// "Teach your Twin": the twin's worked solutions with one injected mistake.
const assert = require("node:assert/strict");
const test = require("node:test");

const twinService = require("../Services/twinService");
const misconceptionService = require("../Services/misconceptionService");
const { questions } = require("../data/questions");

// Every variant of every misconception on every question.
const allLessons = () => questions.flatMap((question) =>
  twinService.TWIN_MISCONCEPTIONS.flatMap((type) => twinService.listTwinVariants(question, type))
);

test("every twin lesson has exactly one mistake, on the marked line, with the intended label", () => {
  const lessons = allLessons();
  assert.ok(lessons.length > 60, `only ${lessons.length} lessons`);

  for (const lesson of lessons) {
    const id = `${lesson.questionId}/${lesson.misconceptionType}/${lesson.stage}`;
    const check = misconceptionService.checkSteps({
      questionId: lesson.questionId,
      work: lesson.lines.join("\n")
    });
    const invalid = check.steps
      .map((step, index) => ({ ...step, index }))
      .filter((step) => step.status === "invalid");
    assert.ok(check.steps.every((step) => step.status !== "unreadable"), id);

    if (lesson.stage === "evaluate") {
      // A slip in the final value sits on a bare "x = ..." line, which the
      // live checker never judges; every earlier step must be valid and the
      // last line must not follow from the one before.
      const last = lesson.lines.length - 1;
      assert.equal(invalid.length, 0, id);
      assert.equal(lesson.wrongIndex, last, id);
      assert.equal(
        misconceptionService.equationsEquivalent(lesson.lines[last - 1], lesson.lines[last]),
        false,
        id
      );
    } else {
      assert.equal(invalid.length, 1, id);
      assert.equal(invalid[0].index, lesson.wrongIndex, id);
      assert.equal(invalid[0].label, lesson.misconceptionType, id);
    }
  }
});

test("the twin makes mistakes at every step of a solution, not just the expansion", () => {
  const stages = new Set(allLessons().map((lesson) => lesson.stage));
  for (const stage of ["expand", "isolate", "divide", "evaluate", "combine"]) {
    assert.ok(stages.has(stage), `no lesson with a mistake while ${stage}`);
  }

  // The same problem can host mistakes at different lines.
  const q = questions.find((x) => x.id === "dp_004");
  const wrongLines = new Set(
    twinService.TWIN_MISCONCEPTIONS.flatMap((type) => twinService.listTwinVariants(q, type))
      .map((lesson) => lesson.wrongIndex)
  );
  assert.ok(wrongLines.size >= 4, `only lines ${[...wrongLines]}`);
});

test("a final-value slip looks the way a student would write it", () => {
  const lesson = twinService.listTwinVariants(questions.find((q) => q.id === "dp_004"), "arithmetic_slip")
    .find((l) => l.stage === "evaluate");
  assert.deepEqual(lesson.lines, [
    "5(x + 4) = 35",
    "5x + 20 = 35",
    "5x = 35 - 20",
    "5x = 15",
    "x = 15/5",
    "x = 4"
  ]);
  assert.equal(lesson.wrongIndex, 5);
});

test("the twin's answer is wrong and is what its last line says", () => {
  for (const lesson of allLessons()) {
    const last = lesson.lines[lesson.lines.length - 1];
    assert.equal(lesson.twinAnswer, last.includes("=") ? last.split("=").pop().trim() : last);
    assert.notEqual(
      misconceptionService.normalizeAnswer
        ? misconceptionService.normalizeAnswer(lesson.twinAnswer)
        : lesson.twinAnswer.replace(/\s+/g, ""),
      misconceptionService.normalizeAnswer
        ? misconceptionService.normalizeAnswer(lesson.correctAnswer)
        : lesson.correctAnswer.replace(/\s+/g, ""),
      `${lesson.questionId}/${lesson.misconceptionType}`
    );
  }
});

test("the twin never writes the same line twice in a row", () => {
  for (const lesson of allLessons()) {
    for (let i = 1; i < lesson.lines.length; i++) {
      assert.notEqual(lesson.lines[i], lesson.lines[i - 1], `${lesson.questionId}/${lesson.misconceptionType}`);
    }
  }
});

test("each misconception has at least three questions the twin can use", () => {
  for (const type of twinService.TWIN_MISCONCEPTIONS) {
    const count = questions.filter((q) => twinService.buildTwinSolution(q, type)).length;
    assert.ok(count >= 3, `${type}: ${count}`);
  }
});

test("a classic distribution mistake looks the way a student would write it", () => {
  const lesson = twinService.buildTwinSolution(
    questions.find((q) => q.id === "dp_001"),
    "failed_to_distribute"
  );

  assert.deepEqual(lesson.lines, [
    "2(x + 3) = 14",
    "2x + 3 = 14",
    "2x = 14 - 3",
    "2x = 11",
    "x = 11/2",
    "x = 5.5"
  ]);
  assert.equal(lesson.wrongIndex, 1);
  assert.equal(lesson.twinAnswer, "5.5");
});

test("lessons are deterministic, prefer the concept, and skip used questions", () => {
  const first = twinService.findTwinLesson({ misconceptionType: "sign_error", concept: "distributive_property" });
  const again = twinService.findTwinLesson({ misconceptionType: "sign_error", concept: "distributive_property" });
  assert.deepEqual(first, again);
  assert.equal(first.concept, "distributive_property");

  const next = twinService.findTwinLesson({
    misconceptionType: "sign_error",
    concept: "distributive_property",
    excludeQuestionIds: [first.questionId]
  });
  assert.notEqual(next.questionId, first.questionId);
});

test("misconceptions that do not fit a question are skipped, never faked", () => {
  const noBrackets = questions.find((q) => q.id === "io_001");
  assert.equal(twinService.buildTwinSolution(noBrackets, "failed_to_distribute"), null);
  assert.equal(twinService.buildTwinSolution(noBrackets, "not_a_misconception"), null);

  // Falls back to another concept when the preferred one has no fit.
  const lesson = twinService.findTwinLesson({
    misconceptionType: "failed_to_distribute",
    concept: "inverse_operations"
  });
  assert.equal(lesson.concept, "distributive_property");
});
