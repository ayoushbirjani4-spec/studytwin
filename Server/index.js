
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
const llmReviewService = require("./Services/llmReviewService");
const classStore = require("./Services/classStore");
const classReportService = require("./Services/classReportService");
const practiceSheetService = require("./Services/practiceSheetService");
const customQuestions = require("./Services/customQuestions");
const demoClass = require("./Services/demoClass");
const inequalities = require("./Services/inequalities");
const solutionChecker = require("./Services/solutionChecker");
const factorising = require("./Services/factorising");
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

// Each photo is a paid Gemini call, so they get a small budget. The
// browser shrinks photos to well under this size before sending.
const photoRateLimiter = createAnswerRateLimiter({
    perMinute: 6,
    perDay: 60
});
const MAX_PHOTO_BASE64_LENGTH = 3_000_000;

// Each explanation is judged by Gemini, so it gets its own small budget.
const explainRateLimiter = createAnswerRateLimiter({
    perMinute: 10,
    perDay: 100
});

// A whole class votes and polls from one school network (often one IP
// address), every few seconds, so class voting gets a much larger budget.
const classroomRateLimiter = createAnswerRateLimiter({
    perMinute: 3000,
    perDay: 100000
});

// Creating classes needs no account, so it is kept to a trickle.
const classCreateRateLimiter = createAnswerRateLimiter({
    perMinute: 3,
    perDay: 20
});


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

// Photos of working need a larger body than everything else; this parser
// runs first for that one route, so the default 100 kB limit still
// applies everywhere else.
app.use("/api/work/photo", express.json({ limit: "3200kb" }));
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

// ============================================================
// READ WORKING FROM A PHOTO
// ============================================================
//
// POST /api/work/photo   { studentId, questionId, image: "data:image/jpeg;base64,..." }
//
// Gemini transcribes the handwritten lines; the student checks them in
// the working box before anything is marked. The photo is only passed
// through to Gemini: it is never stored or logged.
//
// ============================================================

// Checks the request and the student before the rate limiter, so only
// photos that will really be sent to Gemini use up the budget.
async function checkPhotoRequest(req, res, next) {
    const { studentId, questionId, image } = req.body || {};

    if (typeof studentId !== "string" || typeof questionId !== "string" || typeof image !== "string") {
        return res.status(400).json({ success: false, error: "studentId, questionId and image are required." });
    }

    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
        return res.status(400).json({ success: false, error: "The photo must be a JPEG, PNG or WebP image." });
    }
    if (match[2].length > MAX_PHOTO_BASE64_LENGTH) {
        return res.status(413).json({ success: false, error: "That photo is too large. Try again a little further away." });
    }

    try {
        // Only a student working on this question may send a photo of it,
        // so the paid Gemini call can't be used freely.
        const student = await studentStore.get(studentId);
        const token = req.get("X-Student-Token");
        if (!student || !token || student.resetToken !== token) {
            return res.status(403).json({ success: false, error: "Start a practice session first." });
        }
        if (!(student.issuedQuestionIds || []).includes(questionId)) {
            return res.status(403).json({ success: false, error: "This question isn't open for you right now." });
        }
        const question = questionService.findQuestionById(questionId);
        if (!question) {
            return res.status(404).json({ success: false, error: "Question not found." });
        }
        req.photo = { questionText: question.question, mimeType: match[1], imageBase64: match[2] };
        next();
    } catch (error) {
        console.error("Photo request check error:", error.message);
        const status = serviceStatus(error);
        res.status(status).json({
            success: false,
            error: status === 503 ? "Student progress storage is unavailable." : "Couldn't read that photo. Try again, or type your working."
        });
    }
}

app.post(
    "/api/work/photo",
    checkPhotoRequest,
    photoRateLimiter,
    async (req, res) => {
        try {
            const result = await llmReviewService.readWorkingPhoto(req.photo);
            res.json({ success: true, ...result });
        } catch (error) {
            if (error.code === "GEMINI_NOT_CONFIGURED") {
                return res.status(503).json({ success: false, error: "Reading photos isn't set up on this server." });
            }
            console.error("Photo read error:", error.message);
            res.status(502).json({ success: false, error: "Couldn't read that photo. Try again, or type your working." });
        }
    }
);

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
            const result = misconceptionService.checkSteps({ questionId, work, reveal: req.body.reveal === true });
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
                excludeQuestionIds,
                lessonNumber
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
                // Study mode: the practice group works without the twin for now.
                const student = await studentStore.get(studentId);
                if (await studySessionService.studyGroupFor(student) === "practice") {
                    return res.status(403).json({
                        success: false,
                        studyGroup: "practice",
                        error: "Your class is running a study, and your group practises without the twin for now."
                    });
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

            const chosenByStudent = twinService.TWIN_MISCONCEPTIONS.includes(misconceptionType);
            if (!twinService.TWIN_MISCONCEPTIONS.includes(type)) {
                type = DEFAULT_TWIN_MISCONCEPTION;
            }

            // Vary where the twin goes wrong. Lessons alternate between the
            // student's habit and a "mixed" lesson with a slip in a different
            // step (isolating, dividing, evaluating), so the student practises
            // spotting mistakes anywhere in a solution, not just one line.
            // Lessons so far: this session's count, or the saved count when
            // returning (whichever is larger; adding them would double-count,
            // since teaching a lesson advances both).
            const lessonCount = Math.max(
                Number.isInteger(lessonNumber) && lessonNumber >= 0 ? lessonNumber : 0,
                memory?.recentLessons?.length || 0
            );
            const rotate = (list, by) => list.map((_, i) => list[(i + by) % list.length]);
            const mixed = !chosenByStudent && lessonCount % 2 === 1;

            let lesson = null;
            if (mixed) {
                lesson = twinService.findMixedLesson({
                    excludeTypes: [type],
                    stages: rotate(["isolate", "divide", "evaluate"], Math.floor(lessonCount / 2)),
                    concept: lessonConcept,
                    excludeQuestionIds: exclude
                });
            }
            if (!lesson) {
                // Habit lesson; if the habit can happen at several steps, rotate them.
                for (const stage of rotate(twinService.TWIN_STAGES, Math.floor(lessonCount / 2))) {
                    lesson = twinService.findTwinLesson({
                        misconceptionType: type,
                        concept: lessonConcept,
                        excludeQuestionIds: exclude,
                        stage
                    });
                    if (lesson) break;
                }
            }

            if (!lesson) {
                return res.status(404).json({
                    success: false,
                    error: "No twin lesson fits this mistake yet."
                });
            }

            // Never send the answer key to the browser. The step is a hint too,
            // so only the opaque variant number goes back (to grade it later).
            const { wrongIndex, twinAnswer, correctAnswer, stage, ...publicLesson } = lesson;
            const isMixed = lesson.misconceptionType !== type;

            res.json({
                success: true,
                personalised,
                reviewing: reviewing && !isMixed,
                mode: isMixed ? "mixed" : "habit",
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

    // Inequalities and quadratics have their own rules: the fix must keep the
    // inequality's solution, or keep every solution of the quadratic.
    const question = questionService.findQuestionById(questionId);
    if (question && inequalities.isInequalityQuestion(question)) {
        const before = inequalities.solve(previousLine);
        const after = inequalities.solve(corrected);
        return Boolean(before && after && before.op === after.op && Math.abs(before.value - after.value) < 1e-9);
    }
    if (question && question.concept === "quadratics") {
        return solutionChecker.judgeLine(question, corrected) === "valid";
    }
    // Factorising: the fix is the right, fully factorised answer.
    if (question && factorising.handles(question)) {
        return factorising.answersMatch(corrected, question.answer);
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

// ============================================================
// EXPLAIN THE FIX
// ============================================================
//
// POST /api/twin/explain
//   { questionId, misconceptionType, variant, correctedLine, explanation,
//     studentId }          with X-Student-Token, or
//   { ..., classCode }     with X-Teacher-Key (the class twin)
//
// After fixing the twin's line, the student says why it was wrong and
// Gemini judges the reason. Each judgement is a paid call, so it needs a
// real student or teacher, a fix that the rules accept, and a budget.
//
// ============================================================

app.post("/api/twin/explain", explainRateLimiter, async (req, res) => {
    const { questionId, misconceptionType, variant = 0, correctedLine, explanation, studentId, classCode } = req.body || {};

    if (typeof questionId !== "string" || typeof misconceptionType !== "string" ||
        typeof explanation !== "string" || !explanation.trim()) {
        return res.status(400).json({ success: false, error: "Say why the twin's line was wrong first." });
    }
    if (explanation.length > llmReviewService.MAX_EXPLANATION_LENGTH) {
        return res.status(400).json({ success: false, error: "Keep it to a sentence or two." });
    }

    try {
        if (typeof classCode === "string" && classCode) {
            const classRecord = await classStore.get(classCode);
            if (!classStore.teacherKeyMatches(classRecord, req.get("X-Teacher-Key"))) {
                return res.status(403).json({ success: false, error: "That class code and teacher key don't match." });
            }
        } else {
            const student = typeof studentId === "string" ? await studentStore.get(studentId) : null;
            const token = req.get("X-Student-Token");
            if (!student || !token || student.resetToken !== token) {
                return res.status(403).json({ success: false, error: "Start practising first, then teach your twin." });
            }
        }

        const question = questionService.findQuestionById(questionId);
        const lessonVariant = Number.isInteger(variant) && variant >= 0 && variant < 10 ? variant : 0;
        const lesson = twinService.buildTwinSolution(question, misconceptionType, lessonVariant);
        if (!lesson) {
            return res.status(404).json({ success: false, error: "That twin lesson was not found." });
        }
        const previousLine = lesson.lines[lesson.wrongIndex - 1];
        if (!gradeTwinCorrection(questionId, previousLine, correctedLine)) {
            return res.status(400).json({ success: false, error: "Fix the twin's line first." });
        }

        const result = await llmReviewService.judgeExplanation({
            questionText: question.question,
            previousLine,
            wrongLine: lesson.lines[lesson.wrongIndex],
            correctLine: String(correctedLine).trim(),
            mistakeLabel: studySessionService.labelMisconception(misconceptionType),
            explanation: explanation.trim()
        });
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.code === "GEMINI_NOT_CONFIGURED") {
            return res.status(503).json({ success: false, error: "Explaining isn't set up on this server." });
        }
        console.error("Twin explain error:", error.message);
        const status = serviceStatus(error);
        res.status(status === 503 ? 503 : 502).json({
            success: false,
            error: status === 503 ? "Student progress storage is unavailable." : "Couldn't judge that right now. Try again in a moment."
        });
    }
});

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
            variant = 0,
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
        const lessonVariant = Number.isInteger(variant) && variant >= 0 && variant < 10 ? variant : 0;
        const lesson = twinService.buildTwinSolution(question, misconceptionType, lessonVariant);
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
        // Study mode: teaching by the practice group isn't recorded.
        const inPracticeGroup = typeof studentId === "string" && studentId &&
            await studySessionService.studyGroupFor(await studentStore.get(studentId)) === "practice";
        if (fixedIt && typeof studentId === "string" && studentId && !inPracticeGroup) {
            try {
                const recorded = await studySessionService.recordTwinTeaching(
                    studentId,
                    req.get("X-Student-Token"),
                    { misconceptionType, questionId, variant: lessonVariant }
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
// CLASSES AND THE TEACHER VIEW
// ============================================================
//
// POST /api/classes                     { name }  -> { code, teacherKey }
// GET  /api/classes/:code               -> { code, name }  (to confirm before joining)
// POST /api/students/:studentId/class   { code, displayName } or { code: null } to leave
// GET  /api/classes/:code/report        X-Teacher-Key
// GET  /api/classes/:code/export.csv    X-Teacher-Key, ?blind=1 for labelling
//
// The teacher key is shown once when the class is created; only its hash
// is stored. Students appear to the teacher by the name they type.
//
// ============================================================

function sendServiceError(res, error, fallback) {
    const status = serviceStatus(error);
    if (status >= 500) console.error(fallback, error.message);
    res.status(status).json({
        success: false,
        error: status === 503 ? "Student progress storage is unavailable." : status < 500 ? error.message : fallback
    });
}

async function loadClassForTeacher(req, res) {
    const classRecord = await classStore.get(req.params.code);
    if (!classRecord || !classStore.teacherKeyMatches(classRecord, req.get("X-Teacher-Key"))) {
        res.status(403).json({ success: false, error: "That class code and teacher key don't match." });
        return null;
    }
    return classRecord;
}

// A sample class with six students and two weeks of practice, for demos.
app.post("/api/demo/class", classCreateRateLimiter, async (req, res) => {
    try {
        const created = await demoClass.createDemoClass();
        res.status(201).json({ success: true, ...created });
    } catch (error) {
        sendServiceError(res, error, "Unable to make the sample class.");
    }
});

app.post("/api/classes", classCreateRateLimiter, async (req, res) => {
    try {
        const created = await classStore.create({ name: req.body?.name });
        res.status(201).json({ success: true, ...created });
    } catch (error) {
        sendServiceError(res, error, "Unable to create the class.");
    }
});

app.get("/api/classes/:code", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await classStore.get(req.params.code);
        if (!classRecord) {
            return res.status(404).json({ success: false, error: "No class has that code. Check it with your teacher." });
        }
        res.json({ success: true, code: classRecord.code, name: classRecord.name });
    } catch (error) {
        sendServiceError(res, error, "Unable to look up the class.");
    }
});

app.post("/api/students/:studentId/class", stepCheckRateLimiter, async (req, res) => {
    try {
        const { code, displayName } = req.body || {};
        let classRecord = null;
        if (code !== null && code !== undefined && code !== "") {
            classRecord = await classStore.get(code);
            if (!classRecord) {
                return res.status(404).json({ success: false, error: "No class has that code. Check it with your teacher." });
            }
            // A closed class takes no new students; anyone already in it can
            // still change the name they're shown by.
            if (classRecord.joinsClosed) {
                const current = await studentStore.get(req.params.studentId);
                if (current?.classCode !== classRecord.code) {
                    return res.status(403).json({ success: false, error: "This class isn't taking new students right now. Ask your teacher." });
                }
            }
        }
        const result = await studySessionService.joinClass({
            studentId: req.params.studentId,
            resetToken: req.get("X-Student-Token"),
            classCode: classRecord?.code || null,
            displayName
        });
        res.json({ success: true, ...result, className: classRecord?.name || null });
    } catch (error) {
        sendServiceError(res, error, "Unable to join the class.");
    }
});

// GET /api/classes/:code/practice-sheets   teacher: one personalised sheet
// per student, from their own mistakes (see practiceSheetService).
app.get("/api/classes/:code/practice-sheets", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const date = new Date().toISOString().slice(0, 10);
        const members = (await studentStore.listByClass(classRecord.code))
            .sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
        const sheets = [];
        for (const member of members) {
            const student = await studentStore.get(member.studentId);
            const rows = (await attemptLogStore.listAttempts({ studentId: member.studentId, limit: 200 }))
                .filter((row) => row && row.createdAt)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            sheets.push({
                name: student.displayName || "Student",
                questions: practiceSheetService.planSheet(student, rows, `${member.studentId}:${date}`)
            });
        }
        res.json({ success: true, className: classRecord.name, date, sheets });
    } catch (error) {
        sendServiceError(res, error, "Unable to make the practice sheets.");
    }
});

// POST /api/classes/:code/joining   teacher: { open: true | false }
app.post("/api/classes/:code/joining", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        if (typeof req.body?.open !== "boolean") {
            return res.status(400).json({ success: false, error: "Say whether the class is open to new students." });
        }
        await classStore.setJoinsClosed(classRecord.code, !req.body.open);
        res.json({ success: true, joinsClosed: !req.body.open });
    } catch (error) {
        sendServiceError(res, error, "Unable to change who can join.");
    }
});

app.get("/api/classes/:code/report", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        res.json({ success: true, ...(await classReportService.buildClassReport(classRecord)) });
    } catch (error) {
        sendServiceError(res, error, "Unable to build the class report.");
    }
});

app.get("/api/classes/:code/export.csv", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const blind = req.query.blind === "1";
        const rows = await classReportService.exportClassAttempts(classRecord, { blind });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition",
            `attachment; filename="studytwin-${classRecord.code}${blind ? "-to-label" : ""}.csv"`);
        res.send(classReportService.toCsv(rows));
    } catch (error) {
        sendServiceError(res, error, "Unable to export the class.");
    }
});


// ============================================================
// STUDY MODE
// ============================================================
//
// POST /api/classes/:code/study   teacher: { on: true } to start, { on: false } to end
//
// While a study runs, half the class (chosen at random) teaches the twin
// and half practises without it; the class report compares the two.
//
// ============================================================

app.post("/api/classes/:code/study", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        let study = null;
        if (req.body?.on === true) {
            // Shuffle the class and deal it into two equal halves, so the
            // groups are random and the same size.
            const crypto = require("node:crypto");
            const members = (await studentStore.listByClass(classRecord.code)).map((m) => m.studentId);
            for (let i = members.length - 1; i > 0; i--) {
                const j = crypto.randomInt(i + 1);
                [members[i], members[j]] = [members[j], members[i]];
            }
            const groups = Object.fromEntries(members.map((id, i) => [id, i % 2 === 0 ? "twin" : "practice"]));
            study = { startedAt: new Date().toISOString(), groups };
        }
        await classStore.setStudy(classRecord.code, study);
        res.json({ success: true, study: study && { startedAt: study.startedAt } });
    } catch (error) {
        sendServiceError(res, error, "Unable to change study mode.");
    }
});


// ============================================================
// HOMEWORK
// ============================================================
//
// POST   /api/classes/:code/assignments        teacher: { concept, count, dueDate }
// DELETE /api/classes/:code/assignments/:id    teacher
//
// Progress is counted from students' answers, in the class report and in
// each student's profile.
//
// ============================================================

// Mistakes a trap round can be set for.
const HOMEWORK_MISTAKES = [
    "failed_to_distribute", "sign_error", "wrong_inverse_op", "one_sided_op",
    "combining_unlike_terms", "arithmetic_slip", "inequality_flip"
];

app.post("/api/classes/:code/assignments", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const { concept, dueDate, misconceptionType } = req.body || {};
        // "Cure a mistake" homework is one trap round, so it counts as 1.
        const count = misconceptionType ? 1 : req.body?.count;
        if (misconceptionType && !HOMEWORK_MISTAKES.includes(misconceptionType)) {
            return res.status(400).json({ success: false, error: "Choose a mistake StudyTwin can set traps for." });
        }
        const due = /^\d{4}-\d{2}-\d{2}$/.test(String(dueDate)) ? new Date(`${dueDate}T00:00:00Z`) : null;
        const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
        const classQuestionsTopic = concept === customQuestions.CONCEPT && (classRecord.questions || []).length > 0;
        if (!questionService.getConcepts().includes(concept) && !classQuestionsTopic) {
            return res.status(400).json({ success: false, error: "Choose a topic for the homework." });
        }
        if (!Number.isInteger(count) || count < 1 || count > 50) {
            return res.status(400).json({ success: false, error: "Set between 1 and 50 questions." });
        }
        // Allow "yesterday" so a teacher a time zone behind UTC can set today.
        if (!due || Number.isNaN(due.getTime()) || due < today - 24 * 60 * 60 * 1000 || due - today > 366 * 24 * 60 * 60 * 1000) {
            return res.status(400).json({ success: false, error: "Choose a due date in the next year." });
        }
        const assignment = {
            id: require("node:crypto").randomUUID().slice(0, 8),
            concept,
            count,
            dueDate,
            ...(misconceptionType ? { misconceptionType } : {}),
            createdAt: new Date().toISOString()
        };
        await classStore.addAssignment(classRecord.code, assignment);
        res.status(201).json({ success: true, assignment });
    } catch (error) {
        sendServiceError(res, error, "Unable to set the homework.");
    }
});

app.delete("/api/classes/:code/assignments/:id", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        await classStore.removeAssignment(classRecord.code, String(req.params.id));
        res.json({ success: true });
    } catch (error) {
        sendServiceError(res, error, "Unable to remove the homework.");
    }
});


// ============================================================
// PARENT LINK
// ============================================================
//
// POST /api/classes/:code/parent-link   teacher: { student } (the short id) -> { token }
// POST /api/parent                      { token } -> that student's report
//
// The token is "<studentId>.<secret>"; only a hash of the secret is kept on
// the student, so a new link replaces (and switches off) the old one. It is
// sent in the request body, not the URL, so it stays out of server logs.
//
// ============================================================

const hashSecret = (secret) => require("node:crypto").createHash("sha256").update(String(secret)).digest("hex");

app.post("/api/classes/:code/parent-link", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const shortId = String(req.body?.student || "");
        const member = shortId.length >= 6
            ? (await studentStore.listByClass(classRecord.code)).find((s) => s.studentId.endsWith(shortId))
            : null;
        if (!member) {
            return res.status(404).json({ success: false, error: "That student isn't in this class." });
        }
        const student = await studentStore.get(member.studentId);
        const secret = require("node:crypto").randomBytes(18).toString("base64url");
        student.parentKeyHash = hashSecret(secret);
        await studentStore.save(student);
        res.json({ success: true, token: `${student.studentId}.${secret}`, name: student.displayName || "Student" });
    } catch (error) {
        sendServiceError(res, error, "Unable to make a parent link.");
    }
});

app.post("/api/parent", stepCheckRateLimiter, async (req, res) => {
    try {
        const token = String(req.body?.token || "");
        const dot = token.lastIndexOf(".");
        const student = dot > 0 ? await studentStore.get(token.slice(0, dot)) : null;
        const expected = student?.parentKeyHash ? Buffer.from(student.parentKeyHash, "hex") : null;
        const given = Buffer.from(hashSecret(token.slice(dot + 1)), "hex");
        if (!expected || expected.length !== given.length || !require("node:crypto").timingSafeEqual(expected, given)) {
            return res.status(404).json({ success: false, error: "This link doesn't work any more. Ask the teacher for a new one." });
        }
        const classRecord = student.classCode ? await classStore.get(student.classCode) : null;
        res.json({
            success: true,
            className: classRecord?.name || "",
            student: await classReportService.buildStudentReport(student)
        });
    } catch (error) {
        sendServiceError(res, error, "Unable to load the report.");
    }
});


// ============================================================
// REMOVE A STUDENT
// ============================================================
//
// DELETE /api/classes/:code/students/:id   teacher: id is the short id
//
// The same as the student leaving: they drop out of the report, polls and
// homework, and their parent link stops working. Their own practice and
// progress are kept; they can rejoin with the class code.
//
// ============================================================

app.delete("/api/classes/:code/students/:id", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const shortId = String(req.params.id || "");
        const matches = shortId.length >= 6
            ? (await studentStore.listByClass(classRecord.code)).filter((s) => s.studentId.endsWith(shortId))
            : [];
        if (matches.length !== 1) {
            return res.status(404).json({ success: false, error: "That student isn't in this class." });
        }
        const student = await studentStore.get(matches[0].studentId);
        student.classCode = null;
        student.displayName = null;
        student.joinedClassAt = null;
        student.parentKeyHash = null;
        await studentStore.save(student);
        res.json({ success: true });
    } catch (error) {
        sendServiceError(res, error, "Unable to remove the student.");
    }
});


// ============================================================
// THE TEACHER'S OWN QUESTIONS
// ============================================================
//
// POST   /api/classes/:code/questions        teacher: { text } one question per line
// DELETE /api/classes/:code/questions/:id    teacher
//
// Each line is checked: StudyTwin must be able to work out its answer and
// check working for it. Lines it can't are sent back with the reason.
//
// ============================================================

app.post("/api/classes/:code/questions", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const text = String(req.body?.text || "").slice(0, 6000);
        const rows = customQuestions.fromLines(text);
        if (!rows.length) {
            return res.status(400).json({ success: false, error: "Type at least one question." });
        }
        const existing = classRecord.questions || [];
        const accepted = rows.filter((row) => row.id && !existing.includes(row.id));
        const room = classStore.MAX_QUESTIONS - existing.length;
        await classStore.setQuestions(classRecord.code, [...existing, ...accepted.slice(0, Math.max(0, room)).map((row) => row.id)]);
        res.json({
            success: true,
            added: accepted.slice(0, Math.max(0, room)).map(({ id, question, answer }) => ({ id, question, answer })),
            refused: rows.filter((row) => row.error).map(({ line, error }) => ({ line, error })),
            full: accepted.length > room
        });
    } catch (error) {
        sendServiceError(res, error, "Unable to add the questions.");
    }
});

app.delete("/api/classes/:code/questions/:id", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        await classStore.setQuestions(classRecord.code, (classRecord.questions || []).filter((id) => id !== req.params.id));
        res.json({ success: true });
    } catch (error) {
        sendServiceError(res, error, "Unable to remove the question.");
    }
});


// ============================================================
// CLASS TWIN VOTING FROM PHONES
// ============================================================
//
// POST /api/classes/:code/poll          teacher: open a vote on a twin lesson
// POST /api/classes/:code/poll/close    teacher: close it
// GET  /api/classes/:code/poll/results  teacher: votes per line
// GET  /api/classes/:code/poll          students: the lines to vote on
// POST /api/classes/:code/poll/vote     students: { pollId, voterId, line }
//
// Students need only the class code, no name or account. Votes are
// anonymous counts; the answer is never sent to the phones.
//
// ============================================================

const VOTER_ID = /^[A-Za-z0-9_-]{8,40}$/;

function pollLesson(poll) {
    if (!poll) return null;
    const question = questionService.findQuestionById(poll.questionId);
    return twinService.buildTwinSolution(question, poll.misconceptionType, poll.variant);
}

app.post("/api/classes/:code/poll", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const { questionId, misconceptionType, variant = 0 } = req.body || {};
        const poll = {
            id: require("node:crypto").randomUUID().slice(0, 8),
            questionId: String(questionId || ""),
            misconceptionType: String(misconceptionType || ""),
            variant: Number.isInteger(variant) && variant >= 0 && variant < 10 ? variant : 0,
            open: true,
            votes: {}
        };
        if (!pollLesson(poll)) {
            return res.status(404).json({ success: false, error: "That twin lesson was not found." });
        }
        await classStore.setPoll(classRecord.code, poll);
        res.json({ success: true, pollId: poll.id });
    } catch (error) {
        sendServiceError(res, error, "Unable to start the vote.");
    }
});

app.post("/api/classes/:code/poll/close", stepCheckRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        await classStore.closePoll(classRecord.code, String(req.body?.pollId || ""));
        res.json({ success: true });
    } catch (error) {
        sendServiceError(res, error, "Unable to close the vote.");
    }
});

app.get("/api/classes/:code/poll/results", classroomRateLimiter, async (req, res) => {
    try {
        const classRecord = await loadClassForTeacher(req, res);
        if (!classRecord) return;
        const poll = classRecord.poll;
        const lesson = pollLesson(poll);
        const counts = lesson ? lesson.lines.map(() => 0) : [];
        for (const line of Object.values(poll?.votes || {})) {
            if (counts[line] !== undefined) counts[line] += 1;
        }
        res.json({ success: true, pollId: poll?.id || null, open: Boolean(poll?.open), counts, voters: Object.keys(poll?.votes || {}).length });
    } catch (error) {
        sendServiceError(res, error, "Unable to load the votes.");
    }
});

app.get("/api/classes/:code/poll", classroomRateLimiter, async (req, res) => {
    try {
        const classRecord = await classStore.get(req.params.code);
        if (!classRecord) {
            return res.status(404).json({ success: false, error: "No class has that code. Check it with your teacher." });
        }
        const poll = classRecord.poll;
        const lesson = poll?.open ? pollLesson(poll) : null;
        res.json({
            success: true,
            className: classRecord.name,
            pollId: lesson ? poll.id : null,
            open: Boolean(lesson),
            question: lesson ? questionService.findQuestionById(poll.questionId).question : null,
            lines: lesson ? lesson.lines : []
        });
    } catch (error) {
        sendServiceError(res, error, "Unable to load the vote.");
    }
});

app.post("/api/classes/:code/poll/vote", classroomRateLimiter, async (req, res) => {
    const { pollId, voterId, line } = req.body || {};
    if (typeof pollId !== "string" || typeof voterId !== "string" || !VOTER_ID.test(voterId) || !Number.isInteger(line)) {
        return res.status(400).json({ success: false, error: "Tap a line to vote." });
    }
    try {
        const classRecord = await classStore.get(req.params.code);
        const lesson = classRecord?.poll?.id === pollId ? pollLesson(classRecord.poll) : null;
        // Line 0 is the question itself, so it can't be the twin's mistake.
        if (!lesson || line < 1 || line >= lesson.lines.length) {
            return res.status(409).json({ success: false, error: "This vote has finished." });
        }
        const counted = await classStore.vote(classRecord.code, pollId, voterId, line);
        if (!counted) {
            return res.status(409).json({ success: false, error: "This vote has finished." });
        }
        res.json({ success: true });
    } catch (error) {
        sendServiceError(res, error, "Unable to record your vote.");
    }
});


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

// Request bodies that are too large or not valid JSON get a JSON error
// the browser can show, instead of Express's default HTML page.
app.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
        return res.status(413).json({ success: false, error: "That upload is too large." });
    }
    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, error: "The request body isn't valid JSON." });
    }
    next(error);
});


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
