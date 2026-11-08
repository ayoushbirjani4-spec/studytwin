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

module.exports = async function handler(request, response) {
  const path = (request.url || "").split("?")[0];

  // Answers without the database, so a broken deployment can be diagnosed.
  if (path === "/api/health") {
    return response.status(200).json({
      status: "ok",
      environment: process.env.VERCEL_ENV || "unknown",
      settings: configuredSettings()
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
    const notConfigured = /MONGODB_URI must be configured/.test(String(error?.message));
    return response.status(503).json({
      success: false,
      error: "Student progress storage is unavailable.",
      reason: notConfigured ? "database_not_configured" : "database_connection_failed"
    });
  }
};
