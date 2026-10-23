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
