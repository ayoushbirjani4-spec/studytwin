// Classes: a short code students join with, and a teacher key that opens
// the class page. Only a hash of the teacher key is stored.
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { MongoClient } = require("mongodb");

const memoryClasses = new Map();

// No 0/O or 1/I/L, so codes read cleanly off a whiteboard.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function useMemoryStore() {
  return process.env.MEMORY_STORE === "1";
}

let client;
let clientPromise;

async function getCollection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI must be configured to store student progress.");
  if (!clientPromise) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS) || 5000 });
    clientPromise = client.connect().catch((error) => {
      client = undefined;
      clientPromise = undefined;
      throw error;
    });
  }
  await clientPromise;
  return client.db(process.env.MONGODB_DB_NAME || "studytwin").collection("classes");
}

function hashKey(key) {
  return createHash("sha256").update(String(key)).digest("hex");
}

function newCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function normaliseCode(code) {
  const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === CODE_LENGTH && [...clean].every((c) => CODE_ALPHABET.includes(c)) ? clean : null;
}

async function create({ name }) {
  const teacherKey = randomBytes(24).toString("base64url");
  const record = {
    name: String(name || "").trim().slice(0, 60) || "My class",
    teacherKeyHash: hashKey(teacherKey),
    createdAt: new Date().toISOString()
  };

  // A clash is very unlikely (31^6 codes), but retry rather than overwrite.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    if (useMemoryStore()) {
      if (memoryClasses.has(code)) continue;
      memoryClasses.set(code, { ...record, code });
      return { code, name: record.name, teacherKey };
    }
    try {
      await (await getCollection()).insertOne({ _id: code, ...record });
      return { code, name: record.name, teacherKey };
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw new Error("Could not create a unique class code.");
}

async function get(code) {
  const clean = normaliseCode(code);
  if (!clean) return null;
  if (useMemoryStore()) {
    const found = memoryClasses.get(clean);
    return found ? structuredClone(found) : null;
  }
  const found = await (await getCollection()).findOne({ _id: clean });
  if (!found) return null;
  const { _id, ...rest } = found;
  return { ...rest, code: _id };
}

function teacherKeyMatches(classRecord, key) {
  if (!classRecord || typeof key !== "string" || !key) return false;
  const a = Buffer.from(classRecord.teacherKeyHash, "hex");
  const b = Buffer.from(hashKey(key), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------
// Class twin polls: the class votes from their phones on which line
// the twin got wrong. One poll per class at a time, kept on the class
// record so every serverless instance sees the same votes.
// ------------------------------------------------------------

// poll: { id, questionId, misconceptionType, variant, open, votes: { voterId: lineIndex } }
async function setPoll(code, poll) {
  const clean = normaliseCode(code);
  if (useMemoryStore()) {
    const found = memoryClasses.get(clean);
    if (found) found.poll = structuredClone(poll);
    return;
  }
  await (await getCollection()).updateOne({ _id: clean }, { $set: { poll } });
}

async function closePoll(code, pollId) {
  const clean = normaliseCode(code);
  if (useMemoryStore()) {
    const poll = memoryClasses.get(clean)?.poll;
    if (poll?.id === pollId) poll.open = false;
    return;
  }
  await (await getCollection()).updateOne({ _id: clean, "poll.id": pollId }, { $set: { "poll.open": false } });
}

// One vote per voter (they can change it) while the poll is open.
// Returns false if the poll has moved on or closed.
async function vote(code, pollId, voterId, lineIndex) {
  const clean = normaliseCode(code);
  if (useMemoryStore()) {
    const poll = memoryClasses.get(clean)?.poll;
    if (!poll || poll.id !== pollId || !poll.open) return false;
    poll.votes[voterId] = lineIndex;
    return true;
  }
  const result = await (await getCollection()).updateOne(
    { _id: clean, "poll.id": pollId, "poll.open": true },
    { $set: { [`poll.votes.${voterId}`]: lineIndex } }
  );
  return result.matchedCount > 0;
}

// ------------------------------------------------------------
// Homework: { id, concept, count, dueDate: "YYYY-MM-DD", createdAt }
// Progress isn't stored: it is counted from the students' answers.
// ------------------------------------------------------------

const MAX_ASSIGNMENTS = 20;

async function addAssignment(code, assignment) {
  const clean = normaliseCode(code);
  if (useMemoryStore()) {
    const found = memoryClasses.get(clean);
    if (found) found.assignments = [...(found.assignments || []), structuredClone(assignment)].slice(-MAX_ASSIGNMENTS);
    return;
  }
  await (await getCollection()).updateOne(
    { _id: clean },
    { $push: { assignments: { $each: [assignment], $slice: -MAX_ASSIGNMENTS } } }
  );
}

async function removeAssignment(code, id) {
  const clean = normaliseCode(code);
  if (useMemoryStore()) {
    const found = memoryClasses.get(clean);
    if (found) found.assignments = (found.assignments || []).filter((a) => a.id !== id);
    return;
  }
  await (await getCollection()).updateOne({ _id: clean }, { $pull: { assignments: { id } } });
}

// ------------------------------------------------------------
// The teacher's own questions: a list of question ids (see customQuestions).
// ------------------------------------------------------------

const MAX_QUESTIONS = 50;

// Study mode: { startedAt } while running, null when off.
async function setStudy(code, study) {
  const clean = normaliseCode(code);
  if (useMemoryStore()) {
    const found = memoryClasses.get(clean);
    if (found) found.study = study ? { ...study } : null;
    return;
  }
  await (await getCollection()).updateOne({ _id: clean }, { $set: { study } });
}

async function setQuestions(code, ids) {
  const clean = normaliseCode(code);
  const list = [...new Set(ids)].slice(0, MAX_QUESTIONS);
  if (useMemoryStore()) {
    const found = memoryClasses.get(clean);
    if (found) found.questions = list;
    return;
  }
  await (await getCollection()).updateOne({ _id: clean }, { $set: { questions: list } });
}

function clearMemoryClasses() {
  memoryClasses.clear();
}

module.exports = {
  create, get, normaliseCode, teacherKeyMatches,
  setPoll, closePoll, vote,
  addAssignment, removeAssignment,
  setQuestions, MAX_QUESTIONS,
  setStudy,
  clearMemoryClasses
};
