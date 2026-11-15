// Working from a photo: Gemini only transcribes, the photo is passed
// straight through, and only a student working on that question can send one.
const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");

const studentStore = require("../Services/studentStore");
const { app } = require("../index");

// Requests go through node:http, because fetch is mocked to stand in for Gemini.
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
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

const IMAGE = "data:image/jpeg;base64," + Buffer.from("fake jpeg bytes").toString("base64");
const student = { studentId: "photo-student", resetToken: "photo-token", issuedQuestionIds: ["dp_001"], concepts: {} };

function geminiReply(body) {
  return new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(body) }] } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function withGemini(t) {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });
}

const send = (body, token = "photo-token") => post("/api/work/photo", body, { "X-Student-Token": token });

test("the photo is sent to Gemini with the question, and the lines come back cleaned", async (t) => {
  withGemini(t);
  t.mock.method(studentStore, "get", async () => student);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return geminiReply({ readable: true, lines: ["2(x + 3) = 14", "  2x +   3 = 14 ", "", "2x = 11", "x = 11/2"], final_answer: "x = 11/2" });
  });

  const res = await send({ studentId: "photo-student", questionId: "dp_001", image: IMAGE });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.lines, ["2(x + 3) = 14", "2x + 3 = 14", "2x = 11", "x = 11/2"], "mistakes are kept, blanks dropped");
  assert.equal(res.body.answer, "x = 11/2");
  assert.equal(res.body.readable, true);

  const parts = calls[0].body.contents[0].parts;
  assert.match(parts[0].text, /Solve: 2\(x \+ 3\) = 14/);
  assert.match(parts[0].text, /never correct/);
  assert.deepEqual(parts[1].inline_data, { mime_type: "image/jpeg", data: IMAGE.split(",")[1] });
});

test("an unreadable photo says so", async (t) => {
  withGemini(t);
  t.mock.method(studentStore, "get", async () => student);
  t.mock.method(globalThis, "fetch", async () => geminiReply({ readable: false, lines: [], final_answer: null }));
  const res = await send({ studentId: "photo-student", questionId: "dp_001", image: IMAGE });
  assert.equal(res.status, 200);
  assert.equal(res.body.readable, false);
});

test("only the student working on the question can send a photo", async (t) => {
  withGemini(t);
  t.mock.method(studentStore, "get", async (id) => (id === "photo-student" ? student : null));
  let geminiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { geminiCalls++; return geminiReply({ readable: true, lines: ["x = 1"], final_answer: "1" }); });

  assert.equal((await send({ studentId: "photo-student", questionId: "dp_001", image: IMAGE }, "wrong-token")).status, 403);
  assert.equal((await send({ studentId: "nobody", questionId: "dp_001", image: IMAGE })).status, 403);
  assert.equal((await send({ studentId: "photo-student", questionId: "dp_002", image: IMAGE })).status, 403, "question not issued");
  assert.equal(geminiCalls, 0);
});

test("only JPEG, PNG and WebP images of a sensible size are accepted", async (t) => {
  withGemini(t);
  t.mock.method(studentStore, "get", async () => student);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("should not be called"); });

  const bad = await send({ studentId: "photo-student", questionId: "dp_001", image: "data:image/gif;base64,R0lGOD" });
  assert.equal(bad.status, 400);
  const notData = await send({ studentId: "photo-student", questionId: "dp_001", image: "https://example.com/a.jpg" });
  assert.equal(notData.status, 400);

  const huge = await send({ studentId: "photo-student", questionId: "dp_001", image: "data:image/jpeg;base64," + "A".repeat(3_400_000) });
  assert.equal(huge.status, 413);
  assert.match(huge.body.error, /too large/);
});

test("without a Gemini key the server says photos aren't set up", async (t) => {
  const previous = { g: process.env.GEMINI_API_KEY, l: process.env.LLM_API_KEY };
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_API_KEY;
  t.after(() => {
    if (previous.g !== undefined) process.env.GEMINI_API_KEY = previous.g;
    if (previous.l !== undefined) process.env.LLM_API_KEY = previous.l;
  });
  t.mock.method(studentStore, "get", async () => student);
  const res = await send({ studentId: "photo-student", questionId: "dp_001", image: IMAGE });
  assert.equal(res.status, 503);
  assert.match(res.body.error, /isn't set up/);
});

test("photos are capped per minute, and only real reads count", async (t) => {
  withGemini(t);
  t.mock.method(studentStore, "get", async () => student);
  let geminiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { geminiCalls++; return geminiReply({ readable: true, lines: ["x = 4"], final_answer: "4" }); });

  const statuses = [];
  for (let i = 0; i < 8; i++) {
    statuses.push((await send({ studentId: "photo-student", questionId: "dp_001", image: IMAGE })).status);
  }
  assert.ok(statuses.includes(429), statuses.join(","));
  // Earlier tests in this file already used three of the six.
  assert.ok(geminiCalls <= 6, `${geminiCalls} Gemini calls`);
});

test("ordinary routes keep the small body limit", async () => {
  const res = await post("/api/steps/check", { questionId: "dp_001", work: "x".repeat(200_000) });
  assert.equal(res.status, 413);
});
