// ============================================================
// DEMO CLASS
// ============================================================
//
// A ready-made class for showing StudyTwin: six students with two weeks of
// sample practice, so the teacher page, reports, Twin Effect, cures,
// homework and the class twin all have something to show. Everything is
// marked demo (students "demo_…", class name "(sample)").
// ============================================================

const { randomUUID } = require("node:crypto");
const classStore = require("./classStore");
const studentStore = require("./studentStore");
const attemptLogStore = require("./attemptLogStore");

const DAY = 24 * 60 * 60 * 1000;

// Each student: their mistake, and a pattern per answer ("x" = made it,
// "." = right) before and after they taught their twin.
const STUDENTS = [
    { name: "Asha", type: "sign_error", concept: "distributive_property", before: "x..x.x..x.", after: "........x.", cured: true },
    { name: "Ben", type: "failed_to_distribute", concept: "distributive_property", before: "x.x.x.x.x.", after: ".x....x...", cured: false },
    { name: "Cara", type: "failed_to_distribute", concept: "distributive_property", before: "..x.x.x...", after: "x.xx.x.x..", cured: false },
    { name: "Dev", type: "wrong_inverse_op", concept: "inverse_operations", before: "x.x..x....", after: "..........", cured: true },
    { name: "Ela", type: "one_sided_op", concept: "equation_balance", before: ".x..x.x..x", after: "...x......", cured: false },
    { name: "Finn", type: "combining_unlike_terms", concept: "combining_like_terms", before: "x.x.......", after: ".....", cured: false }
];

async function createDemoClass(now = Date.now()) {
    const created = await classStore.create({ name: "Sample class (demo)" });

    for (const [index, s] of STUDENTS.entries()) {
        const studentId = `demo_${randomUUID()}`;
        const taughtAt = new Date(now - 7 * DAY).toISOString();
        const pattern = [...s.before, ...s.after];
        const start = now - 14 * DAY + index * 60 * 60 * 1000;

        // Answers spread over two weeks; the "after" ones follow teaching the twin.
        for (const [i, mark] of pattern.entries()) {
            const isAfter = i >= s.before.length;
            const at = isAfter
                ? now - 7 * DAY + (i - s.before.length + 1) * 12 * 60 * 60 * 1000
                : start + i * 14 * 60 * 60 * 1000;
            await attemptLogStore.logAttempt({
                studentId,
                questionId: `${s.concept === "distributive_property" ? "dp" : s.concept === "inverse_operations" ? "io" : s.concept === "equation_balance" ? "eb" : "clt"}_00${(i % 5) + 1}`,
                concept: s.concept,
                difficulty: 1 + (i % 3),
                studentAnswer: "",
                work: "",
                answerCorrect: mark === ".",
                demonstratedCorrect: mark === ".",
                misconceptionDetected: mark === "x",
                misconceptionType: mark === "x" ? s.type : null,
                misconceptionSource: mark === "x" ? "rules" : null,
                hintsUsed: mark === "x" ? 1 : 0,
                createdAt: new Date(Math.min(at, now - 60 * 1000)).toISOString()
            });
        }

        const mistakes = pattern.filter((m) => m === "x").length;
        await studentStore.save({
            studentId,
            resetToken: randomUUID(),
            demo: true,
            classCode: created.code,
            displayName: s.name,
            joinedClassAt: new Date(now - 14 * DAY).toISOString(),
            concepts: {
                [s.concept]: {
                    attempts: pattern.length, correct: pattern.length - mistakes, rawCorrect: pattern.length - mistakes,
                    recentResults: [], misconceptionCount: mistakes, currentDifficulty: 2, recentQuestionIds: [],
                    misconceptionsByType: { [s.type]: { count: mistakes, firstSeen: new Date(start).toISOString(), lastSeen: taughtAt } }
                }
            },
            twin: { taught: { [s.type]: 2 }, firstTaughtAt: { [s.type]: taughtAt }, lastTaughtAt: { [s.type]: taughtAt }, recentLessons: [] },
            curedMistakes: s.cured
                ? [{ type: s.type, concept: s.concept, curedAt: new Date(now - 3 * DAY).toISOString(), attempts: 6,
                    checkups: [{ days: 2, dueAt: new Date(now - 1 * DAY).toISOString(), questionId: null, result: "held", answeredAt: new Date(now - DAY).toISOString() },
                        { days: 7, dueAt: new Date(now + 4 * DAY).toISOString(), questionId: null, result: null, answeredAt: null }] }]
                : []
        });
    }

    // Homework already set, so its progress shows.
    await classStore.addAssignment(created.code, {
        id: randomUUID().slice(0, 8), concept: "distributive_property", count: 10,
        dueDate: new Date(now + 3 * DAY).toISOString().slice(0, 10), createdAt: new Date(now - 10 * DAY).toISOString()
    });

    return created;
}

module.exports = { createDemoClass };
