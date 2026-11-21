// The teacher's own questions: typed in, answered by StudyTwin, checked
// like any other question, and served to the class in order.
const assert = require("node:assert/strict");
const test = require("node:test");

const customQuestions = require("../Services/customQuestions");
const questionService = require("../Services/questionService");
const misconceptionService = require("../Services/misconceptionService");
const llmReviewService = require("../Services/llmReviewService");
const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const mlService = require("../Services/mlService");
const studySessionService = require("../Services/studySessionService");
const { app } = require("../index");

test("lines from a worksheet become questions with worked-out answers, or a reason", () => {
  const rows = customQuestions.fromLines([
    "1. 3(x - 2) = 2x + 5", "b) 4x − 7 = 6", "x/4 + 2 = 5", "Simplify: 4x + 3 - x + 2",
    "2x + 3 = 2x + 5", "x^2 = 9", "3y + 2 = 11", "7"
  ].join("\n"));
  assert.deepEqual(rows.slice(0, 4).map((r) => [r.question, r.answer]), [
    ["Solve: 3(x - 2) = 2x + 5", "11"],
    ["Solve: 4x - 7 = 6", "13/4"],
    ["Solve: x/4 + 2 = 5", "12"],
    ["Simplify: 4x + 3 - x + 2", "3x + 5"]
  ]);
  assert.ok(rows.slice(4).every((r) => r.error), "no single answer, quadratic, other letter, no x");
});

test("a teacher's question is found by its id and checked like any other", async (t) => {
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  const [row] = customQuestions.fromLines("3(x - 2) = 2x + 5");
  const question = questionService.findQuestionById(row.id);
  assert.equal(question.concept, "class_questions");
  assert.equal(question.answer, "11");

  const right = await misconceptionService.analyzeAnswer({ questionId: row.id, studentAnswer: "11", work: "3(x - 2) = 2x + 5\n3x - 6 = 2x + 5\nx - 6 = 5\nx = 11" });
  assert.equal(right.correct, true);
  assert.equal(right.misconception.detected, false);

  const slip = await misconceptionService.analyzeAnswer({ questionId: row.id, studentAnswer: "7", work: "3(x - 2) = 2x + 5\n3x - 2 = 2x + 5\nx = 7" });
  assert.equal(slip.misconception.type, "failed_to_distribute");

  assert.equal(questionService.findQuestionById("t_!!"), null);
});

test("teachers add and remove questions; students get them in order through homework", async (t) => {
  const previous = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  classStore.clearMemoryClasses();
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_STORE; else process.env.MEMORY_STORE = previous;
    classStore.clearMemoryClasses();
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const { code, teacherKey } = await classStore.create({ name: "Own questions" });
  const teacher = { "X-Teacher-Key": teacherKey };

  const added = await call("POST", `/api/classes/${code}/questions`, { text: "2x + 3 = 11\nx^2 = 4\n5x = 2x + 9" }, teacher);
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.added.map((q) => q.answer), ["4", "3"]);
  assert.equal(added.body.refused[0].line, "x^2 = 4");
  assert.equal((await call("POST", `/api/classes/${code}/questions`, { text: "2x + 3 = 11" }, { "X-Teacher-Key": "guess" })).status, 403);

  // Homework can be set on them.
  const due = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  assert.equal((await call("POST", `/api/classes/${code}/assignments`, { concept: "class_questions", count: 2, dueDate: due }, teacher)).status, 201);

  // A student in the class practises them in the teacher's order.
  const ids = (await classStore.get(code)).questions;
  const records = new Map([["kid", { studentId: "kid", resetToken: "tok", classCode: code, displayName: "Kid", concepts: {} }]]);
  t.mock.method(studentStore, "get", async (id) => structuredClone(records.get(id) || null));
  t.mock.method(studentStore, "save", async (student) => { records.set(student.studentId, structuredClone(student)); });
  t.mock.method(attemptLogStore, "logAttempt", async () => null);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({ success: true, probabilityCorrect: 0.5, probabilityPercent: 50, recommendedDifficulty: 2, recommendation: "" }));

  const session = await studySessionService.startSession({ studentId: "kid", resetToken: "tok", concept: "class_questions", difficulty: 2 });
  assert.equal(session.question.id, ids[0]);
  const result = await studySessionService.recordAnswer({ studentId: "kid", resetToken: "tok", question: { id: ids[0] }, studentAnswer: "4", work: "2x + 3 = 11\n2x = 8\nx = 4" });
  assert.equal(result.answer.correct, true);
  assert.equal(result.nextQuestion.id, ids[1]);

  // Removing a question takes it off the list.
  await call("DELETE", `/api/classes/${code}/questions/${ids[0]}`, undefined, teacher);
  assert.deepEqual((await classStore.get(code)).questions, [ids[1]]);
});
