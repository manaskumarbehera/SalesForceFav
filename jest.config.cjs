// Jest runs the suite in tests/. jsdom provides a DOM for any UI-adjacent tests;
// the credential/URL logic is environment-agnostic pure JavaScript.
module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.js"],
  clearMocks: true,
};
