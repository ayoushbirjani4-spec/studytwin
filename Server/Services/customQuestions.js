// ============================================================
// TEACHERS' OWN QUESTIONS
// ============================================================
//
// A teacher types a question from their own worksheet ("3(x - 2) = 2x + 5"
// or "Simplify: 4x + 3 - x"). StudyTwin works out the answer itself and
// checks the working with the same rules as every other question.
//
// Like generated questions, the id carries the question itself
// ("t_" + the text, base64url-encoded), so any part of the app can rebuild
// it from the id alone and nothing else needs storing. Ids come back from
// the browser, so they are always parsed and checked again.
// ============================================================

const PREFIX = "t_";
const MAX_TEXT_LENGTH = 80;
const CONCEPT = "class_questions";

// Loaded when first used: misconceptionService itself loads questionService,
// which loads this file.
const rules = () => require("./misconceptionService");

function clean(text) {
    return String(text || "")
        .replace(/[−–—]/g, "-")
        .replace(/[×·]/g, "*")
        .replace(/÷/g, "/")
        .replace(/^\s*(?:\(?[a-z0-9]{1,3}[.)]\s+)?/i, "")       // "1. " or "b) " from a worksheet
        .replace(/^\s*(?:solve|simplify)\s*:?\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function gcd(a, b) {
    return b ? gcd(b, a % b) : Math.abs(a);
}

// x = numerator / denominator, as "4", "-3" or "13/3".
function formatSolution(numerator, denominator) {
    if (Number.isInteger(numerator) && Number.isInteger(denominator)) {
        const sign = Math.sign(numerator) * Math.sign(denominator);
        const top = Math.abs(numerator), bottom = Math.abs(denominator);
        const divisor = gcd(top, bottom) || 1;
        const value = `${top / divisor}${bottom / divisor === 1 ? "" : `/${bottom / divisor}`}`;
        return sign < 0 && top !== 0 ? `-${value}` : value;
    }
    return String(Number((numerator / denominator).toFixed(4)));
}

function formatExpression(a, b) {
    const x = a === 1 ? "x" : a === -1 ? "-x" : `${a}x`;
    if (a === 0) return String(b);
    if (b === 0) return x;
    return b > 0 ? `${x} + ${b}` : `${x} - ${-b}`;
}

// The question for this text, or { error } saying why it can't be checked.
function parse(text) {
    const cleaned = clean(text);
    if (!cleaned) return { error: "It's empty." };
    if (cleaned.length > MAX_TEXT_LENGTH) return { error: `Keep it under ${MAX_TEXT_LENGTH} characters.` };
    if (/[a-wyz]/i.test(cleaned.replace(/x/gi, ""))) {
        return { error: "Use x as the only letter." };
    }

    const equals = (cleaned.match(/=/g) || []).length;
    if (equals > 1) return { error: "Use one equals sign." };

    if (equals === 1) {
        const equation = rules().parseEquation(cleaned);
        if (!equation) return { error: "StudyTwin can only check linear equations, like 3(x - 2) = 2x + 5." };
        if (Math.abs(equation.a) < 1e-9) return { error: "This equation doesn't have exactly one answer." };
        const answer = formatSolution(-equation.b, equation.a);
        return {
            question: `Solve: ${cleaned}`,
            answer,
            solution_steps: [`x = ${answer}`],
            explanation: "A question from your teacher. Solve it one step at a time."
        };
    }

    let expression;
    try {
        expression = rules().parseExpression(cleaned);
    } catch {
        expression = null;
    }
    if (!expression || !/x/i.test(cleaned)) {
        return { error: "StudyTwin can only check linear equations and expressions with x." };
    }
    const answer = formatExpression(Number(expression.a.toFixed(6)), Number(expression.b.toFixed(6)));
    return {
        question: `Simplify: ${cleaned}`,
        answer,
        solution_steps: [`Answer: ${answer}`],
        explanation: "A question from your teacher. Collect the x terms and the numbers separately."
    };
}

function toId(text) {
    return PREFIX + Buffer.from(clean(text)).toString("base64url");
}

function isCustomId(id) {
    return typeof id === "string" && id.startsWith(PREFIX);
}

// "t_..." -> the question, or null for anything malformed.
function fromId(id) {
    if (!isCustomId(id) || id.length > 140 || !/^t_[A-Za-z0-9_-]+$/.test(id)) return null;
    const text = Buffer.from(id.slice(PREFIX.length), "base64url").toString("utf8");
    if (toId(text) !== id) return null;
    const parsed = parse(text);
    if (parsed.error) return null;
    return { id, concept: CONCEPT, difficulty: 2, custom: true, ...parsed };
}

// For the teacher: each line becomes a question, or a reason it can't.
function fromLines(text) {
    return String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((line) => {
            const parsed = parse(line);
            return parsed.error
                ? { line, error: parsed.error }
                : { line, id: toId(line), question: parsed.question, answer: parsed.answer };
        });
}

module.exports = { CONCEPT, isCustomId, fromId, fromLines, parse };
