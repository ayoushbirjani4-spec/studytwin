// HTTP tests for /api/twin/lesson and /api/twin/check.
const assert = require("node:assert/strict");
const test = require("node:test");

const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");
const { app } = require("../index");

async function withServer(t) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, body, headers = {}) => fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

// dp_001 with failed_to_distribute:
//   0 "2(x + 3) = 14"   1 "2x + 3 = 14" (mistake)   2 "2x = 14 - 3" ...
const LESSON = { questionId: "dp_001", misconceptionType: "failed_to_distribute" };

test("a lesson never includes the position of the mistake or the right answer", async (t) => {
  const post = await withServer(t);
  const { status, body } = await post("/api/twin/lesson", { misconceptionType: "failed_to_distribute", concept: "distributive_property" });

  assert.equal(status, 200);
  assert.equal(body.lesson.questionId, "dp_001");
  assert.equal(body.lesson.lines[1], "2x + 3 = 14");
  assert.equal(body.lesson.wrongIndex, undefined);
  assert.equal(body.lesson.correctAnswer, undefined);
  assert.equal(body.personalised, false);
});

test("without a misconception, the twin copies the student's most frequent one it can make", async (t) => {
  t.mock.method(studentStore, "get", async () => ({ studentId: "twin-student", resetToken: "twin-token", concepts: {} }));
  t.mock.method(studySessionService, "getStudentProfile", async () => ({
    commonMistakes: [
      { type: "unknown_error", count: 9, concept: null },          // not a twin mistake: skipped
      { type: "one_sided_op", count: 4, concept: "equation_balance" }
    ]
  }));
  const post = await withServer(t);

  const { status, body } = await post(
    "/api/twin/lesson",
    { studentId: "twin-student" },
    { "X-Student-Token": "twin-token" }
  );

  assert.equal(status, 200);
  assert.equal(body.personalised, true);
  assert.equal(body.lesson.misconceptionType, "one_sided_op");
  assert.equal(body.lesson.concept, "equation_balance");
});

test("a profile-based lesson needs the student's own token", async (t) => {
  t.mock.method(studentStore, "get", async () => ({ studentId: "twin-student", resetToken: "twin-token", concepts: {} }));
  const post = await withServer(t);

  const { status } = await post("/api/twin/lesson", { studentId: "twin-student" }, { "X-Student-Token": "someone-else" });
  assert.equal(status, 403);
});

test("an unknown misconception falls back to the default lesson", async (t) => {
  const post = await withServer(t);
  const { body } = await post("/api/twin/lesson", { misconceptionType: "made_up" });
  assert.equal(body.lesson.misconceptionType, "failed_to_distribute");
});

test("choosing a line that is fine tells the student to look again", async (t) => {
  const post = await withServer(t);
  const { body } = await post("/api/twin/check", { ...LESSON, chosenIndex: 2, correctedLine: "2x = 8" });

  assert.equal(body.foundMistake, false);
  assert.equal(body.fixedIt, false);
  assert.equal(body.mistakeIndex, null);
  assert.match(body.twinSays, /look again/i);
});

test("finding the mistake without a correction asks how the line should look", async (t) => {
  const post = await withServer(t);
  const { body } = await post("/api/twin/check", { ...LESSON, chosenIndex: 1 });

  assert.equal(body.foundMistake, true);
  assert.equal(body.fixedIt, false);
  assert.match(body.twinSays, /how should that line look/i);
});

test("a correct fix teaches the twin, and only then is the answer revealed", async (t) => {
  const post = await withServer(t);
  const { body } = await post("/api/twin/check", { ...LESSON, chosenIndex: 1, correctedLine: "2x + 6 = 14" });

  assert.equal(body.foundMistake, true);
  assert.equal(body.fixedIt, true);
  assert.equal(body.mistakeIndex, 1);
  assert.equal(body.correctAnswer, "4");
  assert.match(body.twinSays, /thanks for teaching me/i);
});

test("a fix that jumps straight to the right answer counts", async (t) => {
  const post = await withServer(t);
  // The live checker never judges a bare "x = 4"; the twin check compares it directly.
  const { body } = await post("/api/twin/check", { ...LESSON, chosenIndex: 1, correctedLine: "x = 4" });
  assert.equal(body.fixedIt, true);
});

test("wrong fixes, the twin's own mistake, and copying the line above do not count", async (t) => {
  const post = await withServer(t);

  for (const correctedLine of ["2x + 5 = 14", "2x + 3 = 14", "2(x + 3) = 14", "x = 5.5", "nonsense"]) {
    const { body } = await post("/api/twin/check", { ...LESSON, chosenIndex: 1, correctedLine });
    assert.equal(body.foundMistake, true, correctedLine);
    assert.equal(body.fixedIt, false, correctedLine);
    assert.equal(body.correctAnswer, null, correctedLine);
  }
});

test("the check validates its input", async (t) => {
  const post = await withServer(t);

  assert.equal((await post("/api/twin/check", { questionId: "dp_001" })).status, 400);
  assert.equal((await post("/api/twin/check", { questionId: "io_001", misconceptionType: "failed_to_distribute", chosenIndex: 1 })).status, 404);
  const tooLong = await post("/api/twin/check", { ...LESSON, chosenIndex: 1, correctedLine: "x".repeat(500) });
  assert.equal(tooLong.body.fixedIt, false);
});
