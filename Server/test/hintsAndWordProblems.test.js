// The hint ladder and word problems.
const assert = require("node:assert/strict");
const test = require("node:test");

const misconceptionService = require("../Services/misconceptionService");
const llmReviewService = require("../Services/llmReviewService");
const questionService = require("../Services/questionService");
const twinService = require("../Services/twinService");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const mlService = require("../Services/mlService");
const studySessionService = require("../Services/studySessionService");
const classReportService = require("../Services/classReportService");

test("the correct step is only sent when the student asks for it", () => {
  const work = "2(x + 3) = 14\n2x + 3 = 14";
  const quiet = misconceptionService.checkSteps({ questionId: "dp_001", work });
  assert.equal(quiet.steps[1].status, "invalid");
  assert.ok(!("correctStep" in quiet.steps[1]), "no answer leaks before the last rung");

  const revealed = misconceptionService.checkSteps({ questionId: "dp_001", work, reveal: true });
  assert.equal(revealed.steps[1].correctStep, "2x + 6 = 14");
});

test("hints used are saved with the answer and shown to the teacher per student", async (t) => {
  const records = new Map();
  const logged = [];
  t.mock.method(studentStore, "get", async (id) => records.get(id) || null);
  t.mock.method(studentStore, "save", async (student) => { records.set(student.studentId, structuredClone(student)); });
  t.mock.method(attemptLogStore, "logAttempt", async (row) => { logged.push({ ...row, createdAt: new Date().toISOString() }); });
  t.mock.method(attemptLogStore, "listAttempts", async () => logged.slice());
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true, probabilityCorrect: 0.5, probabilityPercent: 50, recommendedDifficulty: 1, recommendation: "Keep going."
  }));

  const session = await studySessionService.startSession({ studentId: "hinter", resetToken: "tok", concept: "distributive_property", difficulty: 1 });
  await studySessionService.recordAnswer({
    studentId: "hinter", resetToken: "tok", question: { id: session.question.id },
    studentAnswer: "1", work: "x = 1", hintsUsed: 2
  });
  assert.equal(logged[0].hintsUsed, 2);

  t.mock.method(studentStore, "listByClass", async () => [{ studentId: "hinter", displayName: "Hana", classCode: "ABCDEF" }]);
  const report = await classReportService.buildClassReport({ code: "ABCDEF", name: "c", createdAt: null });
  assert.equal(report.students[0].hintsPerAnswer, 2);
});

test("word problems: the student's equation is checked against the story", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  // wp_001: taxi, 2x + 3 = 15, x = 6
  const right = await misconceptionService.analyzeAnswer({ questionId: "wp_001", studentAnswer: "6", work: "2x + 3 = 15\n2x = 12\nx = 6" });
  assert.equal(right.correct, true);
  assert.equal(right.misconception.detected, false);

  // Swapping the fixed charge and the per-mile rate.
  const swapped = await misconceptionService.analyzeAnswer({ questionId: "wp_001", studentAnswer: "4", work: "3x + 2 = 15\n3x = 13\nx = 13/3" });
  assert.equal(swapped.misconception.type, "wrong_equation");
  assert.equal(swapped.misconception.correctStep, "2x + 3 = 15");

  const live = misconceptionService.checkSteps({ questionId: "wp_001", work: "3x + 2 = 15" });
  assert.equal(live.steps[0].label, "wrong_equation");
  const good = misconceptionService.checkSteps({ questionId: "wp_001", work: "2x + 3 = 15\n2x = 12" });
  assert.deepEqual(good.steps.map((s) => s.status), ["valid", "valid"]);

  // Right equation, slip later: the correct step is the next line, not the equation again.
  const later = await misconceptionService.analyzeAnswer({ questionId: "wp_001", studentAnswer: "9", work: "2x + 3 = 15\n2x = 18\nx = 9" });
  assert.equal(later.misconception.type, "wrong_inverse_op");
  assert.equal(later.misconception.correctStep, "2x = 12");
});

test("word problems get twin lessons from their equation", () => {
  const question = questionService.findQuestionById("wp_004");   // 4(x + 2) = 36
  const [lesson] = twinService.listTwinVariants(question, "failed_to_distribute");
  assert.equal(lesson.lines[0], "4(x + 2) = 36");
  assert.equal(lesson.question, question.question, "the twin shows the story");
});
