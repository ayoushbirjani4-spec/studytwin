
// ============================================================
// StudyTwin Question Service
// ============================================================
//
// Responsible for:
// 1. Finding questions by concept
// 2. Finding questions by difficulty
// 3. Selecting a question for a student
// 4. Adapting difficulty based on ML probability
// 5. Avoiding recently answered questions
//
// Difficulty:
// 1 = Easy
// 2 = Medium
// 3 = Hard
//
// ============================================================

const {
    questions,
    getQuestionById: getQuestionByIdFromData,
    getQuestionsByConcept,
    getQuestionsByDifficulty,
    getQuestionsByConceptAndDifficulty
} = require("../data/questions");


// ============================================================
// CONSTANTS
// ============================================================

const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 3;


// ============================================================
// VALIDATE / NORMALIZE DIFFICULTY
// ============================================================

function normalizeDifficulty(difficulty) {

    const value = Number(difficulty);

    if (Number.isNaN(value)) {
        return MIN_DIFFICULTY;
    }

    return Math.min(
        MAX_DIFFICULTY,
        Math.max(
            MIN_DIFFICULTY,
            Math.round(value)
        )
    );
}


// ============================================================
// GET QUESTIONS FOR CONCEPT
// ============================================================

function getConceptQuestions(concept) {

    if (!concept) {
        return [];
    }

    return getQuestionsByConcept(concept);
}


// ============================================================
// GET QUESTIONS FOR CONCEPT + DIFFICULTY
// ============================================================

function getTargetQuestions(
    concept,
    difficulty
) {

    const normalizedDifficulty =
        normalizeDifficulty(difficulty);

    return getQuestionsByConceptAndDifficulty(
        concept,
        normalizedDifficulty
    );
}


// ============================================================
// REMOVE RECENTLY ANSWERED QUESTIONS
// ============================================================
//
// Example:
//
// recentQuestionIds = [
//     "dp_001",
//     "dp_003",
//     "dp_005"
// ]
//
// These questions will be excluded from the candidates.
//
// ============================================================

function removeRecentQuestions(
    questionList,
    recentQuestionIds = []
) {

    if (!Array.isArray(questionList)) {
        return [];
    }

    if (!Array.isArray(recentQuestionIds)) {
        return questionList;
    }

    const recentIds =
        new Set(recentQuestionIds);

    return questionList.filter(
        question =>
            !recentIds.has(question.id)
    );
}


// ============================================================
// RANDOM QUESTION
// ============================================================

function chooseRandomQuestion(questionList) {

    if (
        !questionList ||
        questionList.length === 0
    ) {
        return null;
    }

    const randomIndex =
        Math.floor(
            Math.random() *
            questionList.length
        );

    return questionList[randomIndex];
}


// ============================================================
// GET NEXT QUESTION
// ============================================================
//
// Selection priority:
//
// 1. Requested difficulty + unused question
// 2. Any difficulty + unused question
// 3. Any question if everything was recently used
//
// ============================================================

function getNextQuestion({
    concept,
    difficulty = 1,
    recentQuestionIds = []
}) {

    if (!concept) {

        throw new Error(
            "Concept is required to select a question."
        );
    }

    const normalizedDifficulty =
        normalizeDifficulty(difficulty);


    // --------------------------------------------------------
    // STEP 1
    // Exact difficulty + not recently answered
    // --------------------------------------------------------

    let candidates =
        removeRecentQuestions(

            getTargetQuestions(
                concept,
                normalizedDifficulty
            ),

            recentQuestionIds
        );


    // --------------------------------------------------------
    // STEP 2
    // Any difficulty + not recently answered
    // --------------------------------------------------------

    if (candidates.length === 0) {

        candidates =
            removeRecentQuestions(

                getConceptQuestions(
                    concept
                ),

                recentQuestionIds
            );
    }


    // --------------------------------------------------------
    // STEP 3
    // Allow repetition if necessary
    // --------------------------------------------------------

    if (candidates.length === 0) {

        candidates =
            getConceptQuestions(
                concept
            );
    }


    // --------------------------------------------------------
    // No questions for this concept
    // --------------------------------------------------------

    if (candidates.length === 0) {

        return null;
    }


    // --------------------------------------------------------
    // Select random question
    // --------------------------------------------------------

    return chooseRandomQuestion(
        candidates
    );
}


// ============================================================
// ADAPT DIFFICULTY USING ML PROBABILITY
// ============================================================
//
// probabilityCorrect:
//
// 0.00 - 0.39
// → Student likely struggling
// → Decrease difficulty
//
// 0.40 - 0.75
// → Appropriate challenge
// → Keep difficulty
//
// 0.76 - 1.00
// → Student likely finding it easy
// → Increase difficulty
//
// ============================================================

function adaptDifficulty(
    currentDifficulty,
    probabilityCorrect
) {

    let difficulty =
        normalizeDifficulty(
            currentDifficulty
        );

    const probability =
        Number(probabilityCorrect);


    // --------------------------------------------------------
    // Invalid probability
    // --------------------------------------------------------

    if (
        Number.isNaN(probability) ||
        probability < 0 ||
        probability > 1
    ) {

        return difficulty;
    }


    // --------------------------------------------------------
    // Student is struggling
    // --------------------------------------------------------

    if (probability < 0.40) {

        difficulty =
            Math.max(
                MIN_DIFFICULTY,
                difficulty - 1
            );
    }


    // --------------------------------------------------------
    // Student is succeeding easily
    // --------------------------------------------------------

    else if (probability > 0.75) {

        difficulty =
            Math.min(
                MAX_DIFFICULTY,
                difficulty + 1
            );
    }


    return difficulty;
}


// ============================================================
// GET ADAPTIVE QUESTION
// ============================================================
//
// ML probability
//       ↓
// Difficulty adaptation
//       ↓
// Question selection
//
// ============================================================

function getAdaptiveQuestion({
    concept,
    currentDifficulty = 1,
    probabilityCorrect = null,
    recentQuestionIds = []
}) {

    if (!concept) {

        throw new Error(
            "Concept is required."
        );
    }


    // --------------------------------------------------------
    // Current difficulty
    // --------------------------------------------------------

    const previousDifficulty =
        normalizeDifficulty(
            currentDifficulty
        );


    let nextDifficulty =
        previousDifficulty;


    // --------------------------------------------------------
    // Apply ML recommendation
    // --------------------------------------------------------

    if (
        probabilityCorrect !== null &&
        probabilityCorrect !== undefined
    ) {

        nextDifficulty =
            adaptDifficulty(
                previousDifficulty,
                probabilityCorrect
            );
    }


    // --------------------------------------------------------
    // Select question
    // --------------------------------------------------------

    const question =
        getNextQuestion({

            concept,

            difficulty:
                nextDifficulty,

            recentQuestionIds

        });


    // --------------------------------------------------------
    // Return decision
    // --------------------------------------------------------

    return {

        question,

        previousDifficulty,

        probabilityCorrect,

        recommendedDifficulty:
            nextDifficulty
    };
}


// ============================================================
// GET QUESTION BY ID
// ============================================================
//
// IMPORTANT:
// misconceptionService.js uses:
//
// questionService.getQuestionById(id)
//
// So this function must exist in the exported API.
//
// ============================================================

function getQuestionById(id) {

    if (!id) {
        return null;
    }

    return getQuestionByIdFromData(id);
}


// ============================================================
// BACKWARD-COMPATIBILITY ALIAS
// ============================================================
//
// Some code may use:
//
// findQuestionById()
//
// Keep it working too.
//
// ============================================================

function findQuestionById(id) {

    return getQuestionById(id);
}


// ============================================================
// STUDENT-FACING QUESTION
// ============================================================

function toStudentQuestion(question) {

    if (!question) {
        return null;
    }

    return {
        id: question.id,
        question: question.question,
        concept: question.concept,
        difficulty: question.difficulty
    };
}


// ============================================================
// GET ALL QUESTIONS
// ============================================================

function getAll() {

    return questions.map(toStudentQuestion);
}


// ============================================================
// GET AVAILABLE CONCEPTS
// ============================================================

function getConcepts() {

    const concepts = [
        ...new Set(
            questions.map(
                question =>
                    question.concept
            )
        )
    ];

    return concepts;
}


// ============================================================
// GET AVAILABLE DIFFICULTIES
// ============================================================

function getDifficulties() {

    return [

        {
            value: 1,
            name: "Easy"
        },

        {
            value: 2,
            name: "Medium"
        },

        {
            value: 3,
            name: "Hard"
        }

    ];
}


// ============================================================
// GET QUESTION STATISTICS
// ============================================================
//
// Useful later for the dashboard.
//
// ============================================================

function getQuestionStats() {

    const total =
        questions.length;


    const byDifficulty = {

        easy: 0,

        medium: 0,

        hard: 0

    };


    const byConcept = {};


    questions.forEach(
        question => {

            // Difficulty

            if (
                question.difficulty === 1
            ) {

                byDifficulty.easy++;

            } else if (
                question.difficulty === 2
            ) {

                byDifficulty.medium++;

            } else if (
                question.difficulty === 3
            ) {

                byDifficulty.hard++;
            }


            // Concept

            if (
                !byConcept[question.concept]
            ) {

                byConcept[
                    question.concept
                ] = 0;
            }


            byConcept[
                question.concept
            ]++;
        }
    );


    return {

        total,

        byDifficulty,

        byConcept

    };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    // Question selection

    getNextQuestion,

    getAdaptiveQuestion,

    adaptDifficulty,


    // Question lookup

    getQuestionById,

    findQuestionById,

    toStudentQuestion,


    // Question filtering

    getConceptQuestions,

    getTargetQuestions,


    // Question information

    getAll,

    getConcepts,

    getDifficulties,

    getQuestionStats,


    // Utility

    normalizeDifficulty,

    removeRecentQuestions

};
