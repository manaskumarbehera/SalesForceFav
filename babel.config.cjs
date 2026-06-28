// Babel is used ONLY by Jest (via babel-jest) to transpile any ES-module syntax
// in tests/sources down to CommonJS for the test runner. The extension itself
// ships as plain scripts and does not use this config.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
};
