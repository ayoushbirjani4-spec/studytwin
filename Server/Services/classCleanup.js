// ============================================================
// CLOSING CLASSES
// ============================================================
//
// closeClass: a teacher deletes their class (e.g. at the end of the year).
//   Every real student leaves it, as with "Remove": their own practice is
//   theirs and is kept, and their parent link stops working. Sample
//   students (demo: true) belong to nobody and are deleted with their
//   sample answers. Then the class record goes.
//
// cleanUpOldDemos: sample classes are deleted the same way once they are a
//   day old, so trying the demo doesn't leave data behind.
// ============================================================

const classStore = require("./classStore");
const studentStore = require("./studentStore");
const attemptLogStore = require("./attemptLogStore");

const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;

// Returns how many students were in the class.
async function closeClass(code) {
    const members = await studentStore.listByClass(code);
    for (const member of members) {
        if (member.demo) {
            await attemptLogStore.deleteAttemptsForStudent(member.studentId);
            await studentStore.remove(member.studentId);
        } else {
            await studentStore.leaveClass(member.studentId);
        }
    }
    await classStore.remove(code);
    return members.length;
}

// Returns how many sample classes were deleted.
async function cleanUpOldDemos(now = Date.now()) {
    const codes = await classStore.listDemoClassesBefore(new Date(now - DEMO_LIFETIME_MS).toISOString());
    for (const code of codes) await closeClass(code);
    return codes.length;
}

module.exports = { closeClass, cleanUpOldDemos, DEMO_LIFETIME_MS };
