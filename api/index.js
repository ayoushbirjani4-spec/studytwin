// Vercel serverless entry point: every /api/* request is rewritten here
// (see vercel.json) and handled by the Express app with its original path.
const { app } = require("../Server");
const studentStore = require("../Server/Services/studentStore");

// Which settings this deployment can see: yes/no only, never values.
function configuredSettings() {
  const has = (name) => Boolean((process.env[name] || "").trim());
  return {
    MONGODB_URI: has("MONGODB_URI"),
    MONGODB_DB_NAME: has("MONGODB_DB_NAME"),
    ML_API_URL: has("ML_API_URL"),
    GEMINI_API_KEY: has("GEMINI_API_KEY"),
    GEMINI_MODEL: has("GEMINI_MODEL"),
    MEMORY_STORE: has("MEMORY_STORE")
  };
}

// Yes/no checks on the connection string's format. Reveals no part of it
// (no host, user or password), only whether common copy-paste mistakes exist.
function describeMongoUri(raw) {
  if (!raw) return null;
  const value = String(raw);
  const trimmed = value.trim();
  const afterScheme = trimmed.replace(/^mongodb(\+srv)?:\/\//, "");
  const credentials = afterScheme.includes("@") ? afterScheme.slice(0, afterScheme.lastIndexOf("@")) : "";
  return {
    startsWithMongodbScheme: /^mongodb(\+srv)?:\/\//.test(trimmed),
    hasLeadingOrTrailingSpace: value !== trimmed,
    containsLineBreak: /[\r\n]/.test(value),
    wrappedInQuotes: /^["'].*["']$/.test(trimmed),
    includesVariableName: /MONGODB_URI\s*=/.test(trimmed),
    stillHasPasswordPlaceholder: /<db_password>|<password>/.test(trimmed),
    atSignCount: (afterScheme.match(/@/g) || []).length,          // should be 1
    passwordHasUnencodedSpecialChars: /[:/?#[\]@]/.test(credentials.split(":").slice(1).join(":")),
    length: value.length
  };
}

// A short code for why MongoDB failed, safe to show publicly (no details).
function classifyDatabaseError(error) {
  // The driver often wraps the real cause (e.g. a bad password) inside a
  // server-selection error, so read the nested messages too.
  const message = [error, error?.cause, error?.reason, ...Object.values(error?.reason?.servers || {}).map((s) => s?.error)]
    .map((e) => String(e?.message || ""))
    .join(" | ");
  if (/MONGODB_URI must be configured/.test(message)) {
    return "database_not_configured";        // variable missing
  }
  if (error?.name === "MongoParseError" || /Invalid scheme|URI must include|Invalid connection string/i.test(message)) {
    return "database_uri_invalid";           // malformed connection string
  }
  if (error?.code === 18 || /bad auth|authentication failed/i.test(message)) {
    return "database_auth_failed";           // wrong username or password
  }
  if (/querySrv|ENOTFOUND|getaddrinfo/i.test(message)) {
    return "database_host_not_found";        // wrong cluster address
  }
  if (error?.name === "MongoServerSelectionError") {
    return "database_unreachable";           // e.g. IP not allowed in Atlas
  }
  return "database_connection_failed";
}

module.exports = async function handler(request, response) {
  const path = (request.url || "").split("?")[0];

  // Answers without the database, so a broken deployment can be diagnosed.
  if (path === "/api/health") {
    return response.status(200).json({
      status: "ok",
      environment: process.env.VERCEL_ENV || "unknown",
      settings: configuredSettings(),
      mongodbUriShape: describeMongoUri(process.env.MONGODB_URI)
    });
  }

  try {
    if (!studentStore.useMemoryStore()) {
      await studentStore.connect();
    }
    return app(request, response);
  } catch (error) {
    console.error("MongoDB connection failed for API request:", error);

    // Say which kind of failure it is (never any connection details), so a
    // missing environment variable is distinguishable from a refused login.
    return response.status(503).json({
      success: false,
      error: "Student progress storage is unavailable.",
      reason: classifyDatabaseError(error)
    });
  }
};
