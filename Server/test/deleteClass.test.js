// Deleting a class at the end of the year, and sample classes cleaning up.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const classCleanup = require("../Services/classCleanup");
const demoClass = require("../Services/demoClass");
const { app } = require("../index");

// test/setup.js silences logAttempt; these tests check sample answers are
// deleted, so this file (its own process) uses the real in-memory log.
attemptLogStore.logAttempt.mock?.restore();

function memory(t) {
  const previous = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  classStore.clearMemoryClasses();
  studentStore.clearMemoryRecords();
  attemptLogStore.clearMemoryAttempts();
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_STORE; else process.env.MEMORY_STORE = previous;
    classStore.clearMemoryClasses();
    studentStore.clearMemoryRecords();
    attemptLogStore.clearMemoryAttempts();
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

test("a teacher deletes a class: students leave it but keep their practice", async (t) => {
  memory(t);
  t.mock.method(attemptLogStore, "listAttempts", async () => []);
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Year 8 Set 2" });
  const teacher = { "X-Teacher-Key": teacherKey };
  await studentStore.save({ studentId: "st_del_aaaaaa111111", resetToken: "a", classCode: code, displayName: "Asha", concepts: { quadratics: { attempts: 3, correct: 1 } } });

  const link = await call("POST", `/api/classes/${code}/parent-link`, { student: "111111" }, teacher);
  assert.equal((await call("POST", "/api/parent", { token: link.body.token })).status, 200);

  assert.equal((await call("DELETE", `/api/classes/${code}`, { name: "Year 8 Set 2" }, { "X-Teacher-Key": "guess" })).status, 403);
  const wrongName = await call("DELETE", `/api/classes/${code}`, { name: "Year 8" }, teacher);
  assert.equal(wrongName.status, 400, "the name must be typed to confirm");
  assert.ok(await classStore.get(code), "nothing deleted on a wrong name");

  const res = await call("DELETE", `/api/classes/${code}`, { name: "  year 8 set 2 " }, teacher);
  assert.equal(res.status, 200);
  assert.equal(res.body.studentsRemoved, 1);

  assert.equal(await classStore.get(code), null, "the class record is gone");
  assert.equal((await call("GET", `/api/classes/${code}/report`, undefined, teacher)).status, 403, "its teacher page no longer opens");
  const asha = await studentStore.get("st_del_aaaaaa111111");
  assert.equal(asha.classCode, null);
  assert.deepEqual(asha.concepts, { quadratics: { attempts: 3, correct: 1 } }, "her own practice is kept");
  assert.equal((await call("POST", "/api/parent", { token: link.body.token })).status, 404, "the parent link stops working");
});

test("sample classes older than a day are cleaned up; real students who joined are only detached", async (t) => {
  memory(t);
  const DAY = 24 * 60 * 60 * 1000;
  const old = await demoClass.createDemoClass();
  const oldStudents = await studentStore.listByClass(old.code);
  assert.equal(oldStudents.length, 6);
  assert.ok((await attemptLogStore.listAttempts({ studentId: oldStudents[0].studentId })).length > 0);

  // Someone real joined the sample class with its code.
  await studentStore.save({ studentId: "st_real_bbbbbb222222", resetToken: "b", classCode: old.code, displayName: "Real", concepts: {} });

  // Within the day, a new demo leaves the old one alone.
  await demoClass.createDemoClass();
  assert.ok(await classStore.get(old.code));

  // A day later it goes, with its sample students and their sample answers.
  assert.equal(await classCleanup.cleanUpOldDemos(Date.now() + DAY + 1000), 2, "both sample classes are now over a day old");
  assert.equal(await classStore.get(old.code), null);
  for (const s of oldStudents) {
    assert.equal(await studentStore.get(s.studentId), null, "sample student deleted");
    assert.deepEqual(await attemptLogStore.listAttempts({ studentId: s.studentId }), [], "sample answers deleted");
  }
  const real = await studentStore.get("st_real_bbbbbb222222");
  assert.ok(real, "a real student is never deleted");
  assert.equal(real.classCode, null);
});

test("ordinary classes are never cleaned up as demos", async (t) => {
  memory(t);
  const { code } = await classStore.create({ name: "Real class" });
  assert.equal(await classCleanup.cleanUpOldDemos(Date.now() + 365 * 24 * 60 * 60 * 1000), 0);
  assert.ok(await classStore.get(code));
});
