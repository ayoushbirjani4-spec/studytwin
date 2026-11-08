const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const llmReviewService = require("../Services/llmReviewService");

async function main() {
  const model = process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.5-flash";
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY ||
    (/^gemini-/i.test(model) && process.env.LLM_API_KEY)
  );
  if (!hasKey) {
    throw new Error("Gemini is not configured. Set GEMINI_API_KEY in Server/.env.");
  }

  const review = await llmReviewService.reviewSubmission({
    question: "Solve 3x = 18",
    studentAnswer: "54",
    correctAnswer: "6",
    work: "3x=18 -> x=54"
  });
  if (!review?.label || !review.incorrectStep) {
    throw new Error("Gemini responded without identifying the synthetic inverse-operation error.");
  }
  console.log(`Gemini review succeeded with ${model}: ${review.label} on the submitted step.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
