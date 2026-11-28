// Personalised practice sheets, and opening a sheet's question from its link.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const questionService = require("../Services/questionService");
const questionGenerator = require("../Services/questionGenerator");
const practiceSheetService = require("../Services/practiceSheetService");
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

let clock = 0;
const row = (type, concept, correct = false) => ({
  misconceptionDetected: Boolean(type), misconceptionType: type, concept, demonstratedCorrect: correct,
  createdAt: new Date(Date.UTC(2026, 10, 20, 9, 0, clock++)).toISOString()
});

test("a sheet leads with the student's own mistakes, in the topic they made them", () => {
  const student = { concepts: { negative_numbers: { attempts: 10, correct: 4 }, distributive_property: { attempts: 6, correct: 5 } } };
  const rows = [
    row("sign_error", "negative_numbers"), row("sign_error", "negative_numbers"), row("sign_error", "negative_numbers"),
    row("failed_to_distribute", "distributive_property"), row("failed_to_distribute", "distributive_property"),
    row("unknown_error", "negative_numbers"), row(null, "distributive_property", true)
  ];
  const sheet = practiceSheetService.planSheet(student, rows, "s1");

  assert.equal(sheet.length, practiceSheetService.SHEET_SIZE);
  assert.deepEqual(sheet.slice(0, 4).map((q) => q.reason), ["Sign error", "Sign error", "Failed to distribute", "Failed to distribute"]);
  assert.ok(sheet.slice(0, 2).every((q) => q.concept === "negative_numbers"));
  assert.ok(sheet.slice(2, 4).every((q) => q.concept === "distributive_property"));
  assert.equal(new Set(sheet.map((q) => q.id)).size, sheet.length, "no question twice");

  for (const q of sheet) {
    assert.ok(questionGenerator.isGeneratedId(q.id), `${q.id} can be rebuilt from its link`);
    const rebuilt = questionService.findQuestionById(q.id);
    assert.equal(rebuilt.question, q.question);
    assert.equal(rebuilt.answer, q.answer);
  }
  assert.deepEqual(practiceSheetService.planSheet(student, rows, "s1"), sheet, "the same seed gives the same sheet");
});

test("a student with no answers yet still gets a full sheet", () => {
  const sheet = practiceSheetService.planSheet({ concepts: {} }, [], "new");
  assert.equal(sheet.length, practiceSheetService.SHEET_SIZE);
  assert.ok(sheet.every((q) => q.reason === null));
});

test("the teacher gets one sheet per student; only the teacher can", async (t) => {
  memory(t);
  t.mock.method(attemptLogStore, "listAttempts", async ({ studentId }) =>
    (studentId.endsWith("111111") ? [row("factor_sign_error", "factorising"), row("factor_sign_error", "factorising")] : []));
  const call = await server(t);
  const { code, teacherKey } = await classStore.create({ name: "Sheets class" });
  await studentStore.save({ studentId: "st_sheet_aaaaaa111111", resetToken: "a", classCode: code, displayName: "Zara", concepts: { factorising: { attempts: 2, correct: 0 } } });
  await studentStore.save({ studentId: "st_sheet_bbbbbb222222", resetToken: "b", classCode: code, displayName: "Amir", concepts: {} });

  assert.equal((await call("GET", `/api/classes/${code}/practice-sheets`, undefined, { "X-Teacher-Key": "guess" })).status, 403);
  const res = await call("GET", `/api/classes/${code}/practice-sheets`, undefined, { "X-Teacher-Key": teacherKey });
  assert.equal(res.status, 200);
  assert.equal(res.body.className, "Sheets class");
  assert.deepEqual(res.body.sheets.map((s) => s.name), ["Amir", "Zara"], "in name order");
  const zara = res.body.sheets[1];
  assert.equal(zara.questions[0].reason, "Signs wrong in the brackets");
  assert.match(zara.questions[0].question, /^Factorise: x²/);
  assert.ok(!JSON.stringify(res.body).includes("st_sheet_"), "no student ids on the sheets");
});

test("a question link starts a session on exactly that question", async (t) => {
  memory(t);
  const call = await server(t);
  const headers = { "X-Student-Token": "tok-link" };
  const id = "g_fc3_4_7";

  const res = await call("POST", "/api/sessions", { studentId: "st_link_cccccc333333", concept: "distributive_property", difficulty: 1, questionId: id }, headers);
  assert.equal(res.status, 200);
  assert.equal(res.body.question.id, id);
  assert.equal(res.body.concept, "factorising", "the question's own topic, not the one the page had selected");
  assert.ok(!("answer" in res.body.question), "the answer isn't sent to the student");
  assert.ok((await studentStore.get("st_link_cccccc333333")).issuedQuestionIds.includes(id), "issued, so it can be answered");

  const bad = await call("POST", "/api/sessions", { studentId: "st_link_cccccc333333", concept: "distributive_property", questionId: "g_zz_1_2" }, headers);
  assert.equal(bad.status, 404);
  assert.match(bad.body.error, /question link doesn't work/);
});
