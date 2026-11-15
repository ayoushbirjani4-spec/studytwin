// Trap rounds: every question is set to catch one mistake, and five clean
// answers in a row cure it.
const assert = require("node:assert/strict");
const test = require("node:test");

const attemptLogStore = require("../Services/attemptLogStore");
const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const questionService = require("../Services/questionService");
const questionGenerator = require("../Services/questionGenerator");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");
const twinService = require("../Services/twinService");

function setUp(t) {
  const records = new Map();
  const logged = [];
  t.mock.method(studentStore, "get", async (studentId) => records.get(studentId) || null);
  t.mock.method(studentStore, "save", async (student) => {
    records.set(student.studentId, structuredClone(student));
  });
  t.mock.method(attemptLogStore, "listAttempts", async () => logged.slice().reverse());
  t.mock.method(attemptLogStore, "logAttempt", async (attempt) => {
    logged.push({ ...structuredClone(attempt), createdAt: new Date(Date.now() + logged.length).toISOString() });
  });
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({
    success: true, probabilityCorrect: 0.5, probabilityPercent: 50, recommendedDifficulty: 1, recommendation: "Keep practicing."
  }));
  return { records, logged };
}

// The student's working for this question: right, or with the mistake.
function answerFor(questionId, mistake = null) {
  const question = questionService.findQuestionById(questionId);
  if (mistake) {
    const lesson = twinService.buildTwinSolution(question, mistake, 0);
    return { studentAnswer: lesson.twinAnswer, work: lesson.lines.join("\n") };
  }
  const start = question.question.replace(/^(Solve|Simplify):\s*/, "");
  return {
    studentAnswer: question.answer,
    work: [start, ...question.solution_steps.filter((s) => s.includes("="))].join("\n")
  };
}

async function startRound(studentId, misconceptionType = "failed_to_distribute", concept = "distributive_property") {
  return studySessionService.startSession({ studentId, resetToken: "token", concept, difficulty: 1, misconceptionType });
}

async function answer(studentId, questionId, mistake) {
  return studySessionService.recordAnswer({
    studentId, resetToken: "token", question: { id: questionId }, ...answerFor(questionId, mistake)
  });
}

test("trap questions are set for the mistake being practised", () => {
  const random = questionGenerator.seededRandom("traps");
  for (const [type, codes] of Object.entries(questionGenerator.TRAPS)) {
    for (const code of codes) {
      const concept = questionGenerator.TEMPLATES[code].concept;
      const question = questionGenerator.generateTrapQuestion({ misconceptionType: type, concept, random });
      assert.equal(question.concept, concept);
      assert.ok(questionGenerator.TRAPS[type].some((c) => question.id.startsWith(`g_${c}_`)), `${type}: ${question.id}`);
      // The mistake can actually show in this question.
      assert.ok(twinService.listTwinVariants(question, type).length > 0, `${type} on ${question.id}`);
    }
  }
});

test("a topic where the mistake can't show still gets a hard question", () => {
  const question = questionGenerator.generateTrapQuestion({ misconceptionType: "combining_unlike_terms", concept: "inverse_operations" });
  assert.equal(question.concept, "inverse_operations");
  assert.equal(question.difficulty, 3);
});

test("five clean answers in a row cure the mistake; getting caught resets the streak", async (t) => {
  const { records, logged } = setUp(t);
  const studentId = "trap-student";
  const session = await startRound(studentId);

  assert.equal(session.targetedPractice.goal, 5);
  assert.equal(session.targetedPractice.streak, 0);
  assert.match(session.question.id, /^g_dp[1-4]_/);

  let questionId = session.question.id;
  let result;
  const plan = ["failed_to_distribute", null, "failed_to_distribute", null, null, null, null, null];
  const seen = [];
  for (const mistake of plan) {
    seen.push(questionId);
    result = await answer(studentId, questionId, mistake);
    assert.equal(result.targetedPractice.caught, Boolean(mistake));
    questionId = result.nextQuestion.id;
  }

  assert.equal(new Set(seen).size, seen.length, "no trap repeats in a round");
  assert.equal(result.targetedPractice.streak, 5);
  assert.equal(result.targetedPractice.cured, true);
  assert.equal(result.targetedPractice.completed, true);
  assert.equal(result.targetedPractice.attempts, 8);
  assert.equal(result.targetedPractice.targetErrors, 2);
  assert.match(result.targetedPractice.trapNote, /first term/);
  assert.ok(logged.every((row) => row.targetedPracticePhase === "focused"));

  let profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.curedMistakes.length, 1);
  assert.equal(profile.curedMistakes[0].type, "failed_to_distribute");
  assert.equal(profile.curedMistakes[0].cameBack, 0);

  // Back in ordinary practice, the mistake comes back once: that is shown.
  records.get(studentId).issuedQuestionIds.push("dp_001");
  await answer(studentId, "dp_001", "failed_to_distribute");
  assert.equal(logged.at(-1).targetedPracticePhase, "follow_up");
  profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.curedMistakes[0].answersSince, 1);
  assert.equal(profile.curedMistakes[0].cameBack, 1);
});

test("a round ends after ten questions without a cure", async (t) => {
  setUp(t);
  const studentId = "trap-student-2";
  let questionId = (await startRound(studentId)).question.id;
  let result;
  for (let i = 0; i < 10; i++) {
    result = await answer(studentId, questionId, i % 2 ? null : "failed_to_distribute");
    if (i < 9) assert.equal(result.targetedPractice.active, true);
    questionId = result.nextQuestion.id;
  }
  assert.equal(result.targetedPractice.completed, true);
  assert.equal(result.targetedPractice.cured, false);
  assert.equal(result.targetedPractice.targetErrors, 5);
  assert.deepEqual((await studySessionService.getStudentProfile(studentId)).curedMistakes, []);
});
