const assert = require("node:assert/strict");
const test = require("node:test");

const questionService = require("../Services/questionService");
const mlService = require("../Services/mlService");
const llmReviewService = require("../Services/llmReviewService");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");
const misconceptionService = require("../Services/misconceptionService");

function assertStudentQuestion(question) {
  assert.deepEqual(Object.keys(question).sort(), [
    "concept",
    "difficulty",
    "id",
    "question"
  ]);
}

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

test("question answers and worked solutions are returned only after submission", async (t) => {
  useMemoryStore(t);
  t.mock.method(
    llmReviewService,
    "reviewSubmission",
    async () => null
  );
  const studentId = "question-payload-test";
  const questions = studySessionService.getAllQuestions();

  assert.ok(questions.length > 0);
  questions.forEach(assertStudentQuestion);

  const session = await studySessionService.startSession({
    studentId,
    concept: "distributive_property",
    difficulty: 1
  });

  assertStudentQuestion(session.question);

  t.mock.method(
    mlService,
    "getLearningRecommendation",
    async () => ({
      success: true,
      probabilityCorrect: 0.5,
      probabilityPercent: 50,
      recommendedDifficulty: 1,
      recommendation: "Keep practicing."
    })
  );

  const submittedQuestion =
    questionService.getQuestionById(session.question.id);

  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: session.question.id },
    studentAnswer: submittedQuestion.answer,
    work: "Work shown"
  });

  assert.equal(
    result.answer.correctAnswer,
    submittedQuestion.answer
  );
  assert.equal(result.answer.checkedBy, "rules");
  assert.deepEqual(
    result.solution.steps,
    submittedQuestion.solution_steps
  );
  assert.deepEqual(result.solution.submittedSteps, ["Work shown"]);
  assertStudentQuestion(result.nextQuestion);

  const profile =
    await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.attempts, 1);
});

test("deterministic answer checking controls progress regardless of an LLM answer claim", async (t) => {
  useMemoryStore(t);
  let llmAnswerClaim = true;
  t.mock.method(
    llmReviewService,
    "reviewSubmission",
    async () => ({
      answerCorrect: llmAnswerClaim,
      label: null,
      incorrectStep: null,
      confidence: 0.9
    })
  );
  t.mock.method(
    mlService,
    "getLearningRecommendation",
    async () => ({
      success: true,
      probabilityCorrect: 0.5,
      probabilityPercent: 50,
      recommendedDifficulty: 1,
      recommendation: "Keep practicing."
    })
  );

  const studentId = "llm-cannot-grade-test";
  const session = await studySessionService.startSession({
    studentId,
    concept: "distributive_property",
    difficulty: 1
  });
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: session.question.id },
    studentAnswer: "deliberately incorrect",
    work: ""
  });

  assert.equal(result.answer.correct, false);
  assert.equal(result.answer.checkedBy, "rules");

  // Resubmitting the answered question (e.g. after seeing the solution) is refused.
  await assert.rejects(
    studySessionService.recordAnswer({
      studentId,
      resetToken: "test-token",
      question: { id: session.question.id },
      studentAnswer: questionService.getQuestionById(session.question.id).answer,
      work: ""
    }),
    (error) => error.statusCode === 409
  );

  llmAnswerClaim = false;
  const correctlyAnswered = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: result.nextQuestion.id },
    studentAnswer: questionService.getQuestionById(result.nextQuestion.id).answer,
    work: ""
  });
  assert.equal(correctlyAnswered.answer.correct, true);
  assert.equal(correctlyAnswered.answer.checkedBy, "rules");

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.attempts, 2);
  assert.equal(profile.overall.correct, 1);
});

test("the LLM is consulted only when the rules cannot diagnose the work", async (t) => {
  let request;
  let reviewCalls = 0;

  t.mock.method(
    llmReviewService,
    "reviewSubmission",
    async (input) => {
      reviewCalls += 1;
      request = input;
      return {
        label: "wrong_inverse_op",
        incorrectStep: "3x=18 -> x=18*3 -> x=54",
        confidence: 0.9
      };
    }
  );

  const result = await misconceptionService.analyzeAnswer({
    questionId: "io_003",
    studentAnswer: "54",
    work: "3x=18 -> x=18*3 -> x=54"
  });

  // The rules diagnose this one themselves, so the LLM is never called.
  assert.equal(result.correct, false);
  assert.equal(reviewCalls, 0);
  assert.equal(result.correctnessSource, "rules");
  assert.equal(result.misconception.type, "wrong_inverse_op");
  assert.equal(result.misconception.source, "rules");
  assert.equal(result.misconception.confidence, 0.9);
  assert.equal(
    result.misconception.incorrectStep,
    "x=18*3"
  );

  // Valid steps but a wrong final answer: the rules cannot explain it.
  const parsedWorkResult = await misconceptionService.analyzeAnswer({
    questionId: "io_003",
    studentAnswer: "54",
    work: "3x=18\nx=18/3"
  });

  assert.equal(
    parsedWorkResult.misconception.type,
    "unknown_error"
  );
  assert.equal(reviewCalls, 1);
  assert.equal(request.question, questionService.getQuestionById("io_003").question);
  assert.equal(request.correctAnswer, questionService.getQuestionById("io_003").answer);
  assert.equal(
    request.work,
    "3x=18\nx=18/3",
    "the LLM should review parser-readable work too"
  );
});

test("correct answers with fully verified working skip the LLM", async (t) => {
  let reviewCalls = 0;
  t.mock.method(llmReviewService, "reviewSubmission", async () => {
    reviewCalls += 1;
    return null;
  });

  const result = await misconceptionService.analyzeAnswer({
    questionId: "dp_001",
    studentAnswer: "4",
    work: "2(x+3)=14\n2x+6=14\n2x=8\nx=4"
  });

  assert.equal(result.correct, true);
  assert.equal(result.misconception.detected, false);
  assert.equal(reviewCalls, 0);
});

test("an LLM with no step diagnosis does not suppress deterministic rules or ML", async (t) => {
  let llmReview = {
    label: null,
    incorrectStep: null,
    correctStep: null,
    confidence: 0.9
  };
  t.mock.method(
    llmReviewService,
    "reviewSubmission",
    async () => llmReview
  );
  t.mock.method(
    misconceptionService,
    "predictStepWithML",
    async () => ({
      prediction: "sign_error",
      confidence: 0.7
    })
  );

  const ruleResult = await misconceptionService.analyzeAnswer({
    questionId: "io_002",
    studentAnswer: "6",
    work: "x-4=10\nx=10-4\nx=6"
  });
  assert.equal(ruleResult.misconception.detected, true);
  assert.equal(ruleResult.misconception.type, "wrong_inverse_op");
  assert.equal(ruleResult.misconception.source, "rules");

  const mlResult = await misconceptionService.analyzeAnswer({
    questionId: "io_002",
    studentAnswer: "not an answer",
    work: "x-4=10\nx=unreadable"
  });
  assert.equal(mlResult.misconception.detected, true);
  assert.equal(mlResult.misconception.type, "sign_error");
  assert.equal(
    mlResult.misconception.mlPrediction.prediction,
    "sign_error"
  );
});

test("LLM corrections are shown only when equivalent to the preceding submitted equation", async (t) => {
  let llmReview = {
    label: "sign_error",
    incorrectStep: "3x+2=15",
    correctStep: "3x+6=15",
    explanation: "Multiply 2 by 3.",
    confidence: 0.9
  };
  t.mock.method(
    llmReviewService,
    "reviewSubmission",
    async () => llmReview
  );
  const validCorrection = await misconceptionService.analyzeAnswer({
    questionId: "io_003",
    studentAnswer: "6",
    work: "3(x+2)=15\n3x+2=15"
  });
  assert.equal(validCorrection.misconception.source, "llm");
  assert.equal(validCorrection.misconception.correctStep, "3x+6=15");
  assert.equal(
    validCorrection.misconception.explanation,
    "Multiply 2 by 3."
  );

  llmReview.correctStep = "3x+6=16";
  llmReview.explanation = "This is unverified.";

  const unverifiedCorrection = await misconceptionService.analyzeAnswer({
    questionId: "io_003",
    studentAnswer: "6",
    work: "3(x+2)=15\n3x+2=15"
  });
  assert.equal(unverifiedCorrection.misconception.correctStep, null);
  assert.equal(unverifiedCorrection.misconception.explanation, null);
  assert.ok(unverifiedCorrection.misconception.hint);
});

test("rule-based step labels take precedence over conflicting LLM labels", async (t) => {
  useMemoryStore(t);
  t.mock.method(globalThis, "fetch", async () =>
    new Response("{}", { status: 200 })
  );
  t.mock.method(
    llmReviewService,
    "reviewSubmission",
    async () => ({
      label: "sign_error",
      incorrectStep: "x=10-4",
      confidence: 0.8
    })
  );
  t.mock.method(
    mlService,
    "getLearningRecommendation",
    async () => ({
      success: true,
      probabilityCorrect: 0.5,
      probabilityPercent: 50,
      recommendedDifficulty: 1,
      recommendation: "Keep practicing."
    })
  );

  const studentId = "llm-step-priority-test";
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "io_002" },
    studentAnswer: "6",
    work: "x-4=10\nx=10-4\nx=6"
  });

  assert.equal(result.answer.checkedBy, "rules");
  assert.equal(result.misconception.source, "rules");
  assert.equal(result.misconception.type, "wrong_inverse_op");
  assert.equal(result.misconception.incorrectStep, "x=10-4");
  assert.match(result.misconception.message, /wrong inverse operation/);
});

test("correct final answer with incorrect distribution shows a complete correction and is not scored as mastered", async (t) => {
  const records = useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(
    mlService,
    "getLearningRecommendation",
    async () => ({
      success: true,
      probabilityCorrect: 0.5,
      probabilityPercent: 50,
      recommendedDifficulty: 1,
      recommendation: "Keep practicing."
    })
  );

  const studentId = "incorrect-work-correct-answer";
  const result = await studySessionService.recordAnswer({
    studentId,
    resetToken: "test-token",
    question: { id: "dp_003" },
    studentAnswer: "7",
    work: "4(x-2)=20\n4x-2=20\n4x=28\nx=7"
  });

  assert.equal(result.answer.correct, true);
  assert.equal(result.feedback.correct, false);
  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.incorrectStep, "4x-2=20");
  assert.equal(result.misconception.correctStep, "4x-8=20");
  assert.match(result.misconception.explanation, /both/);
  assert.deepEqual(result.solution.submittedSteps, [
    "4(x-2)=20",
    "4x-2=20",
    "4x=28",
    "x=7"
  ]);

  const profile = await studySessionService.getStudentProfile(studentId);
  assert.equal(profile.overall.correct, 0);
  assert.equal(
    records.get(studentId).concepts.distributive_property.previousCorrect,
    false
  );
});

test("rule feedback corrects an incorrect inverse operation", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(globalThis, "fetch", async () =>
    new Response("{}", { status: 200 })
  );

  const result = await misconceptionService.analyzeAnswer({
    questionId: "io_003",
    studentAnswer: "54",
    work: "3x=18\nx=18*3\nx=54"
  });

  assert.equal(result.misconception.type, "wrong_inverse_op");
  assert.equal(result.misconception.incorrectStep, "x=18*3");
  assert.equal(result.misconception.correctStep, "x = 6");
  assert.ok(result.misconception.explanation);
  assert.ok(result.misconception.hint);
});

test("divide-first inverse-operation error gets a correction based on the submitted equation", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(globalThis, "fetch", async () =>
    new Response("{}", { status: 200 })
  );

  const result = await misconceptionService.analyzeAnswer({
    questionId: "dp_003",
    studentAnswer: "3",
    work: "4(x-2)=20\nx-2=5\nx-2=5\nx=3"
  });

  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "wrong_inverse_op");
  assert.equal(result.misconception.source, "rules");
  assert.equal(result.misconception.incorrectStep, "x=3");
  assert.equal(result.misconception.correctStep, "x = 7");
  assert.match(result.misconception.explanation, /add 2 to both sides/i);
});

test("valid divide-first working is not flagged", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(globalThis, "fetch", async () =>
    new Response("{}", { status: 200 })
  );

  const result = await misconceptionService.analyzeAnswer({
    questionId: "dp_003",
    studentAnswer: "7",
    work: "4(x-2)=20\nx-2=5\nx-2=5\nx=5+2\nx=7"
  });

  assert.equal(result.correct, true);
  assert.equal(result.misconception.detected, false);
});

test("incorrect answers without written work ask for steps rather than guessing", async (t) => {
  useMemoryStore(t);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(
    mlService,
    "getLearningRecommendation",
    async () => ({
      success: true,
      probabilityCorrect: 0.5,
      probabilityPercent: 50,
      recommendedDifficulty: 1,
      recommendation: "Keep practicing."
    })
  );

  const result = await studySessionService.recordAnswer({
    studentId: "missing-work-feedback",
      resetToken: "test-token",
    question: { id: "io_003" },
    studentAnswer: "100",
    work: ""
  });

  assert.equal(result.feedback.correct, false);
  assert.match(result.feedback.message, /Show your working/);
  assert.match(result.feedback.hint, /one step per line/);
  assert.deepEqual(result.solution.submittedSteps, []);
});

test("LLM prompt requests only work review using the five allowed step labels", async (t) => {
  const originalEnv = {
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL
  };

  process.env.LLM_API_URL = "https://llm.example.test/v1/chat/completions";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  let requestBody;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              step_label: "wrong_inverse_op",
              incorrect_step: "3x=18 -> x=54",
              correct_step: "3x=18 -> x=6",
              step_explanation: "Divide both sides by 3.",
              confidence: 0.9
            })
          }
        }]
      }),
      { status: 200 }
    );
  });

  const review = await llmReviewService.reviewSubmission({
    question: "Solve 3x=18",
    studentAnswer: "54",
    correctAnswer: "6",
    work: "3x=18 -> x=54"
  });

  assert.deepEqual(review, {
    label: "wrong_inverse_op",
    incorrectStep: "3x=18 -> x=54",
    correctStep: "3x=18 -> x=6",
    explanation: "Divide both sides by 3.",
    confidence: 0.9
  });
  assert.match(
    requestBody.messages[0].content,
    /Allowed labels: sign_error, wrong_inverse_op, one_sided_op, combining_unlike_terms, arithmetic_slip/
  );
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.match(requestBody.messages[0].content, /written solution steps only/);
  assert.match(requestBody.messages[0].content, /final-answer correctness is checked separately/);
});

test("Gemini model configuration uses native generateContent even if the legacy URL is malformed", async (t) => {
  const originalEnv = {
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL
  };
  process.env.LLM_API_URL = "not a valid URL\\r\\n";
  process.env.LLM_API_KEY = "test-gemini-key";
  process.env.LLM_MODEL = "gemini-3.8-flash";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let requestedUrl;
  let requestOptions;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requestedUrl = String(url);
    requestOptions = options;
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({
            step_label: "wrong_inverse_op",
            incorrect_step: "3x=18 -> x=54",
            correct_step: "3x=18 -> x=6",
            step_explanation: "Divide both sides by 3.",
            confidence: 0.97
          }) }]
        }
      }]
    }), { status: 200 });
  });

  const review = await llmReviewService.reviewSubmission({
    question: "Solve 3x=18",
    studentAnswer: "54",
    correctAnswer: "6",
    work: "3x=18 -> x=54"
  });

  assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(requestOptions.headers["x-goog-api-key"], "test-gemini-key");
  assert.equal(requestOptions.headers.Authorization, undefined);
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema.required, [
    "step_label",
    "incorrect_step",
    "correct_step",
    "step_explanation",
    "confidence"
  ]);
  assert.equal(body.generationConfig.responseSchema.properties.step_label.nullable, true);
  assert.match(body.systemInstruction.parts[0].text, /final-answer correctness is checked separately/);
  assert.deepEqual(review, {
    label: "wrong_inverse_op",
    incorrectStep: "3x=18 -> x=54",
    correctStep: "3x=18 -> x=6",
    explanation: "Divide both sides by 3.",
    confidence: 0.97
  });
});

test("malformed Gemini JSON fails safely and deterministic diagnosis continues", async (t) => {
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_MODEL: process.env.LLM_MODEL
  };
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_API_URL;
  delete process.env.LLM_MODEL;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: '{"step_label":"wrong_inverse_op","incorrect_step":"x=10-4' }]
        }
      }]
    }), { status: 200 })
  );

  const result = await misconceptionService.analyzeAnswer({
    questionId: "io_002",
    studentAnswer: "6",
    work: "x-4=10\nx=10-4\nx=6"
  });

  assert.equal(result.misconception.detected, true);
  assert.equal(result.misconception.type, "wrong_inverse_op");
  assert.equal(result.misconception.source, "rules");
  assert.equal(result.misconception.correctStep, "x = 14");
});

test("Gemini retries one transient 503 and includes provider details when it persists", async (t) => {
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_MODEL: process.env.LLM_MODEL
  };
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_API_URL;
  delete process.env.LLM_MODEL;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1 || calls > 2) {
      return new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "temporary capacity issue" } }), { status: 503 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        step_label: "wrong_inverse_op",
        incorrect_step: "3x=18 -> x=54",
        correct_step: "3x=18 -> x=6",
        step_explanation: "Divide both sides by 3.",
        confidence: 0.95
      }) }] } }]
    }), { status: 200 });
  });

  const review = await llmReviewService.reviewSubmission({
    question: "Solve 3x=18",
    studentAnswer: "54",
    correctAnswer: "6",
    work: "3x=18 -> x=54"
  });
  assert.equal(calls, 2);
  assert.equal(review.label, "wrong_inverse_op");

  await assert.rejects(
    llmReviewService.reviewSubmission({
      question: "Solve 3x=18",
      studentAnswer: "54",
      correctAnswer: "6",
      work: "3x=18 -> x=54"
    }),
    /Gemini API returned HTTP 503: temporary capacity issue/
  );
  assert.equal(calls, 4);
});

test("LLM step labels are validated", async (t) => {
  const originalEnv = {
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL
  };

  process.env.LLM_API_URL = "https://llm.example.test/v1/chat/completions";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              step_label: "failed_to_distribute",
              incorrect_step: null,
              confidence: 0.9
            })
          }
        }]
      }),
      { status: 200 }
    )
  );

  await assert.rejects(
    llmReviewService.reviewSubmission({
      question: "Solve 3x=18",
      studentAnswer: "54",
      correctAnswer: "6",
      work: "3x=18 -> x=54",
    }),
    /invalid step label/
  );
});

test("an LLM step must match a submitted work line", async (t) => {
  const originalEnv = {
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL
  };

  process.env.LLM_API_URL = "https://llm.example.test/v1/chat/completions";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              step_label: "wrong_inverse_op",
              incorrect_step: "invented step",
              confidence: 0.9
            })
          }
        }]
      }),
      { status: 200 }
    )
  );

  await assert.rejects(
    llmReviewService.reviewSubmission({
      question: "Solve 3x=18",
      studentAnswer: "54",
      correctAnswer: "6",
      work: "3x=18 -> x=54"
    }),
    /not present in the submitted work/
  );
});
