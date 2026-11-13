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
const twinService = require("./twinService");
const { randomUUID } = require("node:crypto");


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

// Request errors are raised before anything is written, so the API can
// tell the student nothing was saved (unlike a mid-write database failure).
function requestError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.nothingSaved = true;
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


// Questions served but not yet answered. Capped so abandoned questions
// (closed tabs, skipped sessions) do not accumulate forever.
const MAX_ISSUED_QUESTIONS = 10;

function issueQuestion(student, questionId) {
    const issued = (student.issuedQuestionIds || [])
        .filter((id) => id !== questionId);
    issued.push(questionId);
    student.issuedQuestionIds = issued.slice(-MAX_ISSUED_QUESTIONS);
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

    resetToken = null,

    // How many mistakes the live step checker pointed out before submitting.
    liveHintsSeen = 0

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
    // Get student state (before analysis, so a wrong token or a
    // replayed question is rejected without paying for the LLM)
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

    // Once the server has issued questions to this student, only accept
    // answers to those questions, and score each one once. This stops a
    // student from reading the worked solution and resubmitting it.
    if (Array.isArray(student.issuedQuestionIds)) {
        if (!student.issuedQuestionIds.includes(realQuestion.id)) {
            throw requestError(
                "This question has already been answered or was not issued in this session. Load a new question.",
                409
            );
        }
        student.issuedQuestionIds =
            student.issuedQuestionIds.filter((id) => id !== realQuestion.id);
    }


    // --------------------------------------------------------
    // Analyze answer (async: may call the LLM and FastAPI)
    // --------------------------------------------------------

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
    // Valid steps that stop before solving for x: not a misconception,
    // but the feedback should name the next step.
    const incompleteSolution =
        !isCorrect &&
        analysis.misconception?.type === "incomplete_solution";
    const hasSubmittedWork =
        String(work || "").trim().length > 0;



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

    const targetPractice = student.targetedPractice;
    const targetedPracticeForAnswer = Boolean(
        targetPractice?.active && targetPractice.concept === realQuestion.concept
    );
    if (targetedPracticeForAnswer) {
        targetPractice.attempts++;
        if (analysis.misconception?.type === targetPractice.type) {
            targetPractice.targetErrors++;
        }
        if (targetPractice.attempts >= 3) {
            targetPractice.active = false;
            targetPractice.completed = true;
            targetPractice.completedAt = new Date().toISOString();
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

    let nextQuestion = null;
    if (targetedPracticeForAnswer) {
        if (targetPractice.active) {
            nextQuestion = questionService.getTargetedQuestion({
                concept: realQuestion.concept,
                usedQuestionIds: targetPractice.questionIds || []
            });
            if (nextQuestion) {
                targetPractice.questionIds.push(nextQuestion.id);
                state.recentQuestionIds.push(nextQuestion.id);
                if (state.recentQuestionIds.length > MAX_RECENT_QUESTIONS) {
                    state.recentQuestionIds.shift();
                }
            }
        } else if (targetPractice.completed) {
            nextQuestion = questionService.getNextMixedQuestion({
                recentQuestionIds: state.recentQuestionIds
            });
        }
    } else {
        nextQuestion = questionService.getNextQuestion({

            concept:
                realQuestion.concept,

            difficulty:
                state.currentDifficulty,

            recentQuestionIds:
                state.recentQuestionIds
        });
    }

    // Record the raw submission first. If this write or the progress write
    // fails, the request fails and the interface will not claim it was saved.
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
        misconceptionSource: analysis.misconception?.source ?? null,
        targetedPracticeType: targetedPracticeForAnswer
            ? targetPractice.type
            : null,
        targetedPracticeSessionId: targetPractice?.sessionId || null,
        liveHintsSeen: Math.min(Math.max(Number.parseInt(liveHintsSeen, 10) || 0, 0), 50),
        targetedPracticePhase: targetedPracticeForAnswer
            ? "focused"
            : targetPractice?.completed && targetPractice.concept === realQuestion.concept
                ? "follow_up"
                : null
    });

    if (nextQuestion) {
        issueQuestion(student, nextQuestion.id);
    }

    await studentStore.save(student);


    // ========================================================
    // RETURN STUDENT-FACING RESPONSE
    // ========================================================

    return {

        success: true,
        persisted: true,


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
                misconceptionDetected || incompleteSolution
                    ? analysis.misconception.message
                    : isCorrect
                        ? "Correct! Good work."
                        : hasSubmittedWork
                            ? "I couldn't pinpoint the error from these steps. Check each transition, or write one step per line."
                            : "Your answer is incorrect. Show your working one step per line so I can identify where it went wrong.",

            hint:
                misconceptionDetected || incompleteSolution
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

        targetedPractice: targetedPracticeForAnswer
            ? {
                type: targetPractice.type,
                label: labelMisconception(targetPractice.type),
                attempts: targetPractice.attempts,
                targetErrors: targetPractice.targetErrors,
                errorRate: Number((targetPractice.targetErrors / targetPractice.attempts).toFixed(4)),
                active: targetPractice.active,
                completed: targetPractice.completed
            }
            : null,


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

    misconceptionType = null,

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

    if (misconceptionType && !Object.hasOwn(MISCONCEPTION_LABELS, misconceptionType)) {
        throw requestError("Unsupported misconception type for targeted practice.");
    }

    if (student.targetedPractice?.active) {
        student.targetedPractice.active = false;
    }

    // --------------------------------------------------------
    // Select first question
    // --------------------------------------------------------

    const question = misconceptionType
        ? questionService.getTargetedQuestion({
            concept,
            recentQuestionIds: state.recentQuestionIds
        })
        : questionService.getNextQuestion({

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

    if (misconceptionType) {
        const priorAttempts = await attemptLogStore.listAttempts({
            studentId,
            limit: 500
        });
        const baselineRows = priorAttempts
            .filter(row => row.concept === concept)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10);
        student.targetedPractice = {
            sessionId: randomUUID(),
            type: misconceptionType,
            concept,
            startedAt: new Date().toISOString(),
            completedAt: null,
            baseline: {
                attempts: baselineRows.length,
                errors: baselineRows.filter(row =>
                    row.misconceptionDetected && row.misconceptionType === misconceptionType
                ).length
            },
            attempts: 0,
            targetErrors: 0,
            active: true,
            completed: false,
            questionIds: [question.id]
        };
    }

    issueQuestion(student, question.id);

    await studentStore.save(student);


    // --------------------------------------------------------
    // Return session
    // --------------------------------------------------------

    return {

        success: true,
        persisted: true,

        studentId,

        concept,

        difficulty:
            state.currentDifficulty,

        targetedPractice: misconceptionType
            ? {
                type: misconceptionType,
                label: labelMisconception(misconceptionType),
                attempts: 0,
                targetErrors: 0,
                active: true,
                completed: false
            }
            : null,

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

    let trendAttemptLogs = [];
    try {
        trendAttemptLogs = await attemptLogStore.listAttempts({
            studentId,
            limit: 500
        });
    } catch (_err) {
        // Historical trend data is unavailable; the profile still reports
        // cumulative counts from the student progress document.
    }

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

    const trendChronological = trendAttemptLogs.slice().sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );
    const previousTrendWindow = trendChronological.slice(-20, -10);
    const recentTrendWindow = trendChronological.slice(-10);
    const trendTypes = new Set(Object.keys(allMisconceptionsByType));
    for (const row of trendChronological) {
        if (row.misconceptionDetected && row.misconceptionType) {
            trendTypes.add(row.misconceptionType);
        }
    }
    const calculateTypeRate = (window, type) => {
        if (!window.length) return null;
        const errors = window.filter(row =>
            row.misconceptionDetected && row.misconceptionType === type
        ).length;
        return {
            errors,
            attempts: window.length,
            rate: Number((errors / window.length).toFixed(4))
        };
    };
    const misconceptionTrends = Array.from(trendTypes).map(type => {
        const previous = previousTrendWindow.length === 10
            ? calculateTypeRate(previousTrendWindow, type)
            : null;
        const recent = calculateTypeRate(recentTrendWindow, type);
        const enoughAttempts = previous !== null &&
            recentTrendWindow.length === 10;
        return {
            type,
            label: labelMisconception(type),
            status: !enoughAttempts
                ? "Not enough attempts yet"
                : recent.rate < previous.rate
                    ? "Improving"
                    : "Needs more practice",
            previous,
            recent
        };
    }).sort((a, b) => (b.recent?.errors || 0) - (a.recent?.errors || 0));

    const targetSession = student.targetedPractice || null;
    let targetedPracticeImpact = null;
    if (targetSession?.completed && targetSession.sessionId) {
        const followUpRows = trendChronological
            .filter(row => row.targetedPracticeSessionId === targetSession.sessionId &&
                row.targetedPracticePhase === "follow_up" &&
                row.concept === targetSession.concept)
            .slice(-10);
        const followUpErrors = followUpRows.filter(row =>
            row.misconceptionDetected && row.misconceptionType === targetSession.type
        ).length;
        const baseline = targetSession.baseline || { attempts: 0, errors: 0 };
        const hasComparison = baseline.attempts === 10 && followUpRows.length === 10;
        targetedPracticeImpact = {
            type: targetSession.type,
            label: labelMisconception(targetSession.type),
            concept: targetSession.concept,
            focused: {
                attempts: targetSession.attempts,
                errors: targetSession.targetErrors,
                rate: targetSession.attempts
                    ? Number((targetSession.targetErrors / targetSession.attempts).toFixed(4))
                    : null
            },
            before: baseline.attempts
                ? { attempts: baseline.attempts, errors: baseline.errors, rate: Number((baseline.errors / baseline.attempts).toFixed(4)) }
                : null,
            followUp: {
                attempts: followUpRows.length,
                errors: followUpErrors,
                rate: followUpRows.length ? Number((followUpErrors / followUpRows.length).toFixed(4)) : null
            },
            status: !hasComparison
                ? "Not enough follow-up attempts yet"
                : followUpErrors / followUpRows.length < baseline.errors / baseline.attempts
                    ? "Improving"
                    : "Needs more practice"
        };
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
            let topMistakeCount = 0;
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
                    topMistakeCount = sorted2[0][1];
                }
            } catch (_err) { /* ignore */ }

            // Build a targeted explanation
            const conceptDisplay = targetConcept
                .replace(/_/g, " ")
                .replace(/\b\w/g, c => c.toUpperCase());

            let reason;
            if (topMistakeForConcept && topMistakeCount >= 2) {
                reason =
                    `You've made a "${labelMisconception(topMistakeForConcept)}" ` +
                    `error ${topMistakeCount} times in ${conceptDisplay}. ` +
                    `Targeted practice will help fix this pattern.`;
            } else if (topMistakeForConcept) {
                reason =
                    `A "${labelMisconception(topMistakeForConcept)}" error appeared ` +
                    `once in ${conceptDisplay}. Keep practicing and StudyTwin will ` +
                    `watch whether it becomes a recurring pattern.`;
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
                topMistakeCount,
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

        misconceptionTrends,

        trendAttemptCount: trendChronological.length,

        targetedPractice: student.targetedPractice || null,

        targetedPracticeImpact,

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

    const reset = {
        complete: false,
        deletedProgress: false,
        deletedAttempts: false,
        attemptCount: null
    };

    try {
        reset.attemptCount = await attemptLogStore.deleteAttemptsForStudent(studentId);
        reset.deletedAttempts = true;
        reset.deletedProgress = await studentStore.remove(studentId);
        if (!reset.deletedProgress) {
            reset.deletedProgress = !(await studentStore.get(studentId));
        }
        reset.complete = reset.deletedAttempts && reset.deletedProgress;
        return reset;
    } catch (error) {
        error.resetResult = reset;
        throw error;
    }
}


// ============================================================
// TEACH YOUR TWIN: memory
// ============================================================

// What the twin needs to pick a lesson: its memory, and the questions the
// student has seen recently (so the twin uses a fresh problem).
async function getTwinContext(studentId) {
    const student = await studentStore.get(studentId);
    if (!student) {
        return { memory: null, recentQuestionIds: [] };
    }
    const practised = Object.values(student.concepts || {})
        .flatMap((concept) => concept.recentQuestionIds || []);
    return {
        memory: student.twin || null,
        recentQuestionIds: [
            ...new Set([...practised, ...twinService.recentTwinQuestionIds(student.twin)])
        ]
    };
}

// Save one successful teaching. Creates the student record if this browser
// has never practised, bound to its token like every other write.
async function recordTwinTeaching(studentId, resetToken, { misconceptionType, questionId }) {
    if (!studentId) {
        throw requestError("studentId is required.");
    }
    if (!resetToken) {
        throw requestError("X-Student-Token header is required.", 403);
    }

    const student = await studentStore.get(studentId) || {
        studentId,
        concepts: {},
        resetToken: null,
        schemaVersion: 1
    };
    if (student.resetToken && student.resetToken !== resetToken) {
        throw requestError("Invalid student session token.", 403);
    }
    student.resetToken = student.resetToken || resetToken;

    const result = twinService.applyTwinTeaching(student.twin, { misconceptionType, questionId });
    if (result.counted) {
        student.twin = result.memory;
        await studentStore.save(student);
    }
    return result;
}


// ============================================================
// EXPORTS
// ============================================================

// Each write reads the student record, changes it, and saves it back, so two
// overlapping writes for one student would lose an update. Queue them per
// student within this process; studentStore's revision check catches the
// cross-instance case.
const studentQueues = new Map();

function withStudentLock(studentId, task) {
    const key = String(studentId);
    const previous = studentQueues.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const settled = run.catch(() => {});
    studentQueues.set(key, settled);
    settled.then(() => {
        if (studentQueues.get(key) === settled) {
            studentQueues.delete(key);
        }
    });
    return run;
}

module.exports = {

    startSession: (args = {}) =>
        withStudentLock(args.studentId, () => startSession(args)),

    recordAnswer: (args = {}) =>
        withStudentLock(args.studentId, () => recordAnswer(args)),

    getStudentProfile,

    getConceptProfile,

    getAllQuestions,

    resetStudent: (studentId, resetToken) =>
        withStudentLock(studentId, () => resetStudent(studentId, resetToken)),

    getTwinContext,

    recordTwinTeaching: (studentId, resetToken, lesson) =>
        withStudentLock(studentId, () => recordTwinTeaching(studentId, resetToken, lesson))
};
