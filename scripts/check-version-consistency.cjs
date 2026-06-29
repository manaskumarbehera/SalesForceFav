#!/usr/bin/env node
// Fails if manifest.json and package.json disagree on the version. The store
// release reads manifest.json; package.json is kept in lockstep for clarity.
// manifest uses "1.0" style; package.json uses semver "1.0.0" — compared on the
// shared major.minor(.patch) prefix.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const norm = (v) => String(v).split(".").map(Number);
const m = norm(manifest.version);
const p = norm(pkg.version);
const len = Math.min(m.length, p.length);
const mismatch = m.slice(0, len).join(".") !== p.slice(0, len).join(".");

if (mismatch) {
  console.error(
    `[check:versions] mismatch — manifest.json=${manifest.version} package.json=${pkg.version}`
  );
  process.exit(1);
}
console.log(`[check:versions] OK — manifest=${manifest.version} package=${pkg.version}`);
