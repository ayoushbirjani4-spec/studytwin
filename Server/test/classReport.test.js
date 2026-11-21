// The teacher view: classes, joining, and the class report.
const assert = require("node:assert/strict");
const test = require("node:test");

const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const classStore = require("../Services/classStore");
const classReportService = require("../Services/classReportService");
const { app } = require("../index");

const at = (minute) => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();

// One character per answer: "x" = made `type`, "." = clean and correct.
function answers(studentId, pattern, start, type = "sign_error", concept = "distributive_property") {
  return [...pattern].map((c, i) => ({
    studentId, concept, questionId: "dp_001", createdAt: at(start + i),
    studentAnswer: "4", work: "2(x+3)=14", answerCorrect: c !== "x",
    demonstratedCorrect: c === ".", misconceptionDetected: c === "x",
    misconceptionType: c === "x" ? type : null, misconceptionSource: c === "x" ? "rules" : null
  }));
}

function useMemory(t) {
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

async function withServer(t) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
}

test("a teacher creates a class, students join by code, and only the teacher key opens the report", async (t) => {
  useMemory(t);
  const call = await withServer(t);

  const created = await call("POST", "/api/classes", { name: "Year 8 Maths" });
  assert.equal(created.status, 201);
  assert.match(created.body.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.ok(created.body.teacherKey.length >= 30);
  const { code, teacherKey } = created.body;

  // Students can check the code before joining, without seeing anything else.
  const lookup = await call("GET", `/api/classes/${code.toLowerCase()}`);
  assert.deepEqual(lookup.body, { success: true, code, name: "Year 8 Maths" });
  assert.equal((await call("GET", "/api/classes/ZZZZZZ")).status, 404);

  const join = (id, name, token = `${id}-token`) =>
    call("POST", `/api/students/${id}/class`, { code, displayName: name }, { "X-Student-Token": token });
  assert.equal((await join("st_a", "Asha")).status, 200);
  assert.equal((await join("st_b", "  Ben   K  ")).body.displayName, "Ben K");
  assert.equal((await join("st_c", "")).status, 400, "a name is required");
  assert.equal((await join("st_a", "Someone else", "wrong-token")).status, 403, "can't rename another browser's student");

  // Only a hash of the teacher key is kept.
  const stored = await classStore.get(code);
  assert.ok(!JSON.stringify(stored).includes(teacherKey));

  assert.equal((await call("GET", `/api/classes/${code}/report`)).status, 403);
  assert.equal((await call("GET", `/api/classes/${code}/report`, undefined, { "X-Teacher-Key": "guess" })).status, 403);
  const report = await call("GET", `/api/classes/${code}/report`, undefined, { "X-Teacher-Key": teacherKey });
  assert.equal(report.status, 200);
  assert.deepEqual(report.body.students.map((s) => s.name), ["Asha", "Ben K"]);
  assert.ok(report.body.students.every((s) => !("studentId" in s)), "full student ids aren't sent to the page");

  // Leaving the class takes the student off the report.
  await call("POST", "/api/students/st_b/class", { code: null }, { "X-Student-Token": "st_b-token" });
  const after = await call("GET", `/api/classes/${code}/report`, undefined, { "X-Teacher-Key": teacherKey });
  assert.deepEqual(after.body.students.map((s) => s.name), ["Asha"]);
});

test("the report shows who is stuck, the common mistakes, and pooled evidence", async (t) => {
  useMemory(t);
  const { code } = await classStore.create({ name: "Test class" });
  const classRecord = await classStore.get(code);

  const members = [
    // Taught the twin about sign errors at minute 50, then made them less.
    { studentId: "s1", displayName: "Asha", classCode: code, concepts: {},
      twin: { taught: { sign_error: 2 }, firstTaughtAt: { sign_error: at(50) }, lastTaughtAt: {}, recentLessons: [] },
      curedMistakes: [{ type: "sign_error", concept: "distributive_property", curedAt: at(60), attempts: 6,
        checkups: [{ days: 2, dueAt: at(62), result: "held" }, { days: 7, dueAt: at(67), result: null }] }] },
    { studentId: "s2", displayName: "Ben", classCode: code, concepts: {},
      twin: { taught: { sign_error: 1 }, firstTaughtAt: { sign_error: at(50) }, lastTaughtAt: {}, recentLessons: [] } },
    // Stuck: 4 of the last 10 answers have the same mistake.
    { studentId: "s3", displayName: "Cara", classCode: code, concepts: {} },
    { studentId: "other", displayName: "Not in class", classCode: "OTHER1", concepts: {} }
  ];
  const rows = {
    s1: [...answers("s1", "x.x.x.x.x.", 0), ...answers("s1", "....x.....", 100)],
    s2: [...answers("s2", "xx.x.", 0), ...answers("s2", "....x..", 100)],
    s3: answers("s3", "..x.x..xx.", 0, "failed_to_distribute"),
    other: answers("other", "xxxxx", 0)
  };
  t.mock.method(studentStore, "listByClass", async (c) => members.filter((m) => m.classCode === c));
  t.mock.method(attemptLogStore, "listAttempts", async ({ studentId }) => rows[studentId].slice().reverse());

  const report = await classReportService.buildClassReport(classRecord, { now: Date.parse(at(200)) });

  assert.equal(report.totals.students, 3);
  assert.equal(report.totals.stuck, 1);
  const cara = report.students.find((s) => s.name === "Cara");
  assert.deepEqual(cara.stuckOn, { type: "failed_to_distribute", label: cara.stuckOn.label, count: 4, outOf: 10 });
  assert.equal(report.students.find((s) => s.name === "Asha").stuckOn, null);

  const sign = report.mistakes.find((m) => m.type === "sign_error");
  assert.equal(sign.students, 2);
  const ftd = report.mistakes.find((m) => m.type === "failed_to_distribute");
  assert.deepEqual(ftd.stuck, ["Cara"]);

  // Pooled: Asha 5/10 -> 1/10, Ben 3/5 -> 1/7.
  const [effect] = report.evidence.twinEffect;
  assert.equal(effect.type, "sign_error");
  assert.equal(effect.students, 2);
  assert.deepEqual([effect.before.errors, effect.before.attempts], [8, 15]);
  assert.deepEqual([effect.after.errors, effect.after.attempts], [2, 17]);
  assert.equal(effect.outcomes.improved, 2);
  assert.equal(effect.change, Number(((2 / 17 - 8 / 15) / (8 / 15)).toFixed(4)));

  // Asha's cure: 10 answers on the topic since, the mistake came back once.
  assert.deepEqual(
    { total: report.evidence.cures.total, cameBack: report.evidence.cures.cameBack },
    { total: 1, cameBack: 1 }
  );
  assert.deepEqual(report.evidence.cures.checkups, [{ days: 2, answered: 1, held: 1 }, { days: 7, answered: 0, held: 0 }]);
});

test("the export numbers students instead of naming them, and the blind version is ready to label", async (t) => {
  useMemory(t);
  const { code } = await classStore.create({ name: "Export class" });
  const classRecord = await classStore.get(code);
  t.mock.method(studentStore, "listByClass", async () => [
    { studentId: "s1", displayName: "Asha", classCode: code, joinedClassAt: at(0) },
    { studentId: "s2", displayName: "Ben", classCode: code, joinedClassAt: at(1) }
  ]);
  const rows = {
    s1: [{ ...answers("s1", "x", 5)[0], work: "-3x = 6\nx = \"-2\"" }],
    s2: [{ ...answers("s2", ".", 2)[0], work: "=HYPERLINK(\"x\")" }]
  };
  t.mock.method(attemptLogStore, "listAttempts", async ({ studentId }) => rows[studentId]);

  const blind = await classReportService.exportClassAttempts(classRecord, { blind: true });
  assert.deepEqual(blind.map((r) => r.student), ["S02", "S01"], "oldest first, numbered by join order");
  assert.ok(blind.every((r) => r.gold === "" && !("misconceptionType" in r)));

  const csv = classReportService.toCsv(blind);
  assert.ok(!csv.includes("Asha") && !csv.includes("Ben"));
  assert.match(csv, /^id,student,createdAt,/);
  assert.ok(csv.includes('"-3x = 6\nx = ""-2"""'), "working is kept exactly, quotes escaped");
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), "a formula is defused");

  const full = await classReportService.exportClassAttempts(classRecord);
  assert.equal(full.find((r) => r.student === "S01").misconceptionType, "sign_error");
});

test("the report includes mastery by topic and recent work for printing", async (t) => {
  useMemory(t);
  const { code } = await classStore.create({ name: "Print class" });
  t.mock.method(studentStore, "listByClass", async () => [{
    studentId: "p1", displayName: "Pria", classCode: code,
    concepts: { negative_numbers: { attempts: 4, correct: 3 }, fractions: { attempts: 0, correct: 0 } }
  }]);
  t.mock.method(attemptLogStore, "listAttempts", async () =>
    answers("p1", "x.....", 0, "sign_error", "negative_numbers").reverse());

  const [student] = (await classReportService.buildClassReport(await classStore.get(code))).students;
  assert.deepEqual(student.topics, [{ concept: "negative_numbers", attempts: 4, mastery: 0.75 }], "topics with no answers are left out");
  assert.equal(student.recentWork.length, 5);
  assert.equal(student.recentWork[0].createdAt, at(5), "newest first");
  assert.equal(student.recentWork.at(-1).mistake, null);
});
