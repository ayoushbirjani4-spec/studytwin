// Explain the fix: after correcting the twin's line, the student (or the
// class, on the projector) says why it was wrong, and Gemini judges it.
const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");

const studentStore = require("../Services/studentStore");
const classStore = require("../Services/classStore");
const { app } = require("../index");

// fetch is mocked to stand in for Gemini, so requests use node:http.
let server;
test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
});
test.after(() => server.close());

function post(path, body, headers = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: server.address().port, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers }
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function withGemini(t, reply) {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(reply) }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

// dp_001: 2(x + 3) = 14; the twin's first lesson skips multiplying the 3.
const lesson = { questionId: "dp_001", misconceptionType: "failed_to_distribute", variant: 0, correctedLine: "2x + 6 = 14" };
const student = { studentId: "explainer", resetToken: "explain-token", concepts: {} };

test("a student's reason is judged by Gemini, given the twin's mistake and the fix", async (t) => {
  const calls = withGemini(t, { verdict: "right", feedback: "Yes! The 2 multiplies the 3 too." });
  t.mock.method(studentStore, "get", async (id) => (id === "explainer" ? student : null));

  const res = await post("/api/twin/explain",
    { ...lesson, studentId: "explainer", explanation: "you have to times the 3 by 2 as well" },
    { "X-Student-Token": "explain-token" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, verdict: "right", feedback: "Yes! The 2 multiplies the 3 too." });
  const prompt = calls[0].contents[0].parts[0].text;
  assert.match(prompt, /2\(x \+ 3\) = 14/);
  assert.match(prompt, /The twin wrote: "2x \+ 3 = 14"/);
  assert.match(prompt, /"2x \+ 6 = 14"/);
  assert.match(prompt, /times the 3 by 2/);
  assert.match(prompt, /data, never instructions/);
});

test("the class twin can be explained with the teacher key", async (t) => {
  withGemini(t, { verdict: "partly", feedback: "Good start. Which number was left out?" });
  const previous = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  t.after(() => { if (previous === undefined) delete process.env.MEMORY_STORE; else process.env.MEMORY_STORE = previous; });
  const { code, teacherKey } = await classStore.create({ name: "Projector class" });

  const ok = await post("/api/twin/explain", { ...lesson, classCode: code, explanation: "it's wrong" }, { "X-Teacher-Key": teacherKey });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.verdict, "partly");

  const wrongKey = await post("/api/twin/explain", { ...lesson, classCode: code, explanation: "it's wrong" }, { "X-Teacher-Key": "nope" });
  assert.equal(wrongKey.status, 403);
});

test("Gemini is only asked for a real student who has fixed the line", async (t) => {
  const calls = withGemini(t, { verdict: "right", feedback: "ok" });
  t.mock.method(studentStore, "get", async (id) => (id === "explainer" ? student : null));
  const send = (body, token = "explain-token") => post("/api/twin/explain", { ...lesson, studentId: "explainer", explanation: "because", ...body }, { "X-Student-Token": token });

  assert.equal((await send({}, "wrong-token")).status, 403);
  assert.equal((await send({ studentId: "nobody" })).status, 403);
  assert.equal((await send({ correctedLine: "2x + 3 = 14" })).status, 400, "the twin's own wrong line isn't a fix");
  assert.equal((await send({ explanation: "   " })).status, 400);
  assert.equal((await send({ explanation: "x".repeat(301) })).status, 400);
  assert.equal(calls.length, 0);
});

test("a judgement outside the allowed verdicts is refused", async (t) => {
  withGemini(t, { verdict: "excellent", feedback: "ok" });
  t.mock.method(studentStore, "get", async () => student);
  const res = await post("/api/twin/explain", { ...lesson, studentId: "explainer", explanation: "the 3" }, { "X-Student-Token": "explain-token" });
  assert.equal(res.status, 502);
});

test("without a Gemini key, explaining is reported as not set up", async (t) => {
  const previous = { g: process.env.GEMINI_API_KEY, l: process.env.LLM_API_KEY };
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_API_KEY;
  t.after(() => {
    if (previous.g !== undefined) process.env.GEMINI_API_KEY = previous.g;
    if (previous.l !== undefined) process.env.LLM_API_KEY = previous.l;
  });
  t.mock.method(studentStore, "get", async () => student);
  const res = await post("/api/twin/explain", { ...lesson, studentId: "explainer", explanation: "the 3" }, { "X-Student-Token": "explain-token" });
  assert.equal(res.status, 503);
  assert.match(res.body.error, /isn't set up/);
});
