// ============================================================
// FACTORISING
// ============================================================
//
// "Factorise: 6x + 9" -> "3(2x + 3)", "Factorise: x² + 5x + 6" -> "(x + 2)(x + 3)".
//
// There is no equation to solve, so lines are checked by value: a line is
// right if it equals the question's expression for every x (tested at a few
// points). An answer must also be a product of brackets, and fully
// factorised (no common factor left inside a bracket).
//
// Named mistakes:
//   - not_factorised:       equal, but not written as a product
//   - not_fully_factorised: 3(2x + 4) for 6x + 12
//   - factor_out_one_term:  3(2x + 9) for 6x + 9 (only one term divided)
//   - factor_sign_error:    (x - 2)(x - 3) for x² + 5x + 6
//   - wrong_factor_pair:    the numbers multiply to c but don't add to b
// ============================================================

const { compile } = require("./solutionChecker");

const CONCEPT = "factorising";
const POINTS = [-3.7, -1.3, 0, 0.6, 1, 2.9, 5.2];
const TOLERANCE = 1e-6;
const near = (a, b) => Math.abs(a - b) < TOLERANCE;

function handles(question) {
    return question?.concept === CONCEPT;
}

// "Factorise: x² + 5x + 6" -> "x² + 5x + 6"; a leading "=" is dropped.
function clean(text) {
    return String(text || "").replace(/^\s*factori[sz]e\s*:\s*/i, "").replace(/^\s*=\s*/, "").trim();
}

function startOf(question) {
    return clean(question.question);
}

function read(text) {
    const f = compile(clean(text));
    return f ? (x) => f({ x }) : null;
}

function equivalent(f, g) {
    return POINTS.every((x) => near(f(x), g(x)));
}

// The polynomial's a·x² + b·x + c, or null if it isn't one.
function coefficients(f) {
    const c = f(0), p1 = f(1), m1 = f(-1);
    const a = (p1 + m1) / 2 - c, b = (p1 - m1) / 2;
    const fits = POINTS.every((x) => near(f(x), a * x * x + b * x + c));
    return fits ? { a, b, c } : null;
}

const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));

// The text inside each top-level bracket, or null if a + or - sits outside
// the brackets (so it's a sum, not a product).
function productParts(text) {
    const source = clean(text).replace(/\s+/g, "");
    if (!source.includes("(")) return null;
    const parts = [];
    let depth = 0, from = -1;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === "(") { if (depth === 0) from = i + 1; depth++; }
        else if (ch === ")") { depth--; if (depth === 0) parts.push(source.slice(from, i)); if (depth < 0) return null; }
        else if (depth === 0 && (ch === "+" || ch === "-") && i > 0) return null;
    }
    return depth === 0 ? parts : null;
}

// Each bracket is linear with no common whole-number factor.
function fullyFactorised(text) {
    const parts = productParts(text);
    if (!parts) return false;
    return parts.every((inside) => {
        const f = read(inside);
        const poly = f && coefficients(f);
        if (!poly || !near(poly.a, 0)) return false;
        const { b, c } = poly;
        if (!near(b, Math.round(b)) || !near(c, Math.round(c))) return true;   // fractions: nothing to take out
        return gcd(Math.round(b), Math.round(c)) <= 1;
    });
}

function answersMatch(studentAnswer, correctAnswer) {
    const given = read(studentAnswer), expected = read(correctAnswer);
    return Boolean(given && expected && equivalent(given, expected) && fullyFactorised(studentAnswer));
}

// ------------------------------------------------------------
// Feedback
// ------------------------------------------------------------

const FEEDBACK = {
    not_factorised: {
        message: "This is equal to the question, but it isn't factorised yet.",
        hint: "Factorised means written as a product: a number or brackets multiplied together, like 3(x + 2) or (x + 1)(x + 4)."
    },
    not_fully_factorised: {
        message: "There's still a common factor inside the brackets.",
        hint: "Take out the highest common factor of every term. Check that the numbers left in the brackets share no factor."
    },
    factor_out_one_term: {
        message: "Only one of the terms was divided by the common factor.",
        hint: "Divide every term by the factor you take out. Expand your answer: it should give back the question."
    },
    factor_sign_error: {
        message: "The numbers are right but the signs are the wrong way round.",
        hint: "The two numbers must multiply to the last number and add to the x coefficient, signs included. Expand your brackets to check."
    },
    wrong_factor_pair: {
        message: "These numbers multiply to the right number but don't add up to the x coefficient.",
        hint: "List the pairs of numbers that multiply to the last number, and pick the pair that adds to the number in front of x."
    },
    invalid_step: {
        message: "This line isn't equal to the one before.",
        hint: "Expand this line: it should give back the expression you started with."
    }
};

// What went wrong with an answer that isn't right, as a label.
function classifyAnswer(question, studentAnswer) {
    const target = read(question.answer), given = read(studentAnswer);
    if (!target || !given) return null;
    if (equivalent(target, given)) {
        if (!productParts(studentAnswer)) return "not_factorised";
        if (!fullyFactorised(studentAnswer)) return "not_fully_factorised";
        return null;
    }
    const want = coefficients(target), got = coefficients(given);
    if (!want || !got || !productParts(studentAnswer)) return null;
    if (near(want.a, 0) && near(got.a, 0)) {
        // Common factor: the x term is right but the number isn't, or the other way round.
        return near(want.b, got.b) !== near(want.c, got.c) ? "factor_out_one_term" : null;
    }
    if (near(want.a, got.a) && near(want.c, got.c)) {
        return near(want.b, -got.b) ? "factor_sign_error" : "wrong_factor_pair";
    }
    return null;
}

// ------------------------------------------------------------
// Steps
// ------------------------------------------------------------

// A factorised line is the student's answer: like "x = 4" for equations,
// it isn't judged live, so answers can't be found by trying.
function isAnswerLine(line) {
    return Boolean(productParts(line));
}

function checkSteps(question, work, reveal = false) {
    const rules = require("./misconceptionService");
    const start = read(startOf(question));
    const startText = startOf(question).replace(/\s/g, "");
    let firstErrorIndex = null;
    let reference = start;

    const steps = rules.splitWorkSteps(String(work || "")).slice(0, 30).map((line, index) => {
        if (index === 0 && clean(line).replace(/\s/g, "") === startText) {
            return { line, status: "given", label: null, message: null, hint: null };
        }
        if (isAnswerLine(line)) {
            return { line, status: "final", label: null, message: "Final line: press Check Answer to see if it's right.", hint: null };
        }
        const f = read(line);
        if (!f) return { line, status: "unreadable", label: null, message: "I can't read this line yet.", hint: null };
        const from = reference;
        reference = f;
        if (start && from && equivalent(from, f)) return { line, status: "valid", label: null, message: null, hint: null };
        const first = firstErrorIndex === null;
        if (first) firstErrorIndex = index;
        return {
            line, status: "invalid", label: "invalid_step", message: FEEDBACK.invalid_step.message,
            hint: first ? FEEDBACK.invalid_step.hint : null,
            ...(first && reveal ? { correctStep: question.answer } : {})
        };
    });
    return { questionId: question.id, steps, firstErrorIndex, errorCount: steps.filter((s) => s.status === "invalid").length };
}

function diagnose(question, studentAnswer, work) {
    const rules = require("./misconceptionService");
    const correct = answersMatch(studentAnswer, question.answer);
    const base = { concept: question.concept, source: "rules", previousStep: null, explanation: null };
    const start = read(startOf(question));

    // A middle line that isn't equal to the question.
    for (const line of rules.splitWorkSteps(String(work || ""))) {
        if (isAnswerLine(line)) continue;
        const f = read(line);
        if (start && f && !equivalent(start, f)) {
            return {
                ...base, detected: true, type: "invalid_step", confidence: 0.85,
                message: (correct ? "Your final answer is right, but one of your steps is not: " : "") + FEEDBACK.invalid_step.message,
                hint: FEEDBACK.invalid_step.hint, incorrectStep: line, correctStep: question.answer
            };
        }
    }

    if (correct) return { ...base, detected: false, type: null, confidence: 1, message: "Correct answer.", hint: null };

    const type = classifyAnswer(question, studentAnswer);
    if (type) {
        return { ...base, detected: true, type, confidence: 0.9, ...FEEDBACK[type], incorrectStep: studentAnswer, correctStep: question.answer };
    }
    return { ...base, detected: false, type: "unknown_error", confidence: 0,
        message: "The answer isn't right. Expand your brackets: they should give back the question.",
        hint: "Write one step per line, and check each line is equal to the one before." };
}

module.exports = { CONCEPT, handles, answersMatch, checkSteps, diagnose, classifyAnswer, fullyFactorised, FEEDBACK };
