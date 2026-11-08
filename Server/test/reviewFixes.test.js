// Regression tests for the 2026-11-08 audit fixes:
//   - concurrent submissions must not lose a progress update
//   - MongoDB saves reject a stale revision instead of overwriting
//   - Gemini output cut off at the token limit is rejected
//   - LLM steps from arrow-chain working are matched
const assert = require("node:assert/strict");
const test = require("node:test");
const { MongoClient } = require("mongodb");

const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");

function withGeminiEnv(t, model = "gemini-2.5-flash") {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "LLM_API_KEY", "LLM_API_URL", "LLM_MODEL"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = model;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_API_URL;
  delete process.env.LLM_MODEL;
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function geminiResponse(review, finishReason = "STOP") {
  return new Response(JSON.stringify({
    candidates: [{
      finishReason,
      content: { parts: [{ text: JSON.stringify(review) }] }
    }]
  }), { status: 200 });
}

test("two simultaneous submissions for one student both count", async (t) => {
  const records = new Map();
  t.mock.method(studentStore, "get", async (studentId) => {
    const record = records.get(studentId);
    // Yield so two unlocked requests would both read the same old state.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return record ? structuredClone(record) : null;
  });
  t.mock.method(studentStore, "save", async (student) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    records.set(student.studentId, structuredClone(student));
  });
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.5,
    probabilityPercent: 50,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const submission = {
    studentId: "race-student",
    resetToken: "race-token",
    question: { id: "dp_001" },
    studentAnswer: "4",
    work: "2(x+3)=14\n2x+6=14\n2x=8\nx=4"
  };

  await Promise.all([
    studySessionService.recordAnswer(submission),
    studySessionService.recordAnswer(submission)
  ]);

  assert.equal(records.get("race-student").concepts.distributive_property.attempts, 2);
});

test("a failed submission does not block the next one for that student", async (t) => {
  t.mock.method(studentStore, "get", async () => null);
  t.mock.method(studentStore, "save", async () => {});

  await assert.rejects(studySessionService.recordAnswer({ studentId: "lock-student" }));
  await assert.rejects(
    studySessionService.recordAnswer({ studentId: "lock-student", resetToken: "t", question: { id: "missing" } })
  );
});

test("MongoDB save rejects a stale revision with a 409 instead of overwriting", async (t) => {
  const originalEnv = { MEMORY_STORE: process.env.MEMORY_STORE, MONGODB_URI: process.env.MONGODB_URI };
  delete process.env.MEMORY_STORE;
  process.env.MONGODB_URI = "mongodb://fake-host/test";
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Minimal in-memory stand-in for replaceOne's filter + upsert semantics.
  const docs = new Map();
  const matches = (doc, filter) => {
    if (!doc || doc._id !== filter._id) return false;
    if (filter.$or) {
      return filter.$or.some((clause) =>
        clause.revision?.$exists === false ? doc.revision === undefined : doc.revision === clause.revision
      );
    }
    return doc.revision === filter.revision;
  };
  const collection = {
    findOne: async ({ _id }) => (docs.has(_id) ? structuredClone(docs.get(_id)) : null),
    replaceOne: async (filter, doc) => {
      const existing = docs.get(filter._id);
      if (matches(existing, filter) || !existing) {
        docs.set(filter._id, structuredClone(doc));
        return;
      }
      const error = new Error("E11000 duplicate key error");
      error.code = 11000;
      throw error;
    }
  };
  t.mock.method(MongoClient.prototype, "connect", async function connect() { return this; });
  t.mock.method(MongoClient.prototype, "db", () => ({ collection: () => collection }));

  await studentStore.save({ studentId: "s1", concepts: {}, resetToken: "tok" });
  const first = await studentStore.get("s1");
  const second = await studentStore.get("s1");
  assert.equal(first.revision, 1);

  first.concepts = { a: { attempts: 1 } };
  await studentStore.save(first);

  second.concepts = { a: { attempts: 99 } };
  await assert.rejects(studentStore.save(second), (error) => error.statusCode === 409);
  assert.equal((await studentStore.get("s1")).concepts.a.attempts, 1);
});

test("Gemini 2.5 Flash requests disable thinking so JSON is not truncated", async (t) => {
  withGeminiEnv(t);
  let body;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    body = JSON.parse(options.body);
    return geminiResponse({
      step_label: null, incorrect_step: null, correct_step: null, step_explanation: null, confidence: 0.9
    });
  });

  await llmReviewService.reviewSubmission({
    question: "Solve x+1=2", studentAnswer: "1", correctAnswer: "1", work: "x+1=2\nx=1"
  });

  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test("Gemini models other than 2.5 Flash do not get a zero thinking budget", async (t) => {
  withGeminiEnv(t, "gemini-2.5-pro");
  let body;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    body = JSON.parse(options.body);
    return geminiResponse({
      step_label: null, incorrect_step: null, correct_step: null, step_explanation: null, confidence: 0.9
    });
  });

  await llmReviewService.reviewSubmission({
    question: "Solve x+1=2", studentAnswer: "1", correctAnswer: "1", work: "x+1=2\nx=1"
  });

  assert.equal(body.generationConfig.thinkingConfig, undefined);
});

test("Gemini output cut off at the token limit is rejected", async (t) => {
  withGeminiEnv(t);
  t.mock.method(globalThis, "fetch", async () =>
    geminiResponse({
      step_label: null, incorrect_step: null, correct_step: null, step_explanation: null, confidence: 0.9
    }, "MAX_TOKENS")
  );

  await assert.rejects(
    llmReviewService.reviewSubmission({
      question: "Solve x+1=2", studentAnswer: "1", correctAnswer: "1", work: "x+1=2\nx=1"
    }),
    /cut off/
  );
});

test("an LLM step taken from arrow-chain working is accepted", async (t) => {
  withGeminiEnv(t);
  t.mock.method(globalThis, "fetch", async () =>
    geminiResponse({
      step_label: "wrong_inverse_op",
      incorrect_step: "x = 10 - 4",
      correct_step: "x = 10 + 4",
      step_explanation: "Add 4 to both sides.",
      confidence: 0.9
    })
  );

  const review = await llmReviewService.reviewSubmission({
    question: "Solve x-4=10",
    studentAnswer: "6",
    correctAnswer: "14",
    work: "x - 4 = 10 -> x = 10 - 4 -> x = 6"
  });

  assert.equal(review.label, "wrong_inverse_op");
  assert.equal(review.incorrectStep, "x = 10 - 4");
});
