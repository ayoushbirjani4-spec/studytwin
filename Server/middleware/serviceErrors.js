const DATABASE_UNAVAILABLE_NAMES = new Set([
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoNotConnectedError"
]);

function isDatabaseUnavailable(error) {
  const message = String(error?.message || "");
  return DATABASE_UNAVAILABLE_NAMES.has(error?.name) ||
    [
      "ECONNREFUSED",
      "ENOTFOUND",
      "MongoServerSelectionError",
      "topology was destroyed",
      "connection timed out",
      "not connected to MongoDB",
      "MONGODB_URI must be configured"
    ].some((fragment) => message.includes(fragment));
}

function serviceStatus(error) {
  return error?.statusCode || (isDatabaseUnavailable(error) ? 503 : 500);
}

module.exports = { isDatabaseUnavailable, serviceStatus };
