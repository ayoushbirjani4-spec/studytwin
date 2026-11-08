// Runs in its own process so the store modules create a fresh MongoClient.
const assert = require("node:assert/strict");
const test = require("node:test");
const { serviceStatus } = require("../middleware/serviceErrors");

test("an unreachable MongoDB fails fast with a 503 instead of waiting 30 seconds", async (t) => {
  const keys = ["MEMORY_STORE", "MONGODB_URI", "MONGODB_TIMEOUT_MS"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  delete process.env.MEMORY_STORE;
  process.env.MONGODB_URI = "mongodb://127.0.0.1:1/?directConnection=true";
  process.env.MONGODB_TIMEOUT_MS = "300";
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const studentStore = require("../Services/studentStore");
  const started = Date.now();
  const error = await studentStore.get("anyone").then(() => null, (e) => e);

  assert.ok(error, "expected the lookup to fail");
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
  assert.equal(serviceStatus(error), 503);
});
