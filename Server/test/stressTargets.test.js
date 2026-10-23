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

test("Regression Target 1: arrow chain on one line without LLM diagnosed as wrong_inverse_op (io_002)", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);

  const result = await misconceptionService.analyzeAnswer({
    questionId: "io_002",
    studentAnswer: "6",
    work: "x - 4 = 10 -> x = 10 - 4 -> x = 6"
  });

  assert.equal(result.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "wrong_inverse_op");
});

test("Regression Target 2: subtracted coefficient instead of dividing diagnosed as wrong_inverse_op (io_005)", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);

  const result = await misconceptionService.analyzeAnswer({
    questionId: "io_005",
    studentAnswer: "20",
    work: "4x+7=31\n4x=24\nx=24-4\nx=20"
  });

  assert.equal(result.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "wrong_inverse_op");
});

test("Regression Target 3: skipped step with wrong evaluated result diagnosed as arithmetic_slip (eb_002)", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);

  const result = await misconceptionService.analyzeAnswer({
    questionId: "eb_002",
    studentAnswer: "-4",
    work: "x-6=2\nx=-4"
  });

  assert.equal(result.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "arithmetic_slip");
});

test("Correct final answer with an invalid distribution step does not demonstrate mastery across arrow and newline work when LLM review is unavailable", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => {
    throw new Error("LLM service unavailable");
  });
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.5,
    probabilityPercent: 50,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const workSamples = [
    "2(x+3)=14 -> 2x+3=14 -> 2x=8 -> x=4",
    "2(x+3)=14\n2x+3=14\n2x=8\nx=4"
  ];

  for (const [index, work] of workSamples.entries()) {
    const result = await studySessionService.recordAnswer({
      studentId: `correct-answer-invalid-work-${index}`,
      resetToken: "test-token",
      question: { id: "dp_001" },
      studentAnswer: "4",
      work
    });

    assert.equal(result.answer.correct, true);
    assert.equal(result.feedback.correct, false);
    assert.equal(result.misconception.detected, true);
    assert.equal(result.misconception.type, "failed_to_distribute");
  }
});

test("Correct final answer with valid arrow-chain work is not flagged as a misconception", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);

  const result = await misconceptionService.analyzeAnswer({
    questionId: "dp_001",
    studentAnswer: "4",
    work: "2(x+3)=14 -> 2x+6=14 -> 2x=8 -> x=4"
  });

  assert.equal(result.correct, true);
  assert.equal(result.misconception.detected, false);
});

test("Scenario 1: Correct answer and valid work -> Correct feedback; mastery can increase", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.85,
    probabilityPercent: 85,
    recommendedDifficulty: 2,
    recommendation: "Strong performance. Ready for difficulty 2."
  }));

  const studentId = "scenario-1-student";
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "4",
    work: "2(x+3)=14\n2x+6=14\n2x=8\nx=4"
  });

  assert.equal(result.answer.correct, true);
  assert.equal(result.feedback.correct, true);
  assert.equal(result.misconception.detected, false);
  assert.match(result.feedback.message, /Correct/i);

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.attempts, 1);
  assert.equal(profile.overall.correct, 1);
  assert.equal(profile.overall.accuracy, 1);
});

test("Scenario 2: Incorrect answer with a distribution error -> Incorrect feedback; identify faulty step and give valid correction", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.2,
    probabilityPercent: 20,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const studentId = "scenario-2-student";
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "5.5",
    work: "2(x+3)=14\n2x+3=14\n2x=11\nx=5.5"
  });

  assert.equal(result.answer.correct, false);
  assert.equal(result.feedback.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "failed_to_distribute");
  assert.equal(result.misconception.incorrectStep.replace(/\s+/g, ""), "2x+3=14");
  assert.equal(result.misconception.correctStep.replace(/\s+/g, ""), "2x+6=14");
  assert.ok(result.misconception.explanation);

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.attempts, 1);
  assert.equal(profile.overall.correct, 0);
  assert.equal(profile.overall.misconceptionCount, 1);
});

test("Scenario 3: Correct final answer but invalid work -> Answer correctness remains separate from demonstrated mastery", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.5,
    probabilityPercent: 50,
    recommendedDifficulty: 1,
    recommendation: "Keep practicing."
  }));

  const studentId = "scenario-3-student";
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "dp_001" },
    studentAnswer: "4",
    work: "2(x+3)=14\n2x+3=14\n2x=8\nx=4"
  });

  // Final answer was mathematically 4, but work had a distribution flaw
  assert.equal(result.answer.correct, true, "Answer correctness flag should reflect answer value");
  assert.equal(result.feedback.correct, false, "Demonstrated mastery flag should be false when work is flawed");
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "failed_to_distribute");

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.attempts, 1);
  assert.equal(profile.overall.correct, 0, "Mastery counter must not increase despite correct answer");
});

test("Scenario 4: Valid alternative solution method -> Do not flag a mathematically valid method", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.85,
    probabilityPercent: 85,
    recommendedDifficulty: 1,
    recommendation: "Good work."
  }));

  const studentId = "scenario-4-student";
  // For 4(x-2)=20: standard method is expand to 4x-8=20; alternative method is divide by 4 first to get x-2=5
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "dp_003" },
    studentAnswer: "7",
    work: "4(x-2)=20\n(x-2)=5\nx-2=5\nx=7"
  });

  assert.equal(result.answer.correct, true);
  assert.equal(result.feedback.correct, true);
  assert.equal(result.misconception.detected, false);

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.attempts, 1);
  assert.equal(profile.overall.correct, 1);
});

test("Scenario 5: LLM unavailable -> Deterministic checks and ML fallback still work", async (t) => {
  useMemoryStore(t);
  // LLM throws error
  t.mock.method(llmReviewService, "reviewSubmission", async () => {
    throw new Error("Service unavailable 503");
  });
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true,
    probabilityCorrect: 0.6,
    probabilityPercent: 60,
    recommendedDifficulty: 1,
    recommendation: "Practicing with fallback."
  }));

  const studentId = "scenario-5-student";
  // Submit with an inverse op error
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "io_001" },
    studentAnswer: "17",
    work: "x+5=12\nx=12+5\nx=17"
  });

  assert.equal(result.answer.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "wrong_inverse_op");
  assert.equal(result.misconception.source, "rules");
});
