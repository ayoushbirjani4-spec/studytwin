
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
const studentStore = require("./Services/studentStore");
const attemptLogStore = require("./Services/attemptLogStore");
const { createAnswerRateLimiter } = require("./middleware/rateLimit");

const answerRateLimiter = createAnswerRateLimiter();


// ============================================================
// APP CONFIGURATION
// ============================================================

const app = express();

const port =
    Number(process.env.PORT) || 3000;


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

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


app.get("/health", (req, res) => {

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

            const statusCode = error.statusCode || 500;
            res.status(statusCode).json({

                success: false,

                error: statusCode < 500
                    ? error.message
                    : "Unable to start a study session."
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
            const isUnavailable =
                [
                    "MongoServerSelectionError",
                    "MongoNetworkError",
                    "MongoNetworkTimeoutError"
                ].includes(error.name) ||
                error.message &&
                (
                    error.message.includes("ECONNREFUSED") ||
                    error.message.includes("ENOTFOUND") ||
                    error.message.includes("MongoServerSelectionError") ||
                    error.message.includes("topology was destroyed") ||
                    error.message.includes("connection timed out")
                );
            const statusCode =
                error.statusCode ||
                (isUnavailable ? 503 : 500);

            res.status(statusCode).json({

                success: false,

                error: statusCode < 500
                    ? error.message
                    : statusCode === 503
                        ? "The server could not save your answer right now. Please try again in a moment."
                        : "Unable to process or save your answer.",

                persisted: false
            });

        }

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

            return res.status(500).json({

                success: false,

                error:
                    "Unable to retrieve student profile."
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

            return res.status(500).json({

                success: false,

                error:
                    "Unable to retrieve concept profile."
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

            res.status(500).json({

                success: false,

                error:
                    "Unable to retrieve student."
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

            res.json({

                success: true,

                reset

            });

        } catch (error) {

            console.error(
                "Reset student error:",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    error.message
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
                    : ["id","createdAt","studentId","questionId","concept","difficulty","studentAnswer","work","answerCorrect","demonstratedCorrect","misconceptionDetected","misconceptionType","misconceptionSource"];

                const lines = [headers.join(",")];

                for (const row of chronological) {
                    const values = blind
                        ? [row._id, row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, row.studentId, row.questionId, row.concept, row.difficulty, row.studentAnswer, row.work, row.answerCorrect, ""]
                        : [row._id, row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, row.studentId, row.questionId, row.concept, row.difficulty, row.studentAnswer, row.work, row.answerCorrect, row.demonstratedCorrect, row.misconceptionDetected, row.misconceptionType, row.misconceptionSource];
                    lines.push(values.map(csvEscape).join(","));
                }

                const payload = `${lines.join("\n")}\n`;

                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", `attachment; filename="attempts${blind ? "_blind" : ""}.csv"`);
                return res.send(payload);
            }

            // JSONL
            const data = blind
                ? chronological.map(({ misconceptionType, misconceptionSource, demonstratedCorrect, misconceptionDetected, ...rest }) => ({ ...rest, gold: "" }))
                : chronological;

            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Content-Disposition", `attachment; filename="attempts${blind ? "_blind" : ""}.jsonl"`);
            return res.send(data.map(r => JSON.stringify(r)).join("\n") + (data.length ? "\n" : ""));

        } catch (error) {

            console.error("Export error:", error);

            res.status(500).json({
                success: false,
                error: "Unable to export attempts."
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
