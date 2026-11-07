const assert = require("node:assert/strict");
const test = require("node:test");

const attemptLogStore = require("../Services/attemptLogStore");

test("attempt history deletion removes every row for one student only", async (t) => {
  // test/setup.js normally mocks this for API unit tests; restore the real
  // in-memory append for this store-specific behavior check.
  attemptLogStore.logAttempt.mock.restore();
  const previousMemorySetting = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  attemptLogStore.clearMemoryAttempts();
  t.after(() => {
    attemptLogStore.clearMemoryAttempts();
    if (previousMemorySetting === undefined) {
      delete process.env.MEMORY_STORE;
    } else {
      process.env.MEMORY_STORE = previousMemorySetting;
    }
  });

  await attemptLogStore.logAttempt({ studentId: "student-a", studentAnswer: "1" });
  await attemptLogStore.logAttempt({ studentId: "student-b", studentAnswer: "2" });
  await attemptLogStore.logAttempt({ studentId: "student-a", studentAnswer: "3" });

  assert.equal(await attemptLogStore.deleteAttemptsForStudent("student-a"), 2);
  assert.deepEqual(await attemptLogStore.listAttempts({ studentId: "student-a" }), []);
  assert.equal((await attemptLogStore.listAttempts({ studentId: "student-b" })).length, 1);
});
