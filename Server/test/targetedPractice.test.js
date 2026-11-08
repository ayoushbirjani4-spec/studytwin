const assert = require("node:assert/strict");
const test = require("node:test");

const attemptLogStore = require("../Services/attemptLogStore");
const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");

test("targeted misconception practice progresses and records matching errors", async (t) => {
  const records = new Map();
  t.mock.method(studentStore, "get", async (studentId) => records.get(studentId) || null);
  t.mock.method(studentStore, "save", async (student) => {
    records.set(student.studentId, structuredClone(student));
  });
  t.mock.method(attemptLogStore, "listAttempts", async () => []);
  const loggedAttempts = [];
  t.mock.method(attemptLogStore, "logAttempt", async (attempt) => {
    loggedAttempts.push(structuredClone(attempt));
  });
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.5,
    probabilityPercent: 50,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const studentId = "targeted-practice-student";
  let session = await studySessionService.startSession({
    studentId,
    resetToken: "browser-token",
    concept: "distributive_property",
    difficulty: 1,
    misconceptionType: "failed_to_distribute"
  });

  assert.equal(session.targetedPractice.type, "failed_to_distribute");
  assert.equal(session.question.id, "dp_001");

  const workByQuestion = {
    dp_001: "2(x+3)=14 -> 2x+3=14 -> 2x=8 -> x=4",
    dp_002: "3(x+2)=15 -> 3x+2=15 -> 3x=9 -> x=3",
    dp_003: "4(x-2)=20 -> 4x-2=20 -> 4x=28 -> x=7"
  };
  const answers = { dp_001: "4", dp_002: "3", dp_003: "7" };

  const questionIds = [];
  let result;
  for (let index = 0; index < 3; index++) {
    const questionId = session.question.id;
    questionIds.push(questionId);
    result = await studySessionService.recordAnswer({
      studentId,
      resetToken: "browser-token",
      question: { id: questionId },
      studentAnswer: answers[questionId],
      work: workByQuestion[questionId]
    });
    session.question = result.nextQuestion;
  }

  assert.deepEqual(questionIds, ["dp_001", "dp_002", "dp_003"]);
  assert.equal(result.targetedPractice.completed, true);
  assert.equal(result.targetedPractice.active, false);
  assert.equal(result.targetedPractice.attempts, 3);
  assert.equal(result.targetedPractice.targetErrors, 3);
  assert.ok(result.nextQuestion);
  assert.equal(questionIds.includes(result.nextQuestion.id), false);

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.targetedPractice.attempts, 3);
  assert.equal(profile.targetedPractice.targetErrors, 3);
  assert.ok(loggedAttempts.slice(0, 3).every(row =>
    row.targetedPracticePhase === "focused" &&
    row.targetedPracticeSessionId === profile.targetedPractice.sessionId
  ));

  // Simulate the server later issuing dp_004 (same concept, after practice).
  records.get(studentId).issuedQuestionIds.push("dp_004");
  await studySessionService.recordAnswer({
    studentId,
    resetToken: "browser-token",
    question: { id: "dp_004" },
    studentAnswer: "3",
    work: "5(x+4)=35 -> 5x+20=35 -> 5x=15 -> x=3"
  });
  assert.equal(loggedAttempts[3].targetedPracticePhase, "follow_up");
  assert.equal(loggedAttempts[3].targetedPracticeSessionId, profile.targetedPractice.sessionId);
});
