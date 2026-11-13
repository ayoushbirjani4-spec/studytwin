// "Teach your Twin": the twin's worked solutions with one injected mistake.
const assert = require("node:assert/strict");
const test = require("node:test");

const twinService = require("../Services/twinService");
const misconceptionService = require("../Services/misconceptionService");
const { questions } = require("../data/questions");

const allLessons = () => questions.flatMap((question) =>
  twinService.TWIN_MISCONCEPTIONS
    .map((type) => twinService.buildTwinSolution(question, type))
    .filter(Boolean)
);

test("every twin lesson has exactly one mistake, on the marked line, with the intended label", () => {
  const lessons = allLessons();
  assert.ok(lessons.length > 40, `only ${lessons.length} lessons`);

  for (const lesson of lessons) {
    const check = misconceptionService.checkSteps({
      questionId: lesson.questionId,
      work: lesson.lines.join("\n")
    });
    const invalid = check.steps
      .map((step, index) => ({ ...step, index }))
      .filter((step) => step.status === "invalid");

    assert.equal(invalid.length, 1, `${lesson.questionId}/${lesson.misconceptionType}`);
    assert.equal(invalid[0].index, lesson.wrongIndex);
    assert.equal(invalid[0].label, lesson.misconceptionType);
    assert.ok(check.steps.every((step) => step.status !== "unreadable"));
  }
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
