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

function clearMemoryClasses() {
  memoryClasses.clear();
}

module.exports = { create, get, normaliseCode, teacherKeyMatches, clearMemoryClasses };
