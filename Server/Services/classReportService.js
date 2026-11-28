// ============================================================
// CLASS REPORT
// ============================================================
//
// What a teacher sees for one class:
//   - each student: how they are doing and which mistake they are stuck on
//   - the class's common mistakes, and who is stuck on each
//   - evidence: the Twin Effect and trap-round cures pooled across the
//     class, with the numbers behind every rate so nothing is overclaimed
// ============================================================

const studentStore = require("./studentStore");
const attemptLogStore = require("./attemptLogStore");
const twinService = require("./twinService");
const studySessionService = require("./studySessionService");
const customQuestions = require("./customQuestions");
const parentTips = require("./parentTips");

const RECENT_WINDOW = 10;     // "stuck" looks at a student's last 10 answers
const STUCK_THRESHOLD = 3;    // the same mistake 3+ times in those 10
const COMMON_WINDOW = 20;     // common mistakes look at each student's last 20
const ATTEMPTS_PER_STUDENT = 400;
const CURE_SETTLED_AFTER = 5; // answers on the topic before a cure "held"
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const label = (type) => studySessionService.labelMisconception(type);

function chronological(rows) {
    return rows
        .filter((row) => row && row.createdAt)
        .map((row) => ({ ...row, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function countMistakes(rows) {
    const counts = {};
    for (const row of rows) {
        if (row.misconceptionDetected && row.misconceptionType && row.misconceptionType !== "incomplete_solution") {
            counts[row.misconceptionType] = (counts[row.misconceptionType] || 0) + 1;
        }
    }
    return counts;
}

function summariseStudent(student, rows, now) {
    const recent = rows.slice(-RECENT_WINDOW);
    const recentCounts = countMistakes(recent);
    const [stuckType, stuckCount] = Object.entries(recentCounts).sort((a, b) => b[1] - a[1])[0] || [];
    const last20 = rows.slice(-COMMON_WINDOW);
    const lastActive = rows.at(-1)?.createdAt || null;

    return {
        studentId: student.studentId,
        name: student.displayName || "Unnamed",
        joinedAt: student.joinedClassAt || null,
        answers: rows.length,
        lastActive,
        activeThisWeek: Boolean(lastActive && now - new Date(lastActive) < WEEK_MS),
        recentAccuracy: last20.length
            ? Number((last20.filter((row) => row.demonstratedCorrect).length / last20.length).toFixed(2))
            : null,
        // Hint ladder: hints asked for per answer, over the last 20.
        hintsPerAnswer: last20.length
            ? Number((last20.reduce((sum, row) => sum + (row.hintsUsed || 0), 0) / last20.length).toFixed(1))
            : null,
        stuckOn: stuckCount >= STUCK_THRESHOLD
            ? { type: stuckType, label: label(stuckType), count: stuckCount, outOf: recent.length }
            : null,
        recentMistakes: countMistakes(last20),
        // For the printed report: mastery by topic, and the latest answers.
        topics: Object.entries(student.concepts || {})
            .filter(([, state]) => state.attempts > 0)
            .map(([concept, state]) => ({ concept, attempts: state.attempts, mastery: Number((state.correct / state.attempts).toFixed(2)) }))
            .sort((a, b) => b.attempts - a.attempts),
        recentWork: rows.slice(-5).reverse().map((row) => ({
            createdAt: row.createdAt,
            concept: row.concept,
            correct: Boolean(row.demonstratedCorrect),
            mistake: row.misconceptionDetected && row.misconceptionType ? label(row.misconceptionType) : null
        })),
        cured: studySessionService.summariseCuredMistakes(student.curedMistakes, rows),
        twinEffect: twinService.computeTwinEffect(rows, student.twin),
        taughtTwin: Object.values(student.twin?.taught || {}).reduce((sum, n) => sum + n, 0)
    };
}

// Pool each student's before/after counts for one mistake. Only students
// with enough answers on both sides count; everyone else is "collecting".
function pooledTwinEffect(students) {
    const byType = {};
    for (const student of students) {
        for (const effect of student.twinEffect) {
            const entry = byType[effect.type] ||= {
                type: effect.type, label: label(effect.type),
                students: 0, collecting: 0,
                before: { errors: 0, attempts: 0 }, after: { errors: 0, attempts: 0 },
                outcomes: { improved: 0, unchanged: 0, not_yet: 0 }
            };
            if (!["improved", "unchanged", "not_yet"].includes(effect.status)) {
                entry.collecting += 1;
                continue;
            }
            entry.students += 1;
            entry.outcomes[effect.status] += 1;
            entry.before.errors += effect.before.errors;
            entry.before.attempts += effect.before.attempts;
            entry.after.errors += effect.after.errors;
            entry.after.attempts += effect.after.attempts;
        }
    }
    return Object.values(byType)
        .map((entry) => {
            const beforeRate = entry.before.attempts ? entry.before.errors / entry.before.attempts : null;
            const afterRate = entry.after.attempts ? entry.after.errors / entry.after.attempts : null;
            return {
                ...entry,
                before: { ...entry.before, rate: beforeRate === null ? null : Number(beforeRate.toFixed(4)) },
                after: { ...entry.after, rate: afterRate === null ? null : Number(afterRate.toFixed(4)) },
                // Relative change: -0.4 means the mistake happened 40% less often.
                change: beforeRate ? Number(((afterRate - beforeRate) / beforeRate).toFixed(4)) : null
            };
        })
        .sort((a, b) => b.students - a.students || b.collecting - a.collecting);
}

function cureSummary(students) {
    const all = students.flatMap((student) => student.cured);
    return {
        total: all.length,
        held: all.filter((c) => c.cameBack === 0 && c.answersSince >= CURE_SETTLED_AFTER).length,
        cameBack: all.filter((c) => c.cameBack > 0).length,
        tooSoon: all.filter((c) => c.cameBack === 0 && c.answersSince < CURE_SETTLED_AFTER).length,
        settledAfter: CURE_SETTLED_AFTER,
        // Surprise check-ups after 2 and 7 days: of those answered, how many held.
        checkups: [2, 7].map((days) => {
            const answered = all
                .map((c) => (c.checkups || []).find((k) => k.days === days))
                .filter((k) => k && (k.result === "held" || k.result === "slipped"));
            return { days, answered: answered.length, held: answered.filter((k) => k.result === "held").length };
        })
    };
}

// Study mode: each group's mistake rate before the study and since, pooled.
// Before uses each student's last 20 answers before it started.
function studyComparison(classRecord, entries) {
    const since = new Date(classRecord.study.startedAt);
    const empty = () => ({ students: [], before: { errors: 0, attempts: 0 }, after: { errors: 0, attempts: 0 } });
    const groups = { twin: empty(), practice: empty() };
    const mistakes = (rows) => rows.filter((row) => row.misconceptionDetected).length;
    for (const { name, rows, member } of entries) {
        const group = groups[studySessionService.studyGroup(member.studentId, classRecord.code, classRecord.study)];
        const before = rows.filter((row) => new Date(row.createdAt) < since).slice(-20);
        const after = rows.filter((row) => new Date(row.createdAt) >= since);
        group.students.push(name);
        group.before.errors += mistakes(before);
        group.before.attempts += before.length;
        group.after.errors += mistakes(after);
        group.after.attempts += after.length;
    }
    for (const group of Object.values(groups)) {
        for (const side of [group.before, group.after]) side.rate = side.attempts ? Number((side.errors / side.attempts).toFixed(4)) : null;
        group.change = group.before.rate && group.after.rate !== null
            ? Number(((group.after.rate - group.before.rate) / group.before.rate).toFixed(4)) : null;
    }
    return { startedAt: classRecord.study.startedAt, groups };
}

async function buildClassReport(classRecord, { now = Date.now() } = {}) {
    const members = await studentStore.listByClass(classRecord.code);

    const students = [];
    const homeworkRows = [];
    for (const member of members) {
        const rows = chronological(await attemptLogStore.listAttempts({
            studentId: member.studentId,
            limit: ATTEMPTS_PER_STUDENT
        }));
        students.push(summariseStudent(member, rows, now));
        homeworkRows.push({ name: member.displayName || "Unnamed", rows, member });
    }

    // Homework: who has finished, started or not started each assignment.
    const assignments = (classRecord.assignments || []).map((assignment) => {
        const progress = homeworkRows
            .map(({ name, rows, member }) => ({ name, ...studySessionService.homeworkProgress(assignment, rows, member) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            ...assignment,
            finished: progress.filter((p) => p.finished).length,
            started: progress.filter((p) => !p.finished && (p.done > 0 || p.trapsAnswered > 0)).length,
            notStarted: progress.filter((p) => !p.finished && p.done === 0 && !p.trapsAnswered).length,
            students: progress
        };
    });
    students.sort((a, b) => a.name.localeCompare(b.name));

    // Common mistakes: how many students made each in their last 20 answers.
    const mistakes = {};
    for (const student of students) {
        for (const [type, count] of Object.entries(student.recentMistakes)) {
            const entry = mistakes[type] ||= { type, label: label(type), students: 0, occurrences: 0, stuck: [] };
            entry.students += 1;
            entry.occurrences += count;
        }
        if (student.stuckOn) {
            const entry = mistakes[student.stuckOn.type];
            if (entry) entry.stuck.push(student.name);
        }
    }

    return {
        class: { code: classRecord.code, name: classRecord.name, createdAt: classRecord.createdAt, joinsClosed: Boolean(classRecord.joinsClosed) },
        generatedAt: new Date(now).toISOString(),
        totals: {
            students: students.length,
            activeThisWeek: students.filter((s) => s.activeThisWeek).length,
            answers: students.reduce((sum, s) => sum + s.answers, 0),
            stuck: students.filter((s) => s.stuckOn).length
        },
        rules: { stuck: `the same mistake ${STUCK_THRESHOLD}+ times in their last ${RECENT_WINDOW} answers`, commonWindow: COMMON_WINDOW },
        students: students.map(({ twinEffect, studentId, ...rest }) => ({
            ...rest,
            id: studentId.slice(-6),
            twinEffect: twinEffect.map((e) => ({ type: e.type, label: label(e.type), status: e.status, before: e.before, after: e.after }))
        })),
        assignments,
        study: classRecord.study ? studyComparison(classRecord, homeworkRows) : null,
        // The teacher's own questions, with the answers StudyTwin worked out.
        questions: (classRecord.questions || [])
            .map((id) => customQuestions.fromId(id))
            .filter(Boolean)
            .map(({ id, question, answer }) => ({ id, question, answer })),
        mistakes: Object.values(mistakes).sort((a, b) => b.students - a.students || b.occurrences - a.occurrences),
        evidence: {
            twinEffect: pooledTwinEffect(students),
            cures: cureSummary(students)
        }
    };
}

// Attempts for the whole class, oldest first, with students numbered
// S01, S02… instead of named, for a study export or labelling.
async function exportClassAttempts(classRecord, { blind = false } = {}) {
    const members = (await studentStore.listByClass(classRecord.code))
        .sort((a, b) => String(a.joinedClassAt).localeCompare(String(b.joinedClassAt)));
    const rows = [];
    for (const [index, member] of members.entries()) {
        const attempts = chronological(await attemptLogStore.listAttempts({ studentId: member.studentId, limit: 5000 }));
        for (const row of attempts) {
            rows.push({
                student: `S${String(index + 1).padStart(2, "0")}`,
                createdAt: row.createdAt,
                questionId: row.questionId,
                concept: row.concept,
                difficulty: row.difficulty,
                studentAnswer: row.studentAnswer,
                work: row.work,
                answerCorrect: row.answerCorrect,
                demonstratedCorrect: row.demonstratedCorrect,
                ...(blind ? { gold: "" } : {
                    misconceptionType: row.misconceptionType || "",
                    misconceptionSource: row.misconceptionSource || ""
                }),
                phase: row.targetedPracticePhase || ""
            });
        }
    }
    return rows
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((row, index) => ({ id: index + 1, ...row }));
}

function toCsv(rows) {
    if (!rows.length) return "";
    const columns = Object.keys(rows[0]);
    const cell = (value) => {
        const text = value === null || value === undefined ? "" : String(value);
        // Quote everything; a leading = + @ is prefixed so spreadsheets
        // don't run student-typed text as a formula. (A leading minus is
        // left alone: working like "-3x = 6" must stay exact for labelling.)
        const safe = /^[=+@\t\r]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
    };
    return [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\r\n");
}

// One student's report, for the parent link: the same fields as a row of
// the class report, without ids.
async function buildStudentReport(student) {
    const rows = chronological(await attemptLogStore.listAttempts({ studentId: student.studentId, limit: ATTEMPTS_PER_STUDENT }));
    const { studentId, twinEffect, ...rest } = summariseStudent(student, rows, Date.now());
    // Parent link only: how to help with the mistakes being made most. The
    // practice question stays the same for the day.
    const day = new Date().toISOString().slice(0, 10);
    const helpAtHome = parentTips.helpAtHome(rows, { stuckOn: rest.stuckOn, seed: `${studentId}:${day}` })
        .map((tip) => ({ ...tip, label: label(tip.type) }));
    return { ...rest, helpAtHome, twinEffect: twinEffect.map((e) => ({ type: e.type, label: label(e.type), status: e.status, before: e.before, after: e.after })) };
}

module.exports = { buildClassReport, buildStudentReport, exportClassAttempts, toCsv, STUCK_THRESHOLD, RECENT_WINDOW };
