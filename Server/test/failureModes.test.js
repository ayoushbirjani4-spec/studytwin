const assert = require("node:assert/strict");
const test = require("node:test");

const questionService = require("../Services/questionService");
const mlService = require("../Services/mlService");
const llmReviewService = require("../Services/llmReviewService");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");
const misconceptionService = require("../Services/misconceptionService");

function useMemoryStore(t) {
  const records = new Map();
  t.mock.method(studentStore, "get", async (studentId) =>
    records.get(studentId) || null
  );
  t.mock.method(studentStore, "save", async (student) => {
    records.set(student.studentId, structuredClone(student));
  });
  t.mock.method(studentStore, "remove", async (studentId) =>
    records.delete(studentId)
  );
  return records;
}

test("Failure Case 1: LLM service is completely offline/errors out", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => {
    throw new Error("503 Service Unavailable: upstream LLM timed out");
  });
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.5,
    probabilityPercent: 50,
    recommendedDifficulty: 1,
    recommendation: "Practicing with fallback."
  }));

  // Should not throw, should fall back to deterministic rules
  const result = await studySessionService.recordAnswer({
    studentId: "failure_llm_offline",
      resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "5.5",
    work: "2(x+3)=14\n2x+3=14\n2x=11\nx=5.5"
  });

  assert.equal(result.success, true);
  assert.equal(result.answer.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "failed_to_distribute");
  assert.equal(result.misconception.source, "rules");
});

test("Failure Case 2: FastAPI ML service is offline (connection refused)", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);

  // Mock ML service failure
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: false,
    error: "ECONNREFUSED 127.0.0.1:8000"
  }));

  const result = await studySessionService.recordAnswer({
    studentId: "failure_ml_offline",
      resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "4",
    work: "2(x+3)=14\n2x+6=14\n2x=8\nx=4"
  });

  assert.equal(result.success, true);
  assert.equal(result.adaptation.source, "heuristic");
  assert.match(result.adaptation.recommendation, /ML service offline/);
  assert.ok(result.nextQuestion);
});

test("Failure Case 3: Empty student answer or missing answer", async (t) => {
  useMemoryStore(t);

  // Empty string must never match any answer, including "0".
  const emptyVsZero = await misconceptionService.analyzeAnswer({
    questionId: "dp_001",
    studentAnswer: "",
    work: "2(x+3)=14\n2x+6=14"
  });
  assert.equal(emptyVsZero.correct, false, "empty answer should not match a non-zero correct answer");

  // Empty string must not match another empty string.
  // We test this via isAnswerCorrect directly since no question has answer "".
  const { isAnswerCorrect } = misconceptionService;
  assert.equal(isAnswerCorrect("", ""), false, "empty vs empty should not be correct");
  assert.equal(isAnswerCorrect("", "0"), false, "empty vs '0' must be false");
  assert.equal(isAnswerCorrect("0", "0"), true, "explicit zero vs zero should be correct");
  assert.equal(isAnswerCorrect("  ", "4"), false, "whitespace-only answer should not be correct");
});

test("a blank submission is incorrect when the question's correct answer is zero", async (t) => {
  const originalFindQuestion = questionService.findQuestionById;
  t.mock.method(questionService, "findQuestionById", (questionId) =>
    questionId === "zero-answer-test"
      ? {
          id: "zero-answer-test",
          answer: "0",
          concept: "zero_test",
          solution_steps: []
        }
      : originalFindQuestion(questionId)
  );
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);

  const blankSubmission = await misconceptionService.analyzeAnswer({
    questionId: "zero-answer-test",
    studentAnswer: "",
    work: ""
  });
  const explicitZero = await misconceptionService.analyzeAnswer({
    questionId: "zero-answer-test",
    studentAnswer: "0",
    work: ""
  });

  assert.equal(blankSubmission.correct, false);
  assert.equal(explicitZero.correct, true);
});

test("Failure Case 4: Missing work (empty work string)", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.2,
    probabilityPercent: 20,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const result = await studySessionService.recordAnswer({
    studentId: "failure_empty_work",
      resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "100",
    work: ""
  });

  assert.equal(result.success, true);
  assert.equal(result.answer.correct, false);
  assert.equal(result.misconception.detected, false);
  assert.match(result.feedback.message, /Show your working/);
});

test("Failure Case 5: Malformed and unparseable input work", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.2,
    probabilityPercent: 20,
    recommendedDifficulty: 1,
    recommendation: "Review basics."
  }));

  const result = await studySessionService.recordAnswer({
    studentId: "failure_malformed_work",
      resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "bad_answer",
    work: "???\n@@@ === $$$ +++\nhello world"
  });

  assert.equal(result.success, true);
  assert.equal(result.answer.correct, false);
  // Does not crash, handles as unclassified or unpinpointed error
  assert.ok(result.feedback.message);
});

test("Failure Case 6: Unknown question ID", async (t) => {
  useMemoryStore(t);

  await assert.rejects(
    studySessionService.recordAnswer({
      studentId: "failure_bad_qid",
      resetToken: "test-token",
      question: { id: "non_existent_question_999" },
      studentAnswer: "4",
      work: "x=4"
    }),
    /Question not found/
  );
});

test("Failure Case 7: Missing studentId", async (t) => {
  useMemoryStore(t);

  await assert.rejects(
    studySessionService.recordAnswer({
      studentId: "",
      resetToken: "test-token",
      question: { id: "dp_001" },
      studentAnswer: "4",
      work: "x=4"
    }),
    /studentId is required/
  );
});
