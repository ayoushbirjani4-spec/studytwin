const { randomUUID } = require("node:crypto");
const { MongoClient } = require("mongodb");

const memoryAttempts = [];

function useMemoryStore() {
  return process.env.MEMORY_STORE === "1";
}

let client;
let clientPromise;

async function getCollection() {
  if (useMemoryStore()) {
    return null;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI must be configured to log student attempts."
    );
  }

  if (!clientPromise) {
    // Fail fast when MongoDB is down: the driver's default 30s wait
    // leaves the student staring at a spinner before the 503.
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS) || 5000
    });
    clientPromise = client.connect().catch((error) => {
      client = undefined;
      clientPromise = undefined;
      throw error;
    });
  }

  await clientPromise;
  return client
    .db(process.env.MONGODB_DB_NAME || "studytwin")
    .collection("student_attempts");
}

async function logAttempt(entry) {
  const doc = {
    _id: randomUUID(),
    studentId: entry.studentId,
    questionId: entry.questionId,
    concept: entry.concept,
    difficulty: entry.difficulty ?? null,
    studentAnswer: String(entry.studentAnswer ?? ""),
    work: String(entry.work ?? ""),
    answerCorrect: Boolean(entry.answerCorrect),
    demonstratedCorrect: Boolean(entry.demonstratedCorrect),
    misconceptionDetected: Boolean(entry.misconceptionDetected),
    misconceptionType: entry.misconceptionType ?? null,
    misconceptionSource: entry.misconceptionSource ?? null,
    targetedPracticeType: entry.targetedPracticeType ?? null,
    targetedPracticeSessionId: entry.targetedPracticeSessionId ?? null,
    targetedPracticePhase: entry.targetedPracticePhase ?? null,
    liveHintsSeen: Number.isInteger(entry.liveHintsSeen) ? entry.liveHintsSeen : 0,
    createdAt: new Date()
  };

  if (useMemoryStore()) {
    memoryAttempts.push(structuredClone(doc));
    return doc;
  }

  const collection = await getCollection();
  await collection.insertOne(doc);
  return doc;
}

async function listAttempts({ limit = 5000, studentId } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 5000, 1), 50000);

  if (useMemoryStore()) {
    let rows = memoryAttempts.slice();
    if (studentId) {
      rows = rows.filter((row) => row.studentId === studentId);
    }
    return rows.slice(-capped);
  }

  const collection = await getCollection();
  const filter = studentId ? { studentId } : {};
  return collection
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(capped)
    .toArray();
}

async function deleteAttemptsForStudent(studentId) {
  if (!studentId) {
    throw new Error("studentId is required to delete attempt history.");
  }

  if (useMemoryStore()) {
    let deletedCount = 0;
    for (let index = memoryAttempts.length - 1; index >= 0; index--) {
      if (memoryAttempts[index].studentId === studentId) {
        memoryAttempts.splice(index, 1);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  const collection = await getCollection();
  const result = await collection.deleteMany({ studentId });
  return result.deletedCount || 0;
}

function clearMemoryAttempts() {
  memoryAttempts.length = 0;
}

module.exports = {
  logAttempt,
  listAttempts,
  deleteAttemptsForStudent,
  clearMemoryAttempts,
  useMemoryStore
};
