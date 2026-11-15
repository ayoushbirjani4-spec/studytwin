// ============================================================
// QUESTION GENERATOR
// ============================================================
//
// Unlimited fresh questions in the same style as the hand-written bank,
// for all four topics and three levels.
//
// Each generated question's id encodes its template and numbers, e.g.
// "g_dp1_2_3_4" is 2(x + 3) = 14 with x = 4. Any part of the app can
// rebuild the exact question from the id alone (parseGeneratedId), so
// nothing is stored, and everything keyed by question id keeps working:
// answer checking, the replay guard, attempt logs and the twin.
//
// Numbers are picked so every answer is a whole number and every step
// stays positive and readable at the easier levels.
// ============================================================

const PREFIX = "g_";

// ------------------------------------------------------------
// Formatting
// ------------------------------------------------------------

function term(coefficient) {
    if (coefficient === 1) return "x";
    if (coefficient === -1) return "-x";
    return `${coefficient}x`;
}

// "6x + 8", "11x - 3", "4x"
function linear(a, b) {
    if (b === 0) return term(a);
    return b > 0 ? `${term(a)} + ${b}` : `${term(a)} - ${-b}`;
}

// ------------------------------------------------------------
// Solution steps shared by several templates
// ------------------------------------------------------------

// From "a·x + b = c" to "x = …", the way the bank writes it.
function solveLinearSteps(a, b, c) {
    const steps = [];
    let rhs = c;
    if (b > 0) {
        steps.push(`Subtract ${b} from both sides`, `${term(a)} = ${c - b}`);
        rhs = c - b;
    } else if (b < 0) {
        steps.push(`Add ${-b} to both sides`, `${term(a)} = ${c - b}`);
        rhs = c - b;
    }
    if (a !== 1) {
        steps.push(`Divide both sides by ${a}`, `x = ${rhs / a}`);
    }
    return steps;
}

function equationQuestion({ concept, text, x, steps, explanation }) {
    return {
        question: `Solve: ${text}`,
        concept,
        answer: String(x),
        solution_steps: steps,
        explanation
    };
}

// ------------------------------------------------------------
// Templates
// ------------------------------------------------------------
//
// params: one [min, max] range per number, in id order.
// valid:  extra rules the numbers must satisfy.
// build:  the question, answer, worked steps and explanation.

const bracket = (concept, sign) => (a, p, b, x) => {
    const inner = p * x + sign * b;
    const c = a * inner;
    const expandedB = sign * a * b;
    const insideText = `${term(p)} ${sign > 0 ? "+" : "-"} ${b}`;
    return equationQuestion({
        concept,
        text: `${a}(${insideText}) = ${c}`,
        x,
        steps: [
            `Distribute ${a} to both ${term(p)} and ${b}`,
            `${linear(a * p, expandedB)} = ${c}`,
            ...solveLinearSteps(a * p, expandedB, c)
        ],
        explanation: `Multiply ${a} by every term inside the brackets first, then undo the ${sign > 0 ? "addition" : "subtraction"} and the multiplication.`
    });
};

const addTemplate = (concept) => (b, x) => equationQuestion({
    concept,
    text: `x + ${b} = ${x + b}`,
    x,
    steps: [`Subtract ${b} from both sides`, `x = ${x + b} - ${b}`, `x = ${x}`],
    explanation: `Undo + ${b} by subtracting ${b} from both sides.`
});

const subtractTemplate = (concept) => (b, x) => equationQuestion({
    concept,
    text: `x - ${b} = ${x - b}`,
    x,
    steps: [`Add ${b} to both sides`, `x = ${x - b} + ${b}`, `x = ${x}`],
    explanation: `Undo - ${b} by adding ${b} to both sides.`
});

const multiplyTemplate = (concept) => (a, x) => equationQuestion({
    concept,
    text: `${a}x = ${a * x}`,
    x,
    steps: [`Divide both sides by ${a}`, `x = ${a * x}/${a}`, `x = ${x}`],
    explanation: `${a}x means ${a} times x, so divide both sides by ${a}.`
});

const divideTemplate = (concept) => (d, y) => equationQuestion({
    concept,
    text: `x / ${d} = ${y}`,
    x: d * y,
    steps: [`Multiply both sides by ${d}`, `x = ${y} × ${d}`, `x = ${d * y}`],
    explanation: `Undo dividing by ${d} by multiplying both sides by ${d}.`
});

const twoStepTemplate = (concept, sign) => (a, b, x) => {
    const c = a * x + sign * b;
    return equationQuestion({
        concept,
        text: `${a}x ${sign > 0 ? "+" : "-"} ${b} = ${c}`,
        x,
        steps: solveLinearSteps(a, sign * b, c),
        explanation: `First undo the ${sign > 0 ? "+" : "-"} ${b}, then divide by ${a}. Keep both sides balanced at each step.`
    });
};

function simplifyQuestion(terms, xTotal, constantTotal) {
    const text = terms
        .map((t, i) => (i === 0 ? t : t.startsWith("-") ? `- ${t.slice(1)}` : `+ ${t}`))
        .join(" ");
    const xTerms = terms.filter((t) => t.endsWith("x"));
    const constants = terms.filter((t) => !t.endsWith("x"));
    const answer = linear(xTotal, constantTotal);
    const steps = ["Group the x terms", `${xTerms.join(" + ").replace(/\+ -/g, "- ")} = ${term(xTotal)}`];
    if (constants.length) {
        steps.push("Group the constants", `${constants.join(" + ").replace(/\+ -/g, "- ")} = ${constantTotal}`);
    }
    steps.push(`Answer: ${answer}`);
    return {
        question: `Simplify: ${text}`,
        concept: "combining_like_terms",
        answer,
        solution_steps: steps,
        explanation: constants.length
            ? "Combine the x terms and the constants separately. They are not like terms."
            : "Add or subtract the coefficients of the like terms."
    };
}

const TEMPLATES = {
    // Distributive property
    dp1: { concept: "distributive_property", difficulty: 1, params: [[2, 5], [1, 6], [1, 9]],
        build: (a, b, x) => bracket("distributive_property", 1)(a, 1, b, x) },
    dp2: { concept: "distributive_property", difficulty: 2, params: [[2, 6], [1, 6], [2, 15]],
        valid: (a, b, x) => x > b,
        build: (a, b, x) => bracket("distributive_property", -1)(a, 1, b, x) },
    dp3: { concept: "distributive_property", difficulty: 3, params: [[2, 4], [2, 3], [1, 6], [1, 8]],
        valid: (a, p, b, x) => p * x > b,
        build: bracket("distributive_property", -1) },
    dp4: { concept: "distributive_property", difficulty: 3, params: [[2, 4], [2, 3], [1, 6], [1, 8]],
        build: bracket("distributive_property", 1) },

    // Inverse operations
    io1: { concept: "inverse_operations", difficulty: 1, params: [[1, 12], [1, 15]], build: addTemplate("inverse_operations") },
    io2: { concept: "inverse_operations", difficulty: 1, params: [[1, 12], [2, 20]], valid: (b, x) => x > b, build: subtractTemplate("inverse_operations") },
    io3: { concept: "inverse_operations", difficulty: 2, params: [[2, 9], [2, 12]], build: multiplyTemplate("inverse_operations") },
    io4: { concept: "inverse_operations", difficulty: 2, params: [[2, 9], [2, 9]], build: divideTemplate("inverse_operations") },
    io5: { concept: "inverse_operations", difficulty: 3, params: [[2, 6], [1, 12], [1, 10]], build: twoStepTemplate("inverse_operations", 1) },
    io6: { concept: "inverse_operations", difficulty: 3, params: [[2, 6], [1, 12], [1, 10]], valid: (a, b, x) => a * x > b, build: twoStepTemplate("inverse_operations", -1) },

    // Equation balance
    eb1: { concept: "equation_balance", difficulty: 1, params: [[1, 12], [1, 15]], build: addTemplate("equation_balance") },
    eb2: { concept: "equation_balance", difficulty: 1, params: [[1, 12], [2, 20]], valid: (b, x) => x > b, build: subtractTemplate("equation_balance") },
    eb3: { concept: "equation_balance", difficulty: 2, params: [[2, 9], [2, 12]], build: multiplyTemplate("equation_balance") },
    eb4: { concept: "equation_balance", difficulty: 3, params: [[2, 6], [1, 12], [1, 10]], build: twoStepTemplate("equation_balance", 1) },
    eb5: { concept: "equation_balance", difficulty: 3, params: [[2, 6], [1, 12], [1, 10]], valid: (a, b, x) => a * x > b, build: twoStepTemplate("equation_balance", -1) },

    // Combining like terms
    clt1: { concept: "combining_like_terms", difficulty: 1, params: [[2, 9], [2, 9]],
        build: (a, b) => simplifyQuestion([`${a}x`, `${b}x`], a + b, 0) },
    clt2: { concept: "combining_like_terms", difficulty: 1, params: [[3, 12], [1, 9]],
        valid: (a, b) => a - b >= 2,
        build: (a, b) => simplifyQuestion([`${a}x`, term(-b)], a - b, 0) },
    clt3: { concept: "combining_like_terms", difficulty: 2, params: [[2, 9], [1, 9], [2, 9], [1, 9]],
        build: (a, c, b, d) => simplifyQuestion([`${a}x`, `${c}`, `${b}x`, `${d}`], a + b, c + d) },
    clt4: { concept: "combining_like_terms", difficulty: 2, params: [[2, 9], [1, 9], [2, 9], [1, 9]],
        valid: (a, c, b, d) => c !== d,
        build: (a, c, b, d) => simplifyQuestion([`${a}x`, `-${c}`, `${b}x`, `${d}`], a + b, d - c) },
    clt5: { concept: "combining_like_terms", difficulty: 3, params: [[2, 9], [1, 9], [1, 8], [1, 9], [2, 9]],
        valid: (a, c, b, d, e) => a + e - b >= 2,
        build: (a, c, b, d, e) => simplifyQuestion([`${a}x`, `${c}`, term(-b), `${d}`, `${e}x`], a - b + e, c + d) }
};

// ------------------------------------------------------------
// Building and parsing ids
// ------------------------------------------------------------

function inRange(template, values) {
    return values.length === template.params.length &&
        values.every((v, i) => Number.isInteger(v) && v >= template.params[i][0] && v <= template.params[i][1]) &&
        (!template.valid || template.valid(...values));
}

function buildQuestion(code, values) {
    const template = TEMPLATES[code];
    if (!template || !inRange(template, values)) return null;
    return {
        id: `${PREFIX}${code}_${values.join("_")}`,
        difficulty: template.difficulty,
        generated: true,
        ...template.build(...values)
    };
}

function isGeneratedId(id) {
    return typeof id === "string" && id.startsWith(PREFIX);
}

// "g_dp1_2_3_4" -> the question, or null for anything malformed or out
// of range (ids come back from the browser, so they are never trusted).
function parseGeneratedId(id) {
    if (!isGeneratedId(id) || id.length > 40) return null;
    const [code, ...rest] = id.slice(PREFIX.length).split("_");
    if (!rest.length || !rest.every((part) => /^\d{1,3}$/.test(part))) return null;
    return buildQuestion(code, rest.map(Number));
}

// ------------------------------------------------------------
// Generating
// ------------------------------------------------------------

// Small seeded random generator, so a seed always gives the same set.
function seededRandom(seed) {
    let h = 1779033703 ^ String(seed).length;
    for (const ch of String(seed)) {
        h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let state = h >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function templatesFor(concept, difficulty) {
    const forConcept = Object.entries(TEMPLATES).filter(([, t]) => t.concept === concept);
    const exact = forConcept.filter(([, t]) => t.difficulty === difficulty);
    if (exact.length) return exact;
    // Nearest level that exists for this topic.
    const nearest = forConcept.sort((x, y) =>
        Math.abs(x[1].difficulty - difficulty) - Math.abs(y[1].difficulty - difficulty))[0];
    return nearest ? forConcept.filter(([, t]) => t.difficulty === nearest[1].difficulty) : [];
}

// One fresh question for this topic and level, avoiding the given ids.
function generateQuestion({ concept, difficulty = 1, excludeIds = [], random = Math.random } = {}) {
    const choices = templatesFor(concept, Number(difficulty) || 1);
    if (!choices.length) return null;
    const exclude = new Set(excludeIds);

    for (let attempt = 0; attempt < 60; attempt++) {
        const [code, template] = choices[Math.floor(random() * choices.length)];
        const values = template.params.map(([min, max]) => min + Math.floor(random() * (max - min + 1)));
        const question = buildQuestion(code, values);
        if (question && !exclude.has(question.id)) return question;
    }
    return null;
}

// A fixed set (the same seed gives the same questions), e.g. a pool of
// fresh problems for the twin.
function generateQuestionSet({ perTemplate = 4, seed = "studytwin" } = {}) {
    const random = seededRandom(seed);
    const set = [];
    const seen = new Set();
    for (const [code, template] of Object.entries(TEMPLATES)) {
        let made = 0;
        for (let attempt = 0; made < perTemplate && attempt < perTemplate * 20; attempt++) {
            const values = template.params.map(([min, max]) => min + Math.floor(random() * (max - min + 1)));
            const question = buildQuestion(code, values);
            if (question && !seen.has(question.id)) {
                seen.add(question.id);
                set.push(question);
                made += 1;
            }
        }
    }
    return set;
}

module.exports = {
    TEMPLATES,
    isGeneratedId,
    parseGeneratedId,
    generateQuestion,
    generateQuestionSet,
    seededRandom
};
