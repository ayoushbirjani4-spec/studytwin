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
// Building one twin solution
// ------------------------------------------------------------

// Each builder returns { lines, wrongIndex, twinAnswer } with the mistake
// injected, or null when that misconception does not fit this question.

function buildBracket(q, type) {
    const lines = [q.start];
    const expandedA = q.k * q.p;
    const expandedB = q.k * q.b;
    let a = expandedA;
    let b = expandedB;

    if (type === "failed_to_distribute") {
        b = q.b;                               // only the x-term multiplied
    } else if (type === "sign_error") {
        b = -expandedB;                        // constant's sign flipped
    }

    if (type === "failed_to_distribute" || type === "sign_error") {
        lines.push(equation(formatLinear(a, b), formatNumber(q.c)));
        const wrongIndex = lines.length - 1;
        lines.push(...finishLinear(a, b, q.c));
        return { lines, wrongIndex };
    }

    // Correct expansion, then a mistake while isolating x.
    lines.push(equation(formatLinear(expandedA, expandedB), formatNumber(q.c)));
    return injectIntoLinear(lines, expandedA, expandedB, q.c, type);
}

// From "a·x + b = c" (already written as the last line), make the
// mistake while undoing +b or while dividing by a.
function injectIntoLinear(lines, a, b, c, type) {
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
            // Right operation, wrong result, written in one jump as students
            // do ("2x + 6 = 14" -> "2x = 9"). Writing "2x = 14 - 6" first would
            // make the slip a right-side-only change, which reads as one-sided.
            // Needs a !== 1: a bare "x = 9" line is never judged live.
            wrongLine = equation(formatTerm(a), formatNumber(c - b + 1));
            newRhs = c - b + 1;
        }

        if (wrongLine) {
            lines.push(wrongLine);
            const wrongIndex = lines.length - 1;
            if (type === "wrong_inverse_op") {
                lines.push(equation(formatTerm(a), formatNumber(newRhs)));
            }
            if (a !== 1) {
                pushDivision(lines, newRhs, a);
            }
            return { lines, wrongIndex };
        }
        return null;
    }

    // a·x = c: the mistake happens while dividing.
    if (a !== 1 && type === "wrong_inverse_op") {
        lines.push(equation("x", `${formatNumber(c)} - ${formatNumber(a)}`));
        const wrongIndex = lines.length - 1;
        lines.push(equation("x", formatNumber(c - a)));
        return { lines, wrongIndex };
    }
    return null;
}

function buildDivide(q, type) {
    const lines = [q.start];
    if (type === "wrong_inverse_op") {
        lines.push(equation("x", `${formatNumber(q.c)}/${formatNumber(q.d)}`));
        const wrongIndex = lines.length - 1;
        lines.push(equation("x", formatNumber(q.c / q.d, q.c, q.d)));
        return { lines, wrongIndex };
    }
    // No arithmetic slip here: its wrong line would be a bare "x = 21",
    // which is never judged live.
    return null;
}

function buildLinear(q, type) {
    return injectIntoLinear([q.start], q.a, q.b, q.c, type);
}

function buildSimplify(q, type) {
    const xs = q.terms.filter((t) => t.isX);
    const constants = q.terms.filter((t) => !t.isX);
    const a = xs.reduce((sum, t) => sum + t.coefficient, 0);
    const b = constants.reduce((sum, t) => sum + t.coefficient, 0);
    const lines = [q.start];

    if (type === "combining_unlike_terms" && constants.length > 0) {
        lines.push(formatTerm(a + b));               // numbers merged into the x-term
        return { lines, wrongIndex: 1 };
    }
    if (type === "sign_error" && q.terms.slice(1).some((t) => t.coefficient < 0)) {
        const absA = xs.reduce((sum, t) => sum + Math.abs(t.coefficient), 0);
        const absB = constants.reduce((sum, t) => sum + Math.abs(t.coefficient), 0);
        lines.push(formatLinear(absA, absB));         // every minus treated as plus
        return { lines, wrongIndex: 1 };
    }
    if (type === "arithmetic_slip") {
        // Like terms grouped correctly, one total off by one.
        lines.push(constants.length > 0 ? formatLinear(a, b + 1) : formatTerm(a + 1));
        return { lines, wrongIndex: 1 };
    }
    return null;
}

const BUILDERS = {
    bracket: buildBracket,
    divide: buildDivide,
    linear: buildLinear,
    simplify: buildSimplify
};

// ------------------------------------------------------------
// Verification with the live step checker
// ------------------------------------------------------------

function verify(question, built, type) {
    const result = misconceptionService.checkSteps({
        questionId: question.id,
        work: built.lines.join("\n")
    });
    if (!result) return false;

    const invalid = result.steps
        .map((step, index) => ({ ...step, index }))
        .filter((step) => step.status === "invalid");

    return invalid.length === 1 &&
        invalid[0].index === built.wrongIndex &&
        invalid[0].label === type &&
        result.steps.every((step) => step.status !== "unreadable");
}

// One twin solution for a question and misconception, or null.
function buildTwinSolution(question, type) {
    if (!question || !TWIN_MISCONCEPTIONS.includes(type)) return null;

    const parsed = parseQuestion(question);
    if (!parsed) return null;

    const built = BUILDERS[parsed.kind](parsed, type);
    if (!built || !verify(question, built, type)) return null;

    const lastLine = built.lines[built.lines.length - 1];
    return {
        questionId: question.id,
        question: question.question,
        concept: question.concept,
        misconceptionType: type,
        lines: built.lines,
        wrongIndex: built.wrongIndex,
        twinAnswer: lastLine.includes("=") ? lastLine.split("=").pop().trim() : lastLine,
        correctAnswer: question.answer
    };
}

// A twin lesson for this misconception, preferring the given concept and
// avoiding recently used questions. Returns null if no question fits.
function findTwinLesson({ misconceptionType, concept = null, excludeQuestionIds = [] }) {
    const all = QUESTION_BANK;
    const ordered = [
        ...all.filter((q) => q.concept === concept),
        ...all.filter((q) => q.concept !== concept)
    ];
    const fresh = ordered.filter((q) => !excludeQuestionIds.includes(q.id));

    for (const pool of [fresh, ordered]) {
        for (const question of pool) {
            const lesson = buildTwinSolution(question, misconceptionType);
            if (lesson) return lesson;
        }
    }
    return null;
}

module.exports = {
    TWIN_MISCONCEPTIONS,
    buildTwinSolution,
    findTwinLesson,
    // exported for tests
    parseQuestion,
    formatLinear,
    formatNumber
};
