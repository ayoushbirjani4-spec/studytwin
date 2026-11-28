// ============================================================
// HOW TO HELP AT HOME
// ============================================================
//
// For the parent link: for the mistakes a student is making most, a
// plain-language explanation, an example of the mistake next to the right
// working, what a parent can say, and one question to try together.
//
// Written for parents, not students: no jargon, and no need to know the
// maths method to help. Only mistakes with a clear explanation are listed;
// "unknown" and "step doesn't follow" are too vague to help with.
// ============================================================

const questionGenerator = require("./questionGenerator");

const MAX_TIPS = 2;

const TIPS = {
    failed_to_distribute: {
        what: "Multiplying only the first thing inside the brackets.",
        wrong: "3(x + 4) → 3x + 4", right: "3(x + 4) → 3x + 12",
        help: "Ask them to draw an arrow from the number outside to every term inside the brackets, then multiply along each arrow."
    },
    sign_error: {
        what: "Losing a minus sign, often when multiplying or dividing by a negative number.",
        wrong: "-4x = 20 → x = 5", right: "-4x = 20 → x = -5",
        help: "Ask them to circle every minus sign before each step, and check each circled sign is still there (or has properly changed) afterwards."
    },
    wrong_inverse_op: {
        what: "Undoing a step with the wrong operation, like subtracting to undo a division.",
        wrong: "x/3 = 4 → x = 4/3", right: "x/3 = 4 → x = 12",
        help: "Ask: \"What is being done to x? What's the opposite of that?\" Adding undoes subtracting, and multiplying undoes dividing."
    },
    one_sided_op: {
        what: "Changing only one side of an equation.",
        wrong: "2x + 3 = 11 → 2x = 11", right: "2x + 3 = 11 → 2x = 8",
        help: "Use the picture of a balance: whatever comes off one side must come off the other, or it tips. Ask them to write the step on both sides every time."
    },
    arithmetic_slip: {
        what: "The method is right, but a sum or times table goes wrong along the way.",
        wrong: "3x = 21 → x = 6", right: "3x = 21 → x = 7",
        help: "This is about care, not understanding. Ask them to check the answer by putting it back into the question: does it work?"
    },
    combining_unlike_terms: {
        what: "Adding x terms and plain numbers together as if they were the same thing.",
        wrong: "3x + 2 → 5x", right: "3x + 2 stays as 3x + 2",
        help: "Think of x as apples and plain numbers as pounds: 3 apples and £2 can't be added into 5 of anything."
    },
    wrong_equation: {
        what: "Writing an equation that doesn't match the word problem.",
        wrong: "£2 a ticket plus a £5 fee, total £17 → 5x + 2 = 17", right: "→ 2x + 5 = 17",
        help: "Ask them to explain each number in their equation in words: \"this 2 is the price per ticket\". A number they can't explain is in the wrong place."
    },
    inequality_flip: {
        what: "Forgetting to turn the < or > sign round when dividing by a negative number.",
        wrong: "-2x > 6 → x > -3", right: "-2x > 6 → x < -3",
        help: "Test it with a number: try x = -4 in -2x > 6. It works, and -4 is less than -3, so the sign has to flip."
    },
    lost_a_solution: {
        what: "Finding only one of a quadratic's two answers.",
        wrong: "x² = 49 → x = 7", right: "x² = 49 → x = 7 or x = -7",
        help: "Ask: \"Is there another number that also works?\" (-7)² is 49 too. Quadratics usually have two answers."
    },
    not_factorised: {
        what: "Rewriting the expression without actually factorising it into brackets.",
        wrong: "x² + 5x + 6 → x² + 2x + 3x + 6", right: "x² + 5x + 6 → (x + 2)(x + 3)",
        help: "Remind them the answer should be things multiplied together, like 3(x + 2) or (x + 1)(x + 4), not terms added up."
    },
    not_fully_factorised: {
        what: "Taking out a common factor, but not the biggest one.",
        wrong: "12x + 8 → 2(6x + 4)", right: "12x + 8 → 4(3x + 2)",
        help: "Ask them to look at the numbers left in the brackets: do they still share a factor? If so, there's more to take out."
    },
    factor_out_one_term: {
        what: "Dividing only one of the terms by the common factor.",
        wrong: "6x + 9 → 3(2x + 9)", right: "6x + 9 → 3(2x + 3)",
        help: "Ask them to multiply their brackets back out. If they don't get the question back, something was missed."
    },
    factor_sign_error: {
        what: "Getting the right numbers in the brackets with the signs the wrong way round.",
        wrong: "x² + 5x + 6 → (x - 2)(x - 3)", right: "x² + 5x + 6 → (x + 2)(x + 3)",
        help: "Ask them to multiply the brackets back out and compare the middle term with the question, sign included."
    },
    wrong_factor_pair: {
        what: "Choosing two numbers that multiply correctly but don't add up to the middle number.",
        wrong: "x² + 5x + 6 → (x + 1)(x + 6)", right: "x² + 5x + 6 → (x + 2)(x + 3)",
        help: "Make a list together of the pairs that multiply to the last number (1 and 6, 2 and 3), then pick the pair that adds to the middle one."
    }
};

// The student's most frequent helpable mistakes, newest topic for each,
// with one practice question that targets that mistake. `rows` are the
// student's attempts, oldest first. `seed` keeps the question the same
// for a day, so the page doesn't change on every reload.
function helpAtHome(rows, { stuckOn = null, seed = "" } = {}) {
    const recent = rows.slice(-20);
    const counts = {};
    const lastConcept = {};
    for (const row of recent) {
        const type = row.misconceptionDetected ? row.misconceptionType : null;
        if (!type || !TIPS[type]) continue;
        counts[type] = (counts[type] || 0) + 1;
        lastConcept[type] = row.concept;
    }
    const types = Object.keys(counts).sort((a, b) =>
        (b === stuckOn?.type) - (a === stuckOn?.type) || counts[b] - counts[a]);

    return types.slice(0, MAX_TIPS).map((type) => {
        const concept = lastConcept[type];
        const question = questionGenerator.generateTrapQuestion({
            misconceptionType: type, concept, random: questionGenerator.seededRandom(`${seed}:${type}`)
        });
        return {
            type,
            count: counts[type],
            ...TIPS[type],
            tryThis: question ? { question: question.question, answer: question.answer } : null
        };
    });
}

module.exports = { TIPS, helpAtHome };
