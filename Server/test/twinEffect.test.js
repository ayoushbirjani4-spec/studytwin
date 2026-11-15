// The Twin Effect: is a mistake rarer in the student's own practice
// since they started teaching it to their twin?
const assert = require("node:assert/strict");
const test = require("node:test");

const twinService = require("../Services/twinService");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const studySessionService = require("../Services/studySessionService");

const at = (minute) => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();
const TAUGHT_AT = at(50);

// `pattern`: one character per answer, "x" = made the mistake, "." = didn't.
function answers(pattern, startMinute, concept = "distributive_property", type = "failed_to_distribute") {
  return [...pattern].map((c, i) => ({
    concept,
    createdAt: at(startMinute + i),
    misconceptionDetected: c === "x",
    misconceptionType: c === "x" ? type : null
  }));
}

const memory = (extra = {}) => ({
  taught: { failed_to_distribute: 2 },
  firstTaughtAt: { failed_to_distribute: TAUGHT_AT },
  lastTaughtAt: { failed_to_distribute: at(70) },
  recentLessons: [],
  ...extra
});

test("a mistake that became rarer since teaching shows as improved", () => {
  const rows = [...answers("x.x.x.x.x.", 0), ...answers("...x......", 100)];
  const [effect] = twinService.computeTwinEffect(rows, memory());

  assert.equal(effect.status, "improved");
  assert.deepEqual(effect.before, { errors: 5, attempts: 10, rate: 0.5 });
  assert.deepEqual(effect.after, { errors: 1, attempts: 10, rate: 0.1 });
  assert.equal(effect.learned, true);
});

test("nothing is claimed until there are enough answers since teaching", () => {
  const rows = [...answers("x.x.x.x.x.", 0), ...answers("..", 100)];
  const [effect] = twinService.computeTwinEffect(rows, memory());
  assert.equal(effect.status, "collecting");
  assert.equal(effect.attemptsNeeded, 3);
});

test("no improvement is reported honestly", () => {
  const same = twinService.computeTwinEffect([...answers("x....", 0), ...answers("x....", 100)], memory())[0];
  assert.equal(same.status, "unchanged");

  const worse = twinService.computeTwinEffect([...answers("x....", 0), ...answers("xx...", 100)], memory())[0];
  assert.equal(worse.status, "not_yet");
});

test("without earlier answers there is no before-and-after comparison", () => {
  const [effect] = twinService.computeTwinEffect(answers(".x....", 100), memory());
  assert.equal(effect.status, "no_baseline");
});

test("only answers on topics where the mistake happens are compared", () => {
  const rows = [
    ...answers("x.x.x", 0),
    ...answers(".....", 100),
    // Lots of unrelated, mistake-free answers would dilute the rate if counted.
    ...answers("..........", 110, "inverse_operations")
  ];
  const [effect] = twinService.computeTwinEffect(rows, memory());
  assert.equal(effect.after.attempts, 5);
  assert.equal(effect.before.attempts, 5);
});

test("comparisons use at most the 20 answers on each side", () => {
  const rows = [...answers("x".repeat(40), 0), ...answers(".".repeat(30), 100)];
  const [effect] = twinService.computeTwinEffect(rows, memory({ firstTaughtAt: { failed_to_distribute: at(60) } }));
  assert.equal(effect.before.attempts, 20);
  assert.equal(effect.after.attempts, 20);
});

test("the first teaching time is kept; older records fall back to the latest", () => {
  let mem = twinService.emptyTwinMemory();
  mem = twinService.applyTwinTeaching(mem, { misconceptionType: "sign_error", questionId: "dp_001", now: new Date(at(10)) }).memory;
  mem = twinService.applyTwinTeaching(mem, { misconceptionType: "sign_error", questionId: "dp_002", now: new Date(at(20)) }).memory;
  assert.equal(mem.firstTaughtAt.sign_error, at(10));
  assert.equal(mem.lastTaughtAt.sign_error, at(20));

  const legacy = { taught: { failed_to_distribute: 1 }, lastTaughtAt: { failed_to_distribute: TAUGHT_AT }, recentLessons: [] };
  const [effect] = twinService.computeTwinEffect(answers("x.x.x.....", 0).concat(answers(".....", 100)), legacy);
  assert.equal(effect.since, TAUGHT_AT);
});

test("students who haven't taught their twin see no Twin Effect", () => {
  assert.deepEqual(twinService.computeTwinEffect(answers("x.x", 0), null), []);
});

test("the student profile includes the Twin Effect", async (t) => {
  t.mock.method(studentStore, "get", async () => ({
    studentId: "effect-student",
    resetToken: "effect-token",
    concepts: {
      distributive_property: {
        attempts: 20, correct: 14, rawCorrect: 15, recentResults: [], misconceptionCount: 6,
        misconceptionsByType: { failed_to_distribute: { count: 6 } }, currentDifficulty: 1, recentQuestionIds: []
      }
    },
    twin: memory()
  }));
  t.mock.method(attemptLogStore, "listAttempts", async () =>
    [...answers("x.x.x.x.x.", 0), ...answers("...x......", 100)].reverse()
  );

  const profile = await studySessionService.getStudentProfile("effect-student");
  assert.equal(profile.twinEffect.length, 1);
  assert.equal(profile.twinEffect[0].status, "improved");
  assert.equal(profile.twinEffect[0].after.rate, 0.1);

  // Motivation data for the goal ring, streak and twin growth.
  assert.equal(profile.activity.checkedAt.length, 20);
  assert.equal(profile.activity.checkedAt[0], at(0), "oldest first");
  assert.equal(profile.activity.checkedAt.at(-1), at(109), "newest last");
  assert.equal(profile.twinProgress.learnedCount, 1);
});
