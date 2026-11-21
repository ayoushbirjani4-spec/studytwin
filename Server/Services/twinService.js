// ============================================================
// TWIN SERVICE: "Teach your Twin"
// ============================================================
//
// The twin is a confused AI student that solves a problem out loud and
// makes ONE mistake: the misconception this student makes most often.
// The student must find the wrong line and correct it.
//
// Every twin solution is written step by step (operations shown before
// they are evaluated, e.g. "x = 18 - 3" then "x = 15") so the mistake sits
// on a line the rule engine can judge. After the mistake the twin keeps
// doing correct algebra, so its wrong answer follows from that one error.
//
// Each generated solution is verified with the live step checker: exactly
// one invalid line, at the intended position, with the intended label.
// Anything else is discarded, so the twin never shows an ambiguous lesson.
// Deterministic: the same question and misconception give the same lesson.
// ============================================================

const { questions: QUESTION_BANK } = require("../data/questions");
const { generateQuestionSet } = require("./questionGenerator");
const misconceptionService = require("./misconceptionService");

const TWIN_MISCONCEPTIONS = [
    "failed_to_distribute",
    "sign_error",
    "wrong_inverse_op",
    "one_sided_op",
    "combining_unlike_terms",
    "arithmetic_slip"
];

// ------------------------------------------------------------
// Formatting
// ------------------------------------------------------------

function gcd(a, b) {
    return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

// Integers as-is, terminating decimals up to 2 places, otherwise a fraction.
function formatNumber(value, numerator = null, denominator = null) {
    if (Number.isInteger(value)) return String(value);
    const rounded = Math.round(value * 100) / 100;
    if (Math.abs(rounded - value) < 1e-9) return String(rounded);
    if (numerator !== null && denominator !== null) {
        const g = gcd(numerator, denominator);
        let n = numerator / g;
        let d = denominator / g;
        if (d < 0) { n = -n; d = -d; }
        return `${n}/${d}`;
    }
    return String(rounded);
}

function formatTerm(coefficient) {
    if (coefficient === 1) return "x";
    if (coefficient === -1) return "-x";
    return `${formatNumber(coefficient)}x`;
}

// a·x + b, written the way a student would ("2x + 6", "x - 4", "-3x").
function formatLinear(a, b) {
    if (a === 0) return formatNumber(b);
    const xPart = formatTerm(a);
    if (b === 0) return xPart;
    return b > 0
        ? `${xPart} + ${formatNumber(b)}`
        : `${xPart} - ${formatNumber(-b)}`;
}

function equation(left, right) {
    return `${left} = ${right}`;
}

// ------------------------------------------------------------
// Parsing the question
// ------------------------------------------------------------

const NUMBER = "(-?\\d+(?:\\.\\d+)?)";

// Returns a description of the question's starting line, or null.
function parseQuestion(question) {
    // A word problem: the twin works from the story's equation.
    if (question.equation) return parseQuestion({ ...question, question: question.equation, equation: null });

    const text = String(question.question || "")
        .replace(/^\s*(solve|simplify)\s*:\s*/i, "")
        .replace(/\s+/g, "");

    let m;

    // k(px ± b) = c
    if ((m = text.match(new RegExp(`^${NUMBER}\\((\\d*)x([+-])(\\d+(?:\\.\\d+)?)\\)=${NUMBER}$`)))) {
        return {
            kind: "bracket",
            start: question.question.replace(/^\s*solve\s*:\s*/i, "").trim(),
            k: Number(m[1]),
            p: m[2] === "" ? 1 : Number(m[2]),
            b: (m[3] === "-" ? -1 : 1) * Number(m[4]),
            c: Number(m[5])
        };
    }

    // x / d = c
    if ((m = text.match(new RegExp(`^x/${NUMBER}=${NUMBER}$`)))) {
        return {
            kind: "divide",
            start: question.question.replace(/^\s*solve\s*:\s*/i, "").trim(),
            d: Number(m[1]),
            c: Number(m[2])
        };
    }

    // x/d ± b = c
    if ((m = text.match(new RegExp(`^x/(\\d+)([+-])(\\d+)=${NUMBER}$`)))) {
        return {
            kind: "fraction",
            start: question.question.replace(/^\s*solve\s*:\s*/i, "").trim(),
            d: Number(m[1]),
            b: (m[2] === "-" ? -1 : 1) * Number(m[3]),
            c: Number(m[4])
        };
    }

    // (x ± b)/d = c
    if ((m = text.match(new RegExp(`^\\(x([+-])(\\d+)\\)/(\\d+)=${NUMBER}$`)))) {
        return {
            kind: "bracketFraction",
            start: question.question.replace(/^\s*solve\s*:\s*/i, "").trim(),
            b: (m[1] === "-" ? -1 : 1) * Number(m[2]),
            d: Number(m[3]),
            c: Number(m[4])
        };
    }

    // ax ± b = cx ± d (x on both sides)
    if ((m = text.match(/^(\d*)x(?:([+-])(\d+))?=(\d*)x([+-])(\d+)$/))) {
        return {
            kind: "both",
            start: question.question.replace(/^\s*solve\s*:\s*/i, "").trim(),
            a: m[1] === "" ? 1 : Number(m[1]),
            b: m[2] ? (m[2] === "-" ? -1 : 1) * Number(m[3]) : 0,
            c: m[4] === "" ? 1 : Number(m[4]),
            d: (m[5] === "-" ? -1 : 1) * Number(m[6])
        };
    }

    // ax ± b = c, ax = c, x ± b = c
    if ((m = text.match(new RegExp(`^(-?\\d*)x(?:([+-])(\\d+(?:\\.\\d+)?))?=${NUMBER}$`)))) {
        const a = m[1] === "" ? 1 : m[1] === "-" ? -1 : Number(m[1]);
        return {
            kind: "linear",
            start: question.question.replace(/^\s*solve\s*:\s*/i, "").trim(),
            a,
            b: m[2] ? (m[2] === "-" ? -1 : 1) * Number(m[3]) : 0,
            c: Number(m[4])
        };
    }

    // Simplify: a sum of x-terms and constants
    if (/^simplify/i.test(question.question)) {
        const terms = text.match(/[+-]?[^+-]+/g) || [];
        const parsed = [];
        for (const term of terms) {
            const t = term.match(/^([+-]?)(\d*(?:\.\d+)?)(x?)$/);
            if (!t || (t[2] === "" && t[3] === "")) return null;
            const sign = t[1] === "-" ? -1 : 1;
            const value = t[2] === "" ? 1 : Number(t[2]);
            parsed.push({ coefficient: sign * value, isX: t[3] === "x" });
        }
        return {
            kind: "simplify",
            start: question.question.replace(/^\s*simplify\s*:\s*/i, "").trim(),
            terms: parsed
        };
    }

    return null;
}

// ------------------------------------------------------------
// Solving from any point (correct algebra), used after the mistake
// ------------------------------------------------------------

// "x = 22/2" then "x = 11". When the result does not simplify to a
// different form (e.g. 13/3), the twin writes it once instead of twice.
function pushDivision(lines, numerator, denominator) {
    const expression = `${formatNumber(numerator)}/${formatNumber(denominator)}`;
    const value = formatNumber(numerator / denominator, numerator, denominator);
    lines.push(equation("x", expression));
    if (value !== expression) {
        lines.push(equation("x", value));
    }
}

// From "a·x + b = c", write the remaining correct steps to "x = ...".
function finishLinear(a, b, c) {
    const lines = [];
    let rhs = c;
    if (b !== 0) {
        const op = b > 0 ? "-" : "+";
        lines.push(equation(formatTerm(a), `${formatNumber(c)} ${op} ${formatNumber(Math.abs(b))}`));
        rhs = c - b;
        lines.push(equation(formatTerm(a), formatNumber(rhs)));
    }
    if (a !== 1) {
        pushDivision(lines, rhs, a);
    }
    return lines;
}

// ------------------------------------------------------------
// Building twin solutions
// ------------------------------------------------------------
//
// A misconception can happen at more than one step of a solution. Each
// builder returns every variant it can make, tagged with the step where
// the mistake happens:
//   expand    multiplying out the brackets
//   isolate   moving the constant to the other side
//   divide    dividing by the coefficient of x
//   evaluate  working out the final value
//   combine   collecting like terms (simplify questions)
// Each variant is { lines, wrongIndex, stage }.

const TWIN_STAGES = ["expand", "isolate", "divide", "evaluate", "combine"];

function bracketVariants(q, type) {
    const expandedA = q.k * q.p;
    const expandedB = q.k * q.b;

    if (type === "failed_to_distribute" || type === "sign_error") {
        // Only the x-term multiplied, or the constant's sign flipped.
        const b = type === "failed_to_distribute" ? q.b : -expandedB;
        const lines = [q.start, equation(formatLinear(expandedA, b), formatNumber(q.c))];
        return [{ lines: [...lines, ...finishLinear(expandedA, b, q.c)], wrongIndex: 1, stage: "expand" }];
    }

    // Correct expansion, then a mistake in a later step.
    const prefix = [q.start, equation(formatLinear(expandedA, expandedB), formatNumber(q.c))];
    return linearVariants(prefix, expandedA, expandedB, q.c, type);
}

// From "a·x + b = c" (already the last line of `prefix`), every place the
// misconception can happen while finishing the solution.
function linearVariants(prefix, a, b, c, type) {
    const variants = [];

    if (b !== 0) {
        const op = b > 0 ? "-" : "+";
        const undo = Math.abs(b);
        let wrongLine = null;
        let newRhs = null;

        if (type === "wrong_inverse_op") {
            // Adds b instead of subtracting it (or the reverse).
            const wrongOp = op === "-" ? "+" : "-";
            wrongLine = equation(formatTerm(a), `${formatNumber(c)} ${wrongOp} ${formatNumber(undo)}`);
            newRhs = c + b;
        } else if (type === "one_sided_op") {
            // Removes b from the left only.
            wrongLine = equation(formatTerm(a), formatNumber(c));
            newRhs = c;
        } else if (type === "arithmetic_slip" && a !== 1) {
            // Right operation, wrong result, in one jump ("2x + 6 = 14" -> "2x = 9").
            // Writing "2x = 14 - 6" first would read as a one-sided change.
            // Needs a !== 1: a bare "x = 9" line is never judged live.
            wrongLine = equation(formatTerm(a), formatNumber(c - b + 1));
            newRhs = c - b + 1;
        }

        if (wrongLine) {
            const lines = [...prefix, wrongLine];
            const wrongIndex = lines.length - 1;
            if (type === "wrong_inverse_op") {
                lines.push(equation(formatTerm(a), formatNumber(newRhs)));
            }
            if (a !== 1) {
                pushDivision(lines, newRhs, a);
            }
            variants.push({ lines, wrongIndex, stage: "isolate" });
        }
    }

    // Later steps: isolate x correctly, then slip while dividing or evaluating.
    if (a !== 1) {
        const isolated = [...prefix];
        let rhs = c;
        if (b !== 0) {
            const op = b > 0 ? "-" : "+";
            isolated.push(equation(formatTerm(a), `${formatNumber(c)} ${op} ${formatNumber(Math.abs(b))}`));
            rhs = c - b;
            isolated.push(equation(formatTerm(a), formatNumber(rhs)));
        }

        if (type === "wrong_inverse_op") {
            // Subtracts the coefficient instead of dividing by it.
            const lines = [...isolated, equation("x", `${formatNumber(rhs)} - ${formatNumber(a)}`)];
            const wrongIndex = lines.length - 1;
            lines.push(equation("x", formatNumber(rhs - a)));
            variants.push({ lines, wrongIndex, stage: "divide" });
        }

        if (type === "sign_error" && (a < 0 || rhs < 0)) {
            // Sets up the division right, then gets the sign of the answer wrong.
            const lines = [...isolated, equation("x", `${formatNumber(rhs)}/${formatNumber(a)}`)];
            lines.push(equation("x", formatNumber(-rhs / a, -rhs, a)));
            variants.push({ lines, wrongIndex: lines.length - 1, stage: "evaluate" });
        }

        if (type === "arithmetic_slip") {
            // Divides correctly, then gets the final value wrong.
            const lines = [...isolated, equation("x", `${formatNumber(rhs)}/${formatNumber(a)}`)];
            lines.push(equation("x", formatNumber(rhs / a + 1, rhs + a, a)));
            variants.push({ lines, wrongIndex: lines.length - 1, stage: "evaluate" });
        }
    }

    return variants;
}

// a·x + b = c·x + d: the slip is in moving c·x across, or later on.
function bothSidesVariants(q, type) {
    const left = q.a - q.c;
    if (type === "wrong_inverse_op" || type === "one_sided_op") {
        // Adds c·x instead of subtracting it, or subtracts it from the left only.
        const wrongLine = type === "wrong_inverse_op"
            ? equation(formatLinear(q.a + q.c, q.b), formatNumber(q.d))
            : equation(formatLinear(left, q.b), `${formatTerm(q.c)} + ${formatNumber(q.d)}`);
        const variants = [];
        if (type === "wrong_inverse_op") {
            const lines = [q.start, wrongLine, ...finishLinear(q.a + q.c, q.b, q.d)];
            variants.push({ lines, wrongIndex: 1, stage: "isolate" });
        } else {
            variants.push({ lines: [q.start, wrongLine], wrongIndex: 1, stage: "isolate" });
        }
        // The same mistake can also come later, with the constant or the division.
        return variants.concat(linearVariants([q.start, equation(formatLinear(left, q.b), formatNumber(q.d))], left, q.b, q.d, type));
    }
    return linearVariants([q.start, equation(formatLinear(left, q.b), formatNumber(q.d))], left, q.b, q.d, type);
}

// x/d + b = c: slip while removing b, or while undoing the division.
function fractionVariants(q, type) {
    const y = q.c - q.b;
    const op = q.b > 0 ? "-" : "+";
    const variants = [];
    if (type === "wrong_inverse_op" || type === "one_sided_op") {
        const wrongRhs = type === "wrong_inverse_op" ? q.c + q.b : q.c;
        const lines = [q.start, equation(`x/${q.d}`, formatNumber(wrongRhs)), equation("x", formatNumber(wrongRhs * q.d))];
        variants.push({ lines, wrongIndex: 1, stage: "isolate" });
    }
    const isolated = [q.start, equation(`x/${q.d}`, `${formatNumber(q.c)} ${op} ${formatNumber(Math.abs(q.b))}`), equation(`x/${q.d}`, formatNumber(y))];
    if (type === "wrong_inverse_op") {
        // Divides by d instead of multiplying.
        variants.push({ lines: [...isolated, equation("x", `${formatNumber(y)}/${q.d}`)], wrongIndex: 3, stage: "divide" });
    }
    if (type === "arithmetic_slip") {
        variants.push({ lines: [...isolated, equation("x", `${formatNumber(y)} * ${q.d}`), equation("x", formatNumber(y * q.d + 1))], wrongIndex: 4, stage: "evaluate" });
    }
    return variants;
}

// (x + b)/d = c: slip while clearing the fraction, then finish as x + b = c·d.
function bracketFractionVariants(q, type) {
    const cleared = q.c * q.d;
    const variants = [];
    if (type === "wrong_inverse_op" || type === "one_sided_op") {
        // Divides the other side instead of multiplying, or drops the /d on one side only.
        const rhs = type === "wrong_inverse_op" ? `${formatNumber(q.c)}/${q.d}` : formatNumber(q.c);
        variants.push({ lines: [q.start, equation(formatLinear(1, q.b), rhs)], wrongIndex: 1, stage: "divide" });
    }
    return variants.concat(linearVariants([q.start, equation(formatLinear(1, q.b), formatNumber(cleared))], 1, q.b, cleared, type));
}

function divideVariants(q, type) {
    if (type === "wrong_inverse_op") {
        // Divides instead of multiplying.
        const lines = [q.start, equation("x", `${formatNumber(q.c)}/${formatNumber(q.d)}`)];
        lines.push(equation("x", formatNumber(q.c / q.d, q.c, q.d)));
        return [{ lines, wrongIndex: 1, stage: "divide" }];
    }
    if (type === "arithmetic_slip") {
        // Multiplies correctly, then gets the product wrong.
        const lines = [
            q.start,
            equation("x", `${formatNumber(q.c)} * ${formatNumber(q.d)}`),
            equation("x", formatNumber(q.c * q.d + 1))
        ];
        return [{ lines, wrongIndex: 2, stage: "evaluate" }];
    }
    return [];
}

function simplifyVariants(q, type) {
    const xs = q.terms.filter((t) => t.isX);
    const constants = q.terms.filter((t) => !t.isX);
    const a = xs.reduce((sum, t) => sum + t.coefficient, 0);
    const b = constants.reduce((sum, t) => sum + t.coefficient, 0);

    if (type === "combining_unlike_terms" && constants.length > 0) {
        // Numbers merged into the x-term.
        return [{ lines: [q.start, formatTerm(a + b)], wrongIndex: 1, stage: "combine" }];
    }
    if (type === "sign_error" && q.terms.slice(1).some((t) => t.coefficient < 0)) {
        // Every minus treated as plus.
        const absA = xs.reduce((sum, t) => sum + Math.abs(t.coefficient), 0);
        const absB = constants.reduce((sum, t) => sum + Math.abs(t.coefficient), 0);
        return [{ lines: [q.start, formatLinear(absA, absB)], wrongIndex: 1, stage: "combine" }];
    }
    if (type === "arithmetic_slip") {
        // Like terms grouped correctly, one total off by one.
        const line = constants.length > 0 ? formatLinear(a, b + 1) : formatTerm(a + 1);
        return [{ lines: [q.start, line], wrongIndex: 1, stage: "combine" }];
    }
    return [];
}

const VARIANT_BUILDERS = {
    bracket: bracketVariants,
    both: bothSidesVariants,
    fraction: fractionVariants,
    bracketFraction: bracketFractionVariants,
    divide: divideVariants,
    linear: (q, type) => linearVariants([q.start], q.a, q.b, q.c, type),
    simplify: simplifyVariants
};

// ------------------------------------------------------------
// Verification with the live step checker
// ------------------------------------------------------------

function verify(question, built, type) {
    const result = misconceptionService.checkSteps({
        questionId: question.id,
        work: built.lines.join("\n")
    });
    if (!result || result.steps.some((step) => step.status === "unreadable")) {
        return false;
    }

    const invalid = result.steps
        .map((step, index) => ({ ...step, index }))
        .filter((step) => step.status === "invalid");

    if (built.stage === "evaluate") {
        // The live checker never judges a bare "x = 6" (so answers can't be
        // guessed), so check the final slip directly: every earlier step is
        // valid, and the last line does not follow from the one before.
        const last = built.lines.length - 1;
        return invalid.length === 0 &&
            built.wrongIndex === last &&
            result.steps[last].status === "final" &&
            !misconceptionService.equationsEquivalent(built.lines[last - 1], built.lines[last]);
    }

    return invalid.length === 1 &&
        invalid[0].index === built.wrongIndex &&
        invalid[0].label === type;
}

// Every verified variant of this misconception for this question, in a
// fixed order; `variant` is its position in that list.
function listTwinVariants(question, type) {
    if (!question || !TWIN_MISCONCEPTIONS.includes(type)) return [];

    const parsed = parseQuestion(question);
    if (!parsed) return [];

    return VARIANT_BUILDERS[parsed.kind](parsed, type)
        .filter((built) => verify(question, built, type))
        .map((built, variant) => {
            const lastLine = built.lines[built.lines.length - 1];
            return {
                questionId: question.id,
                question: question.question,
                concept: question.concept,
                misconceptionType: type,
                variant,
                stage: built.stage,
                lines: built.lines,
                wrongIndex: built.wrongIndex,
                twinAnswer: lastLine.includes("=") ? lastLine.split("=").pop().trim() : lastLine,
                correctAnswer: question.answer
            };
        });
}

// One twin solution, or null. Deterministic: the same inputs always give
// the same lesson, so the server can rebuild it to grade the student.
function buildTwinSolution(question, type, variant = 0) {
    return listTwinVariants(question, type)[Number(variant) || 0] || null;
}

// Hand-written questions first, then a fixed set of generated ones, so the
// twin keeps getting new problems once the bank's have all been used.
const TWIN_QUESTIONS = [...QUESTION_BANK, ...generateQuestionSet({ perTemplate: 3, seed: "twin" })];

function questionPools(concept, excludeQuestionIds) {
    const ordered = [
        ...TWIN_QUESTIONS.filter((q) => q.concept === concept),
        ...TWIN_QUESTIONS.filter((q) => q.concept !== concept)
    ];
    return [ordered.filter((q) => !excludeQuestionIds.includes(q.id)), ordered];
}

// A twin lesson for this misconception, preferring the given concept and
// fresh questions, and if possible a different step from `avoidStage`.
// `stage` restricts it to mistakes in one step.
function findTwinLesson({
    misconceptionType,
    concept = null,
    excludeQuestionIds = [],
    stage = null,
    avoidStage = null
}) {
    for (const pool of questionPools(concept, excludeQuestionIds)) {
        let fallback = null;
        for (const question of pool) {
            for (const lesson of listTwinVariants(question, misconceptionType)) {
                if (stage && lesson.stage !== stage) continue;
                if (avoidStage && lesson.stage === avoidStage) {
                    fallback = fallback || lesson;
                    continue;
                }
                return lesson;
            }
        }
        if (fallback) return fallback;
    }
    return null;
}

// A "mixed" lesson: the twin slips at a different step from the student's
// habit, trying the steps in the order given. Returns null if none fits.
function findMixedLesson({
    excludeTypes = [],
    stages = ["isolate", "divide", "evaluate"],
    concept = null,
    excludeQuestionIds = []
}) {
    for (const stage of stages) {
        for (const type of TWIN_MISCONCEPTIONS) {
            if (excludeTypes.includes(type)) continue;
            const lesson = findTwinLesson({ misconceptionType: type, concept, excludeQuestionIds, stage });
            if (lesson) return lesson;
        }
    }
    return null;
}

// ------------------------------------------------------------
// Twin memory: what the student has taught their twin
// ------------------------------------------------------------
//
// Stored on the student record as `twin`:
//   taught:         { [misconception]: successful teachings }
//   firstTaughtAt:  { [misconception]: ISO time of the first teaching }
//   lastTaughtAt:   { [misconception]: ISO time of the latest teaching }
//   recentLessons:  ["misconception:questionId", ...]  (newest last)
// Teaching the same misconception LEARN_THRESHOLD times means the twin
// has learned it and moves on to the student's next mistake.

const LEARN_THRESHOLD = 2;
const MAX_RECENT_TWIN_LESSONS = 20;

function emptyTwinMemory() {
    return { taught: {}, firstTaughtAt: {}, lastTaughtAt: {}, recentLessons: [] };
}

function normaliseTwinMemory(memory) {
    return {
        taught: { ...(memory?.taught || {}) },
        firstTaughtAt: { ...(memory?.firstTaughtAt || {}) },
        lastTaughtAt: { ...(memory?.lastTaughtAt || {}) },
        recentLessons: Array.isArray(memory?.recentLessons) ? [...memory.recentLessons] : []
    };
}

function hasLearned(memory, type) {
    return (memory.taught[type] || 0) >= LEARN_THRESHOLD;
}

// Which mistake the twin should make next. `mistakes` is the student's
// commonMistakes (most frequent first). Returns null if none fit the twin.
function chooseTwinMisconception(mistakes, memory) {
    const twinMemory = normaliseTwinMemory(memory);
    const candidates = (mistakes || [])
        .filter((mistake) => TWIN_MISCONCEPTIONS.includes(mistake.type));
    if (candidates.length === 0) return null;

    const stillLearning = candidates.find((mistake) => !hasLearned(twinMemory, mistake.type));
    if (stillLearning) {
        return { type: stillLearning.type, concept: stillLearning.concept || null, reviewing: false };
    }

    // Every mistake learned: review the one taught longest ago.
    const oldest = [...candidates].sort((a, b) =>
        String(twinMemory.lastTaughtAt[a.type] || "").localeCompare(String(twinMemory.lastTaughtAt[b.type] || ""))
    )[0];
    return { type: oldest.type, concept: oldest.concept || null, reviewing: true };
}

// What the screen shows: how far the twin has come with this student.
function summariseTwinProgress(mistakes, memory, currentType) {
    const twinMemory = normaliseTwinMemory(memory);
    const types = [...new Set(
        (mistakes || [])
            .map((mistake) => mistake.type)
            .filter((type) => TWIN_MISCONCEPTIONS.includes(type))
            .concat(currentType ? [currentType] : [])
    )];
    return {
        learnedCount: types.filter((type) => hasLearned(twinMemory, type)).length,
        totalCount: types.length,
        current: currentType
            ? {
                type: currentType,
                taught: Math.min(twinMemory.taught[currentType] || 0, LEARN_THRESHOLD),
                needed: LEARN_THRESHOLD,
                learned: hasLearned(twinMemory, currentType)
            }
            : null
    };
}

// Record one successful teaching. The same lesson counts only once, so
// repeating a request cannot inflate the twin's progress.
function applyTwinTeaching(memory, { misconceptionType, questionId, variant = 0, now = new Date() }) {
    const twinMemory = normaliseTwinMemory(memory);
    // The same problem can host the mistake at different steps (variants);
    // each is a different lesson. Variant 0 keeps the original key format.
    const key = variant
        ? `${misconceptionType}:${questionId}:${variant}`
        : `${misconceptionType}:${questionId}`;

    if (twinMemory.recentLessons.includes(key)) {
        return { memory: twinMemory, counted: false, justLearned: false };
    }

    const before = hasLearned(twinMemory, misconceptionType);
    twinMemory.taught[misconceptionType] = (twinMemory.taught[misconceptionType] || 0) + 1;
    twinMemory.firstTaughtAt[misconceptionType] =
        twinMemory.firstTaughtAt[misconceptionType] || now.toISOString();
    twinMemory.lastTaughtAt[misconceptionType] = now.toISOString();
    twinMemory.recentLessons = [...twinMemory.recentLessons, key].slice(-MAX_RECENT_TWIN_LESSONS);

    return {
        memory: twinMemory,
        counted: true,
        justLearned: !before && hasLearned(twinMemory, misconceptionType)
    };
}

// ------------------------------------------------------------
// The Twin Effect: has the student's own mistake become rarer since
// they started teaching it to their twin?
// ------------------------------------------------------------
//
// For each mistake the student has taught, compare how often they made
// it in their own practice before teaching started with how often since.
// Only answers on topics where that mistake has happened are counted, so
// the comparison is like-for-like. Nothing is claimed until there are
// enough answers since teaching began.

const TWIN_EFFECT_WINDOW = 20;
const TWIN_EFFECT_MIN_AFTER = 5;
const TWIN_EFFECT_MIN_BEFORE = 3;

function rateOf(rows, type) {
    const errors = rows.filter((row) => row.misconceptionDetected && row.misconceptionType === type).length;
    return {
        errors,
        attempts: rows.length,
        rate: rows.length ? Number((errors / rows.length).toFixed(4)) : null
    };
}

// `attempts`: the student's attempt log rows (any order).
function computeTwinEffect(attempts, memory) {
    const twinMemory = normaliseTwinMemory(memory);
    const rows = (attempts || [])
        .filter((row) => row && row.createdAt)
        .slice()
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return Object.keys(twinMemory.taught)
        .filter((type) => TWIN_MISCONCEPTIONS.includes(type) && twinMemory.taught[type] > 0)
        .map((type) => {
            const since = twinMemory.firstTaughtAt[type] || twinMemory.lastTaughtAt[type] || null;
            const sinceTime = since ? new Date(since).getTime() : NaN;

            // Topics where this mistake has happened at least once.
            const concepts = new Set(
                rows.filter((row) => row.misconceptionType === type).map((row) => row.concept)
            );
            const relevant = concepts.size
                ? rows.filter((row) => concepts.has(row.concept))
                : rows;

            const before = Number.isNaN(sinceTime)
                ? []
                : relevant.filter((row) => new Date(row.createdAt).getTime() < sinceTime).slice(-TWIN_EFFECT_WINDOW);
            const after = Number.isNaN(sinceTime)
                ? []
                : relevant.filter((row) => new Date(row.createdAt).getTime() >= sinceTime).slice(-TWIN_EFFECT_WINDOW);

            const beforeRate = rateOf(before, type);
            const afterRate = rateOf(after, type);

            let status;
            if (after.length < TWIN_EFFECT_MIN_AFTER) {
                status = "collecting";
            } else if (before.length < TWIN_EFFECT_MIN_BEFORE) {
                status = "no_baseline";
            } else if (afterRate.rate < beforeRate.rate) {
                status = "improved";
            } else if (afterRate.rate === beforeRate.rate) {
                status = "unchanged";
            } else {
                status = "not_yet";
            }

            return {
                type,
                taughtCount: twinMemory.taught[type],
                learned: hasLearned(twinMemory, type),
                since,
                status,
                attemptsNeeded: Math.max(0, TWIN_EFFECT_MIN_AFTER - after.length),
                before: beforeRate,
                after: afterRate
            };
        })
        .sort((a, b) => b.taughtCount - a.taughtCount);
}

function recentTwinQuestionIds(memory) {
    // Keys are "type:questionId" or "type:questionId:variant".
    return normaliseTwinMemory(memory).recentLessons.map((key) => key.split(":")[1]);
}

module.exports = {
    TWIN_MISCONCEPTIONS,
    TWIN_STAGES,
    LEARN_THRESHOLD,
    buildTwinSolution,
    listTwinVariants,
    findTwinLesson,
    findMixedLesson,
    emptyTwinMemory,
    chooseTwinMisconception,
    summariseTwinProgress,
    applyTwinTeaching,
    computeTwinEffect,
    recentTwinQuestionIds,
    // exported for tests
    parseQuestion,
    formatLinear,
    formatNumber
};
