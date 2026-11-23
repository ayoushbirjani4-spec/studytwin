// ============================================================
// INEQUALITIES
// ============================================================
//
// "3x - 4 > 11" is checked like an equation, except that every line has a
// direction. Each line is reduced to its solution, x > 5 or x <= -2, so two
// lines agree when their solutions do. Writing the same number with the
// sign the wrong way round is the classic mistake: forgetting to flip the
// sign when multiplying or dividing by a negative number.
//
// Everything else (wrong inverse operation, one side only...) is
// diagnosed by the equation rules, on the lines with "=" in place of the sign.
// ============================================================

const rules = () => require("./misconceptionService");

const FLIP = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
const SHOW = { "<": "<", ">": ">", "<=": "≤", ">=": "≥" };

function normalise(text) {
    return String(text || "").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/\s+/g, " ").trim();
}

// "2x - 3 >= 7" -> { left, op, right }, or null.
function split(text) {
    const clean = normalise(text).replace(/^\s*(solve|simplify)\s*:\s*/i, "");
    const ops = clean.match(/<=|>=|<|>/g) || [];
    // Exactly one sign, and no "=" anywhere else (that would be an equation).
    if (ops.length !== 1 || clean.replace(ops[0], "").includes("=")) return null;
    const [left, right] = clean.split(ops[0]).map((side) => side.trim());
    return left && right ? { left, op: ops[0], right } : null;
}

// The solution of a line: { op, value } meaning "x op value", or null.
function solve(text) {
    const parts = split(text);
    if (!parts) return null;
    const linear = rules().parseEquation(`${parts.left} = ${parts.right}`);   // left - right = a·x + b
    if (!linear || Math.abs(linear.a) < 1e-9) return null;
    return {
        op: linear.a > 0 ? parts.op : FLIP[parts.op],
        value: -linear.b / linear.a
    };
}

function same(a, b) {
    return Boolean(a && b) && a.op === b.op && Math.abs(a.value - b.value) < 1e-9;
}

function isInequality(text) {
    return Boolean(split(text));
}

function isInequalityQuestion(question) {
    return /[<>≤≥]/.test(String(question?.question || "")) && isInequality(question.question);
}

function formatValue(value) {
    if (Number.isInteger(value)) return String(value);
    for (let denominator = 2; denominator <= 12; denominator++) {
        const numerator = value * denominator;
        if (Math.abs(numerator - Math.round(numerator)) < 1e-9) return `${Math.round(numerator)}/${denominator}`;
    }
    return String(Number(value.toFixed(4)));
}

function formatSolution(solution) {
    return `x ${SHOW[solution.op]} ${formatValue(solution.value)}`;
}

// "x > 5", "5 < x" and "x>5" are all the same answer.
function answersMatch(studentAnswer, correctAnswer) {
    return same(solve(studentAnswer), solve(correctAnswer));
}

// "x > 5" on its own: the final line, which (like "x = 4") isn't judged live,
// so an answer can't be found by trying values.
function isBareAnswer(line) {
    return /^\s*x\s*(<=|>=|<|>|≤|≥)\s*-?\d+(\.\d+)?(\/\d+)?\s*$/.test(line);
}

const FLIP_FEEDBACK = {
    message: "The inequality sign is the wrong way round here.",
    hint: "Flip the sign only when you multiply or divide both sides by a negative number, and always flip it then."
};

// What went wrong between two lines, or null if the step is fine.
function classify(from, to) {
    const before = solve(from);
    const after = solve(to);
    if (!before || !after || same(before, after)) return null;
    if (Math.abs(before.value - after.value) < 1e-9) return "inequality_flip";
    const asEquation = (line) => { const p = split(line); return `${p.left} = ${p.right}`; };
    return rules().classifyStepError(asEquation(from), asEquation(to)) || "arithmetic_slip";
}

function feedbackFor(label) {
    return label === "inequality_flip" ? FLIP_FEEDBACK : rules().STEP_LABELS[label] || {
        message: "This step changes the inequality.",
        hint: "Do the same thing to both sides, and flip the sign if you multiply or divide by a negative."
    };
}

// The correct version of a wrong line: the same line with the sign flipped,
// or else the solution itself.
function correctionFor(question, from, to, label) {
    if (label === "inequality_flip") {
        const parts = split(to);
        return `${parts.left} ${SHOW[FLIP[parts.op]]} ${parts.right}`;
    }
    return question.answer;
}

// Same shape as misconceptionService.checkSteps.
function checkSteps(question, work, reveal = false) {
    const start = normalise(question.question.replace(/^\s*solve\s*:\s*/i, ""));
    const lines = rules().splitWorkSteps(String(work || "")).slice(0, 30);
    let reference = start;
    let firstErrorIndex = null;

    const steps = lines.map((line, index) => {
        if (index === 0 && normalise(line).replace(/\s/g, "") === start.replace(/\s/g, "")) {
            return { line, status: "given", label: null, message: null, hint: null };
        }
        if (isBareAnswer(line)) {
            reference = line;
            return { line, status: "final", label: null, message: "Final line: press Check Answer to see if it's right.", hint: null };
        }
        if (!solve(line)) {
            return { line, status: "unreadable", label: null, message: "I can't read this line as an inequality yet.", hint: null };
        }
        const from = reference;
        reference = line;
        if (same(solve(from), solve(line))) {
            return { line, status: "valid", label: null, message: null, hint: null };
        }
        const label = classify(from, line);
        const feedback = feedbackFor(label);
        const isFirstError = firstErrorIndex === null;
        if (isFirstError) firstErrorIndex = index;
        return {
            line, status: "invalid", label,
            message: feedback.message,
            hint: isFirstError ? feedback.hint : null,
            ...(isFirstError && reveal ? { correctStep: correctionFor(question, from, line, label) } : {})
        };
    });

    return {
        questionId: question.id,
        steps,
        firstErrorIndex,
        errorCount: steps.filter((step) => step.status === "invalid").length
    };
}

// Same shape as a misconceptionService diagnosis.
function diagnose(question, studentAnswer, work) {
    const correct = answersMatch(studentAnswer, question.answer);
    const lines = rules().splitWorkSteps(String(work || ""));
    let previous = normalise(question.question.replace(/^\s*solve\s*:\s*/i, ""));
    for (const line of lines) {
        if (!solve(line)) continue;
        const label = classify(previous, line);
        if (label) {
            const feedback = feedbackFor(label);
            return {
                detected: true,
                type: label,
                concept: question.concept,
                confidence: 0.9,
                message: (correct ? "Your final answer is right, but one of your steps is not: " : "") + feedback.message,
                hint: feedback.hint,
                incorrectStep: line,
                previousStep: previous,
                correctStep: correctionFor(question, previous, line, label),
                explanation: null,
                source: "rules"
            };
        }
        previous = line;
    }
    return correct
        ? { detected: false, type: null, concept: question.concept, confidence: 1, message: "Correct answer.", hint: null }
        : {
            detected: false, type: "unknown_error", concept: question.concept, confidence: 0,
            message: "The answer isn't right, but I couldn't find the step that went wrong. Write one step per line.",
            hint: "Do the same to both sides, and flip the sign if you multiply or divide by a negative."
        };
}

module.exports = { isInequalityQuestion, answersMatch, solve, classify, formatSolution, checkSteps, diagnose, SHOW, FLIP };
