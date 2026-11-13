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

const { questions: QUESTIONS } = require("../data/questions");
const { buildTwinSolution } = twinService;

// A valid fix for any lesson: every line before the twin's mistake is
// correct, so jumping straight to the right answer always follows from it.
function correctFix(lesson) {
  const question = QUESTIONS.find((q) => q.id === lesson.questionId);
  const full = buildTwinSolution(question, lesson.misconceptionType, lesson.variant);
  const line = /^simplify/i.test(question.question) ? question.answer : `x = ${question.answer}`;
  return { index: full.wrongIndex, line };
}

async function teach(post, token, studentId, lesson) {
  const fix = correctFix(lesson);
  return post("/api/twin/check", {
    studentId,
    questionId: lesson.questionId,
    misconceptionType: lesson.misconceptionType,
    variant: lesson.variant,
    chosenIndex: fix.index,
    correctedLine: fix.line
  }, token);
}

test("lessons alternate between the student's habit and mistakes in other steps", async (t) => {
  setUpStudent(t, { studentId: "mixed-student", resetToken: "mixed-token", concepts: {} });
  const post = await withServer(t);

  const modes = [];
  const types = [];
  for (let lessonNumber = 0; lessonNumber < 6; lessonNumber++) {
    const data = await post("/api/twin/lesson", { studentId: "mixed-student", lessonNumber }, "mixed-token");
    modes.push(data.mode);
    types.push(data.lesson.misconceptionType);
    assert.equal(data.lesson.stage, undefined, "the step is never sent to the browser");
  }

  assert.deepEqual(modes, ["habit", "mixed", "habit", "mixed", "habit", "mixed"]);
  assert.ok(types.filter((_, i) => i % 2 === 0).every((type) => type === "failed_to_distribute"));
  assert.ok(types.filter((_, i) => i % 2 === 1).every((type) => type !== "failed_to_distribute"));
});

test("mixed lessons put the twin's mistake later in the solution", async (t) => {
  setUpStudent(t, { studentId: "late-student", resetToken: "late-token", concepts: {} });
  const post = await withServer(t);

  const wrongLines = [];
  for (const lessonNumber of [1, 3, 5]) {
    const { lesson } = await post("/api/twin/lesson", { studentId: "late-student", lessonNumber }, "late-token");
    const full = buildTwinSolution(QUESTIONS.find((q) => q.id === lesson.questionId), lesson.misconceptionType, lesson.variant);
    wrongLines.push(full.wrongIndex);
  }
  // Line 1 is the expansion, where the distribution habit always is.
  assert.ok(wrongLines.every((index) => index >= 2), `mistake lines ${wrongLines}`);
  assert.ok(new Set(wrongLines).size >= 2, `mistake lines ${wrongLines}`);
});

test("teaching the habit twice makes the twin learn it, mixed lessons in between", async (t) => {
  const records = setUpStudent(t, {
    studentId: "memory-student",
    resetToken: "memory-token",
    concepts: { distributive_property: { recentQuestionIds: ["dp_001"] } }
  });
  const post = await withServer(t);
  const token = "memory-token";

  const first = await post("/api/twin/lesson", { studentId: "memory-student", lessonNumber: 0 }, token);
  assert.equal(first.mode, "habit");
  assert.equal(first.lesson.misconceptionType, "failed_to_distribute");
  assert.notEqual(first.lesson.questionId, "dp_001", "just-practised question is skipped");
  assert.deepEqual(first.progress.current, { type: "failed_to_distribute", taught: 0, needed: 2, learned: false });

  const taught1 = await teach(post, token, "memory-student", first.lesson);
  assert.equal(taught1.fixedIt, true);
  assert.equal(taught1.memory.justLearned, false);

  // Next comes a mixed lesson: a different mistake, and the habit counter stays.
  const mixed = await post("/api/twin/lesson", { studentId: "memory-student", lessonNumber: 1 }, token);
  assert.equal(mixed.mode, "mixed");
  assert.notEqual(mixed.lesson.misconceptionType, "failed_to_distribute");
  const taughtMixed = await teach(post, token, "memory-student", mixed.lesson);
  assert.equal(taughtMixed.fixedIt, true, JSON.stringify(mixed.lesson.lines));

  const second = await post("/api/twin/lesson", { studentId: "memory-student", lessonNumber: 2 }, token);
  assert.equal(second.mode, "habit");
  assert.equal(second.progress.current.taught, 1);
  const taught2 = await teach(post, token, "memory-student", second.lesson);
  assert.equal(taught2.memory.justLearned, true);
  assert.match(taught2.twinSays, /won't make that mistake again/);

  assert.equal(records.get("memory-student").twin.taught.failed_to_distribute, 2);

  // The habit is learned, so the next habit lesson moves on to the next mistake.
  const next = await post("/api/twin/lesson", { studentId: "memory-student", lessonNumber: 4 }, token);
  assert.equal(next.mode, "habit");
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
