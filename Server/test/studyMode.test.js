// Study mode (half the class teaches the twin, half doesn't) and the twin's
// lessons for inequalities and quadratics.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const studySessionService = require("../Services/studySessionService");
const classReportService = require("../Services/classReportService");
const twinService = require("../Services/twinService");
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

test("study groups are random but fixed, and split a class about in half", () => {
  const groups = Array.from({ length: 200 }, (_, i) => studySessionService.studyGroup(`st_${i}`, "ABCDEF"));
  const twin = groups.filter((g) => g === "twin").length;
  assert.ok(twin > 70 && twin < 130, `${twin} of 200 in the twin group`);
  assert.equal(studySessionService.studyGroup("st_5", "ABCDEF"), studySessionService.studyGroup("st_5", "ABCDEF"));
});

test("during a study the practice group can't open the twin, and the report compares the groups", async (t) => {
  memory(t);
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Study class" });
  const teacher = { "X-Teacher-Key": teacherKey };

  for (const [id, name] of [["st_study_a", "Tia"], ["st_study_b", "Pat"]]) {
    await studentStore.save({ studentId: id, resetToken: `tok-${id}`, classCode: code, displayName: name, concepts: {} });
  }

  assert.equal((await call("POST", `/api/classes/${code}/study`, { on: true }, { "X-Teacher-Key": "guess" })).status, 403);
  assert.equal((await call("POST", `/api/classes/${code}/study`, { on: true }, teacher)).status, 200);

  // The class is dealt into two equal halves when the study starts.
  const groups = (await classStore.get(code)).study.groups;
  assert.deepEqual(Object.values(groups).sort(), ["practice", "twin"]);
  const twinId = Object.keys(groups).find((id) => groups[id] === "twin");
  const practiceId = Object.keys(groups).find((id) => groups[id] === "practice");
  // The names used below follow whichever student landed in each group.
  await studentStore.save({ ...(await studentStore.get(twinId)), displayName: "Tia" });
  await studentStore.save({ ...(await studentStore.get(practiceId)), displayName: "Pat" });

  const lesson = (id) => call("POST", "/api/twin/lesson", { studentId: id }, { "X-Student-Token": `tok-${id}` });
  const blocked = await lesson(practiceId);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.studyGroup, "practice");
  assert.equal((await lesson(twinId)).status, 200);

  const profile = await studySessionService.getStudentProfile(practiceId);
  assert.equal(profile.studyGroup, "practice");

  // Comparison: each group's mistakes before the study and since.
  const startedAt = Date.parse((await classStore.get(code)).study.startedAt);
  const row = (id, minutes, mistake) => ({ studentId: id, concept: "distributive_property", createdAt: new Date(startedAt + minutes * 60000).toISOString(), misconceptionDetected: mistake, demonstratedCorrect: !mistake });
  const rows = [row(twinId, -5, true), row(twinId, -4, true), row(twinId, 5, false), row(twinId, 6, false),
    row(practiceId, -5, true), row(practiceId, -4, false), row(practiceId, 5, true), row(practiceId, 6, false)];
  t.mock.method(attemptLogStore, "listAttempts", async ({ studentId }) => rows.filter((r) => r.studentId === studentId));
  const report = await classReportService.buildClassReport(await classStore.get(code));
  assert.deepEqual(report.study.groups.twin.students, ["Tia"]);
  assert.deepEqual([report.study.groups.twin.before.rate, report.study.groups.twin.after.rate, report.study.groups.twin.change], [1, 0, -1]);
  assert.deepEqual([report.study.groups.practice.before.rate, report.study.groups.practice.after.rate, report.study.groups.practice.change], [0.5, 0.5, 0]);

  // Ending the study gives everyone the twin back.
  await call("POST", `/api/classes/${code}/study`, { on: false }, teacher);
  assert.equal((await lesson(practiceId)).status, 200);
});

test("the twin forgets to flip an inequality sign, and keeps only one solution of a quadratic", async (t) => {
  const call = await server(t);
  const [flip] = twinService.listTwinVariants(questionService.findQuestionById("iq_005"), "inequality_flip");
  assert.deepEqual(flip.lines, ["-3x + 5 ≥ 14", "-3x ≥ 9", "x ≥ -3"]);

  const check = (lessonRow, chosenIndex, correctedLine) => call("POST", "/api/twin/check", {
    questionId: lessonRow.questionId, misconceptionType: lessonRow.misconceptionType, variant: lessonRow.variant, chosenIndex, correctedLine
  });
  assert.equal((await check(flip, 2, "x ≤ -3")).body.fixedIt, true);
  assert.equal((await check(flip, 2, "x <= -3")).body.fixedIt, true, "typing <= is fine");
  assert.equal((await check(flip, 2, "x ≥ -3")).body.fixedIt, false);

  const [lost] = twinService.listTwinVariants(questionService.findQuestionById("qd_003"), "lost_a_solution");
  assert.deepEqual(lost.lines, ["x² = 49", "x = 7"]);
  assert.equal((await check(lost, 1, "x = 7 or x = -7")).body.fixedIt, true);
  assert.equal((await check(lost, 1, "x = ±7")).body.fixedIt, true);
  assert.equal((await check(lost, 1, "x = 7")).body.fixedIt, false);
});
