// ============================================================
// StudyTwin Question Bank
// ============================================================
//
// 4 concepts
// 5 questions per concept
// 20 questions total
//
// Difficulty:
// 1 = Easy
// 2 = Medium
// 3 = Hard
//
// solution_steps will later be used by the
// misconception-analysis engine.
// ============================================================


const questions = [

    // ========================================================
    // 1. DISTRIBUTIVE PROPERTY
    // ========================================================

    {
        id: "dp_001",
        question: "Solve: 2(x + 3) = 14",
        concept: "distributive_property",
        difficulty: 1,
        answer: "4",

        solution_steps: [
            "Distribute 2 to both x and 3",
            "2x + 6 = 14",
            "Subtract 6 from both sides",
            "2x = 8",
            "Divide both sides by 2",
            "x = 4"
        ],

        explanation:
            "First distribute 2 to both terms inside the parentheses. " +
            "Then isolate x."
    },

    {
        id: "dp_002",
        question: "Solve: 3(x + 2) = 15",
        concept: "distributive_property",
        difficulty: 1,
        answer: "3",

        solution_steps: [
            "Distribute 3 to both x and 2",
            "3x + 6 = 15",
            "Subtract 6 from both sides",
            "3x = 9",
            "Divide both sides by 3",
            "x = 3"
        ],

        explanation:
            "Distribute 3 across both terms inside the parentheses, " +
            "then solve for x."
    },

    {
        id: "dp_003",
        question: "Solve: 4(x - 2) = 20",
        concept: "distributive_property",
        difficulty: 2,
        answer: "7",

        solution_steps: [
            "Distribute 4 to x and -2",
            "4x - 8 = 20",
            "Add 8 to both sides",
            "4x = 28",
            "Divide both sides by 4",
            "x = 7"
        ],

        explanation:
            "Remember that distributing 4 to -2 produces -8."
    },

    {
        id: "dp_004",
        question: "Solve: 5(x + 4) = 35",
        concept: "distributive_property",
        difficulty: 2,
        answer: "3",

        solution_steps: [
            "Distribute 5 to both x and 4",
            "5x + 20 = 35",
            "Subtract 20 from both sides",
            "5x = 15",
            "Divide both sides by 5",
            "x = 3"
        ],

        explanation:
            "Distribute 5 first, then use inverse operations."
    },

    {
        id: "dp_005",
        question: "Solve: 3(2x - 4) = 24",
        concept: "distributive_property",
        difficulty: 3,
        answer: "6",

        solution_steps: [
            "Distribute 3 to both 2x and -4",
            "6x - 12 = 24",
            "Add 12 to both sides",
            "6x = 36",
            "Divide both sides by 6",
            "x = 6"
        ],

        explanation:
            "The 3 must be multiplied by both 2x and -4."
    },


    // ========================================================
    // 2. COMBINING LIKE TERMS
    // ========================================================

    {
        id: "clt_001",
        question: "Simplify: 3x + 2x",
        concept: "combining_like_terms",
        difficulty: 1,
        answer: "5x",

        solution_steps: [
            "Identify the like terms 3x and 2x",
            "Add their coefficients",
            "3 + 2 = 5",
            "Keep the variable x",
            "Answer: 5x"
        ],

        explanation:
            "Like terms have the same variable and exponent. " +
            "Add their coefficients."
    },

    {
        id: "clt_002",
        question: "Simplify: 7x - 3x",
        concept: "combining_like_terms",
        difficulty: 1,
        answer: "4x",

        solution_steps: [
            "Identify 7x and -3x as like terms",
            "Subtract the coefficients",
            "7 - 3 = 4",
            "Keep the variable x",
            "Answer: 4x"
        ],

        explanation:
            "Subtract the coefficients because the second term is negative."
    },

    {
        id: "clt_003",
        question: "Simplify: 4x + 3 + 2x + 5",
        concept: "combining_like_terms",
        difficulty: 2,
        answer: "6x + 8",

        solution_steps: [
            "Group the x terms",
            "4x + 2x = 6x",
            "Group the constant terms",
            "3 + 5 = 8",
            "Answer: 6x + 8"
        ],

        explanation:
            "Combine variable terms separately from constant terms."
    },

    {
        id: "clt_004",
        question: "Simplify: 8x - 5 + 3x + 2",
        concept: "combining_like_terms",
        difficulty: 2,
        answer: "11x - 3",

        solution_steps: [
            "Group the x terms",
            "8x + 3x = 11x",
            "Group the constants",
            "-5 + 2 = -3",
            "Answer: 11x - 3"
        ],

        explanation:
            "Combine the x terms and constants separately."
    },

    {
        id: "clt_005",
        question: "Simplify: 6x + 4 - 2x + 7 + 3x",
        concept: "combining_like_terms",
        difficulty: 3,
        answer: "7x + 11",

        solution_steps: [
            "Group all x terms",
            "6x - 2x + 3x",
            "6 - 2 + 3 = 7",
            "Group the constants",
            "4 + 7 = 11",
            "Answer: 7x + 11"
        ],

        explanation:
            "Collect every term containing x, then combine the constants."
    },


    // ========================================================
    // 3. INVERSE OPERATIONS
    // ========================================================

    {
        id: "io_001",
        question: "Solve: x + 5 = 12",
        concept: "inverse_operations",
        difficulty: 1,
        answer: "7",

        solution_steps: [
            "Subtract 5 from both sides",
            "x + 5 - 5 = 12 - 5",
            "x = 7"
        ],

        explanation:
            "Addition is undone using subtraction."
    },

    {
        id: "io_002",
        question: "Solve: x - 4 = 10",
        concept: "inverse_operations",
        difficulty: 1,
        answer: "14",

        solution_steps: [
            "Add 4 to both sides",
            "x - 4 + 4 = 10 + 4",
            "x = 14"
        ],

        explanation:
            "Subtraction is undone using addition."
    },

    {
        id: "io_003",
        question: "Solve: 3x = 18",
        concept: "inverse_operations",
        difficulty: 2,
        answer: "6",

        solution_steps: [
            "Divide both sides by 3",
            "3x / 3 = 18 / 3",
            "x = 6"
        ],

        explanation:
            "Multiplication is undone using division."
    },

    {
        id: "io_004",
        question: "Solve: x / 5 = 4",
        concept: "inverse_operations",
        difficulty: 2,
        answer: "20",

        solution_steps: [
            "Multiply both sides by 5",
            "x / 5 × 5 = 4 × 5",
            "x = 20"
        ],

        explanation:
            "Division is undone using multiplication."
    },

    {
        id: "io_005",
        question: "Solve: 4x + 7 = 31",
        concept: "inverse_operations",
        difficulty: 3,
        answer: "6",

        solution_steps: [
            "Subtract 7 from both sides",
            "4x = 24",
            "Divide both sides by 4",
            "x = 6"
        ],

        explanation:
            "Use inverse operations in the correct order: " +
            "remove the constant first, then divide by the coefficient."
    },


    // ========================================================
    // 4. EQUATION BALANCE
    // ========================================================

    {
        id: "eb_001",
        question: "Solve: x + 3 = 8",
        concept: "equation_balance",
        difficulty: 1,
        answer: "5",

        solution_steps: [
            "Subtract 3 from both sides",
            "x + 3 - 3 = 8 - 3",
            "x = 5"
        ],

        explanation:
            "Whatever operation you perform on one side " +
            "must also be performed on the other side."
    },

    {
        id: "eb_002",
        question: "Solve: x - 6 = 2",
        concept: "equation_balance",
        difficulty: 1,
        answer: "8",

        solution_steps: [
            "Add 6 to both sides",
            "x - 6 + 6 = 2 + 6",
            "x = 8"
        ],

        explanation:
            "Keep the equation balanced by applying the same operation to both sides."
    },

    {
        id: "eb_003",
        question: "Solve: 2x = 16",
        concept: "equation_balance",
        difficulty: 2,
        answer: "8",

        solution_steps: [
            "Divide both sides by 2",
            "2x / 2 = 16 / 2",
            "x = 8"
        ],

        explanation:
            "Divide both sides by the same non-zero number to keep the equation balanced."
    },

    {
        id: "eb_004",
        question: "Solve: 3x + 4 = 19",
        concept: "equation_balance",
        difficulty: 2,
        answer: "5",

        solution_steps: [
            "Subtract 4 from both sides",
            "3x = 15",
            "Divide both sides by 3",
            "x = 5"
        ],

        explanation:
            "Apply each operation to both sides of the equation."
    },

    {
        id: "eb_005",
        question: "Solve: 5x - 7 = 28",
        concept: "equation_balance",
        difficulty: 3,
        answer: "7",

        solution_steps: [
            "Add 7 to both sides",
            "5x = 35",
            "Divide both sides by 5",
            "x = 7"
        ],

        explanation:
            "First remove the -7 by adding 7 to both sides, then divide by 5."
    },


    // ========================================================
    // X ON BOTH SIDES
    // ========================================================

    {
        id: "xb_001",
        question: "Solve: 5x = 2x + 12",
        concept: "x_on_both_sides",
        difficulty: 1,
        answer: "4",
        solution_steps: ["Subtract 2x from both sides", "3x = 12", "Divide both sides by 3", "x = 4"],
        explanation: "Collect the x terms on one side first: subtract 2x from both sides."
    },

    {
        id: "xb_002",
        question: "Solve: 4x + 3 = x + 15",
        concept: "x_on_both_sides",
        difficulty: 2,
        answer: "4",
        solution_steps: ["Subtract x from both sides", "3x + 3 = 15", "Subtract 3 from both sides", "3x = 12", "Divide both sides by 3", "x = 4"],
        explanation: "Subtract x from both sides to get the x terms together, then solve as a two-step equation."
    },

    {
        id: "xb_003",
        question: "Solve: 6x + 2 = 2x + 22",
        concept: "x_on_both_sides",
        difficulty: 2,
        answer: "5",
        solution_steps: ["Subtract 2x from both sides", "4x + 2 = 22", "Subtract 2 from both sides", "4x = 20", "Divide both sides by 4", "x = 5"],
        explanation: "Moving 2x to the other side means subtracting it from both sides, not adding it."
    },

    {
        id: "xb_004",
        question: "Solve: 7x - 4 = 3x + 8",
        concept: "x_on_both_sides",
        difficulty: 3,
        answer: "3",
        solution_steps: ["Subtract 3x from both sides", "4x - 4 = 8", "Add 4 to both sides", "4x = 12", "Divide both sides by 4", "x = 3"],
        explanation: "Collect the x terms, then undo the - 4 by adding 4 to both sides."
    },

    {
        id: "xb_005",
        question: "Solve: 9x - 5 = 4x + 15",
        concept: "x_on_both_sides",
        difficulty: 3,
        answer: "4",
        solution_steps: ["Subtract 4x from both sides", "5x - 5 = 15", "Add 5 to both sides", "5x = 20", "Divide both sides by 5", "x = 4"],
        explanation: "Whatever you do to one side, do to the other: subtract 4x from both sides, then add 5."
    },


    // ========================================================
    // NEGATIVE NUMBERS
    // ========================================================

    {
        id: "ng_001", question: "Solve: x + 8 = 3", concept: "negative_numbers", difficulty: 1, answer: "-5",
        solution_steps: ["Subtract 8 from both sides", "x = 3 - 8", "x = -5"],
        explanation: "3 - 8 goes below zero: the answer is negative."
    },
    {
        id: "ng_002", question: "Solve: -4x = 20", concept: "negative_numbers", difficulty: 2, answer: "-5",
        solution_steps: ["Divide both sides by -4", "x = 20/-4", "x = -5"],
        explanation: "A positive divided by a negative is negative."
    },
    {
        id: "ng_003", question: "Solve: -3x = -15", concept: "negative_numbers", difficulty: 2, answer: "5",
        solution_steps: ["Divide both sides by -3", "x = -15/-3", "x = 5"],
        explanation: "A negative divided by a negative is positive."
    },
    {
        id: "ng_004", question: "Solve: 3x + 10 = 1", concept: "negative_numbers", difficulty: 3, answer: "-3",
        solution_steps: ["Subtract 10 from both sides", "3x = -9", "Divide both sides by 3", "x = -3"],
        explanation: "1 - 10 = -9, then divide by 3."
    },
    {
        id: "ng_005", question: "Solve: -2x + 7 = 15", concept: "negative_numbers", difficulty: 3, answer: "-4",
        solution_steps: ["Subtract 7 from both sides", "-2x = 8", "Divide both sides by -2", "x = -4"],
        explanation: "Subtract 7, then divide by -2: the minus sign changes the sign of the answer."
    },


    // ========================================================
    // EQUATIONS WITH FRACTIONS
    // ========================================================

    {
        id: "fr_001", question: "Solve: x / 4 = 5", concept: "equations_with_fractions", difficulty: 1, answer: "20",
        solution_steps: ["Multiply both sides by 4", "x = 5 × 4", "x = 20"],
        explanation: "x / 4 means x divided by 4, so multiply both sides by 4."
    },
    {
        id: "fr_002", question: "Solve: x/3 + 2 = 6", concept: "equations_with_fractions", difficulty: 2, answer: "12",
        solution_steps: ["Subtract 2 from both sides", "x/3 = 4", "Multiply both sides by 3", "x = 12"],
        explanation: "Undo the + 2 first, then multiply by 3."
    },
    {
        id: "fr_003", question: "Solve: x/5 + 4 = 7", concept: "equations_with_fractions", difficulty: 2, answer: "15",
        solution_steps: ["Subtract 4 from both sides", "x/5 = 3", "Multiply both sides by 5", "x = 15"],
        explanation: "Undo the + 4 first, then multiply by 5."
    },
    {
        id: "fr_004", question: "Solve: (x + 2)/3 = 4", concept: "equations_with_fractions", difficulty: 3, answer: "10",
        solution_steps: ["Multiply both sides by 3", "x + 2 = 12", "Subtract 2 from both sides", "x = 10"],
        explanation: "All of x + 2 is divided by 3, so multiply both sides by 3 first."
    },
    {
        id: "fr_005", question: "Solve: (x + 5)/2 = 6", concept: "equations_with_fractions", difficulty: 3, answer: "7",
        solution_steps: ["Multiply both sides by 2", "x + 5 = 12", "Subtract 5 from both sides", "x = 7"],
        explanation: "Multiply both sides by 2 to clear the fraction, then subtract 5."
    },


    // ========================================================
    // WORD PROBLEMS
    // ========================================================
    // `equation` is what the story gives: the student writes it as their
    // first line, and it is checked against this.

    {
        id: "wp_001",
        question: "A taxi charges £3 plus £2 for every mile. A journey cost £15. How many miles long was the journey?",
        equation: "2x + 3 = 15", concept: "word_problems", difficulty: 1, answer: "6",
        solution_steps: ["Write an equation for the story", "2x + 3 = 15", "Subtract 3 from both sides", "2x = 12", "Divide both sides by 2", "x = 6"],
        explanation: "Let x be the number of miles: £2 per mile is 2x, plus the £3 charge, makes £15."
    },
    {
        id: "wp_002",
        question: "Cinema tickets cost £8 each, plus a £2 booking fee for the whole order. An order cost £34. How many tickets were bought?",
        equation: "8x + 2 = 34", concept: "word_problems", difficulty: 2, answer: "4",
        solution_steps: ["Write an equation for the story", "8x + 2 = 34", "Subtract 2 from both sides", "8x = 32", "Divide both sides by 8", "x = 4"],
        explanation: "Let x be the number of tickets: 8x for the tickets plus £2 for the fee makes £34."
    },
    {
        id: "wp_003",
        question: "A plant is 5 cm tall and grows 3 cm every week. After how many weeks will it be 29 cm tall?",
        equation: "3x + 5 = 29", concept: "word_problems", difficulty: 2, answer: "8",
        solution_steps: ["Write an equation for the story", "3x + 5 = 29", "Subtract 5 from both sides", "3x = 24", "Divide both sides by 3", "x = 8"],
        explanation: "Let x be the number of weeks: it grows 3x and started at 5, making 29."
    },
    {
        id: "wp_004",
        question: "4 friends each buy a cinema ticket and a £2 snack. Altogether they spend £36. How much does one ticket cost?",
        equation: "4(x + 2) = 36", concept: "word_problems", difficulty: 3, answer: "7",
        solution_steps: ["Write an equation for the story", "4(x + 2) = 36", "Distribute 4 to both x and 2", "4x + 8 = 36", "Subtract 8 from both sides", "4x = 28", "Divide both sides by 4", "x = 7"],
        explanation: "Let x be the ticket price: each friend spends x + 2, and 4 friends spend 4(x + 2)."
    },
    {
        id: "wp_005",
        question: "Gym A charges £6 a visit. Gym B charges a £20 joining fee plus £2 a visit. After how many visits do the two gyms cost the same?",
        equation: "6x = 2x + 20", concept: "word_problems", difficulty: 3, answer: "5",
        solution_steps: ["Write an equation for the story", "6x = 2x + 20", "Subtract 2x from both sides", "4x = 20", "Divide both sides by 4", "x = 5"],
        explanation: "Let x be the number of visits: Gym A costs 6x and Gym B costs 2x + 20. Set them equal."
    },


    // ========================================================
    // INEQUALITIES
    // ========================================================

    {
        id: "iq_001", question: "Solve: x + 4 > 9", concept: "inequalities", difficulty: 1, answer: "x > 5",
        solution_steps: ["Subtract 4 from both sides", "x > 5"],
        explanation: "Solve it like an equation, keeping the sign the same way round."
    },
    {
        id: "iq_002", question: "Solve: 3x - 4 ≤ 11", concept: "inequalities", difficulty: 2, answer: "x ≤ 5",
        solution_steps: ["Add 4 to both sides", "3x ≤ 15", "Divide both sides by 3", "x ≤ 5"],
        explanation: "Dividing by 3, a positive number, keeps the sign the same way round."
    },
    {
        id: "iq_003", question: "Solve: 2x + 7 ≥ 1", concept: "inequalities", difficulty: 2, answer: "x ≥ -3",
        solution_steps: ["Subtract 7 from both sides", "2x ≥ -6", "Divide both sides by 2", "x ≥ -3"],
        explanation: "The answer can be negative; the sign only flips when you divide by a negative."
    },
    {
        id: "iq_004", question: "Solve: -2x < 8", concept: "inequalities", difficulty: 3, answer: "x > -4",
        solution_steps: ["Divide both sides by -2 and flip the sign", "x > -4"],
        explanation: "Dividing by -2, a negative number, flips the sign: < becomes >."
    },
    {
        id: "iq_005", question: "Solve: -3x + 5 ≥ 14", concept: "inequalities", difficulty: 3, answer: "x ≤ -3",
        solution_steps: ["Subtract 5 from both sides", "-3x ≥ 9", "Divide both sides by -3 and flip the sign", "x ≤ -3"],
        explanation: "Subtract 5, then divide by -3. Dividing by a negative flips ≥ to ≤."
    },


    // ========================================================
    // QUADRATICS (checked against their solutions)
    // ========================================================

    {
        id: "qd_001", question: "Solve: x² - 5x + 6 = 0", concept: "quadratics", difficulty: 1, answer: "x = 2 or x = 3",
        solution_steps: ["Factorise", "(x - 2)(x - 3) = 0", "One of the brackets must be 0", "x - 2 = 0 or x - 3 = 0", "x = 2 or x = 3"],
        explanation: "Factorise, then set each bracket to 0. There are two solutions."
    },
    {
        id: "qd_002", question: "Solve: x² + 2x - 15 = 0", concept: "quadratics", difficulty: 2, answer: "x = 3 or x = -5",
        solution_steps: ["Factorise", "(x - 3)(x + 5) = 0", "x - 3 = 0 or x + 5 = 0", "x = 3 or x = -5"],
        explanation: "Find two numbers that multiply to -15 and add to 2: 5 and -3."
    },
    {
        id: "qd_003", question: "Solve: x² = 49", concept: "quadratics", difficulty: 3, answer: "x = 7 or x = -7",
        solution_steps: ["Take the square root of both sides, remembering ±", "x = 7 or x = -7"],
        explanation: "Both 7 and -7 square to 49."
    },
    {
        id: "qd_004", question: "Solve: x² = 6x", concept: "quadratics", difficulty: 3, answer: "x = 0 or x = 6",
        solution_steps: ["Subtract 6x from both sides", "x² - 6x = 0", "Factorise", "x(x - 6) = 0", "x = 0 or x = 6"],
        explanation: "Dividing by x would lose x = 0. Move everything to one side and factorise."
    },


    // ========================================================
    // SIMULTANEOUS EQUATIONS (checked against their solution)
    // ========================================================

    {
        id: "sm_001", question: "Solve: x + y = 10 and x - y = 4", concept: "simultaneous_equations", difficulty: 2, answer: "x = 7, y = 3",
        solution_steps: ["Add the two equations to remove y", "2x = 14", "x = 7", "Substitute into the first equation", "7 + y = 10", "y = 3"],
        explanation: "Adding the equations removes y."
    },
    {
        id: "sm_002", question: "Solve: 2x + y = 11 and x + 3y = 13", concept: "simultaneous_equations", difficulty: 3, answer: "x = 4, y = 3",
        solution_steps: ["Make x the subject of the second equation", "x = 13 - 3y", "Substitute into the first equation", "2(13 - 3y) + y = 11", "26 - 5y = 11", "y = 3", "x = 4"],
        explanation: "Write x in terms of y from one equation, then substitute it into the other."
    }

];


// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get all questions.
 */
function getAllQuestions() {
    return questions;
}


/**
 * Find a question by ID.
 */
function getQuestionById(id) {
    return questions.find(question => question.id === id);
}


/**
 * Get questions belonging to a specific concept.
 */
function getQuestionsByConcept(concept) {
    return questions.filter(
        question => question.concept === concept
    );
}


/**
 * Get questions at a specific difficulty.
 */
function getQuestionsByDifficulty(difficulty) {
    return questions.filter(
        question => question.difficulty === difficulty
    );
}


/**
 * Get questions matching both concept and difficulty.
 */
function getQuestionsByConceptAndDifficulty(
    concept,
    difficulty
) {
    return questions.filter(
        question =>
            question.concept === concept &&
            question.difficulty === difficulty
    );
}


/**
 * Get a random question.
 */
function getRandomQuestion() {

    const index = Math.floor(
        Math.random() * questions.length
    );

    return questions[index];
}


/**
 * Get a random question for a concept
 * and difficulty.
 */
function getRandomQuestionForStudent(
    concept,
    difficulty
) {

    const matchingQuestions =
        getQuestionsByConceptAndDifficulty(
            concept,
            difficulty
        );

    if (matchingQuestions.length === 0) {
        return null;
    }

    const index = Math.floor(
        Math.random() * matchingQuestions.length
    );

    return matchingQuestions[index];
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    questions,
    getAllQuestions,
    getQuestionById,
    getQuestionsByConcept,
    getQuestionsByDifficulty,
    getQuestionsByConceptAndDifficulty,
    getRandomQuestion,
};
