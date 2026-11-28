// "How to help at home" on the parent link.
const assert = require("node:assert/strict");
const test = require("node:test");

const parentTips = require("../Services/parentTips");
const studySessionService = require("../Services/studySessionService");
const questionGenerator = require("../Services/questionGenerator");

const row = (type, concept) => ({ misconceptionDetected: Boolean(type), misconceptionType: type, concept, createdAt: "2026-11-20T10:00:00Z" });

test("the most frequent mistakes get tips, the one they're stuck on first", () => {
  const rows = [
    row("sign_error", "negative_numbers"), row("sign_error", "negative_numbers"), row("sign_error", "negative_numbers"),
    row("failed_to_distribute", "distributive_property"), row("failed_to_distribute", "distributive_property"),
    row("arithmetic_slip", "inverse_operations"),
    row(null, "inverse_operations")
  ];
  const tips = parentTips.helpAtHome(rows, { stuckOn: { type: "failed_to_distribute" }, seed: "s" });
  assert.deepEqual(tips.map((t) => t.type), ["failed_to_distribute", "sign_error"], "stuck-on first, at most two");
  assert.equal(tips[1].count, 3);
  for (const tip of tips) {
    assert.ok(tip.what && tip.wrong && tip.right && tip.help, tip.type);
    assert.ok(tip.tryThis.question && tip.tryThis.answer, `${tip.type} has a question to try`);
  }
});

test("the practice question targets the mistake in the topic it happened in", () => {
  const [tip] = parentTips.helpAtHome([row("factor_sign_error", "factorising")], { seed: "s" });
  assert.match(tip.tryThis.question, /^Factorise: x²/);
  const same = parentTips.helpAtHome([row("factor_sign_error", "factorising")], { seed: "s" });
  assert.deepEqual(same[0].tryThis, tip.tryThis, "the same seed gives the same question");
});

test("vague mistakes get no tip, and no mistakes means no section", () => {
  assert.deepEqual(parentTips.helpAtHome([row("unknown_error", "quadratics"), row("invalid_step", "quadratics")]), []);
  assert.deepEqual(parentTips.helpAtHome([row(null, "quadratics")]), []);
});

test("the report names recent mistakes by their readable label, not their code", async (t) => {
  const attemptLogStore = require("../Services/attemptLogStore");
  const classReportService = require("../Services/classReportService");
  t.mock.method(attemptLogStore, "listAttempts", async () => [
    row("factor_sign_error", "factorising"), row("factor_sign_error", "factorising"), row("wrong_inverse_op", "inverse_operations")
  ]);
  const report = await classReportService.buildStudentReport({ studentId: "st_labels_1", displayName: "Lee", concepts: {} });
  assert.deepEqual(report.recentMistakes, { factor_sign_error: 2, wrong_inverse_op: 1 });
  assert.deepEqual(report.mistakeLabels, {
    factor_sign_error: "Signs wrong in the brackets",
    wrong_inverse_op: "Wrong inverse operation"
  });
});

test("every mistake that can be practised in a trap round has a tip", () => {
  for (const type of Object.keys(questionGenerator.TRAPS)) {
    assert.ok(parentTips.TIPS[type], `no parent tip for ${type}`);
  }
  for (const type of Object.keys(parentTips.TIPS)) {
    assert.notEqual(studySessionService.labelMisconception(type), type, `${type} has a readable label`);
  }
});
