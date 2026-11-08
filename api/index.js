// Vercel serverless entry point: every /api/* request is rewritten here
// (see vercel.json) and handled by the Express app with its original path.
const { app } = require("../Server");
const studentStore = require("../Server/Services/studentStore");

module.exports = async function handler(request, response) {
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
