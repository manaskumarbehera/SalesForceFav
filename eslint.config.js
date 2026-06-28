"use strict";

// Flat ESLint config (ESLint 9+). The extension runtime sources (popup/*.js) run
// in the browser; the dev tooling (scripts/, tests/, *.cjs, *.mjs) runs in Node.

const js = require("@eslint/js");

const browserGlobals = {
  chrome: "readonly",
  document: "readonly",
  window: "readonly",
  location: "readonly",
  navigator: "readonly",
  console: "readonly",
  alert: "readonly",
  fetch: "readonly",
  Image: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  MutationObserver: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  Promise: "readonly",
  URL: "readonly",
  Blob: "readonly",
  localStorage: "readonly",
  self: "readonly",
  globalThis: "readonly",
  // Shared module (popup/credentials.js) exposed on the global as SFFav.
  SFFav: "readonly",
};

const nodeGlobals = {
  module: "writable",
  require: "readonly",
  process: "readonly",
  __dirname: "readonly",
  console: "readonly",
  global: "writable",
  URL: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
};

const jestGlobals = {
  describe: "readonly",
  test: "readonly",
  it: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  jest: "readonly",
};

module.exports = [
  {
    ignores: ["node_modules/**", "build/**", "dist/**", "coverage/**", "*.zip"],
  },
  js.configs.recommended,
  {
    // Extension popup source — runs in the browser.
    files: ["popup/popup.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Universal shared module — runs in the browser and in Node (jest).
    files: ["popup/credentials.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...browserGlobals, module: "writable" },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    // Dev tooling — ES module scripts.
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    // Tests and CommonJS config. Tests use jsdom DOM globals, so include the
    // browser set too.
    files: ["tests/**", "**/*.cjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...browserGlobals, ...nodeGlobals, ...jestGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
];
