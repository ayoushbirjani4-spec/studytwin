const assert = require("node:assert/strict");
const test = require("node:test");

const attemptLogStore = require("../Services/attemptLogStore");
const studentStore = require("../Services/studentStore");
const studySessionService = require("../Services/studySessionService");

test("reset removes attempt history and progress before reporting complete", async (t) => {
  const calls = [];
  t.mock.method(studentStore, "get", async () => ({
    studentId: "reset-student",
    resetToken: "browser-token",
    concepts: {}
  }));
  t.mock.method(attemptLogStore, "deleteAttemptsForStudent", async (studentId) => {
    calls.push(["attempts", studentId]);
    return 4;
  });
  t.mock.method(studentStore, "remove", async (studentId) => {
    calls.push(["progress", studentId]);
    return true;
  });

  const reset = await studySessionService.resetStudent(
    "reset-student",
    "browser-token"
  );

  assert.deepEqual(calls, [
    ["attempts", "reset-student"],
    ["progress", "reset-student"]
  ]);
  assert.deepEqual(reset, {
    complete: true,
    deletedProgress: true,
    deletedAttempts: true,
    attemptCount: 4
  });
});

test("reset reports partial deletion when progress removal fails", async (t) => {
  t.mock.method(studentStore, "get", async () => ({
    studentId: "partial-reset-student",
    resetToken: "browser-token",
    concepts: {}
  }));
  t.mock.method(attemptLogStore, "deleteAttemptsForStudent", async () => 2);
  t.mock.method(studentStore, "remove", async () => {
    const error = new Error("database selection timed out");
    error.name = "MongoServerSelectionError";
    throw error;
  });

  await assert.rejects(
    studySessionService.resetStudent("partial-reset-student", "browser-token"),
    (error) => {
      assert.deepEqual(error.resetResult, {
        complete: false,
        deletedProgress: false,
        deletedAttempts: true,
        attemptCount: 2
      });
      return true;
    }
  );
});
