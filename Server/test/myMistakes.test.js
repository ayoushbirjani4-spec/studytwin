// "My mistakes": a student's own wrong answers, to look back over and retry.
const assert = require("node:assert/strict");
const test = require("node:test");

const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const { app } = require("../index");

// test/setup.js silences logAttempt everywhere; these tests read the log
// back, so this file (its own process) uses the real in-memory one.
attemptLogStore.logAttempt.mock?.restore();

function memory(t) {
  const previous = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  studentStore.clearMemoryRecords();
  attemptLogStore.clearMemoryAttempts();
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_STORE; else process.env.MEMORY_STORE = previous;
    studentStore.clearMemoryRecords();
    attemptLogStore.clearMemoryAttempts();
  });
}

async function server(t) {
  const s = app.listen(0);
  await new Promise((resolve) => s.once("listening", resolve));
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  return async (method, path, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers } });
    return { status: res.status, body: await res.json() };
  };
}

let minute = 0;
const log = (fields) => attemptLogStore.logAttempt({
  studentId: "st_mine_111111", difficulty: 1, answerCorrect: false, demonstratedCorrect: false,
  misconceptionDetected: false, misconceptionType: null, createdAt: new Date(Date.UTC(2026, 10, 25, 10, minute++)), ...fields
});

test("a student sees their own wrong answers, newest first, with the wrong line marked", async (t) => {
  memory(t);
  const call = await server(t);
  await studentStore.save({ studentId: "st_mine_111111", resetToken: "mine", concepts: {} });

  // dp_001 is 2(x + 3) = 14: first a distribution mistake, then right.
  await log({ questionId: "dp_001", concept: "distributive_property", studentAnswer: "11/2", work: "2(x + 3) = 14\n2x + 3 = 14\n2x = 11\nx = 11/2",
    misconceptionDetected: true, misconceptionType: "failed_to_distribute" });
  await log({ questionId: "fc_003", concept: "factorising", studentAnswer: "(x - 2)(x - 3)", work: "x² + 5x + 6\n(x - 2)(x - 3)",
    misconceptionDetected: true, misconceptionType: "factor_sign_error" });
  await log({ questionId: "dp_001", concept: "distributive_property", studentAnswer: "4", work: "2(x + 3) = 14\n2x + 6 = 14\n2x = 8\nx = 4",
    answerCorrect: true, demonstratedCorrect: true });
  await log({ questionId: "qd_003", concept: "quadratics", studentAnswer: "x = 7", work: "" });

  const res = await call("GET", "/api/students/st_mine_111111/mistakes", { "X-Student-Token": "mine" });
  assert.equal(res.status, 200);
  const items = res.body.mistakes;
  assert.deepEqual(items.map((m) => m.questionId), ["qd_003", "fc_003", "dp_001"], "newest first, right answers left out");

  const distribute = items[2];
  assert.equal(distribute.question, "Solve: 2(x + 3) = 14");
  assert.equal(distribute.mistake.label, "Failed to distribute");
  assert.equal(distribute.steps[distribute.firstErrorIndex].line, "2x + 3 = 14", "the line that went wrong");

  assert.equal(items[1].mistake.label, "Signs wrong in the brackets");
  assert.deepEqual(items[0].steps, [], "no working written");
  for (const m of items) assert.ok(!("answer" in m) && !("correctAnswer" in m), "the right answer isn't given away");
});

test("only the student can see their mistakes", async (t) => {
  memory(t);
  const call = await server(t);
  await studentStore.save({ studentId: "st_mine_111111", resetToken: "mine", concepts: {} });
  await log({ questionId: "dp_001", concept: "distributive_property", studentAnswer: "5", work: "2(x + 3) = 14\nx = 5" });

  assert.equal((await call("GET", "/api/students/st_mine_111111/mistakes", { "X-Student-Token": "someone-else" })).status, 403);
  assert.equal((await call("GET", "/api/students/st_mine_111111/mistakes")).status, 403);
  // A student with no saved record yet just has none.
  const fresh = await call("GET", "/api/students/st_new_222222/mistakes", { "X-Student-Token": "new" });
  assert.deepEqual(fresh.body.mistakes, []);
});
