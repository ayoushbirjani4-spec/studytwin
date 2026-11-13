
// ============================================================
// StudyTwin API Server
// ============================================================
//
// Architecture:
//
// Frontend
//    ↓
// Express API
//    ↓
// Study Session Service
//    ↓
// ML Service + Question Service
//
// ============================================================

const express = require("express");
const cors = require("cors");
const path = require("node:path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const questionService = require("./Services/questionService");
const mlService = require("./Services/mlService");
const studySessionService = require("./Services/studySessionService");
const misconceptionService = require("./Services/misconceptionService");
const twinService = require("./Services/twinService");
const studentStore = require("./Services/studentStore");
const attemptLogStore = require("./Services/attemptLogStore");
const { createAnswerRateLimiter } = require("./middleware/rateLimit");
const { serviceStatus } = require("./middleware/serviceErrors");

const answerRateLimiter = createAnswerRateLimiter();

// Live step checks fire as the student types (debounced in the browser),
// so they get a higher, separate budget from answer submissions.
const stepCheckRateLimiter = createAnswerRateLimiter({
    perMinute: 120,
    perDay: 3000
});
const MAX_LIVE_WORK_LENGTH = 2000;


// ============================================================
// APP CONFIGURATION
// ============================================================

const app = express();

const trustedProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || "0", 10);
app.set("trust proxy", Number.isInteger(trustedProxyHops) && trustedProxyHops > 0
    ? trustedProxyHops
    : false);

const port =
    Number(process.env.PORT) || 3000;


// ============================================================
// MIDDLEWARE
// ============================================================

const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
);
app.use(cors({
    origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
    }
}));

app.use(express.json());

// Serve the frontend so the tunnel URL opens the app directly.
// This must come after express.json() but before the API routes
// so that /api/* paths are not matched by the static handler.
app.use(express.static(path.join(__dirname, "..", "frontend")));


// ============================================================
// BASIC ROUTES
// ============================================================

app.get("/", (req, res) => {

    // express.static will serve index.html for "/"; this handler
    // is only reached when the frontend folder is missing.
    res.json({
        name: "StudyTwin API",
        status: "running"
    });

});


// /api/health is the same check under /api, the only path Vercel routes to
// the API (see api/index.js); the frontend uses it.
app.get(["/health", "/api/health"], (req, res) => {

    res.json({
        status: "healthy",
        service: "studytwin-server"
    });

});


// ============================================================
// QUESTION ROUTES
// ============================================================

// Get all questions

app.get("/api/questions", (req, res) => {

    try {

        res.json(
            studySessionService.getAllQuestions
                ? studySessionService.getAllQuestions()
                : questionService.getAll()
        );

    } catch (error) {

        console.error(
            "Question error:",
            error
        );

        res.status(500).json({

            success: false,

            error:
                "Unable to retrieve questions."
        });

    }

});


// ============================================================
// GET AVAILABLE CONCEPTS
// ============================================================

app.get("/api/questions/concepts", (req, res) => {

    try {

        res.json({
            success: true,
            concepts: questionService.getConcepts()
        });

    } catch (error) {

        console.error("Concepts error:", error);

        res.status(500).json({
            success: false,
            error: "Unable to retrieve concepts."
        });

    }

});


// ============================================================
// ML HEALTH
// ============================================================

app.get(
    "/api/ml/health",
    async (req, res) => {

        try {

            const result =
                await mlService.checkMLHealth();

            res.json(result);

        } catch (error) {

            console.error(
                "ML health error:",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    "Unable to check ML service."
            });

        }

    }
);


// ============================================================
// START STUDY SESSION
// ============================================================
//
// POST /api/sessions
//
// Body:
//
// {
//     "studentId": "demo_student",
//     "concept": "distributive_property",
//     "difficulty": 2
// }
//
// ============================================================

app.post(
    "/api/sessions",
    async (req, res) => {

        try {
            const resetToken = req.get("X-Student-Token");
            if (!resetToken) {
                return res.status(403).json({
                    success: false,
                    error: "X-Student-Token header is required."
                });
            }

            const result =
                await studySessionService.startSession(
                    {
                        ...req.body,
                        resetToken
                    }
                );

            res.json(result);

        } catch (error) {

            console.error(
                "Start session error:",
                error
            );

            const statusCode = serviceStatus(error);
            res.status(statusCode).json({

                success: false,

                error: statusCode < 500
                    ? error.message
                    : statusCode === 503
                        ? "The session could not be saved because the database is unavailable."
                        : "Unable to start a study session.",
                persisted: false
            });

        }

    }
);


// ============================================================
// RECORD STUDENT ANSWER
// ============================================================
//
// POST /api/sessions/answer
//
// Body:
//
// {
//     "studentId": "demo_student",
//     "question": {
//         "id": "dp_004",
//         "concept": "distributive_property",
//         "difficulty": 2
//     },
//     "isCorrect": true,
//     "misconception": false
// }
//
// ============================================================

app.post(
    "/api/sessions/answer",
    answerRateLimiter,
    async (req, res) => {

        try {

            const resetToken = req.get("X-Student-Token");

            const result =
                await studySessionService.recordAnswer({
                    ...req.body,
                    resetToken
                });

            res.json(result);

        } catch (error) {

            console.error(
                "Answer error:",
                error
            );

            // Distinguish infrastructure errors from validation errors.
            // If MongoDB (or a required service) is unavailable, return
            // 503 so the frontend can show a meaningful message instead
            // of presenting it as a student input error.
            const statusCode =
                serviceStatus(error);

            res.status(statusCode).json({

                success: false,

                error: statusCode < 500
                    ? error.message
                    : statusCode === 503
                        ? "We could not confirm that your answer and progress were fully saved. The submission may be partially recorded; check your profile before retrying."
                        : "Unable to process or save your answer.",

                persisted: false,
                persistenceState: error.nothingSaved
                    ? "not_saved"
                    : "unconfirmed"
            });

        }

    }
);


// ============================================================
// LIVE STEP CHECK
// ============================================================
//
// POST /api/steps/check   { questionId, work }
//
// Checks each written line against the previous one while the student
// types. Rule-based only; reads no student data and saves nothing.
//
// ============================================================

app.post(
    "/api/steps/check",
    stepCheckRateLimiter,
    (req, res) => {
        const { questionId, work } = req.body || {};

        if (typeof questionId !== "string" || typeof work !== "string") {
            return res.status(400).json({
                success: false,
                error: "questionId and work must be strings."
            });
        }

        if (work.length > MAX_LIVE_WORK_LENGTH) {
            return res.status(400).json({
                success: false,
                error: "Working is too long to check live."
            });
        }

        try {
            const result = misconceptionService.checkSteps({ questionId, work });
            if (!result) {
                return res.status(404).json({
                    success: false,
                    error: "Question not found."
                });
            }
            res.json({ success: true, ...result });
        } catch (error) {
            console.error("Step check error:", error);
            res.status(500).json({
                success: false,
                error: "Unable to check these steps."
            });
        }
    }
);


// ============================================================
// TEACH YOUR TWIN
// ============================================================
//
// POST /api/twin/lesson  { studentId?, misconceptionType?, concept?, excludeQuestionIds? }
//   The twin's worked solution with one mistake. Without a misconceptionType
//   it uses the student's most frequent mistake (needs their X-Student-Token).
//   The mistake's position is never sent, so the browser cannot reveal it.
//
// POST /api/twin/check   { questionId, misconceptionType, chosenIndex, correctedLine }
//   Grades the student's teaching: did they find the wrong line, and does
//   their corrected line follow validly from the line before it? The lesson
//   is rebuilt on the server (it is deterministic), so nothing is stored.
//
// ============================================================

const DEFAULT_TWIN_MISCONCEPTION = "failed_to_distribute";
const MAX_TWIN_LINE_LENGTH = 200;

app.post(
    "/api/twin/lesson",
    stepCheckRateLimiter,
    async (req, res) => {
        try {
            const {
                studentId,
                misconceptionType,
                concept,
                excludeQuestionIds
            } = req.body || {};

            let type = misconceptionType;
            let lessonConcept = typeof concept === "string" ? concept : null;
            let personalised = false;
            let reviewing = false;
            let mistakes = [];
            let memory = null;
            const exclude = Array.isArray(excludeQuestionIds)
                ? excludeQuestionIds.filter((id) => typeof id === "string").slice(0, 50)
                : [];

            // The student's own mistakes and the twin's memory of them.
            if (typeof studentId === "string" && studentId) {
                const allowed = await verifyStudentToken(req, res, studentId);
                if (!allowed) {
                    return;
                }
                const [profile, twinContext] = await Promise.all([
                    studySessionService.getStudentProfile(studentId),
                    studySessionService.getTwinContext(studentId)
                ]);
                mistakes = profile?.commonMistakes || [];
                memory = twinContext.memory;
                // Fresh problems: not ones just practised or recently taught.
                exclude.push(...twinContext.recentQuestionIds);

                if (!type) {
                    const choice = twinService.chooseTwinMisconception(mistakes, memory);
                    if (choice) {
                        type = choice.type;
                        lessonConcept = lessonConcept || choice.concept;
                        reviewing = choice.reviewing;
                        personalised = true;
                    }
                }
            }

            if (!twinService.TWIN_MISCONCEPTIONS.includes(type)) {
                type = DEFAULT_TWIN_MISCONCEPTION;
            }

            const lesson = twinService.findTwinLesson({
                misconceptionType: type,
                concept: lessonConcept,
                excludeQuestionIds: exclude
            });

            if (!lesson) {
                return res.status(404).json({
                    success: false,
                    error: "No twin lesson fits this mistake yet."
                });
            }

            // Never send the answer key to the browser.
            const { wrongIndex, twinAnswer, correctAnswer, ...publicLesson } = lesson;

            res.json({
                success: true,
                personalised,
                reviewing,
                progress: personalised
                    ? twinService.summariseTwinProgress(mistakes, memory, type)
                    : null,
                lesson: { ...publicLesson, twinAnswer }
            });

        } catch (error) {
            console.error("Twin lesson error:", error);
            const statusCode = serviceStatus(error);
            res.status(statusCode).json({
                success: false,
                error: statusCode === 503
                    ? "Your progress is unavailable right now, so the twin can't be personalised."
                    : "Unable to create a twin lesson."
            });
        }
    }
);


// The student's corrected line must follow validly from the line before
// the twin's mistake, and actually move on from it.
function gradeTwinCorrection(questionId, previousLine, correctedLine) {
    const corrected = String(correctedLine || "").trim();
    if (!corrected || corrected.length > MAX_TWIN_LINE_LENGTH) {
        return false;
    }

    const normalize = (line) => String(line).replace(/\s+/g, "").toLowerCase();
    if (normalize(corrected) === normalize(previousLine)) {
        return false;
    }

    const check = misconceptionService.checkSteps({
        questionId,
        work: `${previousLine}\n${corrected}`
    });
    const verdict = check?.steps?.[check.steps.length - 1];

    if (verdict?.status === "valid") {
        return true;
    }
    // A final "x = 4" line is never judged by the live checker (so answers
    // can't be guessed there); here the answer key is ours, so compare directly.
    if (verdict?.status === "final") {
        return misconceptionService.equationsEquivalent(previousLine, corrected);
    }
    return false;
}

const TWIN_REPLIES = {
    wrongLine: "Hmm, I think that line is fine. Can you look again?",
    fixed: "Oh! I see what I did wrong. Thanks for teaching me!",
    learned: "I've got it now! You taught me so well that I won't make that mistake again.",
    notFixed: "That's the line I got wrong, but I'm still confused. Can you show me the right step?",
    foundOnly: "You're right, that's where I went wrong! How should that line look?"
};

app.post(
    "/api/twin/check",
    stepCheckRateLimiter,
    async (req, res) => {
        const {
            studentId,
            questionId,
            misconceptionType,
            chosenIndex,
            correctedLine
        } = req.body || {};

        if (typeof questionId !== "string" || typeof misconceptionType !== "string") {
            return res.status(400).json({
                success: false,
                error: "questionId and misconceptionType are required."
            });
        }

        const question = questionService.findQuestionById(questionId);
        const lesson = twinService.buildTwinSolution(question, misconceptionType);
        if (!lesson) {
            return res.status(404).json({
                success: false,
                error: "That twin lesson was not found."
            });
        }

        const foundMistake = Number(chosenIndex) === lesson.wrongIndex;
        const hasCorrection = typeof correctedLine === "string" && correctedLine.trim() !== "";
        const fixedIt = foundMistake && hasCorrection &&
            gradeTwinCorrection(questionId, lesson.lines[lesson.wrongIndex - 1], correctedLine);

        // Remember the teaching. A storage problem must not cost the student
        // their result, so failures are reported, not thrown.
        let memory = null;
        if (fixedIt && typeof studentId === "string" && studentId) {
            try {
                const recorded = await studySessionService.recordTwinTeaching(
                    studentId,
                    req.get("X-Student-Token"),
                    { misconceptionType, questionId }
                );
                memory = {
                    remembered: true,
                    counted: recorded.counted,
                    justLearned: recorded.justLearned,
                    taught: Math.min(recorded.memory.taught[misconceptionType] || 0, twinService.LEARN_THRESHOLD),
                    needed: twinService.LEARN_THRESHOLD
                };
            } catch (error) {
                console.error("Twin memory error:", error.message);
                memory = { remembered: false };
            }
        }

        res.json({
            success: true,
            foundMistake,
            fixedIt,
            // Revealed only once the student has taught the twin successfully.
            mistakeIndex: fixedIt ? lesson.wrongIndex : null,
            correctAnswer: fixedIt ? lesson.correctAnswer : null,
            memory,
            twinSays: !foundMistake
                ? TWIN_REPLIES.wrongLine
                : fixedIt
                    ? (memory?.justLearned ? TWIN_REPLIES.learned : TWIN_REPLIES.fixed)
                    : hasCorrection
                        ? TWIN_REPLIES.notFixed
                        : TWIN_REPLIES.foundOnly
        });
    }
);


// ============================================================
// GET STUDENT PROFILE
// ============================================================
//
// GET /api/sessions/profile/:studentId
//
// Example:
//
// /api/sessions/profile/demo_profile
//
// ============================================================

app.get(
    "/api/sessions/profile/:studentId",
    async (req, res) => {

        try {

            const allowed =
                await verifyStudentToken(
                    req,
                    res,
                    req.params.studentId
                );

            if (!allowed) return;

            const profile =
                await studySessionService.getStudentProfile(
                    req.params.studentId
                );


            if (!profile) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Student not found."
                });

            }


            return res.json({

                success: true,

                profile

            });

        } catch (error) {

            console.error(
                "Profile error:",
                error
            );

            const statusCode = serviceStatus(error);
            return res.status(statusCode).json({

                success: false,

                error:
                    statusCode === 503
                        ? "The student profile is temporarily unavailable because the database is unavailable."
                        : "Unable to retrieve student profile."
            });

        }

    }
);


// ============================================================
// GET STUDENT CONCEPT PROFILE
// ============================================================
//
// GET:
//
// /api/sessions/profile/:studentId/:concept
//
// Example:
//
// /api/sessions/profile/demo_profile/distributive_property
//
// ============================================================

app.get(
    "/api/sessions/profile/:studentId/:concept",
    async (req, res) => {

        try {
            const allowed =
                await verifyStudentToken(
                    req,
                    res,
                    req.params.studentId
                );

            if (!allowed) return;

            const profile =
                await studySessionService.getConceptProfile(
                    req.params.studentId,
                    req.params.concept
                );


            if (!profile) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Student or concept not found."
                });

            }


            return res.json({

                success: true,

                profile

            });

        } catch (error) {

            console.error(
                "Concept profile error:",
                error
            );

            const statusCode = serviceStatus(error);
            return res.status(statusCode).json({

                success: false,

                error:
                    statusCode === 503
                        ? "The concept profile is temporarily unavailable because the database is unavailable."
                        : "Unable to retrieve concept profile."
            });

        }

    }
);


// ============================================================
// STUDENT TOKEN GUARD
// ============================================================
//
// Ensures the requester's X-Student-Token matches the
// reset token stored on the student record.  This prevents
// one browser from reading or modifying another student's
// progress.
//
// Usage: await verifyStudentToken(req, studentId)
// Returns true if the request may proceed, or sends a 403
// and returns false so the route handler can return early.
//
// ============================================================

async function verifyStudentToken(req, res, studentId) {

    const providedToken =
        req.get("X-Student-Token") || null;

    if (!providedToken) {
        res.status(403).json({
            success: false,
            error: "X-Student-Token header is required."
        });
        return false;
    }

    // Load the stored record.  If none exists yet (student has
    // not submitted any answer) we still allow the read so the
    // frontend can render an empty dashboard on first load.
    const student = await studentStore.get(studentId);

    if (!student) {
        // No record yet — allow; the route will return 404.
        return true;
    }

    // A legacy record without a bound token is not safe to expose by ID.
    if (!student.resetToken || student.resetToken !== providedToken) {
        res.status(403).json({
            success: false,
            error: "Access denied. This profile belongs to a different browser session."
        });
        return false;
    }

    return true;
}



app.get(
    "/api/students/:studentId",
    async (req, res) => {

        try {

            const allowed =
                await verifyStudentToken(
                    req,
                    res,
                    req.params.studentId
                );

            if (!allowed) return;

            const profile =
                await studySessionService.getStudentProfile(
                    req.params.studentId
                );


            if (!profile) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Student not found."
                });

            }


            res.json({

                success: true,

                profile

            });

        } catch (error) {

            console.error(
                "Student profile error:",
                error
            );

            const statusCode = serviceStatus(error);
            res.status(statusCode).json({

                success: false,

                error:
                    statusCode === 503
                        ? "The student profile is temporarily unavailable because the database is unavailable."
                        : "Unable to retrieve student."
            });

        }

    }
);


// ============================================================
// RESET STUDENT
// ============================================================
//
// DELETE /api/students/:studentId
//
// ============================================================

app.delete(
    "/api/students/:studentId",
    async (req, res) => {

        try {

            const resetToken = req.get("X-Student-Token");

            const reset =
                await studySessionService.resetStudent(
                    req.params.studentId,
                    resetToken
                );

            if (!reset) {
                return res.status(403).json({
                    success: false,
                    error:
                        "Reset denied. Use the session token from this browser."
                });
            }

            if (!reset.complete) {
                return res.status(500).json({
                    success: false,
                    error: "Reset did not remove all session data. Retry reset to finish deleting it.",
                    reset,
                    deleted: false
                });
            }

            res.json({

                success: true,

                deleted: true,

                reset

            });

        } catch (error) {

            console.error(
                "Reset student error:",
                error
            );

            const statusCode = serviceStatus(error);
            res.status(statusCode).json({

                success: false,

                error:
                    statusCode === 503
                        ? "Reset could not be confirmed because the database is unavailable. Some or all session data may already have been removed; retry reset to confirm completion."
                        : "Reset could not be confirmed. Some or all session data may already have been removed; retry reset to confirm completion.",
                reset: error.resetResult || {
                    complete: false,
                    deletedProgress: false,
                    deletedAttempts: false,
                    attemptCount: null
                },
                deleted: false
            });

        }

    }
);


// ============================================================
// EXPORT ATTEMPTS
// ============================================================
//
// GET /api/export/attempts?format=csv&blind=1
//
// Returns logged attempts as CSV or JSONL.
// blind=1 omits system labels and adds an empty gold column.
// Useful in MEMORY_STORE=1 mode where the CLI export script
// runs in a separate process and can't see in-memory data.
//
// ============================================================

app.get(
    "/api/export/attempts",
    async (req, res) => {

        try {
            const exportToken = process.env.ATTEMPT_EXPORT_TOKEN;
            if (
                !exportToken ||
                req.get("X-Admin-Token") !== exportToken
            ) {
                return res.status(403).json({
                    success: false,
                    error: "Attempt export is not authorized."
                });
            }

            const blind  = req.query.blind === "1" || req.query.blind === "true";
            const format = req.query.format === "csv" ? "csv" : "jsonl";

            const rows = await attemptLogStore.listAttempts({ limit: 50000 });

            // listAttempts returns newest-first from MongoDB; reverse to chronological.
            const chronological = rows.slice().reverse();

            if (format === "csv") {

                function csvEscape(value) {
                    const text = String(value ?? "");
                    if (/[",\n\r]/.test(text)) {
                        return `"${text.replace(/"/g, '""')}"`;
                    }
                    return text;
                }

                const headers = blind
                    ? ["id","createdAt","studentId","questionId","concept","difficulty","studentAnswer","work","answerCorrect","gold"]
                    : ["id","createdAt","studentId","questionId","concept","difficulty","studentAnswer","work","answerCorrect","demonstratedCorrect","misconceptionDetected","misconceptionType","misconceptionSource","targetedPracticeType","liveHintsSeen"];

                const lines = [headers.join(",")];

                for (const row of chronological) {
                    const values = blind
                        ? [row._id, row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, row.studentId, row.questionId, row.concept, row.difficulty, row.studentAnswer, row.work, row.answerCorrect, ""]
                        : [row._id, row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, row.studentId, row.questionId, row.concept, row.difficulty, row.studentAnswer, row.work, row.answerCorrect, row.demonstratedCorrect, row.misconceptionDetected, row.misconceptionType, row.misconceptionSource, row.targetedPracticeType, row.liveHintsSeen ?? 0];
                    lines.push(values.map(csvEscape).join(","));
                }

                const payload = `${lines.join("\n")}\n`;

                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", `attachment; filename="attempts${blind ? "_blind" : ""}.csv"`);
                return res.send(payload);
            }

            // JSONL
            const data = blind
                ? chronological.map(({ misconceptionType, misconceptionSource, targetedPracticeType, demonstratedCorrect, misconceptionDetected, ...rest }) => ({ ...rest, gold: "" }))
                : chronological;

            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Content-Disposition", `attachment; filename="attempts${blind ? "_blind" : ""}.jsonl"`);
            return res.send(data.map(r => JSON.stringify(r)).join("\n") + (data.length ? "\n" : ""));

        } catch (error) {

            console.error("Export error:", error);

            const statusCode = serviceStatus(error);
            res.status(statusCode).json({
                success: false,
                error: statusCode === 503
                    ? "Attempt history is temporarily unavailable because the database is unavailable."
                    : "Unable to export attempts."
            });
        }
    }
);


// ============================================================
// 404 HANDLER
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "Route not found.",

            path:
                req.originalUrl

        });

    }
);


// ============================================================
// START SERVER
// ============================================================

async function startServer() {
    await studentStore.connect();

    const server = app.listen(
        port,
        () => {
            const memoryMode = studentStore.useMemoryStore();

            console.log("");
            console.log(
                "=================================================="
            );
            console.log(
                "              STUDYTWIN SERVER"
            );
            console.log(
                "=================================================="
            );

            console.log(
                `✓ Server running on http://localhost:${port}`
            );

            console.log(
                "✓ Express API ready"
            );

            console.log(
                memoryMode
                    ? "✓ In-memory student store (MEMORY_STORE=1)"
                    : "✓ MongoDB persistence enabled"
            );

            console.log(
                "✓ Adaptive question system enabled"
            );

            console.log(
                "=================================================="
            );
            console.log("");
        }
    );

    return server;
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error("Unable to start StudyTwin:", error);
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };
