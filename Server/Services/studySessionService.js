// ============================================================
// StudyTwin Session Service
// ============================================================
//
// Complete adaptive learning pipeline:
//
// Student Answer
//      ↓
// Find Question
//      ↓
// Analyze Answer
//      ↓
// Detect Misconception
//      ↓
// Update Student Statistics
//      ↓
// ML Prediction
//      ↓
// Adapt Difficulty
//      ↓
// Select Next Question
//      ↓
// Return Student Feedback
//
// ============================================================

const questionService = require("./questionService");
const misconceptionService = require("./misconceptionService");
const mlService = require("./mlService");
const studentStore = require("./studentStore");
const attemptLogStore = require("./attemptLogStore");


// ============================================================
// MISCONCEPTION TYPE → HUMAN LABEL
// ============================================================

const MISCONCEPTION_LABELS = {
    failed_to_distribute: "Failed to distribute",
    sign_error: "Sign error",
    wrong_inverse_op: "Wrong inverse operation",
    one_sided_op: "One-sided operation",
    arithmetic_slip: "Arithmetic slip",
    combining_unlike_terms: "Combining unlike terms",
    invalid_transformation: "Invalid step",
    unknown_error: "Unknown error"
};

function labelMisconception(type) {
    return MISCONCEPTION_LABELS[type] || String(type || "Unknown");
}


// ============================================================
// CONSTANTS
// ============================================================

const MAX_RECENT_RESULTS = 5;
const MAX_RECENT_QUESTIONS = 5;

function requestError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}


// ============================================================
// GET / CREATE STUDENT
// ============================================================

async function getStudent(studentId, concept) {
    const student = await studentStore.get(studentId) || {
        studentId,
        concepts: {},
        resetToken: null,
        schemaVersion: 1
    };

    if (!student.concepts[concept]) {
        student.concepts[concept] = {
            attempts: 0,
            correct: 0,
            rawCorrect: 0,           // final-answer correct regardless of work quality
            recentResults: [],
            misconceptionCount: 0,
            misconceptionsByType: {},
            currentDifficulty: 1,
            previousCorrect: false,
            recentQuestionIds: []
        };
    }

    // Back-fill fields that may be absent on records written before this version.
    const s = student.concepts[concept];
    student.schemaVersion ||= 1;
    if (s.rawCorrect === undefined)          s.rawCorrect = s.correct;
    if (!s.misconceptionsByType)             s.misconceptionsByType = {};
    for (const [type, value] of Object.entries(s.misconceptionsByType)) {
        if (typeof value === "number") {
            s.misconceptionsByType[type] = {
                count: value,
                firstSeen: null,
                lastSeen: null
            };
        }
    }

    return { student, state: student.concepts[concept] };
}


// ============================================================
// CALCULATE ACCURACY
// ============================================================

function calculateAccuracy(correct, attempts) {

    if (attempts === 0) {
        return 0;
    }

    return Number(
        (correct / attempts).toFixed(4)
    );
}


// ============================================================
// CALCULATE RECENT ACCURACY
// ============================================================

function calculateRecentAccuracy(recentResults) {

    if (
        !Array.isArray(recentResults) ||
        recentResults.length === 0
    ) {
        return 0;
    }


    const total =
        recentResults.reduce(
            (sum, value) => sum + value,
            0
        );


    return Number(
        (total / recentResults.length).toFixed(4)
    );
}


// ============================================================
// NORMALIZE QUESTION
// ============================================================
//
// Frontend sends:
//
// {
//     "id": "dp_004"
// }
//
// Server retrieves the real question.
//
// ============================================================

function getQuestionFromRequest(question) {

    if (!question || !question.id) {

        throw requestError(
            "question.id is required."
        );
    }


    const realQuestion =
        questionService.findQuestionById(
            question.id
        );


    if (!realQuestion) {

        throw requestError(
            `Question not found: ${question.id}`
        );
    }


    return realQuestion;
}


// ============================================================
// RECORD STUDENT ANSWER
// ============================================================
//
// POST /api/sessions/answer
//
// Expected body:
//
// {
//     "studentId": "demo_student",
//     "question": {
//         "id": "dp_004"
//     },
//     "studentAnswer": "7",
//     "work":
//         "5x + 20 = 35\n5x = 15\nx = 3"
// }
//
// ============================================================

async function recordAnswer({

    studentId,

    question,

    studentAnswer,

    work = "",

    resetToken = null

}) {

    // --------------------------------------------------------
    // Validate student
    // --------------------------------------------------------

    if (!studentId) {

        throw requestError(
            "studentId is required."
        );
    }

    // A session token is required so that only the browser that
    // created a student record can write to it.  The token is set
    // on the first successful recordAnswer call and must match on
    // every subsequent call for the same studentId.
    if (!resetToken) {

        throw requestError(
            "X-Student-Token header is required.",
            403
        );
    }


    // --------------------------------------------------------
    // Find the real question
    // --------------------------------------------------------

    const realQuestion =
        getQuestionFromRequest(question);


    // --------------------------------------------------------
    // Analyze answer
    // --------------------------------------------------------
    //
    // IMPORTANT:
    // analyzeAnswer() is asynchronous because it calls
    // the FastAPI ML service.
    //
    // Therefore we MUST await it.
    //

    const analysis =
        await misconceptionService.analyzeAnswer({

            questionId:
                realQuestion.id,

            studentAnswer,

            work
        });


    // --------------------------------------------------------
    // Determine correctness
    // --------------------------------------------------------

    const isCorrect =
        Boolean(
            analysis.correct
        );


    // --------------------------------------------------------
    // Determine misconception
    // --------------------------------------------------------

    const misconceptionDetected =
        Boolean(
            analysis.misconception &&
            analysis.misconception.detected
        );

    const demonstratedCorrect =
        isCorrect && !misconceptionDetected;
    const hasSubmittedWork =
        String(work || "").trim().length > 0;


    // --------------------------------------------------------
    // Get student state
    // --------------------------------------------------------

    const { student, state } =
        await getStudent(
            studentId,
            realQuestion.concept
        );

    if (resetToken) {
        if (student.resetToken && student.resetToken !== resetToken) {
            throw requestError("Invalid student session token.", 403);
        }
        if (!student.resetToken) {
            student.resetToken = resetToken;
        }
    }


    // ========================================================
    // UPDATE STUDENT STATISTICS
    // ========================================================

    state.attempts++;

    // rawCorrect tracks how often the final answer matched,
    // regardless of whether the written work was valid.
    if (isCorrect) {
        state.rawCorrect = (state.rawCorrect || 0) + 1;
    }

    // correct (demonstrated mastery) only increments when
    // the answer is right AND the work has no detected error.
    if (demonstratedCorrect) {

        state.correct++;
    }


    if (misconceptionDetected) {

        state.misconceptionCount++;

        const mType = analysis.misconception?.type;
        if (mType) {
            if (!state.misconceptionsByType) state.misconceptionsByType = {};
            const now = new Date().toISOString();
            const previous = state.misconceptionsByType[mType];
            const record = typeof previous === "number"
                ? { count: previous, firstSeen: null, lastSeen: null }
                : previous || { count: 0, firstSeen: null, lastSeen: null };
            state.misconceptionsByType[mType] = {
                count: record.count + 1,
                firstSeen: record.firstSeen || now,
                lastSeen: now
            };
        }
    }


    state.previousCorrect =
        demonstratedCorrect;


    // --------------------------------------------------------
    // Store recent result
    // --------------------------------------------------------

    state.recentResults.push(
        demonstratedCorrect ? 1 : 0
    );


    if (
        state.recentResults.length >
        MAX_RECENT_RESULTS
    ) {

        state.recentResults.shift();
    }


    // --------------------------------------------------------
    // Store recent question
    // --------------------------------------------------------

    if (
        !state.recentQuestionIds.includes(
            realQuestion.id
        )
    ) {

        state.recentQuestionIds.push(
            realQuestion.id
        );
    }


    if (
        state.recentQuestionIds.length >
        MAX_RECENT_QUESTIONS
    ) {

        state.recentQuestionIds.shift();
    }

    await studentStore.save(student);


    // ========================================================
    // CALCULATE PERFORMANCE
    // ========================================================

    const correctRate =
        calculateAccuracy(
            state.correct,
            state.attempts
        );


    const recentAccuracy =
        calculateRecentAccuracy(
            state.recentResults
        );


    // ========================================================
    // SEND DATA TO ML
    // ========================================================

    let mlResult =
        await mlService.getLearningRecommendation({

            difficulty:
                realQuestion.difficulty,

            attempt_count:
                state.attempts,

            correct_rate:
                correctRate,

            recent_accuracy:
                recentAccuracy,

            misconception_count:
                state.misconceptionCount,

            previous_correct:
                state.previousCorrect ? 1 : 0,

            concept:
                realQuestion.concept
        });


    // --------------------------------------------------------
    // ML failure
    // --------------------------------------------------------

    // ML service unavailable: fall back to a simple heuristic
    // so the learning loop keeps working.

    if (!mlResult.success) {

        const heuristicProbability =
            0.6 * recentAccuracy +
            0.4 * correctRate;

        mlResult = {
            success: true,
            source: "heuristic",
            probabilityCorrect:
                heuristicProbability,
            probabilityPercent:
                Math.round(heuristicProbability * 100),
            recommendedDifficulty:
                questionService.adaptDifficulty(
                    state.currentDifficulty,
                    heuristicProbability
                ),
            recommendation:
                "Estimated from recent accuracy (ML service offline)."
        };
    }


    // ========================================================
    // UPDATE DIFFICULTY
    // ========================================================

    const previousDifficulty =
        state.currentDifficulty;


    state.currentDifficulty =
        mlResult.recommendedDifficulty;


    // ========================================================
    // SELECT NEXT QUESTION
    // ========================================================

    const nextQuestion =
        questionService.getNextQuestion({

            concept:
                realQuestion.concept,

            difficulty:
                state.currentDifficulty,

            recentQuestionIds:
                state.recentQuestionIds
        });

    await studentStore.save(student);

    try {
        await attemptLogStore.logAttempt({
            studentId,
            questionId: realQuestion.id,
            concept: realQuestion.concept,
            difficulty: realQuestion.difficulty,
            studentAnswer,
            work,
            answerCorrect: Boolean(analysis.correct),
            demonstratedCorrect,
            misconceptionDetected,
            misconceptionType: analysis.misconception?.type ?? null,
            misconceptionSource: analysis.misconception?.source ?? null
        });
    } catch (error) {
        console.error("Attempt logging failed:", error.message);
    }


    // ========================================================
    // RETURN STUDENT-FACING RESPONSE
    // ========================================================

    return {

        success: true,


        // ----------------------------------------------------
        // Answer
        // ----------------------------------------------------

        answer: {

            studentAnswer,

            correctAnswer:
                realQuestion.answer,

            correct:
                isCorrect,

            checkedBy:
                analysis.correctnessSource
        },


        // ----------------------------------------------------
        // Feedback
        // ----------------------------------------------------

        feedback: {

            correct:
                demonstratedCorrect,

            message:
                misconceptionDetected
                    ? analysis.misconception.message
                    : isCorrect
                        ? "Correct! Good work."
                        : hasSubmittedWork
                            ? "I couldn't pinpoint the error from these steps. Check each transition, or write one step per line."
                            : "Your answer is incorrect. Show your working one step per line so I can identify where it went wrong.",

            hint:
                misconceptionDetected
                    ? analysis.misconception.hint
                    : isCorrect
                        ? ""
                        : "Include each equation or operation you used, one step per line."
        },


        // ----------------------------------------------------
        // Misconception
        // ----------------------------------------------------

        misconception: {

            detected:
                misconceptionDetected,

            type:
                analysis.misconception
                    ? analysis.misconception.type
                    : null,

            concept:
                analysis.misconception
                    ? analysis.misconception.concept
                    : realQuestion.concept,

            confidence:
                analysis.misconception
                    ? analysis.misconception.confidence
                    : 0,

            message:
                analysis.misconception
                    ? analysis.misconception.message
                    : "",

            hint:
                analysis.misconception
                    ? analysis.misconception.hint
                    : "",

            incorrectStep:
                analysis.misconception
                    ? analysis.misconception.incorrectStep || null
                    : null,

            correctStep:
                analysis.misconception
                    ? analysis.misconception.correctStep || null
                    : null,

            explanation:
                analysis.misconception
                    ? analysis.misconception.explanation || null
                    : null,

            source:
                analysis.misconception
                    ? analysis.misconception.source || "rules"
                    : analysis.correctnessSource
        },


        // ----------------------------------------------------
        // Student statistics
        // ----------------------------------------------------

        student: {

            studentId,

            concept:
                realQuestion.concept,

            attempts:
                state.attempts,

            correct:
                state.correct,

            correctRate,

            recentAccuracy,

            misconceptionCount:
                state.misconceptionCount,

            previousCorrect:
                state.previousCorrect,

            currentDifficulty:
                state.currentDifficulty,

            recentQuestionIds:
                state.recentQuestionIds
        },


        // ----------------------------------------------------
        // ML adaptation
        // ----------------------------------------------------

        adaptation: {

            source:
                mlResult.source ||
                (mlResult.success === false ? "heuristic" : "ml"),

            probabilityCorrect:
                mlResult.probabilityCorrect,

            probabilityPercent:
                mlResult.probabilityPercent,

            previousDifficulty,

            recommendedDifficulty:
                state.currentDifficulty,

            recommendation:
                mlResult.recommendation
        },


        // ----------------------------------------------------
        // Solution
        // ----------------------------------------------------

        solution: {

            submittedSteps:
                String(work || "")
                    .split(/\r?\n/)
                    .map(step => step.trim())
                    .filter(Boolean),

            steps:
                realQuestion.solution_steps,

            explanation:
                realQuestion.explanation
        },


        // ----------------------------------------------------
        // Next question
        // ----------------------------------------------------

        nextQuestion:
            questionService.toStudentQuestion(nextQuestion)
    };
}


// ============================================================
// START SESSION
// ============================================================
//
// POST /api/sessions
//
// Body:
//
// {
//     "studentId": "demo_student",
//     "concept": "distributive_property",
//     "difficulty": 1
// }
//
// ============================================================

async function startSession({

    studentId,

    concept,

    difficulty = 1,

    resetToken = null

}) {

    if (!studentId) {

        throw requestError(
            "studentId is required."
        );
    }


    if (!concept) {

        throw requestError(
            "concept is required."
        );
    }


    const { student, state } =
        await getStudent(
            studentId,
            concept
        );

    if (resetToken) {
        if (student.resetToken && student.resetToken !== resetToken) {
            throw requestError("Invalid student session token.", 403);
        }
        student.resetToken = resetToken;
    }


    // --------------------------------------------------------
    // Normalize difficulty
    // --------------------------------------------------------

    const normalizedDifficulty =
        Math.min(
            3,
            Math.max(
                1,
                Math.round(
                    Number(difficulty) || 1
                )
            )
        );


    state.currentDifficulty =
        normalizedDifficulty;

    // --------------------------------------------------------
    // Select first question
    // --------------------------------------------------------

    const question =
        questionService.getNextQuestion({

            concept,

            difficulty:
                state.currentDifficulty,

            recentQuestionIds:
                state.recentQuestionIds
        });


    if (!question) {

        throw requestError(
            `No questions available for concept: ${concept}`
        );
    }

    await studentStore.save(student);


    // --------------------------------------------------------
    // Return session
    // --------------------------------------------------------

    return {

        success: true,

        studentId,

        concept,

        difficulty:
            state.currentDifficulty,

        question:
            questionService.toStudentQuestion(question)
    };
}


// ============================================================
// GET STUDENT PROFILE
// ============================================================

async function getStudentProfile(studentId) {
    const student = await studentStore.get(studentId);


    if (!student) {

        return null;
    }


    let totalAttempts = 0;

    let totalCorrect = 0;

    let totalRawCorrect = 0;

    let totalMisconceptions = 0;

    const allMisconceptionsByType = {};

    const concepts = {};


    // --------------------------------------------------------
    // Calculate each concept
    // --------------------------------------------------------

    for (
        const [concept, state]
        of Object.entries(student.concepts)
    ) {

        const accuracy =
            calculateAccuracy(
                state.correct,
                state.attempts
            );

        const rawAccuracy =
            calculateAccuracy(
                state.rawCorrect ?? state.correct,
                state.attempts
            );

        const recentAccuracy =
            calculateRecentAccuracy(
                state.recentResults
            );


        totalAttempts +=
            state.attempts;


        totalCorrect +=
            state.correct;

        totalRawCorrect +=
            state.rawCorrect ?? state.correct;

        totalMisconceptions +=
            state.misconceptionCount;


        // Aggregate misconception types across concepts.
        for (const [mType, record] of Object.entries(
            state.misconceptionsByType || {}
        )) {
            const count = typeof record === "number" ? record : record.count;
            allMisconceptionsByType[mType] =
                (allMisconceptionsByType[mType] || 0) + count;
        }


        concepts[concept] = {

            attempts:
                state.attempts,

            correct:
                state.correct,

            rawCorrect:
                state.rawCorrect ?? state.correct,

            correctRate:
                accuracy,

            rawCorrectRate:
                rawAccuracy,

            recentAccuracy,

            misconceptionCount:
                state.misconceptionCount,

            misconceptionsByType:
                state.misconceptionsByType || {},

            currentDifficulty:
                state.currentDifficulty,

            previousCorrect:
                state.previousCorrect,

            recentQuestionIds:
                state.recentQuestionIds
        };
    }


    // --------------------------------------------------------
    // Overall accuracy
    // --------------------------------------------------------

    // masteryAccuracy: correct answer + valid work (demonstrated mastery)
    const overallAccuracy =
        calculateAccuracy(
            totalCorrect,
            totalAttempts
        );

    // rawAccuracy: how often the final numerical answer was right,
    // regardless of whether the written work was valid.
    const overallRawAccuracy =
        calculateAccuracy(
            totalRawCorrect,
            totalAttempts
        );


    // --------------------------------------------------------
    // Learning level
    // --------------------------------------------------------

    let learningLevel;


    if (totalAttempts === 0) {

        learningLevel =
            "Beginning";

    } else if (overallAccuracy >= 0.80) {

        learningLevel =
            "Advanced";

    } else if (overallAccuracy >= 0.60) {

        learningLevel =
            "Developing";

    } else {

        learningLevel =
            "Beginning";
    }


    // --------------------------------------------------------
    // Recommendation
    // --------------------------------------------------------

    let recommendation;


    if (totalAttempts === 0) {

        recommendation =
            "Start practicing to build your learning profile.";

    } else if (overallAccuracy >= 0.80) {

        recommendation =
            "Student is performing strongly. Introduce harder problems and new variations.";

    } else if (overallAccuracy >= 0.60) {

        recommendation =
            "Student is developing. Continue practice while gradually increasing difficulty.";

    } else {

        recommendation =
            "Continue practicing foundational concepts with additional support.";
    }


    // --------------------------------------------------------
    // Common mistakes — derived from persisted misconceptionsByType
    // in the student record (fast, always available).
    // Falls back to querying the attempt log if the field is absent
    // on older records written before this schema version.
    // --------------------------------------------------------

    let commonMistakes = [];

    if (Object.keys(allMisconceptionsByType).length > 0) {
        const conceptsByType = {};
        for (const [concept, state] of Object.entries(student.concepts)) {
            for (const [type, record] of Object.entries(
                state.misconceptionsByType || {}
            )) {
                const count = typeof record === "number" ? record : record.count;
                conceptsByType[type] ||= {};
                conceptsByType[type][concept] =
                    (conceptsByType[type][concept] || 0) + count;
            }
        }

        commonMistakes = Object.entries(allMisconceptionsByType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type, count]) => {
                const conceptCounts = Object.entries(conceptsByType[type] || {})
                    .sort((a, b) => b[1] - a[1]);
                return {
                    type,
                    label: labelMisconception(type),
                    count,
                    concept: conceptCounts[0]?.[0] || null
                };
            });
    } else {
        // Legacy fallback — scan the attempt log.
        try {
            const recentLogs =
                await attemptLogStore.listAttempts({
                    studentId,
                    limit: 200
                });

            const mistakeCount = {};

            for (const row of recentLogs) {
                if (
                    row.misconceptionDetected &&
                    row.misconceptionType
                ) {
                    const summary = mistakeCount[row.misconceptionType] || {
                        count: 0,
                        concepts: {}
                    };
                    summary.count++;
                    if (row.concept) {
                        summary.concepts[row.concept] =
                            (summary.concepts[row.concept] || 0) + 1;
                    }
                    mistakeCount[row.misconceptionType] = summary;
                }
            }

            commonMistakes = Object.entries(mistakeCount)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 3)
                .map(([type, summary]) => ({
                    type,
                    label: labelMisconception(type),
                    count: summary.count,
                    concept: Object.entries(summary.concepts)
                        .sort((a, b) => b[1] - a[1])[0]?.[0] || null
                }));

        } catch (_err) {
            // Attempt log unavailable — return empty list gracefully.
        }
    }


    // --------------------------------------------------------
    // Weakest concepts (ranked by accuracy ascending)
    // Only include concepts with at least one attempt.
    // --------------------------------------------------------

    const weakestConcepts = Object.entries(concepts)
        .filter(([, c]) => c.attempts > 0)
        .sort((a, b) => a[1].correctRate - b[1].correctRate)
        .map(([concept, c]) => ({
            concept,
            correctRate: c.correctRate,
            accuracyPercent: Math.round(c.correctRate * 100),
            misconceptionCount: c.misconceptionCount,
            currentDifficulty: c.currentDifficulty
        }));


    // --------------------------------------------------------
    // Recent attempts (last 5 logged submissions)
    // --------------------------------------------------------

    let recentAttempts = [];

    try {
        const logs = await attemptLogStore.listAttempts({
            studentId,
            limit: 5
        });

        // listAttempts returns newest-first from MongoDB,
        // oldest-first from memory. Normalise to newest-first.
        const sorted = logs.slice().sort(
            (a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
        );

        recentAttempts = sorted.slice(0, 5).map(row => ({
            questionId: row.questionId,
            concept: row.concept,
            difficulty: row.difficulty,
            answerCorrect: row.answerCorrect,
            demonstratedCorrect: row.demonstratedCorrect,
            misconceptionDetected: row.misconceptionDetected,
            misconceptionType: row.misconceptionType
                ? labelMisconception(row.misconceptionType)
                : null,
            createdAt: row.createdAt
        }));

    } catch (_err) {
        // Attempt log unavailable — return empty list gracefully
    }


    // --------------------------------------------------------
    // Next learning step
    // Pick the concept with the lowest recent accuracy (most
    // urgent need), then decide whether to hold/increase its
    // difficulty or focus on correcting a recurring error.
    // --------------------------------------------------------

    let nextLearningStep = null;

    if (totalAttempts > 0) {

        // The concept that needs the most work right now is
        // the one with the lowest recent accuracy (or, among
        // ties, the most misconceptions).
        const sortedByNeed = Object.entries(concepts)
            .filter(([, c]) => c.attempts > 0)
            .sort((a, b) => {
                const aRA = a[1].recentAccuracy;
                const bRA = b[1].recentAccuracy;
                if (Math.abs(aRA - bRA) > 0.001) return aRA - bRA;
                return b[1].misconceptionCount - a[1].misconceptionCount;
            });

        if (sortedByNeed.length > 0) {
            const [targetConcept, targetState] =
                sortedByNeed[0];

            // Find the most common recurring error for this concept
            let topMistakeForConcept = null;
            try {
                const conceptLogs = await attemptLogStore.listAttempts({
                    studentId,
                    limit: 200
                });
                const typeCounts = {};
                for (const row of conceptLogs) {
                    if (row.concept === targetConcept &&
                        row.misconceptionDetected && row.misconceptionType) {
                        typeCounts[row.misconceptionType] =
                            (typeCounts[row.misconceptionType] || 0) + 1;
                    }
                }
                const persistedCounts =
                    targetState.misconceptionsByType || {};
                for (const [type, record] of Object.entries(persistedCounts)) {
                    typeCounts[type] = typeof record === "number"
                        ? record
                        : record.count;
                }
                const sorted2 = Object.entries(typeCounts)
                    .sort((a, b) => b[1] - a[1]);
                if (sorted2.length > 0) {
                    topMistakeForConcept = sorted2[0][0];
                }
            } catch (_err) { /* ignore */ }

            // Build a targeted explanation
            const conceptDisplay = targetConcept
                .replace(/_/g, " ")
                .replace(/\b\w/g, c => c.toUpperCase());

            let reason;
            if (topMistakeForConcept) {
                reason =
                    `You've made a "${labelMisconception(topMistakeForConcept)}" ` +
                    `error multiple times in ${conceptDisplay}. ` +
                    `Targeted practice will help fix this pattern.`;
            } else if (targetState.recentAccuracy < 0.5) {
                reason =
                    `Your recent accuracy in ${conceptDisplay} ` +
                    `(${Math.round(targetState.recentAccuracy * 100)}%) ` +
                    `indicates it needs more practice.`;
            } else {
                reason =
                    `Continuing practice on ${conceptDisplay} will ` +
                    `help consolidate your understanding before moving on.`;
            }

            nextLearningStep = {
                concept: targetConcept,
                conceptDisplay,
                recommendedDifficulty:
                    targetState.currentDifficulty,
                reason,
                topMistakeType: topMistakeForConcept,
                topMistakeLabel: topMistakeForConcept
                    ? labelMisconception(topMistakeForConcept)
                    : null
            };
        }
    }


    // --------------------------------------------------------
    // Return profile
    // --------------------------------------------------------

    return {

        studentId,

        learningLevel,

        overall: {

            attempts:
                totalAttempts,

            correct:
                totalCorrect,

            rawCorrect:
                totalRawCorrect,

            accuracy:
                overallAccuracy,

            accuracyPercent:
                Number(
                    (
                        overallAccuracy * 100
                    ).toFixed(2)
                ),

            // Final-answer accuracy (answer matched regardless of work).
            rawAccuracy:
                overallRawAccuracy,

            rawAccuracyPercent:
                Number(
                    (
                        overallRawAccuracy * 100
                    ).toFixed(2)
                ),

            misconceptionCount:
                totalMisconceptions,

            misconceptionsByType:
                allMisconceptionsByType
        },

        concepts,

        recommendation,

        // Extended dashboard fields
        commonMistakes,

        weakestConcepts,

        recentAttempts,

        nextLearningStep
    };
}


// ============================================================
// GET CONCEPT PROFILE
// ============================================================

async function getConceptProfile(
    studentId,
    concept
) {
    const student = await studentStore.get(studentId);


    if (!student) {

        return null;
    }


    const state =
        student.concepts[concept];


    if (!state) {

        return null;
    }


    const accuracy =
        calculateAccuracy(
            state.correct,
            state.attempts
        );

    const rawAccuracy =
        calculateAccuracy(
            state.rawCorrect ?? state.correct,
            state.attempts
        );


    const recentAccuracy =
        calculateRecentAccuracy(
            state.recentResults
        );


    return {

        studentId,

        concept,

        attempts:
            state.attempts,

        correct:
            state.correct,

        rawCorrect:
            state.rawCorrect ?? state.correct,

        correctRate:
            accuracy,

        rawCorrectRate:
            rawAccuracy,

        recentAccuracy,

        misconceptionCount:
            state.misconceptionCount,

        misconceptionsByType:
            state.misconceptionsByType || {},

        currentDifficulty:
            state.currentDifficulty,

        previousCorrect:
            state.previousCorrect,

        recentQuestionIds:
            state.recentQuestionIds
    };
}


// ============================================================
// GET ALL QUESTIONS
// ============================================================

function getAllQuestions() {

    return questionService.getAll();
}


// ============================================================
// RESET STUDENT
// ============================================================

async function resetStudent(studentId, resetToken) {
    if (!resetToken) {
        return false;
    }

    const student = await studentStore.get(studentId);

    if (!student || !student.resetToken || student.resetToken !== resetToken) {
        return false;
    }

    return studentStore.remove(studentId);
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    startSession,

    recordAnswer,

    getStudentProfile,

    getConceptProfile,

    getAllQuestions,

    resetStudent
};