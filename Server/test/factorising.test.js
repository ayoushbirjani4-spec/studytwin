// Factorising: answers checked by value, and must be fully factorised.
const assert = require("node:assert/strict");
const test = require("node:test");

const misconceptionService = require("../Services/misconceptionService");
const llmReviewService = require("../Services/llmReviewService");
const questionService = require("../Services/questionService");
const generator = require("../Services/questionGenerator");

async function check(questionId, studentAnswer, work = "") {
  return misconceptionService.analyzeAnswer({ questionId, studentAnswer, work });
}

test("factorising is a topic with questions at every level", () => {
  assert.ok(questionService.getConcepts().some((c) => (c.concept ?? c) === "factorising"));
  for (const difficulty of [1, 2, 3]) {
    const q = generator.generateQuestion({ concept: "factorising", difficulty, random: generator.seededRandom("fc" + difficulty) });
    assert.equal(q.concept, "factorising");
    assert.equal(questionService.findQuestionById(q.id).answer, q.answer, "rebuilt from its id");
  }
});

test("right answers are accepted in any order and spacing", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  for (const [id, answer] of [["fc_001", "3(2x + 3)"], ["fc_003", "(x+3)(x+2)"], ["fc_004", "(x - 3)(x + 5)"], ["fc_005", "(x-7)(x+7)"]]) {
    const result = await check(id, answer);
    assert.equal(result.correct, true, `${id}: ${answer}`);
    assert.equal(result.misconception.detected, false, `${id}: ${result.misconception.type}`);
  }
});

test("classic factorising mistakes are named", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  const cases = [
    ["fc_002", "2(6x + 4)", "not_fully_factorised"],
    ["fc_001", "3(2x + 9)", "factor_out_one_term"],
    ["fc_003", "(x - 2)(x - 3)", "factor_sign_error"],
    ["fc_004", "(x - 5)(x + 3)", "factor_sign_error"],
    ["fc_003", "(x + 1)(x + 6)", "wrong_factor_pair"],
    ["fc_003", "x² + 5x + 6", "not_factorised"]
  ];
  for (const [id, answer, type] of cases) {
    const result = await check(id, answer);
    assert.equal(result.correct, false, `${id}: ${answer}`);
    assert.equal(result.misconception.type, type, `${id}: ${answer}`);
  }
});

test("live steps: a wrong middle line is caught, the answer line isn't judged", () => {
  const ok = misconceptionService.checkSteps({ questionId: "fc_003", work: "x² + 5x + 6\nx² + 2x + 3x + 6\n(x + 2)(x + 3)" });
  assert.deepEqual(ok.steps.map((s) => s.status), ["given", "valid", "final"]);

  const bad = misconceptionService.checkSteps({ questionId: "fc_003", work: "x² + 5x + 6\nx² + 2x + 2x + 6\n(x + 2)(x + 2)" });
  assert.equal(bad.firstErrorIndex, 1);
  assert.equal(bad.steps[2].status, "final", "a wrong answer line isn't revealed live");
});

test("the twin shows factorising mistakes and accepts the right fix", () => {
  const twinService = require("../Services/twinService");
  const [signs] = twinService.listTwinVariants(questionService.findQuestionById("fc_003"), "factor_sign_error");
  assert.deepEqual(signs.lines, ["x² + 5x + 6", "(x - 2)(x - 3)"]);
  const [oneTerm] = twinService.listTwinVariants(questionService.findQuestionById("fc_001"), "factor_out_one_term");
  assert.deepEqual(oneTerm.lines, ["6x + 9", "3(2x + 9)"]);
  // x² - 49: swapping the signs gives the same answer, so it's no lesson.
  assert.deepEqual(twinService.listTwinVariants(questionService.findQuestionById("fc_005"), "factor_sign_error"), []);
});

test("a trap round targets the factorising mistake", () => {
  const q = generator.generateTrapQuestion({ misconceptionType: "factor_sign_error", concept: "factorising", random: generator.seededRandom("trap") });
  assert.equal(q.concept, "factorising");
  assert.match(q.id, /^g_fc[23]_/);
});
