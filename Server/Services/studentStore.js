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
    revision: record.revision || 0,
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

  // Optimistic concurrency: only replace the revision this request read.
  // If another instance saved in between, the filter misses, the upsert
  // collides on _id, and the request fails instead of silently overwriting.
  const expectedRevision = student.revision || 0;
  doc.revision = expectedRevision + 1;
  const filter = expectedRevision === 0
    ? { _id: studentId, $or: [{ revision: { $exists: false } }, { revision: 0 }] }
    : { _id: studentId, revision: expectedRevision };

  try {
    await collection.replaceOne(filter, doc, { upsert: true });
  } catch (error) {
    if (error?.code === 11000) {
      const conflict = new Error(
        "Your progress was updated by another request at the same time. Refresh and try again."
      );
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
  student.revision = doc.revision;
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
