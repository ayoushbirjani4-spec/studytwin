// ============================================================
// MY MISTAKES
// ============================================================
//
// A student's own wrong answers, newest first, to look back over: the
// question, their working with the first wrong line marked, and the
// mistake's name. Each can be tried again (the question link, ?q=<id>).
//
// Built from the attempt log, which already keeps the question id, the
// working and the answer. The wrong line is found again by the same
// step checker the student saw live. The right answer is not sent: the
// point is to try again.
// ============================================================

const attemptLogStore = require("./attemptLogStore");
const questionService = require("./questionService");
const misconceptionService = require("./misconceptionService");
const studySessionService = require("./studySessionService");

const MAX_ITEMS = 30;
const SCAN = 400;          // answers looked through
const MAX_LINES = 12;      // working lines shown per mistake

async function listMistakes(studentId) {
    const rows = (await attemptLogStore.listAttempts({ studentId, limit: SCAN }))
        .filter((row) => row && row.createdAt && !row.demonstratedCorrect)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const seen = new Set();
    const items = [];
    for (const row of rows) {
        if (items.length >= MAX_ITEMS) break;
        // The latest try at each question only.
        if (seen.has(row.questionId)) continue;
        seen.add(row.questionId);

        const question = questionService.findQuestionById(row.questionId);
        if (!question) continue;   // e.g. a teacher's question since removed

        let steps = [];
        let firstErrorIndex = null;
        try {
            const check = row.work ? misconceptionService.checkSteps({ questionId: row.questionId, work: row.work }) : null;
            steps = (check?.steps || []).slice(0, MAX_LINES).map((step) => ({ line: step.line, status: step.status }));
            firstErrorIndex = check?.firstErrorIndex ?? null;
        } catch {
            // Working that can't be re-checked is still shown as written.
            steps = String(row.work).split("\n").filter(Boolean).slice(0, MAX_LINES).map((line) => ({ line, status: null }));
        }

        const type = row.misconceptionDetected ? row.misconceptionType : null;
        items.push({
            questionId: row.questionId,
            question: question.question,
            concept: question.concept,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            studentAnswer: row.studentAnswer || "",
            answerCorrect: Boolean(row.answerCorrect),
            steps,
            firstErrorIndex: firstErrorIndex !== null && firstErrorIndex < steps.length ? firstErrorIndex : null,
            mistake: type ? { type, label: studySessionService.labelMisconception(type) } : null
        });
    }
    return items;
}

module.exports = { listMistakes, MAX_ITEMS };
