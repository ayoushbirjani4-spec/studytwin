// Usage (from the Server/ folder):
//   node eval/run_eval.js
//   node eval/run_eval.js --real-data path/to/labeled.csv
//
// Scores analyzeAnswer() against all evaluation sets with the LLM disabled.
//
// Hand-written sets (regression guards):
//   MAIN SET   — 63 cases, written alongside rule development
//   STRESS SET — 24 cases, written to break the rules
//   UNSEEN SET — 31 cases, written independently
//
// All three currently score 100%.  That metric is saturated because the
// cases were written by the same person who wrote the rules.  They are
// regression guards only.
//
// Real-data set (the meaningful benchmark):
//   Pass --real-data with a CSV exported by:
//     node scripts/export_attempts.js --blind --format csv --out to_label.csv
//   Fill in the "gold" column (one label per row from the set below), then:
//     node eval/run_eval.js --real-data to_label.csv
//
// Valid gold labels:
//   correct  failed_to_distribute  sign_error  wrong_inverse_op
//   one_sided_op  arithmetic_slip  combining_unlike_terms  no_evidence
//   (blank / empty = skip row)

const path = require("node:path");
const fs   = require("node:fs");

const { analyzeAnswer } = require("../Services/misconceptionService");
const llmReviewService  = require("../Services/llmReviewService");

// ============================================================
// HAND-WRITTEN SETS
// ============================================================

const HAND_WRITTEN_SETS = [
  ["MAIN SET (written alongside the rules)",   require("./cases")],
  ["STRESS SET (written to break them)",        require("./stress_cases")],
  ["UNSEEN SET (independent generalization)",   require("./unseen_cases")]
];

// ============================================================
// LABELS
// ============================================================

const LABELS = [
  "failed_to_distribute",
  "sign_error",
  "wrong_inverse_op",
  "one_sided_op",
  "arithmetic_slip",
  "combining_unlike_terms"
];
const SYSTEM_TO_GOLD = Object.fromEntries(LABELS.map(l => [l, l]));
const GENERIC  = new Set(["invalid_transformation"]);
const NO_CLAIM = new Set(["unknown_error", null, undefined]);

// ============================================================
// SCORE ONE SET
// ============================================================

async function runSet(title, cases) {
  const origErr = console.error;
  const origLog = console.log;
  const rows    = [];

  for (const c of cases) {
    console.error = () => {};
    console.log   = () => {};
    let r   = null;
    let err = null;
    try {
      r = await analyzeAnswer({ questionId: c.q, studentAnswer: c.a, work: c.w });
    } catch (e) {
      err = e.message;
    }
    console.error = origErr;
    console.log   = origLog;

    const m = r?.misconception || {};
    rows.push({
      ...c,
      err,
      sysCorrect: r?.correct,
      detected:   !!m.detected,
      sysType:    m.type ?? null
    });
  }

  const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}% (${n}/${d})` : "n/a";
  const errors = rows.filter(r => r.err);

  // 1. Final-answer correctness
  const ans   = rows.filter(r => !r.err);
  const ansOk = ans.filter(r => r.sysCorrect === r.answerCorrect).length;

  // 2. False positives on correct work
  const clean = rows.filter(r => r.gold === "correct" && !r.err);
  const fp    = clean.filter(r => r.detected || (r.sysType && !NO_CLAIM.has(r.sysType)));

  // 3. Wrong-with-evidence cases
  const diag    = rows.filter(r => !["correct","no_evidence"].includes(r.gold) && !r.answerCorrect && !r.err);
  const flagged = diag.filter(r => r.detected && !NO_CLAIM.has(r.sysType));
  const exact   = diag.filter(
    r => r.detected && SYSTEM_TO_GOLD[r.sysType] === r.gold
  );
  const generic = diag.filter(r => GENERIC.has(r.sysType));

  // 4. No-evidence: should not guess
  const noev   = rows.filter(r => r.gold === "no_evidence" && !r.err);
  const noevOk = noev.filter(r => NO_CLAIM.has(r.sysType) && !r.detected);

  // 5. Right answer, wrong work
  const hidden       = rows.filter(r => r.answerCorrect && r.gold !== "correct" && !r.err);
  const hiddenCaught = hidden.filter(r => r.detected);

  console.log(`\n${title}  —  ${rows.length} cases\n${"=".repeat(60)}`);
  if (errors.length) console.log(`!! ${errors.length} cases threw errors\n`);
  console.log(`Final-answer checking           ${pct(ansOk, ans.length)}`);
  console.log(`False positives on correct work ${pct(fp.length, clean.length)}   (lower is better)`);
  console.log(`\nWrong answers with work shown (${diag.length} cases)`);
  console.log(`  Problem flagged (any label)   ${pct(flagged.length, diag.length)}`);
  console.log(`  Exact label correct           ${pct(exact.length, diag.length)}`);
  console.log(`  Generic "invalid step" only   ${pct(generic.length, diag.length)}`);
  console.log(`\nWrong answer, NO work (${noev.length})  Did not guess  ${pct(noevOk.length, noev.length)}`);
  console.log(`Right answer, wrong work (${hidden.length})  Caught        ${pct(hiddenCaught.length, hidden.length)}`);

  console.log(`\nPer gold category (system label counts):`);
  const cats = [...new Set(rows.map(r => r.gold))];
  for (const g of cats) {
    const rs = rows.filter(r => r.gold === g);
    const tally = {};
    rs.forEach(r => {
      const k = r.err ? "ERROR" : String(r.sysType);
      tally[k] = (tally[k] || 0) + 1;
    });
    console.log(`  ${g.padEnd(24)} n=${String(rs.length).padStart(2)}  ${JSON.stringify(tally)}`);
  }

  const misses = [
    ...fp,
    ...diag.filter(r => !exact.includes(r)),
    ...hidden.filter(r => !r.detected),
    ...noev.filter(r => !noevOk.includes(r))
  ];
  if (misses.length) {
    console.log(`\nMisses worth reading (${misses.length}):`);
    misses.slice(0, 25).forEach(r =>
      console.log(
        `  [${r.q}] gold=${r.gold} sys=${r.sysType} detected=${r.detected} | ` +
        `${JSON.stringify(r.w).slice(0, 60)}${r.note ? " — " + r.note : ""}`
      )
    );
  }

  fs.writeFileSync(
    path.join(__dirname, `last_results_${title.split(" ")[0].toLowerCase()}.json`),
    JSON.stringify(rows, null, 2)
  );
}

// ============================================================
// REAL-DATA SET
// ============================================================
//
// Loads a labeled CSV produced by:
//   node scripts/export_attempts.js --blind --format csv --out to_label.csv
//
// Required CSV columns (order does not matter):
//   id, questionId, studentAnswer, work, answerCorrect, gold
//
// The "gold" column must contain one of the eight labels listed at
// the top of this file, or be blank (rows with blank gold are skipped).
// "answerCorrect" must be "true" or "false".
// ============================================================

const REAL_DATA_GOLD_VALUES = new Set([
  ...LABELS,
  "correct",
  "no_evidence"
]);

function parseCsv(text) {
  // Character-level RFC 4180 parser: quoted cells may contain commas,
  // doubled quotes, and line breaks (student work is multi-line).
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((v) => v !== "")) records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }

  if (field !== "" || record.length) {
    record.push(field);
    if (record.some((v) => v !== "")) records.push(record);
  }

  if (records.length < 2) return [];

  const headers = records[0].map((h) => h.trim());
  return records.slice(1).map((values) => {
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    return row;
  });
}

function loadRealDataCsv(csvPath) {
  const text     = fs.readFileSync(csvPath, "utf8");
  const rawRows  = parseCsv(text);
  const required = ["questionId", "studentAnswer", "work", "answerCorrect", "gold"];

  for (const col of required) {
    if (!rawRows[0] || !(col in rawRows[0])) {
      throw new Error(
        `Real-data CSV is missing required column "${col}". ` +
        `Export with: node scripts/export_attempts.js --blind --format csv`
      );
    }
  }

  const cases = [];
  let   skipped = 0;

  for (const row of rawRows) {
    const gold = (row.gold || "").trim();
    if (!gold) { skipped++; continue; }
    if (!REAL_DATA_GOLD_VALUES.has(gold)) {
      console.warn(`  Skipping row with unrecognised gold label "${gold}" (id=${row.id || "?"})`);
      skipped++;
      continue;
    }

    cases.push({
      q:             (row.questionId || "").trim(),
      a:             (row.studentAnswer || "").trim(),
      w:             (row.work || "").replace(/\\n/g, "\n"),
      gold,
      answerCorrect: row.answerCorrect === "true" || row.answerCorrect === "1",
      note:          row.id || ""
    });
  }

  if (skipped) {
    console.log(`  (${skipped} rows skipped — blank or unrecognised gold label)`);
  }

  return cases;
}

// ============================================================
// ARGUMENT PARSING
// ============================================================

function parseArgs(argv) {
  let realDataPath = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--real-data" && argv[i + 1]) {
      realDataPath = argv[++i];
    }
  }
  return { realDataPath };
}

// ============================================================
// ENTRY POINT
// ============================================================

(async () => {
  const { realDataPath } = parseArgs(process.argv);

  // Disable LLM for deterministic, reproducible scores.
  const origReview = llmReviewService.reviewSubmission;
  llmReviewService.reviewSubmission = async () => null;

  try {
    // ---- hand-written regression sets ----
    for (const [title, cases] of HAND_WRITTEN_SETS) {
      await runSet(title, cases);
    }
    console.log("\nPer-case results saved to eval/last_results_*.json");

    // ---- real-data set ----
    if (realDataPath) {
      const absPath = path.resolve(realDataPath);
      console.log(`\nLoading real-data CSV: ${absPath}`);
      const cases = loadRealDataCsv(absPath);
      if (cases.length === 0) {
        console.log(
          "\nREAL DATA SET — 0 usable rows.  " +
          "Fill in the \"gold\" column and re-run."
        );
      } else {
        await runSet(
          "REAL DATA SET (labeled student attempts)",
          cases
        );
      }
    } else {
      console.log(
        "\n── Real-data benchmark not run ──────────────────────────────────────\n" +
        "  1. Collect attempts: start the server with MONGODB_URI set.\n" +
        "  2. Export blind:     node scripts/export_attempts.js --blind --format csv --out to_label.csv\n" +
        "  3. Label the CSV:    fill in the empty \"gold\" column for each row.\n" +
        "     Valid labels: " + [...REAL_DATA_GOLD_VALUES].join("  ") + "\n" +
        "  4. Score:            node eval/run_eval.js --real-data to_label.csv\n" +
        "─────────────────────────────────────────────────────────────────────"
      );
    }
  } finally {
    llmReviewService.reviewSubmission = origReview;
  }
})().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exitCode = 1;
});
