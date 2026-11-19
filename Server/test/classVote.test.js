// Class twin voting from phones.
const assert = require("node:assert/strict");
const test = require("node:test");

const classStore = require("../Services/classStore");
const { app } = require("../index");

async function setUp(t) {
  const previous = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  classStore.clearMemoryClasses();
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_STORE; else process.env.MEMORY_STORE = previous;
    classStore.clearMemoryClasses();
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  const { code, teacherKey } = await classStore.create({ name: "Voting class" });
  return { call, code, teacher: { "X-Teacher-Key": teacherKey } };
}

// dp_001's first lesson: line 1 (2x + 3 = 14) is the twin's mistake.
const lesson = { questionId: "dp_001", misconceptionType: "failed_to_distribute", variant: 0 };

test("the teacher opens a vote, phones vote once each, and the counts come back live", async (t) => {
  const { call, code, teacher } = await setUp(t);

  // Before a vote, phones are told to wait.
  assert.deepEqual((await call("GET", `/api/classes/${code}/poll`)).body.open, false);

  const opened = await call("POST", `/api/classes/${code}/poll`, lesson, teacher);
  assert.equal(opened.status, 200);
  const { pollId } = opened.body;

  const ballot = await call("GET", `/api/classes/${code.toLowerCase()}/poll`);
  assert.equal(ballot.body.open, true);
  assert.equal(ballot.body.question, "Solve: 2(x + 3) = 14");
  assert.equal(ballot.body.lines[1], "2x + 3 = 14");
  assert.ok(!JSON.stringify(ballot.body).match(/wrongIndex|correct|answer/i), "the answer never reaches the phones");

  const vote = (voterId, line) => call("POST", `/api/classes/${code}/poll/vote`, { pollId, voterId, line });
  assert.equal((await vote("phone-aaaa", 1)).status, 200);
  assert.equal((await vote("phone-bbbb", 1)).status, 200);
  assert.equal((await vote("phone-cccc", 3)).status, 200);
  assert.equal((await vote("phone-cccc", 1)).status, 200, "changing a vote replaces it");

  const results = await call("GET", `/api/classes/${code}/poll/results`, undefined, teacher);
  assert.equal(results.body.voters, 3);
  assert.equal(results.body.counts[1], 3);
  assert.equal(results.body.counts[3], 0);

  // Closing stops voting.
  await call("POST", `/api/classes/${code}/poll/close`, { pollId }, teacher);
  assert.equal((await vote("phone-dddd", 2)).status, 409);
  assert.equal((await call("GET", `/api/classes/${code}/poll`)).body.open, false);
});

test("bad votes are refused", async (t) => {
  const { call, code, teacher } = await setUp(t);
  const { pollId } = (await call("POST", `/api/classes/${code}/poll`, lesson, teacher)).body;
  const vote = (body) => call("POST", `/api/classes/${code}/poll/vote`, { pollId, voterId: "phone-aaaa", line: 1, ...body });

  assert.equal((await vote({ line: 0 })).status, 409, "the question line can't be the mistake");
  assert.equal((await vote({ line: 99 })).status, 409);
  assert.equal((await vote({ line: "1" })).status, 400);
  assert.equal((await vote({ voterId: "x" })).status, 400);
  assert.equal((await vote({ voterId: "bad id with spaces" })).status, 400);
  assert.equal((await vote({ pollId: "old-poll" })).status, 409);

  // A new lesson starts a new vote; old votes don't carry over.
  const next = (await call("POST", `/api/classes/${code}/poll`, { ...lesson, questionId: "dp_002" }, teacher)).body;
  assert.notEqual(next.pollId, pollId);
  assert.equal((await vote({})).status, 409, "a vote for the previous lesson doesn't count");
});

test("only the teacher can open, close or see the vote", async (t) => {
  const { call, code } = await setUp(t);
  const nope = { "X-Teacher-Key": "guess" };
  assert.equal((await call("POST", `/api/classes/${code}/poll`, lesson, nope)).status, 403);
  assert.equal((await call("GET", `/api/classes/${code}/poll/results`, undefined, nope)).status, 403);
  assert.equal((await call("POST", `/api/classes/${code}/poll/close`, { pollId: "x" }, nope)).status, 403);
  assert.equal((await call("GET", "/api/classes/ZZZZZZ/poll")).status, 404);
});
