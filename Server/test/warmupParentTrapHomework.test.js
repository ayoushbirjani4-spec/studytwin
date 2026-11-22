// Daily warm-up, parent links and "cure a mistake" homework.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studySessionService = require("../Services/studySessionService");
const questionService = require("../Services/questionService");
const { app } = require("../index");

function memory(t) {
  const previous = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  classStore.clearMemoryClasses();
  studentStore.clearMemoryRecords();
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_STORE; else process.env.MEMORY_STORE = previous;
    classStore.clearMemoryClasses();
    studentStore.clearMemoryRecords();
  });
}

async function server(t) {
  const s = app.listen(0);
  await new Promise((resolve) => s.once("listening", resolve));
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

function quiet(t) {
  t.mock.method(attemptLogStore, "logAttempt", async () => null);
  t.mock.method(attemptLogStore, "listAttempts", async () => []);
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({ success: true, probabilityCorrect: 0.5, probabilityPercent: 50, recommendedDifficulty: 1, recommendation: "" }));
}

// What a student who gets it right writes.
function rightWork(question) {
  const start = question.equation || question.question.replace(/^(Solve|Simplify):\s*/, "");
  if (question.question.startsWith("Simplify")) return { studentAnswer: question.answer, work: `${start}\n${question.answer}` };
  return { studentAnswer: question.answer, work: [start, ...question.solution_steps.filter((s) => /[=<>≤≥]/.test(s))].join("\n") };
}

test("the daily warm-up is three questions from the student's own mistakes, then ordinary practice", async (t) => {
  memory(t);
  quiet(t);
  await studentStore.save({
    studentId: "warm", resetToken: "tok", concepts: {
      distributive_property: { attempts: 5, correct: 3, rawCorrect: 3, recentResults: [], misconceptionCount: 2, currentDifficulty: 1, recentQuestionIds: [],
        misconceptionsByType: { failed_to_distribute: { count: 2, lastSeen: "2026-11-20T10:00:00Z" } } }
    }
  });

  const session = await studySessionService.startSession({ studentId: "warm", resetToken: "tok", concept: "distributive_property", warmup: true, localDate: "2026-11-22" });
  assert.deepEqual(session.warmup, { date: "2026-11-22", done: 0, total: 3, complete: false });
  assert.match(session.question.id, /^g_dp[1-4]_/, "the first question is a trap for the student's mistake");

  let question = session.question;
  let result;
  for (let i = 0; i < 3; i++) {
    const full = questionService.findQuestionById(question.id);
    result = await studySessionService.recordAnswer({ studentId: "warm", resetToken: "tok", question: { id: question.id }, ...rightWork(full) });
    assert.equal(result.warmup.done, i + 1);
    question = result.nextQuestion;
  }
  assert.equal(result.warmup.complete, true);
  assert.ok(result.nextQuestion, "practice carries on after the warm-up");

  const profile = await studySessionService.getStudentProfile("warm");
  assert.deepEqual(profile.warmup, { date: "2026-11-22", done: 3, total: 3, complete: true });

  await assert.rejects(studySessionService.startSession({ studentId: "warm", resetToken: "tok", concept: "distributive_property", warmup: true, localDate: "today" }));
});

test("a parent link shows one student's report; a new link switches the old one off", async (t) => {
  memory(t);
  quiet(t);
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Parents class" });
  await studentStore.save({ studentId: "st_parent_child_123456", resetToken: "tok", classCode: code, displayName: "Ria", concepts: {} });

  const made = await call("POST", `/api/classes/${code}/parent-link`, { student: "123456" }, { "X-Teacher-Key": teacherKey });
  assert.equal(made.status, 200);
  assert.equal((await call("POST", `/api/classes/${code}/parent-link`, { student: "123456" }, { "X-Teacher-Key": "guess" })).status, 403);
  assert.equal((await call("POST", `/api/classes/${code}/parent-link`, { student: "999999" }, { "X-Teacher-Key": teacherKey })).status, 404);

  const report = await call("POST", "/api/parent", { token: made.body.token });
  assert.equal(report.status, 200);
  assert.equal(report.body.student.name, "Ria");
  assert.equal(report.body.className, "Parents class");
  assert.ok(!JSON.stringify(report.body).includes("st_parent_child"), "no student id in the report");
  assert.ok(!JSON.stringify(await studentStore.get("st_parent_child_123456")).includes(made.body.token.split(".")[1]), "only a hash is kept");

  assert.equal((await call("POST", "/api/parent", { token: made.body.token + "x" })).status, 404);
  const again = await call("POST", `/api/classes/${code}/parent-link`, { student: "123456" }, { "X-Teacher-Key": teacherKey });
  assert.equal((await call("POST", "/api/parent", { token: made.body.token })).status, 404, "the old link stops working");
  assert.equal((await call("POST", "/api/parent", { token: again.body.token })).status, 200);
});

test("'cure a mistake' homework is finished when a trap round cures it", async (t) => {
  memory(t);
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Trap homework" });
  const due = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const set = (body) => call("POST", `/api/classes/${code}/assignments`, body, { "X-Teacher-Key": teacherKey });

  const created = await set({ concept: "distributive_property", misconceptionType: "sign_error", dueDate: due });
  assert.equal(created.status, 201);
  assert.equal(created.body.assignment.count, 1);
  assert.equal((await set({ concept: "distributive_property", misconceptionType: "made_up", dueDate: due })).status, 400);

  const assignment = created.body.assignment;
  const after = new Date(Date.parse(assignment.createdAt) + 1000).toISOString();
  const before = new Date(Date.parse(assignment.createdAt) - 864e5).toISOString();
  const progress = (cured, rows = []) => studySessionService.homeworkProgress(assignment, rows, { curedMistakes: cured });

  assert.equal(progress([{ type: "sign_error", concept: "distributive_property", curedAt: after }]).finished, true);
  assert.equal(progress([{ type: "sign_error", concept: "distributive_property", curedAt: before }]).finished, false, "a cure from before the homework doesn't count");
  const started = progress([], [{ targetedPracticeType: "sign_error", concept: "distributive_property", createdAt: after, demonstratedCorrect: true }]);
  assert.deepEqual([started.finished, started.trapsAnswered], [false, 1]);
});
