const assert = require("node:assert/strict");
const test = require("node:test");

const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
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
  const trendRows = Array.from({ length: 20 }, (_, index) => ({
    studentId: "misconception-tracking-test",
    concept: "distributive_property",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    misconceptionDetected: index < 4 || index === 17 || index === 4 || index === 12,
    misconceptionType: index < 4 || index === 17
      ? "failed_to_distribute"
      : index === 4 || index === 12
        ? "sign_error"
        : null,
    answerCorrect: false,
    demonstratedCorrect: false
  }));
  t.mock.method(attemptLogStore, "listAttempts", async () => trendRows);

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
  assert.deepEqual(profile.misconceptionTrends[0], {
    type: "failed_to_distribute",
    label: "Failed to distribute",
    status: "Improving",
    previous: { errors: 4, attempts: 10, rate: 0.4 },
    recent: { errors: 1, attempts: 10, rate: 0.1 }
  });
  assert.equal(profile.misconceptionTrends[1].type, "sign_error");
  assert.equal(profile.misconceptionTrends[1].status, "Needs more practice");
  assert.equal(profile.misconceptionTrends[1].previous.rate, 0.1);
  assert.equal(profile.misconceptionTrends[1].recent.rate, 0.1);
});

test("misconception trend says not enough attempts until two complete windows exist", async (t) => {
  t.mock.method(studentStore, "get", async (studentId) => ({
    studentId,
    concepts: {
      distributive_property: {
        attempts: 8,
        correct: 2,
        rawCorrect: 3,
        recentResults: [],
        misconceptionCount: 2,
        misconceptionsByType: {
          failed_to_distribute: { count: 2, firstSeen: null, lastSeen: null }
        },
        currentDifficulty: 1,
        previousCorrect: false,
        recentQuestionIds: []
      }
    }
  }));
  t.mock.method(attemptLogStore, "listAttempts", async () =>
    Array.from({ length: 8 }, (_, index) => ({
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      misconceptionDetected: index === 1,
      misconceptionType: index === 1 ? "failed_to_distribute" : null
    }))
  );

  const profile = await studySessionService.getStudentProfile("trend-student");
  assert.equal(
    profile.misconceptionTrends[0].status,
    "Not enough attempts yet"
  );
  assert.equal(profile.misconceptionTrends[0].previous, null);
  assert.deepEqual(profile.misconceptionTrends[0].recent, {
    errors: 1,
    attempts: 8,
    rate: 0.125
  });
});
