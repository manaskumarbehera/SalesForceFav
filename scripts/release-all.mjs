#!/usr/bin/env node
/**
 * release-all.mjs — one-command release: bump the version and ship BOTH stores.
 *
 * Encodes the user's "publish" preference: bump, then submit to Chrome AND Edge
 * with no extra questions. The painful parts (OAuth token, store privacy/listing
 * fields) are ONE-TIME setup that persists across versions — this script assumes
 * they're done.
 *
 * Usage:
 *   npm run release                 # patch bump (1.0.0 -> 1.0.1), publish both
 *   npm run release -- --minor      # 1.0.0 -> 1.1.0
 *   npm run release -- --major      # 1.0.0 -> 2.0.0
 *   npm run release -- --set 1.2.3  # explicit version
 *   npm run release -- --dry        # bump + upload to each store DRAFT, no submit
 *   npm run release -- --skip-edge  # or --skip-chrome
 *   npm run release -- --no-git     # don't commit/tag the bump
 *
 * Notes:
 *  - Manifest + package.json are set to the SAME version string.
 *  - Per-store failures don't abort the other store; you get a summary.
 *  - Edge rejects a second submit while one is still in review — expected, not a
 *    script bug; that store just shows "failed" until the prior review clears.
 *  - Commits "release: vX.Y.Z" and tags vX.Y.Z locally (push yourself, or let
 *    .github/workflows/release.yml pick up the tag).
 */

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const DRY = has("--dry") || has("--dry-run");
const NO_GIT = has("--no-git");
const SKIP_CHROME = has("--skip-chrome");
const SKIP_EDGE = has("--skip-edge");
const log = (m) => console.log(`[release] ${m}`);
const die = (m) => {
  console.error(`[release] ERR ${m}`);
  process.exit(1);
};

// ─── Version bump ────────────────────────────────────────────────────────────
function bump(v, kind) {
  const p = String(v)
    .split(".")
    .map((n) => Number(n) || 0);
  while (p.length < 3) p.push(0);
  if (kind === "major") (p[0]++, (p[1] = 0), (p[2] = 0));
  else if (kind === "minor") (p[1]++, (p[2] = 0));
  else p[2]++; // patch (default)
  return p.slice(0, 3).join(".");
}

const pkgPath = path.join(ROOT, "package.json");
const manifestPath = path.join(ROOT, "manifest.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const setIdx = args.indexOf("--set");
const explicit = setIdx >= 0 ? args[setIdx + 1] : null;
if (setIdx >= 0 && !/^\d+\.\d+\.\d+$/.test(explicit || "")) die("--set needs an X.Y.Z version.");
const kind = has("--major") ? "major" : has("--minor") ? "minor" : "patch";
const nextVersion = explicit || bump(pkg.version, kind);
log(`Version: ${pkg.version} -> ${nextVersion}${DRY ? "  (DRY: draft upload only)" : ""}`);

// ─── Git hygiene: refuse a REAL release on a dirty tree (tracked files) ─────
// (--dry restores the version files afterward, so a dirty tree is fine there.)
if (!NO_GIT && !DRY) {
  const dirty = execSync("git status --porcelain --untracked-files=no", { cwd: ROOT })
    .toString()
    .trim();
  if (dirty)
    die("working tree has uncommitted changes — commit or stash first (or pass --no-git).");
}

// ─── Write the new version to both files (remembering originals for --dry) ──
const origManifest = fs.readFileSync(manifestPath, "utf8");
const origPkg = fs.readFileSync(pkgPath, "utf8");
manifest.version = nextVersion;
pkg.version = nextVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
execFileSync("node", [path.join(ROOT, "scripts", "check-version-consistency.cjs")], {
  stdio: "inherit",
});

// ─── Publish each store; collect outcomes (don't abort on one failure) ───────
const flag = DRY ? "--dry-run" : "--publish";
const results = {};
function ship(store, script) {
  log(`▶ ${store}: node scripts/${script} ${flag}`);
  try {
    execFileSync("node", [path.join(ROOT, "scripts", script), flag], {
      cwd: ROOT,
      stdio: "inherit",
    });
    results[store] = "ok";
  } catch {
    results[store] = "FAILED";
  }
}
if (!SKIP_CHROME) ship("chrome", "release-chrome.mjs");
if (!SKIP_EDGE) ship("edge", "release-edge.mjs");

// In --dry mode, restore the version files so the test leaves no trace.
if (DRY) {
  fs.writeFileSync(manifestPath, origManifest);
  fs.writeFileSync(pkgPath, origPkg);
  log("DRY: restored manifest.json + package.json to their original versions.");
}

// ─── Git commit + tag (only on a real, non-dry release) ──────────────────────
const anyShipped = Object.values(results).some((r) => r === "ok");
if (!NO_GIT && !DRY && anyShipped) {
  try {
    execSync(`git add manifest.json package.json`, { cwd: ROOT });
    execSync(`git commit -m "release: v${nextVersion}"`, { cwd: ROOT });
    execSync(`git tag v${nextVersion}`, { cwd: ROOT });
    log(`Committed + tagged v${nextVersion}. Push with: git push --follow-tags`);
  } catch {
    log("Could not commit/tag (non-fatal) — version files are bumped; commit them yourself.");
  }
} else if (!DRY && !anyShipped) {
  log("Both stores failed — leaving the version bump uncommitted so you can retry/revert.");
}

// ─── Summary ─────────────────────────────────────────────────────────────────
log("──────── summary ────────");
log(`version: ${nextVersion}${DRY ? " (dry)" : ""}`);
for (const [store, r] of Object.entries(results)) log(`${store}: ${r === "ok" ? "✓" : "✗ " + r}`);
const failed = Object.values(results).filter((r) => r !== "ok").length;
if (failed) {
  log("A store failed. Common causes: Edge submission already in review; a store's");
  log(
    "one-time listing/privacy fields not yet completed (DOCUMENTATION/store-privacy-answers.md)."
  );
  process.exit(1);
}
log("Both stores submitted. ✓");
