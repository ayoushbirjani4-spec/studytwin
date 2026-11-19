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

test("dividing by a negative number is a valid step (-3x = -6 gives x = 2)", async (t) => {
  assert.equal(misconceptionService.equationsEquivalent("-3x = -6", "x = 2"), true);
  assert.equal(misconceptionService.equationsEquivalent("-3x + 12 = 6", "x = 2"), true);
  assert.equal(misconceptionService.equationsEquivalent("-3x = -6", "x = -2"), false);

  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  const question = { id: "neg_mult", question: "Solve: -3(x - 4) = 6", concept: "distributive_property", difficulty: 3, answer: "2",
    solution_steps: ["-3x + 12 = 6", "-3x = -6", "x = 2"], explanation: "" };
  const find = questionService.findQuestionById;
  t.mock.method(questionService, "findQuestionById", (id) => (id === "neg_mult" ? question : find(id)));

  const right = await misconceptionService.analyzeAnswer({
    questionId: "neg_mult", studentAnswer: "2", work: "-3(x - 4) = 6\n-3x + 12 = 6\n-3x = -6\nx = 2"
  });
  assert.equal(right.correct, true);
  assert.equal(right.misconception.detected, false);

  const sign = await misconceptionService.analyzeAnswer({
    questionId: "neg_mult", studentAnswer: "-6", work: "-3(x - 4) = 6\n-3x - 12 = 6\n-3x = 18\nx = -6"
  });
  assert.equal(sign.misconception.type, "sign_error");
});

test("x on both sides: moving an x term without changing its sign, or changing one side, is diagnosed", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  // 4x + 3 = x + 15
  const moved = await misconceptionService.analyzeAnswer({
    questionId: "xb_002", studentAnswer: "12/5", work: "4x + 3 = x + 15\n5x + 3 = 15\n5x = 12\nx = 12/5"
  });
  assert.equal(moved.misconception.type, "wrong_inverse_op");
  assert.equal(moved.misconception.correctStep, "3x + 3 = 15", "the next worked line, not the final answer");

  const oneSide = await misconceptionService.analyzeAnswer({
    questionId: "xb_002", studentAnswer: "6", work: "4x + 3 = x + 15\n3x + 3 = x + 15\n2x + 3 = 15\nx = 6"
  });
  assert.equal(oneSide.misconception.type, "one_sided_op");

  const right = await misconceptionService.analyzeAnswer({
    questionId: "xb_002", studentAnswer: "4", work: "4x + 3 = x + 15\n4x = x + 12\n3x = 12\nx = 4"
  });
  assert.equal(right.correct, true, "collecting in another order is fine");
  assert.equal(right.misconception.detected, false);
});

test("the twin has lessons for x on both sides", () => {
  for (const id of ["xb_001", "xb_002", "xb_003", "xb_004", "xb_005"]) {
    const question = questionService.findQuestionById(id);
    for (const type of ["wrong_inverse_op", "one_sided_op"]) {
      const [lesson] = twinService.listTwinVariants(question, type);
      assert.ok(lesson, `${id} ${type}`);
      assert.equal(lesson.stage, "isolate");
    }
  }
  const lesson = twinService.findTwinLesson({ misconceptionType: "one_sided_op", concept: "x_on_both_sides" });
  assert.equal(lesson.concept ?? questionService.findQuestionById(lesson.questionId).concept, "x_on_both_sides");
});

test("negative numbers: losing the minus when dividing is a sign error", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  // -4x = 20, so x = -5
  const lost = await misconceptionService.analyzeAnswer({ questionId: "ng_002", studentAnswer: "5", work: "-4x = 20\nx = 20/4\nx = 5" });
  assert.equal(lost.misconception.type, "sign_error");
  // -2x + 7 = 15 -> -2x = 8 -> x = 4 (should be -4)
  const later = await misconceptionService.analyzeAnswer({ questionId: "ng_005", studentAnswer: "4", work: "-2x + 7 = 15\n-2x = 8\nx = 4" });
  assert.equal(later.misconception.type, "sign_error");

  const lesson = twinService.findTwinLesson({ misconceptionType: "sign_error", concept: "negative_numbers" });
  assert.equal(questionService.findQuestionById(lesson.questionId).concept, "negative_numbers");
});

test("fractions: dividing the other side instead of multiplying is a wrong inverse operation", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  const bracket = await misconceptionService.analyzeAnswer({ questionId: "fr_004", studentAnswer: "-2/3", work: "(x + 2)/3 = 4\nx + 2 = 4/3\nx = -2/3" });
  assert.equal(bracket.misconception.type, "wrong_inverse_op");
  const plain = await misconceptionService.analyzeAnswer({ questionId: "fr_002", studentAnswer: "4/3", work: "x/3 + 2 = 6\nx/3 = 4\nx = 4/3" });
  assert.equal(plain.misconception.type, "wrong_inverse_op");

  for (const id of ["fr_002", "fr_004"]) {
    assert.ok(twinService.listTwinVariants(questionService.findQuestionById(id), "wrong_inverse_op").length, id);
  }
});

test("a correct simplify answer with checked working is settled by the rules, without Gemini", async (t) => {
  let calls = 0;
  t.mock.method(llmReviewService, "reviewSubmission", async () => { calls++; return null; });
  for (const work of ["8x - 5 + 3x + 2\n11x - 3", "8x - 5 + 3x + 2 -> 8x + 3x - 5 + 2 -> 11x - 3"]) {
    const result = await misconceptionService.analyzeAnswer({ questionId: "clt_004", studentAnswer: "11x - 3", work });
    assert.equal(result.correct, true);
    assert.equal(result.misconception.detected, false);
  }
  assert.equal(calls, 0);

  // A wrong middle line is still found, by the rules.
  const flawed = await misconceptionService.analyzeAnswer({ questionId: "clt_004", studentAnswer: "11x - 3", work: "8x - 5 + 3x + 2\n11x + 7\n11x - 3" });
  assert.equal(flawed.misconception.detected, true);
  assert.equal(calls, 0);
});
