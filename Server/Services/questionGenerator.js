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

// a·x + b = c·x + d, with a - c >= 2 so x stays on the left and it is never a one-liner.
const bothSidesTemplate = (sign) => (a, b, c, x) => {
    const left = a - c;
    const d = left * x + sign * b;
    const lhs = b === 0 ? term(a) : `${term(a)} ${sign > 0 ? "+" : "-"} ${b}`;
    return equationQuestion({
        concept: "x_on_both_sides",
        text: `${lhs} = ${term(c)} + ${d}`,
        x,
        steps: [`Subtract ${term(c)} from both sides`, `${linear(left, sign * b)} = ${d}`, ...solveLinearSteps(left, sign * b, d)],
        explanation: `Collect the x terms first: subtract ${term(c)} from both sides, then solve as before.`
    });
};

// Negative numbers: a·x + b = c with a negative coefficient, constant or
// answer. Ids hold only digits, so a template negates its own numbers.
const negativeTemplate = (a, b, x) => {
    const c = a * x + b;
    const lhs = b === 0 ? term(a) : linear(a, b);
    // One-step questions show the working line too ("x = 3 - 8"), like the bank.
    const steps = a === 1
        ? [`Subtract ${b} from both sides`, `x = ${c} - ${b}`, `x = ${x}`]
        : b === 0
            ? [`Divide both sides by ${a}`, `x = ${c}/${a}`, `x = ${x}`]
            : solveLinearSteps(a, b, c);
    return equationQuestion({
        concept: "negative_numbers",
        text: `${lhs} = ${c}`,
        x,
        steps,
        explanation: "Keep track of every minus sign: dividing by a negative number changes the sign of the answer."
    });
};

// Equations with fractions: x/d ± b = c, and (x ± b)/d = c.
const fractionTemplate = (d, b, y) => equationQuestion({
    concept: "equations_with_fractions",
    text: `x/${d} + ${b} = ${y + b}`,
    x: d * y,
    steps: [`Subtract ${b} from both sides`, `x/${d} = ${y}`, `Multiply both sides by ${d}`, `x = ${d * y}`],
    explanation: `Undo the + ${b} first, then undo dividing by ${d} by multiplying both sides by ${d}.`
});

const bracketFractionTemplate = (b, d, c) => equationQuestion({
    concept: "equations_with_fractions",
    text: `(x + ${b})/${d} = ${c}`,
    x: c * d - b,
    steps: [`Multiply both sides by ${d}`, `x + ${b} = ${c * d}`, `Subtract ${b} from both sides`, `x = ${c * d - b}`],
    explanation: `The whole of x + ${b} is divided by ${d}, so multiply both sides by ${d} first.`
});

// Word problems: a story around an existing template. The student writes
// the equation first; `equation` is what the story gives, for checking.
function wordProblem(build, describe) {
    return (...values) => {
        const base = build(...values);
        const equation = base.question.replace(/^Solve:\s*/, "");
        return {
            ...base,
            concept: "word_problems",
            question: describe(...values),
            equation,
            solution_steps: ["Write an equation for the story", equation, ...base.solution_steps],
            explanation: `Turn the story into an equation first (${equation}), then solve it. ${base.explanation}`
        };
    };
}

// Inequalities: a·x + b (op) c with solution "x (op) k". `o` picks the sign.
const INEQUALITY_SIGNS = ["<", ">", "≤", "≥"];
const FLIPPED = { "<": ">", ">": "<", "≤": "≥", "≥": "≤" };
const inequalityTemplate = (a, b, k, o) => {
    const op = INEQUALITY_SIGNS[o];
    const c = a * k + b;
    const solved = a < 0 ? FLIPPED[op] : op;
    const steps = [];
    if (b !== 0) steps.push(`Subtract ${b} from both sides`, `${term(a)} ${op} ${c - b}`);
    if (a !== 1) {
        steps.push(a < 0 ? `Divide both sides by ${a} and flip the sign` : `Divide both sides by ${a}`, `x ${solved} ${k}`);
    }
    return {
        question: `Solve: ${b === 0 ? term(a) : linear(a, b)} ${op} ${c}`,
        concept: "inequalities",
        answer: `x ${solved} ${k}`,
        solution_steps: steps,
        explanation: a < 0
            ? `Solve it like an equation, but you divide by ${a}, a negative number, so the sign flips.`
            : "Solve it like an equation, keeping the inequality sign the same way round."
    };
};

// Quadratics with whole-number roots, and simultaneous equations. These are
// checked against their solutions (solutionChecker), not the linear rules.

// "x² - 5x + 6"
function quadraticText(b, c) {
    const bx = b === 0 ? "" : b > 0 ? ` + ${term(b)}` : ` - ${term(-b)}`;
    const cc = c === 0 ? "" : c > 0 ? ` + ${c}` : ` - ${-c}`;
    return `x²${bx}${cc}`;
}
const factor = (r) => (r === 0 ? "x" : r > 0 ? `(x - ${r})` : `(x + ${-r})`);

const quadraticFromRoots = (r1, r2) => ({
    question: `Solve: ${quadraticText(-(r1 + r2), r1 * r2)} = 0`,
    concept: "quadratics",
    answer: `x = ${r1} or x = ${r2}`,
    solution_steps: ["Factorise", `${factor(r1)}${factor(r2)} = 0`, "One of the brackets must be 0",
        `${factor(r1).replace(/[()]/g, "")} = 0 or ${factor(r2).replace(/[()]/g, "")} = 0`, `x = ${r1} or x = ${r2}`],
    explanation: "Factorise, then set each bracket to 0. A quadratic like this has two solutions."
});

const squareTemplate = (r) => ({
    question: `Solve: x² = ${r * r}`,
    concept: "quadratics",
    answer: `x = ${r} or x = ${-r}`,
    solution_steps: ["Take the square root of both sides, remembering ±", `x = ${r} or x = ${-r}`],
    explanation: `Both ${r} and ${-r} square to ${r * r}, so there are two solutions.`
});

const xFactorTemplate = (k) => ({
    question: `Solve: x² = ${k}x`,
    concept: "quadratics",
    answer: `x = 0 or x = ${k}`,
    solution_steps: [`Subtract ${k}x from both sides`, `x² - ${k}x = 0`, "Factorise", `x(x - ${k}) = 0`, `x = 0 or x = ${k}`],
    explanation: "Don't divide by x: that loses the solution x = 0. Move everything to one side and factorise."
});

const simultaneousTemplate = (a, b, x, y) => {
    const first = `${term(a)} + y = ${a * x + y}`;
    const second = `x + ${b}y = ${x + b * y}`;
    return {
        question: `Solve: ${first} and ${second}`,
        concept: "simultaneous_equations",
        answer: `x = ${x}, y = ${y}`,
        solution_steps: ["Make x the subject of the second equation", `x = ${x + b * y} - ${b}y`,
            "Substitute into the first equation and solve for y", `y = ${y}`, "Substitute y back in", `x = ${x}`],
        explanation: "Use one equation to write x in terms of y, substitute it into the other, then solve."
    };
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

    // x on both sides: a·x (+/- b) = c·x + d
    xb1: { concept: "x_on_both_sides", difficulty: 1, params: [[3, 9], [1, 7], [1, 9]],
        valid: (a, c) => a - c >= 2,
        build: (a, c, x) => bothSidesTemplate(1)(a, 0, c, x) },
    xb2: { concept: "x_on_both_sides", difficulty: 2, params: [[3, 9], [1, 9], [1, 7], [1, 9]],
        valid: (a, b, c) => a - c >= 2,
        build: bothSidesTemplate(1) },
    xb3: { concept: "x_on_both_sides", difficulty: 3, params: [[3, 9], [1, 9], [1, 7], [1, 9]],
        valid: (a, b, c, x) => a - c >= 2 && (a - c) * x > b,
        build: bothSidesTemplate(-1) },

    // Negative numbers
    ng1: { concept: "negative_numbers", difficulty: 1, params: [[2, 12], [1, 9]],   // x + b = c, x = -m
        build: (b, m) => negativeTemplate(1, b, -m) },
    ng2: { concept: "negative_numbers", difficulty: 2, params: [[2, 9], [1, 9]],    // -a·x = c, x = m
        build: (a, m) => negativeTemplate(-a, 0, m) },
    ng3: { concept: "negative_numbers", difficulty: 2, params: [[2, 6], [1, 12], [1, 9]],   // a·x + b = c, x = -m
        build: (a, b, m) => negativeTemplate(a, b, -m) },
    ng4: { concept: "negative_numbers", difficulty: 3, params: [[2, 6], [1, 12], [1, 9]],   // -a·x + b = c, x = m
        build: (a, b, m) => negativeTemplate(-a, b, m) },

    // Equations with fractions
    fr1: { concept: "equations_with_fractions", difficulty: 1, params: [[2, 9], [2, 9]], build: divideTemplate("equations_with_fractions") },
    fr2: { concept: "equations_with_fractions", difficulty: 2, params: [[2, 9], [1, 9], [1, 9]], build: fractionTemplate },
    fr3: { concept: "equations_with_fractions", difficulty: 3, params: [[1, 9], [2, 6], [2, 9]],
        valid: (b, d, c) => c * d > b,
        build: bracketFractionTemplate },

    // Inequalities (the last number picks <, >, ≤ or ≥)
    iq1: { concept: "inequalities", difficulty: 1, params: [[1, 12], [1, 15], [0, 3]],          // x + b > c
        build: (b, k, o) => inequalityTemplate(1, b, k, o) },
    iq2: { concept: "inequalities", difficulty: 2, params: [[2, 6], [1, 12], [1, 9], [0, 3]],   // a·x + b > c
        build: (a, b, k, o) => inequalityTemplate(a, b, k, o) },
    iq3: { concept: "inequalities", difficulty: 3, params: [[2, 9], [1, 9], [0, 3]],            // -a·x > c: flip
        build: (a, k, o) => inequalityTemplate(-a, 0, k, o) },
    iq4: { concept: "inequalities", difficulty: 3, params: [[2, 6], [1, 12], [1, 9], [0, 3]],   // -a·x + b > c: flip
        build: (a, b, k, o) => inequalityTemplate(-a, b, k, o) },

    // Quadratics
    qd1: { concept: "quadratics", difficulty: 1, params: [[1, 9], [1, 9]], valid: (r1, r2) => r1 < r2,   // two positive roots
        build: quadraticFromRoots },
    qd2: { concept: "quadratics", difficulty: 2, params: [[1, 9], [1, 9]], valid: (r1, r2) => r1 !== r2, // one negative root
        build: (r1, r2) => quadraticFromRoots(r1, -r2) },
    qd3: { concept: "quadratics", difficulty: 3, params: [[2, 12]], build: squareTemplate },              // x² = 49
    qd4: { concept: "quadratics", difficulty: 3, params: [[2, 9]], build: xFactorTemplate },              // x² = 5x

    // Simultaneous equations: a·x + y = c and x + b·y = d
    sm3: { concept: "simultaneous_equations", difficulty: 2, params: [[2, 5], [1, 9], [1, 9]],     // x + y = s and a·x + y = t: subtract
        build: (a, x, y) => ({
            question: `Solve: x + y = ${x + y} and ${a}x + y = ${a * x + y}`,
            concept: "simultaneous_equations",
            answer: `x = ${x}, y = ${y}`,
            solution_steps: ["Subtract the first equation from the second to remove y", `${a - 1 === 1 ? "" : a - 1}x = ${(a - 1) * x}`, `x = ${x}`, "Substitute into the first equation", `${x} + y = ${x + y}`, `y = ${y}`],
            explanation: "Both equations have + y, so subtracting one from the other removes y."
        }) },
    sm1: { concept: "simultaneous_equations", difficulty: 1, params: [[1, 1], [1, 1], [1, 9], [1, 9]],
        valid: (a, b, x, y) => x !== y,
        build: (a, b, x, y) => ({
            ...simultaneousTemplate(1, 1, x, y),
            question: `Solve: x + y = ${x + y} and x - y = ${x - y}`,
            solution_steps: ["Add the two equations to remove y", `2x = ${2 * x}`, `x = ${x}`, "Substitute into the first equation", `${x} + y = ${x + y}`, `y = ${y}`],
            explanation: "Adding the equations removes y. Find x, then substitute it back to find y."
        }) },
    sm2: { concept: "simultaneous_equations", difficulty: 3, params: [[2, 5], [2, 5], [1, 8], [1, 8]],
        build: simultaneousTemplate },

    // Word problems
    wp1: { concept: "word_problems", difficulty: 1, params: [[2, 5], [2, 6], [2, 12]],
        build: wordProblem(twoStepTemplate("word_problems", 1),
            (a, b, x) => `A taxi charges £${b} plus £${a} for every mile. A journey cost £${a * x + b}. How many miles long was the journey?`) },
    wp2: { concept: "word_problems", difficulty: 2, params: [[3, 12], [1, 5], [2, 9]],
        build: wordProblem(twoStepTemplate("word_problems", 1),
            (a, b, x) => `Concert tickets cost £${a} each, plus a £${b} booking fee for the whole order. An order cost £${a * x + b}. How many tickets were bought?`) },
    wp3: { concept: "word_problems", difficulty: 2, params: [[2, 6], [3, 20], [2, 10]],
        build: wordProblem(twoStepTemplate("word_problems", 1),
            (a, b, x) => `A plant is ${b} cm tall and grows ${a} cm every week. After how many weeks will it be ${a * x + b} cm tall?`) },
    wp4: { concept: "word_problems", difficulty: 3, params: [[2, 6], [1, 5], [3, 12]],
        build: wordProblem((a, b, x) => bracket("word_problems", 1)(a, 1, b, x),
            (a, b, x) => `${a} friends each buy a cinema ticket and a £${b} snack. Altogether they spend £${a * (x + b)}. How much does one ticket cost?`) },
    wp5: { concept: "word_problems", difficulty: 3, params: [[4, 9], [1, 7], [2, 12]],
        valid: (a, c) => a - c >= 2,
        build: wordProblem((a, c, x) => bothSidesTemplate(1)(a, 0, c, x),
            (a, c, x) => `Gym A charges £${a} a visit. Gym B charges a £${(a - c) * x} joining fee plus £${c} a visit. After how many visits do the two gyms cost the same?`) },

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

// ------------------------------------------------------------
// Trap questions
// ------------------------------------------------------------
//
// A trap question is one where a particular mistake is tempting and would
// show in the working. Which templates can show which mistake was checked
// against the twin's verified mistakes (twinService.listTwinVariants):
// e.g. a minus inside the brackets is where sign errors happen, and a
// two-step equation is where students do something to only one side.

const TRAPS = {
    failed_to_distribute: ["dp1", "dp4", "dp3", "dp2", "wp4"],
    sign_error: ["dp2", "dp3", "ng2", "ng3", "ng4", "clt2", "clt4", "clt5"],
    wrong_inverse_op: ["dp2", "dp3", "io2", "io4", "io6", "eb2", "eb5", "xb1", "xb2", "xb3", "ng1", "ng3", "fr1", "fr2", "fr3", "wp1", "wp2", "wp3", "wp4", "wp5"],
    one_sided_op: ["dp1", "dp4", "io5", "io6", "eb4", "eb5", "xb1", "xb2", "xb3", "ng3", "ng4", "fr2", "wp1", "wp2", "wp3", "wp4", "wp5"],
    arithmetic_slip: ["dp3", "dp4", "io5", "io6", "eb4", "eb5", "xb3", "ng2", "ng3", "ng4", "fr1", "fr2", "clt4", "clt5"],
    combining_unlike_terms: ["clt3", "clt4", "clt5"]
};

// What the trap was set to catch, shown once the student has answered.
const TRAP_NOTES = {
    failed_to_distribute: "This one was set to catch multiplying only the first term in the brackets.",
    sign_error: "This one was set to catch a lost minus sign.",
    wrong_inverse_op: "This one was set to catch undoing a step with the wrong operation.",
    one_sided_op: "This one was set to catch changing only one side of the equation.",
    arithmetic_slip: "This one was set to catch a slip in the arithmetic.",
    combining_unlike_terms: "This one was set to catch adding x terms and numbers together."
};

// A trap for this mistake in this topic. When the mistake can't show in
// this topic's questions, the topic's hardest questions are used instead.
function generateTrapQuestion({ misconceptionType, concept, excludeIds = [], random = Math.random } = {}) {
    const codes = (TRAPS[misconceptionType] || []).filter((code) => TEMPLATES[code].concept === concept);
    if (!codes.length) return generateQuestion({ concept, difficulty: 3, excludeIds, random });

    const exclude = new Set(excludeIds);
    for (let attempt = 0; attempt < 60; attempt++) {
        const code = codes[Math.floor(random() * codes.length)];
        const values = TEMPLATES[code].params.map(([min, max]) => min + Math.floor(random() * (max - min + 1)));
        const question = buildQuestion(code, values);
        if (question && !exclude.has(question.id)) return question;
    }
    return null;
}

module.exports = {
    TEMPLATES,
    TRAPS,
    TRAP_NOTES,
    generateTrapQuestion,
    isGeneratedId,
    parseGeneratedId,
    generateQuestion,
    generateQuestionSet,
    seededRandom
};
