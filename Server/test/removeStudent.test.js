// A teacher removing a student from their class.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
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

const names = (report) => (report.body.report || report.body).students.map((s) => s.name).sort();

test("a teacher can remove a student; they leave the report and their parent link stops working", async (t) => {
  memory(t);
  t.mock.method(attemptLogStore, "listAttempts", async () => []);
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Remove class" });
  const teacher = { "X-Teacher-Key": teacherKey };
  await studentStore.save({ studentId: "st_keep_aaaaaa111111", resetToken: "a", classCode: code, displayName: "Asha", concepts: {} });
  await studentStore.save({ studentId: "st_joke_bbbbbb222222", resetToken: "b", classCode: code, displayName: "Mr Teacher", concepts: { quadratics: { attempts: 4, correct: 2 } } });

  const link = await call("POST", `/api/classes/${code}/parent-link`, { student: "222222" }, teacher);
  assert.equal((await call("POST", "/api/parent", { token: link.body.token })).status, 200);

  // Only the class's teacher can remove anyone.
  assert.equal((await call("DELETE", `/api/classes/${code}/students/222222`, undefined, { "X-Teacher-Key": "guess" })).status, 403);
  assert.equal((await call("DELETE", `/api/classes/${code}/students/999999`, undefined, teacher)).status, 404);
  assert.equal((await call("DELETE", `/api/classes/${code}/students/22`, undefined, teacher)).status, 404, "too short to identify anyone");

  assert.equal((await call("DELETE", `/api/classes/${code}/students/222222`, undefined, teacher)).status, 200);
  assert.deepEqual(names(await call("GET", `/api/classes/${code}/report`, undefined, teacher)), ["Asha"]);
  assert.equal((await call("POST", "/api/parent", { token: link.body.token })).status, 404, "the parent link stops working");

  // The student keeps their own progress, and is simply out of the class.
  const removed = await studentStore.get("st_joke_bbbbbb222222");
  assert.equal(removed.classCode, null);
  assert.equal(removed.displayName, null);
  assert.deepEqual(removed.concepts, { quadratics: { attempts: 4, correct: 2 } });

  // Removing again: they aren't in the class any more.
  assert.equal((await call("DELETE", `/api/classes/${code}/students/222222`, undefined, teacher)).status, 404);
});

test("a teacher can close a class to new students; students already in it carry on", async (t) => {
  memory(t);
  t.mock.method(attemptLogStore, "listAttempts", async () => []);
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Closing class" });
  const teacher = { "X-Teacher-Key": teacherKey };
  const join = (id, token, name) => call("POST", `/api/students/${id}/class`, { code, displayName: name }, { "X-Student-Token": token });

  assert.equal((await join("st_in_dddddd444444", "d", "Dev")).status, 200, "open by default");
  const report = await call("GET", `/api/classes/${code}/report`, undefined, teacher);
  assert.equal((report.body.report || report.body).class.joinsClosed, false);

  // Only the teacher can close it, and they must say open or closed.
  assert.equal((await call("POST", `/api/classes/${code}/joining`, { open: false }, { "X-Teacher-Key": "guess" })).status, 403);
  assert.equal((await call("POST", `/api/classes/${code}/joining`, { open: "no" }, teacher)).status, 400);
  assert.equal((await call("POST", `/api/classes/${code}/joining`, { open: false }, teacher)).status, 200);

  const refused = await join("st_new_eeeeee555555", "e", "Ela");
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /isn't taking new students/);
  assert.equal((await studentStore.get("st_new_eeeeee555555"))?.classCode ?? null, null, "nothing was saved");

  // Dev is already in: he can still change his name, and leave.
  assert.equal((await join("st_in_dddddd444444", "d", "Devan")).status, 200);
  const closedReport = await call("GET", `/api/classes/${code}/report`, undefined, teacher);
  assert.equal((closedReport.body.report || closedReport.body).class.joinsClosed, true);
  assert.deepEqual(names(closedReport), ["Devan"]);

  // A removed student can't come straight back while it's closed.
  assert.equal((await call("DELETE", `/api/classes/${code}/students/444444`, undefined, teacher)).status, 200);
  assert.equal((await join("st_in_dddddd444444", "d", "Dev")).status, 403);

  // Opened again, anyone with the code can join.
  assert.equal((await call("POST", `/api/classes/${code}/joining`, { open: true }, teacher)).status, 200);
  assert.equal((await join("st_new_eeeeee555555", "e", "Ela")).status, 200);
});

test("a teacher can't remove a student from another class", async (t) => {
  memory(t);
  const call = await server(t);
  const mine = await classStore.create({ name: "Mine" });
  const theirs = await classStore.create({ name: "Theirs" });
  await studentStore.save({ studentId: "st_other_cccccc333333", resetToken: "c", classCode: theirs.code, displayName: "Cara", concepts: {} });

  const res = await call("DELETE", `/api/classes/${mine.code}/students/333333`, undefined, { "X-Teacher-Key": mine.teacherKey });
  assert.equal(res.status, 404);
  assert.equal((await studentStore.get("st_other_cccccc333333")).classCode, theirs.code);
});
