const assert = require("node:assert/strict");
const test = require("node:test");

const attemptLogStore = require("../Services/attemptLogStore");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");

test("focused practice impact compares recorded before and subsequent error rates", async (t) => {
  const sessionId = "target-session-1";
  t.mock.method(studentStore, "get", async () => ({
    studentId: "impact-student",
    concepts: {
      distributive_property: {
        attempts: 23,
        correct: 10,
        rawCorrect: 12,
        recentResults: [],
        misconceptionCount: 5,
        misconceptionsByType: {
          failed_to_distribute: { count: 5, firstSeen: null, lastSeen: null }
        },
        currentDifficulty: 1,
        previousCorrect: true,
        recentQuestionIds: []
      }
    },
    targetedPractice: {
      sessionId,
      type: "failed_to_distribute",
      concept: "distributive_property",
      attempts: 3,
      targetErrors: 2,
      active: false,
      completed: true,
      baseline: { attempts: 10, errors: 4 }
    }
  }));
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => ({
      concept: "distributive_property",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      misconceptionDetected: index < 4,
      misconceptionType: index < 4 ? "failed_to_distribute" : null
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      concept: "distributive_property",
      targetedPracticeSessionId: sessionId,
      targetedPracticePhase: "follow_up",
      createdAt: new Date(Date.UTC(2026, 0, 2, 0, index)).toISOString(),
      misconceptionDetected: index === 2,
      misconceptionType: index === 2 ? "failed_to_distribute" : null
    }))
  ];
  t.mock.method(attemptLogStore, "listAttempts", async () => rows);

  const profile = await studySessionService.getStudentProfile("impact-student");
  assert.deepEqual(profile.targetedPracticeImpact.before, {
    attempts: 10,
    errors: 4,
    rate: 0.4
  });
  assert.deepEqual(profile.targetedPracticeImpact.followUp, {
    attempts: 10,
    errors: 1,
    rate: 0.1
  });
  assert.equal(profile.targetedPracticeImpact.status, "Improving");
});

test("focused practice impact stays provisional until ten follow-up attempts are recorded", async (t) => {
  t.mock.method(studentStore, "get", async () => ({
    studentId: "impact-student",
    concepts: {},
    targetedPractice: {
      sessionId: "target-session-2",
      type: "failed_to_distribute",
      concept: "distributive_property",
      attempts: 3,
      targetErrors: 1,
      completed: true,
      baseline: { attempts: 10, errors: 4 }
    }
  }));
  t.mock.method(attemptLogStore, "listAttempts", async () => [
    { concept: "distributive_property", targetedPracticeSessionId: "target-session-2", targetedPracticePhase: "follow_up", createdAt: new Date().toISOString(), misconceptionDetected: false }
  ]);

  const profile = await studySessionService.getStudentProfile("impact-student");
  assert.equal(profile.targetedPracticeImpact.status, "Not enough follow-up attempts yet");
  assert.equal(profile.targetedPracticeImpact.followUp.attempts, 1);
});
