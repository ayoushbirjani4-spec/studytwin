const assert = require("node:assert/strict");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mlService = require("../Services/mlService");

async function main() {
  const health = await mlService.checkMLHealth();
  assert.equal(health.success, true, `ML health failed: ${health.error || "unhealthy"}`);
  assert.equal(health.data?.status, "healthy");

  const prediction = await mlService.predictStudent({
    difficulty: 1,
    attempt_count: 3,
    correct_rate: 0.5,
    recent_accuracy: 0.5,
    misconception_count: 1,
    previous_correct: 0,
    concept: "distributive_property"
  });
  assert.equal(prediction.success, true, `ML prediction failed: ${prediction.error || "invalid response"}`);
  assert.ok(Number.isFinite(prediction.data?.data?.probability_correct));

  const baseUrl = process.env.ML_API_URL || "http://127.0.0.1:8000";
  const stepResponse = await fetch(`${baseUrl}/predict-step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      previous_step: "2(x+3)=14",
      current_step: "2x+3=14"
    })
  });
  assert.equal(stepResponse.ok, true, `ML step prediction returned HTTP ${stepResponse.status}`);
  const stepPrediction = await stepResponse.json();
  assert.equal(stepPrediction.success, true, "ML step prediction did not succeed");
  assert.ok(stepPrediction.data?.prediction);
  console.log("ML health, student prediction, and step prediction endpoints returned valid data.");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
