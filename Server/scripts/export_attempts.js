// Export raw attempt logs for offline labeling and evaluation.
//
// Usage (run from Server/):
//   node scripts/export_attempts.js
//   node scripts/export_attempts.js --format csv --out attempts.csv
//   node scripts/export_attempts.js --student st_abc123
//   node scripts/export_attempts.js --blind              # omit system labels
//   node scripts/export_attempts.js --blind --format csv --out to_label.csv
//
// In MEMORY_STORE=1 mode attempts are held in the server process and are
// not accessible from this script.  You must run the server with
// MEMORY_STORE=0 (the default) and a real MONGODB_URI to persist attempts
// across processes.  If you see "0 attempts exported" while using the in-
// memory store that is expected.
//
// --blind mode
// ============
// Omits misconceptionType and misconceptionSource (the system's own guesses)
// so a human labeler cannot be anchored by them.  Adds an empty "gold"
// column for the labeler to fill in.  Use the labeled file as the real-data
// input for run_eval.js.

require("dotenv").config({
  path: require("node:path").join(__dirname, "..", ".env")
});

const fs   = require("node:fs");
const path = require("node:path");
const attemptLogStore = require("../Services/attemptLogStore");

// ============================================================
// ARGUMENT PARSING
// ============================================================

function parseArgs(argv) {
  const options = {
    format:    "jsonl",
    out:       "",
    studentId: "",
    limit:     5000,
    blind:     false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format" && argv[i + 1]) {
      options.format = argv[++i];
    } else if (arg === "--out" && argv[i + 1]) {
      options.out = argv[++i];
    } else if (arg === "--student" && argv[i + 1]) {
      options.studentId = argv[++i];
    } else if (arg === "--limit" && argv[i + 1]) {
      options.limit = Number(argv[++i]);
    } else if (arg === "--blind") {
      options.blind = true;
    }
  }

  return options;
}

// ============================================================
// CSV HELPERS
// ============================================================

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// Full export (includes system labels — useful for debugging).
const FULL_HEADERS = [
  "id",
  "createdAt",
  "studentId",
  "questionId",
  "concept",
  "difficulty",
  "studentAnswer",
  "work",
  "answerCorrect",
  "demonstratedCorrect",
  "misconceptionDetected",
  "misconceptionType",
  "misconceptionSource"
];

// Blind export (omits system labels; adds empty gold column for human labeler).
// demonstratedCorrect and misconceptionDetected are also omitted — they are the
// system's own judgments and would anchor the labeler toward the system's answer.
// Valid gold labels: correct  failed_to_distribute  sign_error  wrong_inverse_op
//                   one_sided_op  arithmetic_slip  combining_unlike_terms  no_evidence
const BLIND_HEADERS = [
  "id",
  "createdAt",
  "studentId",
  "questionId",
  "concept",
  "difficulty",
  "studentAnswer",
  "work",
  "answerCorrect",
  "gold"          // empty — fill this in before running through run_eval.js
];

function rowToFullCsv(row) {
  return [
    row._id,
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    row.studentId,
    row.questionId,
    row.concept,
    row.difficulty,
    row.studentAnswer,
    row.work,
    row.answerCorrect,
    row.demonstratedCorrect,
    row.misconceptionDetected,
    row.misconceptionType,
    row.misconceptionSource
  ].map(csvEscape).join(",");
}

function rowToBlindCsv(row) {
  return [
    row._id,
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    row.studentId,
    row.questionId,
    row.concept,
    row.difficulty,
    row.studentAnswer,
    row.work,
    row.answerCorrect,
    ""              // gold — to be filled in by labeler
  ].map(csvEscape).join(",");
}

function toCsv(rows, blind) {
  const headers = blind ? BLIND_HEADERS : FULL_HEADERS;
  const toRow   = blind ? rowToBlindCsv : rowToFullCsv;
  const lines   = [headers.join(","), ...rows.map(toRow)];
  return `${lines.join("\n")}\n`;
}

// ============================================================
// JSONL / JSON HELPERS
// ============================================================

function toBlindJson(row) {
  const { misconceptionType, misconceptionSource, demonstratedCorrect, misconceptionDetected, ...rest } = row;
  return { ...rest, gold: "" };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const options = parseArgs(process.argv);

  if (attemptLogStore.useMemoryStore()) {
    console.warn(
      "WARNING: Server is running with MEMORY_STORE=1.  Attempts are stored in\n" +
      "the server process and are NOT visible to this script.  Start the server\n" +
      "with a real MONGODB_URI to persist attempts between processes."
    );
  }

  const rows = await attemptLogStore.listAttempts({
    limit:     options.limit,
    studentId: options.studentId || undefined
  });

  // listAttempts returns newest-first from MongoDB; reverse to chronological.
  const chronological = rows.slice().reverse();

  if (options.blind) {
    console.error(
      `Blind export: system labels omitted.  Fill in the "gold" column before\n` +
      `passing the file to run_eval.js --real-data.`
    );
  }

  let payload;

  if (options.format === "csv") {
    payload = toCsv(chronological, options.blind);
  } else if (options.format === "json") {
    const data = options.blind ? chronological.map(toBlindJson) : chronological;
    payload = `${JSON.stringify(data, null, 2)}\n`;
  } else {
    // Default: JSONL
    const data = options.blind ? chronological.map(toBlindJson) : chronological;
    payload = data.map((row) => JSON.stringify(row)).join("\n");
    if (payload) payload += "\n";
  }

  if (options.out) {
    const outPath = path.resolve(options.out);
    fs.writeFileSync(outPath, payload, "utf8");
    console.log(`Exported ${chronological.length} attempts to ${outPath}`);
    return;
  }

  process.stdout.write(payload);
}

main().catch((error) => {
  console.error("Export failed:", error.message);
  process.exitCode = 1;
});
