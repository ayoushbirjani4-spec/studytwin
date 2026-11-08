// Live step checking: per-line verdicts while the student types.
const assert = require("node:assert/strict");
const test = require("node:test");

const misconceptionService = require("../Services/misconceptionService");
const llmReviewService = require("../Services/llmReviewService");
const mlService = require("../Services/mlService");
const studentStore = require("../Services/studentStore");
const attemptLogStore = require("../Services/attemptLogStore");
const studySessionService = require("../Services/studySessionService");
const { app } = require("../index");

const statuses = (result) => result.steps.map((step) => step.status);

test("correct working is marked step by step; the question line is 'given'", () => {
  const result = misconceptionService.checkSteps({
    questionId: "dp_001",
    work: "2(x+3)=14\n2x+6=14\n2x=8\nx=4"
  });

  assert.deepEqual(statuses(result), ["given", "valid", "valid", "final"]);
  assert.equal(result.firstErrorIndex, null);
  assert.equal(result.errorCount, 0);
});

test("the first line is checked against the question when it is not written out", () => {
  const result = misconceptionService.checkSteps({ questionId: "dp_001", work: "2x+3=14" });

  assert.deepEqual(statuses(result), ["invalid"]);
  assert.equal(result.steps[0].label, "failed_to_distribute");
  assert.ok(result.steps[0].hint);
});

test("only the first mistake gets a hint, and later lines are checked against the line before", () => {
  const result = misconceptionService.checkSteps({
    questionId: "dp_001",
    work: "2(x+3)=14\n2x+3=14\n2x=11\n2x=20"
  });

  assert.deepEqual(statuses(result), ["given", "invalid", "valid", "invalid"]);
  assert.equal(result.firstErrorIndex, 1);
  assert.ok(result.steps[1].hint);
  assert.equal(result.steps[3].hint, null);
  assert.equal(result.errorCount, 2);
});

test("a bare 'x = number' line is never judged, so answers cannot be guessed live", () => {
  for (const guess of ["x=1", "x=4", "4=x"]) {
    const result = misconceptionService.checkSteps({ questionId: "dp_001", work: guess });
    assert.deepEqual(statuses(result), ["final"], guess);
  }
});

test("'x = expression' lines are still checked", () => {
  const result = misconceptionService.checkSteps({ questionId: "io_002", work: "x-4=10\nx=10-4" });

  assert.deepEqual(statuses(result), ["given", "invalid"]);
  assert.equal(result.steps[1].label, "wrong_inverse_op");
});

test("simplify questions check expressions", () => {
  const good = misconceptionService.checkSteps({ questionId: "clt_003", work: "4x+3+2x+5\n6x+8" });
  const bad = misconceptionService.checkSteps({ questionId: "clt_003", work: "4x+3+2x+5\n14x" });

  assert.deepEqual(statuses(good), ["given", "valid"]);
  assert.deepEqual(statuses(bad), ["given", "invalid"]);
  assert.equal(bad.steps[1].label, "combining_unlike_terms");
});

test("unreadable lines are flagged and skipped for the next comparison", () => {
  const result = misconceptionService.checkSteps({
    questionId: "dp_001",
    work: "2(x+3)=14\nnot maths\n2x+6=14"
  });

  assert.deepEqual(statuses(result), ["given", "unreadable", "valid"]);
});

test("arrow chains are split into steps", () => {
  const result = misconceptionService.checkSteps({
    questionId: "dp_001",
    work: "2(x+3)=14 -> 2x+6=14 -> 2x=8"
  });

  assert.deepEqual(statuses(result), ["given", "valid", "valid"]);
});

test("POST /api/steps/check validates input and returns verdicts without calling the LLM", async (t) => {
  let reviewCalls = 0;
  t.mock.method(llmReviewService, "reviewSubmission", async () => {
    reviewCalls += 1;
    return null;
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/steps/check`;
  const post = (body) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const ok = await post({ questionId: "dp_001", work: "2(x+3)=14\n2x+3=14" });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.steps.map((step) => step.status), ["given", "invalid"]);

  assert.equal((await post({ questionId: "dp_001" })).status, 400);
  assert.equal((await post({ questionId: "dp_001", work: "x".repeat(2001) })).status, 400);
  assert.equal((await post({ questionId: "nope", work: "x=1" })).status, 404);
  assert.equal(reviewCalls, 0);
});

test("the number of live hints seen is stored with the attempt", async (t) => {
  t.mock.method(studentStore, "get", async () => null);
  t.mock.method(studentStore, "save", async () => {});
  t.mock.method(llmReviewService, "reviewSubmission", async () => null);
  t.mock.method(mlService, "getLearningRecommendation", async () => ({ success: false }));
  const logged = [];
  t.mock.method(attemptLogStore, "logAttempt", async (entry) => logged.push(entry));

  await studySessionService.recordAnswer({
    studentId: "live-hints-student",
    resetToken: "live-hints-token",
    question: { id: "dp_001" },
    studentAnswer: "4",
    work: "2(x+3)=14\n2x+6=14\n2x=8\nx=4",
    liveHintsSeen: 2
  });

  assert.equal(logged[0].liveHintsSeen, 2);
});
