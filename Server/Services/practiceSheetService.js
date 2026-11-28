// ============================================================
// PERSONALISED PRACTICE SHEETS
// ============================================================
//
// One printed sheet per student, built from their own mistakes:
//   - up to two questions for each of their most frequent mistakes, set to
//     catch that mistake (questionGenerator.generateTrapQuestion), in the
//     topic where they made it;
//   - then questions from the topics they practise, at a level that fits
//     how they're doing there.
//
// Every question is a generated one, so its id rebuilds it exactly: the
// short link on the sheet (?q=<id>) opens the same question in the app,
// where the student can type or photograph their working to have it checked.
// A sheet is the same all day (seeded by student and date), so reprinting
// gives the same sheets.
// ============================================================

const questionGenerator = require("./questionGenerator");
const studySessionService = require("./studySessionService");

const SHEET_SIZE = 6;
const PER_MISTAKE = 2;
const MAX_MISTAKES = 3;
const RECENT = 40;            // mistakes are counted over the last 40 answers
const FALLBACK_CONCEPT = "distributive_property";

function levelFor(state) {
    if (!state || !state.attempts) return 1;
    const mastery = state.correct / state.attempts;
    return mastery >= 0.8 ? 3 : mastery >= 0.5 ? 2 : 1;
}

// rows: the student's attempts, oldest first. student: their stored record.
function planSheet(student, rows, seed) {
    const random = questionGenerator.seededRandom(seed);
    const picked = [];
    const ids = new Set();
    const add = (question, reason) => {
        if (!question || ids.has(question.id) || picked.length >= SHEET_SIZE) return;
        ids.add(question.id);
        picked.push({ question, reason });
    };

    // 1. The mistakes they make most, in the topic they made them in.
    const mistakes = {};
    for (const row of rows.slice(-RECENT)) {
        const type = row.misconceptionDetected ? row.misconceptionType : null;
        if (!type || !questionGenerator.TRAPS[type] || !row.concept) continue;
        const key = `${type}|${row.concept}`;
        mistakes[key] = { type, concept: row.concept, count: (mistakes[key]?.count || 0) + 1 };
    }
    const top = Object.values(mistakes).sort((a, b) => b.count - a.count).slice(0, MAX_MISTAKES);
    for (const mistake of top) {
        for (let i = 0; i < PER_MISTAKE; i++) {
            add(questionGenerator.generateTrapQuestion({
                misconceptionType: mistake.type, concept: mistake.concept, excludeIds: [...ids], random
            }), studySessionService.labelMisconception(mistake.type));
        }
    }

    // 2. Their own topics, most practised first, at a fitting level.
    const concepts = Object.entries(student.concepts || {})
        .filter(([, state]) => state?.attempts > 0)
        .sort((a, b) => b[1].attempts - a[1].attempts);
    if (!concepts.length) concepts.push([FALLBACK_CONCEPT, null]);
    for (let round = 0; picked.length < SHEET_SIZE && round < SHEET_SIZE; round++) {
        for (const [concept, state] of concepts) {
            add(questionGenerator.generateQuestion({ concept, difficulty: levelFor(state), excludeIds: [...ids], random }), null);
        }
    }
    // The teacher's own questions can't be generated; fill any gap.
    for (let i = 0; picked.length < SHEET_SIZE && i < SHEET_SIZE * 3; i++) {
        add(questionGenerator.generateQuestion({ concept: FALLBACK_CONCEPT, difficulty: 1, excludeIds: [...ids], random }), null);
    }

    return picked.map(({ question, reason }) => ({
        id: question.id,
        question: question.question,
        concept: question.concept,
        answer: question.answer,
        reason
    }));
}

module.exports = { planSheet, SHEET_SIZE };
