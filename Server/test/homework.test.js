// Homework: the teacher sets a topic, a number of questions and a due date;
// progress is counted from the students' answers.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const classReportService = require("../Services/classReportService");
const studySessionService = require("../Services/studySessionService");
const { app } = require("../index");

const inDays = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

async function setUp(t) {
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
    const res = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  const { code, teacherKey } = await classStore.create({ name: "Homework class" });
  return { call, code, teacher: { "X-Teacher-Key": teacherKey } };
}

test("a teacher sets and removes homework; bad homework is refused", async (t) => {
  const { call, code, teacher } = await setUp(t);
  const set = (body, headers = teacher) => call("POST", `/api/classes/${code}/assignments`, body, headers);
  const good = { concept: "negative_numbers", count: 10, dueDate: inDays(7) };

  const created = await set(good);
  assert.equal(created.status, 201);
  assert.equal(created.body.assignment.concept, "negative_numbers");

  assert.equal((await set(good, { "X-Teacher-Key": "guess" })).status, 403);
  assert.equal((await set({ ...good, concept: "rocket_science" })).status, 400);
  assert.equal((await set({ ...good, count: 0 })).status, 400);
  assert.equal((await set({ ...good, count: 51 })).status, 400);
  assert.equal((await set({ ...good, dueDate: "next friday" })).status, 400);
  assert.equal((await set({ ...good, dueDate: inDays(-5) })).status, 400);
  assert.equal((await set({ ...good, dueDate: inDays(400) })).status, 400);

  assert.equal((await classStore.get(code)).assignments.length, 1);
  await call("DELETE", `/api/classes/${code}/assignments/${created.body.assignment.id}`, undefined, teacher);
  assert.equal((await classStore.get(code)).assignments.length, 0);
});

test("progress counts answers on the topic after the homework was set", async (t) => {
  const { code } = await setUp(t);
  const setAt = new Date(Date.now() - 60_000).toISOString();
  await classStore.addAssignment(code, { id: "hw1", concept: "negative_numbers", count: 3, dueDate: inDays(3), createdAt: setAt });

  const answer = (minutesAfter, concept, right) => ({
    concept, demonstratedCorrect: right,
    createdAt: new Date(Date.parse(setAt) + minutesAfter * 1000).toISOString()
  });
  const rows = {
    a: [answer(-30, "negative_numbers", true), answer(5, "negative_numbers", true), answer(6, "negative_numbers", false), answer(7, "negative_numbers", true), answer(8, "negative_numbers", true)],
    b: [answer(5, "negative_numbers", true), answer(6, "fractions", true)],
    c: []
  };
  t.mock.method(studentStore, "listByClass", async () => [
    { studentId: "a", displayName: "Asha", classCode: code },
    { studentId: "b", displayName: "Ben", classCode: code },
    { studentId: "c", displayName: "Cara", classCode: code }
  ]);
  t.mock.method(attemptLogStore, "listAttempts", async ({ studentId }) => rows[studentId].slice().reverse());

  const report = await classReportService.buildClassReport(await classStore.get(code));
  const [hw] = report.assignments;
  assert.deepEqual([hw.finished, hw.started, hw.notStarted], [1, 1, 1]);
  const asha = hw.students.find((s) => s.name === "Asha");
  // The answer before the homework was set doesn't count; only the first 3 after do.
  assert.deepEqual([asha.done, asha.correct, asha.finished], [3, 2, true]);
  assert.deepEqual(hw.students.find((s) => s.name === "Ben").done, 1, "other topics don't count");
});

test("a student's profile lists their class homework with their own progress", async (t) => {
  const { code } = await setUp(t);
  await classStore.addAssignment(code, { id: "hw2", concept: "x_on_both_sides", count: 2, dueDate: inDays(2), createdAt: new Date(Date.now() - 60_000).toISOString() });
  t.mock.method(studentStore, "get", async () => ({
    studentId: "s", resetToken: "t", classCode: code, displayName: "Sam",
    concepts: { x_on_both_sides: { attempts: 1, correct: 1, rawCorrect: 1, recentResults: [1], misconceptionCount: 0, misconceptionsByType: {}, currentDifficulty: 1, recentQuestionIds: [] } }
  }));
  t.mock.method(attemptLogStore, "listAttempts", async () => [
    { concept: "x_on_both_sides", demonstratedCorrect: true, createdAt: new Date().toISOString() }
  ]);

  const profile = await studySessionService.getStudentProfile("s");
  assert.equal(profile.homework.length, 1);
  assert.deepEqual([profile.homework[0].done, profile.homework[0].count, profile.homework[0].finished], [1, 2, false]);
});
