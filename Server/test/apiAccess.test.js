const assert = require("node:assert/strict");
const test = require("node:test");

const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studentStore = require("../Services/studentStore");
const { app } = require("../index");

test("student endpoints require a matching header token, including concept profiles", async (t) => {
  t.mock.method(studentStore, "get", async (studentId) => {
    if (studentId === "legacy-student") {
      return { studentId, resetToken: null, concepts: {} };
    }
    return {
      studentId,
      resetToken: "expected-token",
      concepts: {}
    };
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const requests = [
    fetch(`${baseUrl}/api/sessions/profile/known-student`),
    fetch(`${baseUrl}/api/sessions/profile/known-student?token=expected-token`),
    fetch(`${baseUrl}/api/sessions/profile/known-student/distributive_property`, {
      headers: { "X-Student-Token": "wrong-token" }
    }),
    fetch(`${baseUrl}/api/sessions/profile/legacy-student`, {
      headers: { "X-Student-Token": "new-token" }
    }),
    fetch(`${baseUrl}/api/students/known-student`, {
      headers: { "X-Student-Token": "wrong-token" }
    }),
    fetch(`${baseUrl}/api/export/attempts`)
  ];

  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.status), [
    403, 403, 403, 403, 403, 403
  ]);

  const startWithoutToken = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: "new-student",
      concept: "distributive_property"
    })
  });
  assert.equal(startWithoutToken.status, 403);
});

test("answer route distinguishes invalid questions from database outages", async (t) => {
  t.mock.method(studentStore, "get", async () => {
    const error = new Error("database selection timed out");
    error.name = "MongoServerSelectionError";
    throw error;
  });
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.5,
    probabilityPercent: 50,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const unavailable = await fetch(`${baseUrl}/api/sessions/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Student-Token": "valid-test-token"
    },
    body: JSON.stringify({
      studentId: "database-outage-test",
      question: { id: "dp_001" },
      studentAnswer: "4",
      work: ""
    })
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).persisted, false);

  const invalidQuestion = await fetch(`${baseUrl}/api/sessions/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Student-Token": "valid-test-token"
    },
    body: JSON.stringify({
      studentId: "database-outage-test",
      question: { id: "not-a-question" },
      studentAnswer: "4",
      work: ""
    })
  });
  assert.equal(invalidQuestion.status, 400);
});
