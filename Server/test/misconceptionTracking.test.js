const assert = require("node:assert/strict");
const test = require("node:test");

const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");

test("recurring misconceptions retain timestamps and identify their concept", async (t) => {
  const records = new Map();
  t.mock.method(studentStore, "get", async (studentId) =>
    records.get(studentId) || null
  );
  t.mock.method(studentStore, "save", async (student) => {
    records.set(student.studentId, structuredClone(student));
  });
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.3,
    probabilityPercent: 30,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const studentId = "misconception-tracking-test";
  const submission = {
    studentId,
    resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "5.5",
    work: "2(x+3)=14\n2x+3=14\n2x=11\nx=5.5"
  };
  await studySessionService.recordAnswer(submission);
  await studySessionService.recordAnswer(submission);

  const profile = await studySessionService.getStudentProfile(studentId);
  const conceptProfile = await studySessionService.getConceptProfile(
    studentId,
    "distributive_property"
  );
  const tracked =
    records.get(studentId).concepts.distributive_property
      .misconceptionsByType.failed_to_distribute;

  assert.equal(tracked.count, 2);
  assert.ok(Number.isFinite(Date.parse(tracked.firstSeen)));
  assert.ok(Number.isFinite(Date.parse(tracked.lastSeen)));
  assert.equal(profile.commonMistakes[0].type, "failed_to_distribute");
  assert.equal(profile.commonMistakes[0].count, 2);
  assert.equal(
    profile.commonMistakes[0].concept,
    "distributive_property"
  );
  assert.equal(
    conceptProfile.misconceptionsByType.failed_to_distribute.count,
    2
  );
  assert.equal(conceptProfile.rawCorrectRate, 0);
});
