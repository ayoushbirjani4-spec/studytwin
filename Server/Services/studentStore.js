const { MongoClient } = require("mongodb");

const memoryRecords = new Map();

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
    throw new Error("MONGODB_URI must be configured to store student progress.");
  }

  if (!clientPromise) {
    client = new MongoClient(uri);
    clientPromise = client.connect().catch((error) => {
      client = undefined;
      clientPromise = undefined;
      throw error;
    });
  }

  await clientPromise;
  return client
    .db(process.env.MONGODB_DB_NAME || "studytwin")
    .collection("student_progress");
}

async function get(studentId) {
  if (useMemoryStore()) {
    const student = memoryRecords.get(studentId);
    if (!student) {
      return null;
    }
    return structuredClone(student);
  }

  const collection = await getCollection();
  const student = await collection.findOne({ _id: studentId });

  if (!student) {
    return null;
  }

  const { _id, ...record } = student;
  return {
    ...record,
    studentId: _id,
    concepts: record.concepts || {},
    resetToken: record.resetToken || null,
    schemaVersion: record.schemaVersion || 1,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

async function connect() {
  if (useMemoryStore()) {
    return;
  }
  await getCollection();
}

async function save(student) {
  const now = new Date().toISOString();
  const { studentId, _id, ...studentMetadata } = student;

  if (useMemoryStore()) {
    const existing = memoryRecords.get(studentId);
    memoryRecords.set(studentId, {
      ...existing,
      ...studentMetadata,
      studentId,
      concepts: structuredClone(student.concepts || {}),
      resetToken: student.resetToken || existing?.resetToken || null,
      schemaVersion: student.schemaVersion || existing?.schemaVersion || 1,
      createdAt: student.createdAt || existing?.createdAt || now,
      updatedAt: now
    });
    return;
  }

  const collection = await getCollection();

  // Preserve existing metadata when replacing the progress document.
  const existing = await collection.findOne(
    { _id: studentId }
  );

  const doc = {
    ...existing,
    ...studentMetadata,
    _id: studentId,
    concepts: student.concepts || {},
    createdAt: student.createdAt || existing?.createdAt || now,
    updatedAt: now,
    schemaVersion: student.schemaVersion || existing?.schemaVersion || 1
  };

  doc.resetToken = student.resetToken || existing?.resetToken || null;

  await collection.replaceOne({ _id: studentId }, doc, { upsert: true });
}

async function remove(studentId) {
  if (useMemoryStore()) {
    return memoryRecords.delete(studentId);
  }

  const collection = await getCollection();
  const result = await collection.deleteOne({ _id: studentId });
  return result.deletedCount > 0;
}

function clearMemoryRecords() {
  memoryRecords.clear();
}

module.exports = {
  get,
  connect,
  save,
  remove,
  clearMemoryRecords,
  useMemoryStore
};
