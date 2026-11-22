// ============================================================
// QUADRATICS AND SIMULTANEOUS EQUATIONS
// ============================================================
//
// The linear rules can't follow these, so they are checked a different
// way: StudyTwin knows the solutions, and a written line is right if it
// is still true for them.
//
//   - quadratics: a line true for only one of the two solutions has lost
//     one ("x² = 5x" -> "x = 5" forgets x = 0; "x² = 49" -> "x = 7"
//     forgets -7). That is the classic mistake and it is named.
//   - simultaneous equations: a line false for the solution is the first
//     mistake.
//
// Lines are evaluated with a small parser below: numbers, x, y, + - * / ^,
// brackets and implicit multiplication (2x, 3(x + 1), (x - 2)(x - 3)).
// ============================================================

const CONCEPTS = ["quadratics", "simultaneous_equations"];
const TOLERANCE = 1e-6;

// ------------------------------------------------------------
// Expression parsing
// ------------------------------------------------------------

function tokenize(text) {
    const source = String(text).replace(/²/g, "^2").replace(/[−–]/g, "-").replace(/×|·/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
    const tokens = [];
    for (let i = 0; i < source.length;) {
        const rest = source.slice(i);
        const number = rest.match(/^\d+(\.\d+)?/);
        if (number) { tokens.push({ type: "num", value: Number(number[0]) }); i += number[0].length; continue; }
        if (/^[xy]/i.test(rest)) { tokens.push({ type: "var", value: rest[0].toLowerCase() }); i += 1; continue; }
        if ("+-*/^()".includes(rest[0])) { tokens.push({ type: rest[0] }); i += 1; continue; }
        return null;
    }
    // Implicit multiplication: 2x, 2(, x(, )(, )x, x y
    const out = [];
    for (const token of tokens) {
        const prev = out[out.length - 1];
        const endsValue = prev && (prev.type === "num" || prev.type === "var" || prev.type === ")");
        const startsValue = token.type === "num" || token.type === "var" || token.type === "(";
        if (endsValue && startsValue && !(prev.type === "num" && token.type === "num")) out.push({ type: "*" });
        out.push(token);
    }
    return out;
}

// Recursive descent: returns (vars) => number, or null if it can't be read.
function compile(text) {
    const tokens = tokenize(text);
    if (!tokens || !tokens.length) return null;
    let i = 0;
    const peek = () => tokens[i];
    const take = (type) => (tokens[i] && tokens[i].type === type ? tokens[i++] : null);

    function expression() {
        let node = term();
        while (node && (peek()?.type === "+" || peek()?.type === "-")) {
            const op = tokens[i++].type;
            const right = term();
            if (!right) return null;
            const left = node;
            node = op === "+" ? (v) => left(v) + right(v) : (v) => left(v) - right(v);
        }
        return node;
    }
    function term() {
        let node = unary();
        while (node && (peek()?.type === "*" || peek()?.type === "/")) {
            const op = tokens[i++].type;
            const right = unary();
            if (!right) return null;
            const left = node;
            node = op === "*" ? (v) => left(v) * right(v) : (v) => left(v) / right(v);
        }
        return node;
    }
    function unary() {
        if (take("-")) { const inner = unary(); return inner && ((v) => -inner(v)); }
        if (take("+")) return unary();
        return power();
    }
    function power() {
        const base = atom();
        if (base && take("^")) {
            const exponent = unary();
            return exponent && ((v) => base(v) ** exponent(v));
        }
        return base;
    }
    function atom() {
        const num = take("num");
        if (num) return () => num.value;
        const variable = take("var");
        if (variable) return (v) => v[variable.value] ?? NaN;
        if (take("(")) {
            const inner = expression();
            return inner && take(")") ? inner : null;
        }
        return null;
    }

    const result = expression();
    return result && i === tokens.length ? result : null;
}

// "L = R" -> (vars) => L - R, or null.
function compileEquation(line) {
    const sides = String(line).split("=");
    if (sides.length !== 2) return null;
    const left = compile(sides[0]);
    const right = compile(sides[1]);
    return left && right ? (v) => left(v) - right(v) : null;
}

// ------------------------------------------------------------
// Answers
// ------------------------------------------------------------

const near = (a, b) => Math.abs(a - b) < TOLERANCE;
const asNumber = (text) => {
    const f = compile(text);
    if (!f || /[xy]/i.test(text)) return null;
    const value = f({});
    return Number.isFinite(value) ? value : null;
};

// "x = 2 or x = 3", "x = 2, x = -3", "2 or 3", "x = ±7" -> [2, 3] or null
function readRoots(text) {
    const clean = String(text || "").replace(/\band\b|\bor\b|;/gi, ",").replace(/x\s*=\s*±\s*([\d./]+)/gi, "x = $1, x = -$1");
    const values = clean.split(",").map((part) => part.trim()).filter(Boolean)
        .map((part) => asNumber(part.replace(/^x\s*=\s*/i, "")));
    return values.length && values.every((v) => v !== null) ? values : null;
}

// "x = 3, y = 1" (any order) -> { x: 3, y: 1 } or null
function readPair(text) {
    const pair = {};
    for (const part of String(text || "").split(/,|;|\band\b/i).map((p) => p.trim()).filter(Boolean)) {
        const match = part.match(/^([xy])\s*=\s*(.+)$/i);
        if (!match) return null;
        const value = asNumber(match[2]);
        if (value === null) return null;
        pair[match[1].toLowerCase()] = value;
    }
    return "x" in pair && "y" in pair ? pair : null;
}

function sameSet(a, b) {
    const unique = (list) => list.filter((v, i) => list.findIndex((w) => near(v, w)) === i);
    const ua = unique(a), ub = unique(b);
    return ua.length === ub.length && ua.every((v) => ub.some((w) => near(v, w)));
}

// The question's solutions, from its answer: [{x}, {x}] or [{x, y}].
function solutionsOf(question) {
    if (question.concept === "simultaneous_equations") {
        const pair = readPair(question.answer);
        return pair ? [pair] : [];
    }
    return (readRoots(question.answer) || []).map((x) => ({ x }));
}

function handles(question) {
    return CONCEPTS.includes(question?.concept);
}

function answersMatch(studentAnswer, correctAnswer, question) {
    if (question.concept === "simultaneous_equations") {
        const given = readPair(studentAnswer), expected = readPair(correctAnswer);
        return Boolean(given && expected && near(given.x, expected.x) && near(given.y, expected.y));
    }
    const given = readRoots(studentAnswer), expected = readRoots(correctAnswer);
    return Boolean(given && expected && sameSet(given, expected));
}

// ------------------------------------------------------------
// Steps
// ------------------------------------------------------------

const FEEDBACK = {
    lost_a_solution: {
        message: "This line loses one of the solutions.",
        hint: "A quadratic like this has two solutions. Don't divide both sides by something with x in it, and remember the ± when you take a square root."
    },
    invalid_step: {
        message: "This line doesn't follow from the one before.",
        hint: "Check this step: do the same to both sides, and check every sign and number."
    }
};

// A final answer line ("x = 3", "x = 2 or x = -5", "y = 4"): like "x = 4"
// for equations, it isn't judged live, so answers can't be found by trying.
function isAnswerLine(line) {
    return /^\s*[xy]\s*=\s*[-±]?\s*[\d./]+\s*((,|or|and)\s*([xy]\s*=\s*)?-?[\d./]+\s*)*$/i.test(line);
}

// "valid", or the label of what's wrong, or null if the line can't be read.
function judgeLine(question, line) {
    const parts = String(line).split(/\bor\b|,/i).map((p) => p.trim()).filter(Boolean);
    const solutions = solutionsOf(question);
    if (question.concept === "quadratics" && parts.length > 1) {
        // "x - 2 = 0 or x - 3 = 0": each solution must satisfy one of the parts.
        const fs = parts.map(compileEquation);
        if (fs.some((f) => !f)) return null;
        const covered = solutions.filter((s) => fs.some((f) => near(f(s), 0)));
        const allTrue = fs.every((f) => solutions.some((s) => near(f(s), 0)));
        if (covered.length === solutions.length && allTrue) return "valid";
        return covered.length > 0 ? "lost_a_solution" : "invalid_step";
    }
    const f = compileEquation(line);
    if (!f) return null;
    const holds = solutions.filter((s) => near(f(s), 0));
    if (holds.length === solutions.length) return "valid";
    if (question.concept === "quadratics" && holds.length > 0) return "lost_a_solution";
    return "invalid_step";
}

function startOf(question) {
    return String(question.question).replace(/^\s*solve\s*:\s*/i, "");
}

function checkSteps(question, work, reveal = false) {
    const rules = require("./misconceptionService");
    const start = startOf(question).replace(/\s/g, "").replace(/²/g, "^2");
    let firstErrorIndex = null;
    const steps = rules.splitWorkSteps(String(work || "")).slice(0, 30).map((line, index) => {
        if (index === 0 && line.replace(/\s/g, "").replace(/²/g, "^2") === start) {
            return { line, status: "given", label: null, message: null, hint: null };
        }
        if (isAnswerLine(line)) {
            return { line, status: "final", label: null, message: "Final line: press Check Answer to see if it's right.", hint: null };
        }
        const verdict = judgeLine(question, line);
        if (verdict === null) {
            return { line, status: "unreadable", label: null, message: "I can't read this line yet.", hint: null };
        }
        if (verdict === "valid") return { line, status: "valid", label: null, message: null, hint: null };
        const first = firstErrorIndex === null;
        if (first) firstErrorIndex = index;
        return {
            line, status: "invalid", label: verdict, message: FEEDBACK[verdict].message,
            hint: first ? FEEDBACK[verdict].hint : null,
            ...(first && reveal ? { correctStep: question.answer } : {})
        };
    });
    return { questionId: question.id, steps, firstErrorIndex, errorCount: steps.filter((s) => s.status === "invalid").length };
}

function diagnose(question, studentAnswer, work) {
    const rules = require("./misconceptionService");
    const correct = answersMatch(studentAnswer, question.answer, question);
    const base = { concept: question.concept, source: "rules", previousStep: null, explanation: null };

    for (const line of rules.splitWorkSteps(String(work || ""))) {
        if (line.replace(/\s/g, "") === startOf(question).replace(/\s/g, "")) continue;
        const verdict = isAnswerLine(line) && question.concept === "quadratics"
            ? judgeLine(question, line.replace(/±/g, ""))
            : judgeLine(question, line);
        if (verdict && verdict !== "valid") {
            return {
                ...base, detected: true, type: verdict, confidence: 0.85,
                message: (correct ? "Your final answer is right, but one of your steps is not: " : "") + FEEDBACK[verdict].message,
                hint: FEEDBACK[verdict].hint, incorrectStep: line, correctStep: question.answer
            };
        }
    }

    // One solution of two, written only as the answer.
    if (!correct && question.concept === "quadratics") {
        const given = readRoots(studentAnswer);
        const expected = readRoots(question.answer) || [];
        if (given && given.length < expected.length && given.every((v) => expected.some((w) => near(v, w)))) {
            return { ...base, detected: true, type: "lost_a_solution", confidence: 0.9, ...FEEDBACK.lost_a_solution, incorrectStep: studentAnswer, correctStep: question.answer };
        }
    }

    return correct
        ? { ...base, detected: false, type: null, confidence: 1, message: "Correct answer.", hint: null }
        : { ...base, detected: false, type: "unknown_error", confidence: 0,
            message: "The answer isn't right, but I couldn't find the step that went wrong. Write one step per line.",
            hint: "Check that every line is still true for your answer." };
}

module.exports = { CONCEPTS, handles, answersMatch, checkSteps, diagnose, compile, readRoots, readPair, FEEDBACK };
