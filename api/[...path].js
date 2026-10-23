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
    return response.status(503).json({
      success: false,
      error: "Student progress storage is unavailable."
    });
  }
};
