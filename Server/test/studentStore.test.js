const assert = require("node:assert/strict");
const test = require("node:test");

const studentStore = require("../Services/studentStore");

test("saving progress preserves schema and creation metadata", async (t) => {
  const previousMemoryMode = process.env.MEMORY_STORE;
  process.env.MEMORY_STORE = "1";
  studentStore.clearMemoryRecords();

  t.after(() => {
    studentStore.clearMemoryRecords();
    if (previousMemoryMode === undefined) {
      delete process.env.MEMORY_STORE;
    } else {
      process.env.MEMORY_STORE = previousMemoryMode;
    }
  });

  await studentStore.save({
    studentId: "metadata-preservation-test",
    concepts: {},
    resetToken: "test-token",
    schemaVersion: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
    auditMetadata: { importBatch: "legacy-migration" }
  });
  await studentStore.save({
    studentId: "metadata-preservation-test",
    concepts: { algebra: { attempts: 1 } }
  });

  const saved = await studentStore.get("metadata-preservation-test");
  assert.equal(saved.schemaVersion, 3);
  assert.equal(saved.createdAt, "2026-10-01T00:00:00.000Z");
  assert.equal(saved.resetToken, "test-token");
  assert.deepEqual(saved.auditMetadata, {
    importBatch: "legacy-migration"
  });
  assert.equal(saved.concepts.algebra.attempts, 1);
});
