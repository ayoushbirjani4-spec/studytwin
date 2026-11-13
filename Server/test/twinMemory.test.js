// The twin remembers what the student has taught it.
const assert = require("node:assert/strict");
const test = require("node:test");

const twinService = require("../Services/twinService");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");
const { app } = require("../index");

const MISTAKES = [
  { type: "unknown_error", count: 9, concept: null },                    // twin can't make it
  { type: "failed_to_distribute", count: 5, concept: "distributive_property" },
  { type: "sign_error", count: 3, concept: "distributive_property" }
];

// ------------------------------------------------------------
// Learning rules
// ------------------------------------------------------------

test("the twin works on the most frequent mistake it hasn't learned yet", () => {
  assert.deepEqual(
    twinService.chooseTwinMisconception(MISTAKES, null),
    { type: "failed_to_distribute", concept: "distributive_property", reviewing: false }
  );

  const learnedFirst = { taught: { failed_to_distribute: 2 }, lastTaughtAt: {}, recentLessons: [] };
  assert.equal(twinService.chooseTwinMisconception(MISTAKES, learnedFirst).type, "sign_error");
});

test("once every mistake is learned, the twin reviews the one taught longest ago", () => {
  const allLearned = {
    taught: { failed_to_distribute: 2, sign_error: 3 },
    lastTaughtAt: { failed_to_distribute: "2026-11-10T00:00:00.000Z", sign_error: "2026-11-01T00:00:00.000Z" },
    recentLessons: []
  };
  assert.deepEqual(
    twinService.chooseTwinMisconception(MISTAKES, allLearned),
    { type: "sign_error", concept: "distributive_property", reviewing: true }
  );
  assert.equal(twinService.chooseTwinMisconception([{ type: "unknown_error" }], null), null);
});

test("each lesson counts once, and the twin learns at the threshold exactly once", () => {
  let memory = twinService.emptyTwinMemory();
  const first = twinService.applyTwinTeaching(memory, { misconceptionType: "sign_error", questionId: "dp_001" });
  assert.equal(first.counted, true);
  assert.equal(first.justLearned, false);
  memory = first.memory;

  const repeat = twinService.applyTwinTeaching(memory, { misconceptionType: "sign_error", questionId: "dp_001" });
  assert.equal(repeat.counted, false);

  const second = twinService.applyTwinTeaching(memory, { misconceptionType: "sign_error", questionId: "dp_002" });
  assert.equal(second.justLearned, true);
  memory = second.memory;

  const third = twinService.applyTwinTeaching(memory, { misconceptionType: "sign_error", questionId: "dp_003" });
  assert.equal(third.counted, true);
  assert.equal(third.justLearned, false);
});

test("recent lessons are capped so the record cannot grow forever", () => {
  let memory = twinService.emptyTwinMemory();
  for (let i = 0; i < 30; i++) {
    memory = twinService.applyTwinTeaching(memory, { misconceptionType: "sign_error", questionId: `q${i}` }).memory;
  }
  assert.equal(memory.recentLessons.length, 20);
  assert.equal(memory.recentLessons.at(-1), "sign_error:q29");
});

test("progress summarises learned mistakes and the current habit", () => {
  const memory = { taught: { failed_to_distribute: 2, sign_error: 1 }, lastTaughtAt: {}, recentLessons: [] };
  assert.deepEqual(twinService.summariseTwinProgress(MISTAKES, memory, "sign_error"), {
    learnedCount: 1,
    totalCount: 2,
    current: { type: "sign_error", taught: 1, needed: 2, learned: false }
  });
});

// ------------------------------------------------------------
// Through the API, with a stored student
// ------------------------------------------------------------

function setUpStudent(t, record) {
  const records = new Map([[record.studentId, structuredClone(record)]]);
  t.mock.method(studentStore, "get", async (id) => (records.has(id) ? structuredClone(records.get(id)) : null));
  t.mock.method(studentStore, "save", async (student) => records.set(student.studentId, structuredClone(student)));
  t.mock.method(studySessionService, "getStudentProfile", async () => ({ commonMistakes: MISTAKES }));
  return records;
}

async function withServer(t) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, body, token) => fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Student-Token": token },
    body: JSON.stringify(body)
  }).then((res) => res.json());
}

// The fix for the twin's mistake: the correct version of its wrong line.
function correctFix(lesson) {
  const full = twinService.buildTwinSolution(
    require("../data/questions").questions.find((q) => q.id === lesson.questionId),
    lesson.misconceptionType
  );
  const correct = twinService.buildTwinSolution(
    require("../data/questions").questions.find((q) => q.id === lesson.questionId),
    "wrong_inverse_op"
  );
  // For distribution lessons the correct expansion is the line at the same
  // position in a lesson whose mistake comes later.
  return { index: full.wrongIndex, line: correct ? correct.lines[full.wrongIndex] : null };
}

test("teaching the twin twice makes it learn, and it moves on to the next mistake", async (t) => {
  const records = setUpStudent(t, {
    studentId: "memory-student",
    resetToken: "memory-token",
    concepts: { distributive_property: { recentQuestionIds: ["dp_001"] } }
  });
  const post = await withServer(t);
  const token = "memory-token";

  const first = await post("/api/twin/lesson", { studentId: "memory-student" }, token);
  assert.equal(first.lesson.misconceptionType, "failed_to_distribute");
  assert.notEqual(first.lesson.questionId, "dp_001", "just-practised question is skipped");
  assert.deepEqual(first.progress.current, { type: "failed_to_distribute", taught: 0, needed: 2, learned: false });

  for (let lessonNumber = 1; lessonNumber <= 2; lessonNumber++) {
    const lesson = (await post("/api/twin/lesson", { studentId: "memory-student" }, token)).lesson;
    assert.equal(lesson.misconceptionType, "failed_to_distribute");
    const fix = correctFix(lesson);
    const result = await post("/api/twin/check", {
      studentId: "memory-student",
      questionId: lesson.questionId,
      misconceptionType: lesson.misconceptionType,
      chosenIndex: fix.index,
      correctedLine: fix.line
    }, token);

    assert.equal(result.fixedIt, true, `lesson ${lessonNumber}: ${fix.line}`);
    assert.equal(result.memory.remembered, true);
    assert.equal(result.memory.justLearned, lessonNumber === 2);
    if (lessonNumber === 2) assert.match(result.twinSays, /won't make that mistake again/);
  }

  const saved = records.get("memory-student").twin;
  assert.equal(saved.taught.failed_to_distribute, 2);

  const next = await post("/api/twin/lesson", { studentId: "memory-student" }, token);
  assert.equal(next.lesson.misconceptionType, "sign_error");
  assert.equal(next.progress.learnedCount, 1);
  assert.equal(next.progress.totalCount, 2);
});

test("repeating the same successful check does not count twice", async (t) => {
  const records = setUpStudent(t, { studentId: "repeat-student", resetToken: "repeat-token", concepts: {} });
  const post = await withServer(t);
  const body = {
    studentId: "repeat-student",
    questionId: "dp_001",
    misconceptionType: "failed_to_distribute",
    chosenIndex: 1,
    correctedLine: "2x + 6 = 14"
  };

  const once = await post("/api/twin/check", body, "repeat-token");
  const twice = await post("/api/twin/check", body, "repeat-token");
  assert.equal(once.memory.counted, true);
  assert.equal(twice.memory.counted, false);
  assert.equal(records.get("repeat-student").twin.taught.failed_to_distribute, 1);
});

test("with the wrong token the student still gets their result, but nothing is saved", async (t) => {
  const records = setUpStudent(t, { studentId: "owned-student", resetToken: "real-token", concepts: {} });
  const post = await withServer(t);

  const result = await post("/api/twin/check", {
    studentId: "owned-student",
    questionId: "dp_001",
    misconceptionType: "failed_to_distribute",
    chosenIndex: 1,
    correctedLine: "2x + 6 = 14"
  }, "someone-else");

  assert.equal(result.fixedIt, true);
  assert.deepEqual(result.memory, { remembered: false });
  assert.equal(records.get("owned-student").twin, undefined);
});
