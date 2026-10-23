const { mock } = require("node:test");
const misconceptionService = require("../Services/misconceptionService");
const attemptLogStore = require("../Services/attemptLogStore");

// Silence the ML step-classifier HTTP call so test output stays clean.
// Tests that need to verify ML behaviour mock predictStepWithML themselves.
mock.method(misconceptionService, "predictStepWithML", async () => null);

// Silence the attempt-log MongoDB calls (MONGODB_URI is not set in the test
// environment; the real logAttempt would otherwise print an error for every
// recordAnswer call).
mock.method(attemptLogStore, "logAttempt", async () => null);
