// The question generator: fresh questions in the bank's style, rebuilt
// from their id alone, that the answer checker and the twin both handle.
const assert = require("node:assert/strict");
const test = require("node:test");

const generator = require("../Services/questionGenerator");
const questionService = require("../Services/questionService");
const misconceptionService = require("../Services/misconceptionService");
const llmReviewService = require("../Services/llmReviewService");
const twinService = require("../Services/twinService");
const { questions: BANK } = require("../data/questions");

const CONCEPTS = [...new Set(BANK.map((q) => q.concept))];

// A sample of every template, the same every run.
function sampleQuestions(perTemplate = 15) {
  const random = generator.seededRandom("test");
  const out = [];
  for (const [code, template] of Object.entries(generator.TEMPLATES)) {
    let made = 0;
    for (let i = 0; made < perTemplate && i < 500; i++) {
      const values = template.params.map(([min, max]) => min + Math.floor(random() * (max - min + 1)));
      const question = questionService.findQuestionById(`g_${code}_${values.join("_")}`);
      if (question) { out.push(question); made++; }
    }
    assert.equal(made, perTemplate, `template ${code} should produce valid questions`);
  }
  return out;
}

// What a student who gets it right would write.
function correctWork(question) {
  const start = question.question.replace(/^(Solve|Simplify):\s*/, "");
  if (question.question.startsWith("Simplify")) return `${start}\n${question.answer}`;
  return [start, ...question.solution_steps.filter((s) => s.includes("="))].join("\n");
}

test("ids rebuild the exact question, and bad ids are refused", () => {
  const q = questionService.findQuestionById("g_dp1_2_3_4");
  assert.equal(q.question, "Solve: 2(x + 3) = 14");
  assert.equal(q.answer, "4");
  assert.equal(q.concept, "distributive_property");
  assert.equal(q.difficulty, 1);
  assert.deepEqual(questionService.findQuestionById(q.id), q);

  for (const bad of ["g_dp1_99_3_4", "g_dp1_2_3", "g_dp1_2_3_4_5", "g_zz_1_2", "g_dp2_3_6_5", "g_dp1_2_3_x", "g_dp1_-2_3_4", "g_"]) {
    assert.equal(questionService.findQuestionById(bad), null, bad);
  }
  assert.equal(questionService.findQuestionById("dp_001").id, "dp_001", "bank questions still work");
});

test("every topic and level gets questions in the bank's style", () => {
  for (const concept of CONCEPTS) {
    for (const difficulty of [1, 2, 3]) {
      const q = generator.generateQuestion({ concept, difficulty, random: generator.seededRandom(concept + difficulty) });
      assert.ok(q, `${concept} d${difficulty}`);
      assert.equal(q.concept, concept);
      assert.equal(q.difficulty, difficulty);
      assert.match(q.question, /^(Solve|Simplify): /);
      assert.ok(!q.id.includes(":"), "twin memory keys split on ':'");
    }
  }
});

test("equation answers are whole numbers and simplify answers are tidy", () => {
  for (const q of sampleQuestions()) {
    if (q.question.startsWith("Solve")) {
      assert.ok(Number.isInteger(Number(q.answer)), `${q.id}: ${q.answer}`);
    } else {
      assert.match(q.answer, /^\d*x( [+-] \d+)?$/, q.id);
      assert.doesNotMatch(q.question, /\b1x/, `${q.id} writes x, not 1x`);
    }
  }
});

test("correct working on generated questions is accepted with no mistake found", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  for (const q of sampleQuestions(8)) {
    const work = correctWork(q);
    const live = misconceptionService.checkSteps({ questionId: q.id, work });
    assert.deepEqual(live.steps.filter((s) => s.status === "invalid"), [], `${q.id}\n${work}`);

    const result = await misconceptionService.analyzeAnswer({ questionId: q.id, studentAnswer: q.answer, work });
    assert.equal(result.correct, true, q.id);
    assert.equal(result.misconception.detected, false, `${q.id}: ${result.misconception.type}`);
  }
});

test("a classic mistake on a generated question is still diagnosed", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  // 3(x + 4) = 27 solved without distributing: 3x + 4 = 27
  const result = await misconceptionService.analyzeAnswer({
    questionId: "g_dp1_3_4_5",
    studentAnswer: "23/3",
    work: "3(x + 4) = 27\n3x + 4 = 27\n3x = 23\nx = 23/3"
  });
  assert.equal(result.correct, false);
  assert.equal(result.misconception.type, "failed_to_distribute");
});

test("practice keeps the requested level and avoids recent questions", () => {
  const random = generator.seededRandom("practice");
  const recent = [];
  for (let i = 0; i < 30; i++) {
    const q = questionService.getNextQuestion({ concept: "inverse_operations", difficulty: 2, recentQuestionIds: recent, random });
    assert.equal(q.difficulty, 2);
    assert.ok(!recent.includes(q.id), `${q.id} was just seen`);
    recent.push(q.id);
    if (recent.length > 5) recent.shift();
  }
});

test("practice mixes bank and generated questions", () => {
  const random = generator.seededRandom("mix");
  const ids = Array.from({ length: 40 }, () =>
    questionService.getNextQuestion({ concept: "distributive_property", difficulty: 1, random }).id);
  assert.ok(ids.some((id) => generator.isGeneratedId(id)));
  assert.ok(ids.some((id) => !generator.isGeneratedId(id)));
});

test("a targeted session goes beyond the bank once it is used up", () => {
  const used = BANK.filter((q) => q.concept === "equation_balance").map((q) => q.id);
  const next = questionService.getTargetedQuestion({ concept: "equation_balance", usedQuestionIds: used });
  assert.ok(generator.isGeneratedId(next.id));
  assert.equal(next.concept, "equation_balance");
  assert.ok(!used.includes(next.id));

  // Before that, it still walks the bank easiest first.
  const first = questionService.getTargetedQuestion({ concept: "equation_balance" });
  assert.ok(!generator.isGeneratedId(first.id));
});

test("the twin gets new questions once every bank question has been used", () => {
  const all = BANK.map((q) => q.id);
  for (const type of twinService.TWIN_MISCONCEPTIONS) {
    const lesson = twinService.findTwinLesson({ misconceptionType: type, excludeQuestionIds: all });
    assert.ok(lesson, type);
    assert.ok(generator.isGeneratedId(lesson.questionId), `${type}: ${lesson.questionId}`);
    // The server rebuilds the lesson from the id to grade the student.
    const rebuilt = twinService.buildTwinSolution(questionService.findQuestionById(lesson.questionId), type, lesson.variant);
    assert.deepEqual(rebuilt.lines, lesson.lines);
  }
});

test("a seed always gives the same set", () => {
  const a = generator.generateQuestionSet({ seed: "same" }).map((q) => q.id);
  const b = generator.generateQuestionSet({ seed: "same" }).map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});
