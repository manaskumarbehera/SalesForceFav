#!/usr/bin/env node
/**
 * release-chrome.mjs
 *
 * Automated Chrome Web Store release for SalesForceFav, using the official Chrome
 * Web Store API (OAuth refresh-token → upload → publish). Mirrors the mechanism
 * used by the sibling TrackForcePro / Week Number extensions.
 *
 * Usage:
 *   npm run release:chrome:dry        # Build + upload to the draft only (no publish)
 *   npm run release:chrome:publish    # Build + upload + submit for review
 *   node scripts/release-chrome.mjs --publish
 *
 * Credentials (read from the environment, or a local .env at the repo root):
 *   CHROME_EXTENSION_ID                       (the store item ID for SalesForceFav)
 *   CHROME_CLIENT_ID     / GOOGLE_CLIENT_ID
 *   CHROME_CLIENT_SECRET / GOOGLE_CLIENT_SECRET
 *   CHROME_REFRESH_TOKEN / GOOGLE_REFRESH_TOKEN
 *
 * SAFETY: publish is opt-in. Without --publish (or PUBLISH=true) the script
 * uploads to the draft and stops, so a run can never accidentally submit.
 * See DOCUMENTATION/CHROME_WEBSTORE_RELEASE.md for first-time setup.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const log = (msg) => console.log(`[release-chrome] ${msg}`);
const logOk = (msg) => console.log(`[release-chrome] OK  ${msg}`);
const logErr = (msg) => console.error(`[release-chrome] ERR ${msg}`);

// ─── Load .env (if present) without a dependency ─────────────────────────────
// Lines are KEY=VALUE; existing process.env values win so CI secrets override.
function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

// ─── Flags ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN =
  args.includes("--dry-run") || args.includes("--dry") || process.env.DRY_RUN === "true";
const PUBLISH =
  args.includes("--publish") || process.env.PUBLISH === "true" || process.env.PUBLISH === "1";
const SKIP_VERSION_CHECK =
  args.includes("--skip-version-check") || process.env.SKIP_VERSION_CHECK === "true";

// ─── 1. Validate credentials ─────────────────────────────────────────────────
const readSecret = (canonical, alias) =>
  process.env[canonical] || (alias ? process.env[alias] : undefined) || undefined;

const extensionId = readSecret("CHROME_EXTENSION_ID");
const clientId = readSecret("CHROME_CLIENT_ID", "GOOGLE_CLIENT_ID");
const clientSecret = readSecret("CHROME_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET");
const refreshToken = readSecret("CHROME_REFRESH_TOKEN", "GOOGLE_REFRESH_TOKEN");

const missing = [];
if (!extensionId) missing.push("CHROME_EXTENSION_ID");
if (!clientId) missing.push("CHROME_CLIENT_ID (or GOOGLE_CLIENT_ID)");
if (!clientSecret) missing.push("CHROME_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)");
if (!refreshToken) missing.push("CHROME_REFRESH_TOKEN (or GOOGLE_REFRESH_TOKEN)");

if (missing.length > 0) {
  logErr("Missing required credentials:");
  missing.forEach((v) => logErr(`  - ${v}`));
  logErr("");
  logErr("Copy .env.example to .env and fill it in, or export the variables.");
  logErr("First-time setup: DOCUMENTATION/CHROME_WEBSTORE_RELEASE.md");
  process.exit(1);
}
logOk("Credentials present (values not printed).");

// ─── 2. Build the Chrome package ─────────────────────────────────────────────
log("Building Chrome package (npm run package:chrome)...");
try {
  execSync("npm run package:chrome", { cwd: ROOT, stdio: "inherit", env: { ...process.env } });
} catch (_) {
  logErr("Build failed. Fix the errors above and retry.");
  process.exit(1);
}

// ─── 3. Read manifest version ────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
if (!version) {
  logErr('manifest.json has no "version".');
  process.exit(1);
}
logOk(`manifest version: ${version}`);

// ─── 4. Refuse to re-upload the same version (vs last git tag) ───────────────
let lastTag = null;
try {
  lastTag = execSync("git describe --tags --abbrev=0", { cwd: ROOT, encoding: "utf8" })
    .trim()
    .replace(/^v/, "");
} catch (_) {
  // no tags yet — first release
}
if (lastTag && lastTag === version && !SKIP_VERSION_CHECK) {
  logErr(`manifest version (${version}) equals the last git tag (v${lastTag}).`);
  logErr("Bump the version (manifest.json + package.json) or pass --skip-version-check.");
  process.exit(1);
}

// ─── 5. Locate + sanity-check the ZIP ────────────────────────────────────────
const zipPath = path.join(ROOT, "build", "chrome", `salesforcefav-v${version}-chrome.zip`);
if (!fs.existsSync(zipPath)) {
  logErr(`Chrome ZIP not found at ${zipPath} (did build.sh run?).`);
  process.exit(1);
}
logOk(`ZIP: ${zipPath} (${Math.round(fs.statSync(zipPath).size / 1024)} KB)`);

const zipList = execSync(`unzip -l "${zipPath}"`, { cwd: ROOT, encoding: "utf8" });
if (!zipList.split("\n").some((l) => /\s+manifest\.json\s*$/.test(l.trim()))) {
  logErr("manifest.json is not at the ZIP root — the store would reject this.");
  process.exit(1);
}
logOk("manifest.json is at the ZIP root.");

// ─── 6. OAuth access token ───────────────────────────────────────────────────
log("Obtaining OAuth access token...");
let accessToken;
{
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    logErr(`OAuth failed: ${data.error || res.status} ${data.error_description || ""}`);
    if (data.error === "invalid_grant") {
      logErr('"invalid_grant" usually means the refresh token expired — regenerate it.');
    }
    process.exit(1);
  }
  accessToken = data.access_token;
}
logOk("Access token obtained (not logged).");

// ─── 7. Upload the ZIP to the draft ──────────────────────────────────────────
log(`Uploading to Chrome Web Store item ${extensionId}...`);
const zipBuffer = fs.readFileSync(zipPath);
const uploadRes = await fetch(
  `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-api-version": "2",
      "Content-Type": "application/zip",
    },
    body: zipBuffer,
  }
);
const uploadResult = await uploadRes.json();
if (!uploadRes.ok || uploadResult.uploadState === "FAILURE") {
  logErr(`Upload failed (uploadState: ${uploadResult.uploadState || uploadRes.status}).`);
  (uploadResult.itemError || []).forEach((e) => logErr(`  [${e.error_code}] ${e.error_detail}`));
  process.exit(1);
}
logOk(`Upload complete. uploadState: ${uploadResult.uploadState}`);

// ─── 8. Publish (opt-in) ─────────────────────────────────────────────────────
if (DRY_RUN || !PUBLISH) {
  log("");
  log(
    DRY_RUN
      ? "DRY RUN: uploaded to the draft, skipping publish."
      : "Uploaded to the draft. Publish SKIPPED (pass --publish to submit for review)."
  );
  log("  Run: npm run release:chrome:publish");
  process.exit(0);
}

log("Publishing (submitting for review)...");
const pubRes = await fetch(
  `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-api-version": "2",
      "Content-Length": "0",
    },
  }
);
const pubResult = await pubRes.json();
if (!pubRes.ok) {
  logErr(`Publish failed: HTTP ${pubRes.status}`);
  if (pubResult.error) logErr(`  ${pubResult.error.message}`);
  (pubResult.itemError || []).forEach((e) => logErr(`  [${e.error_code}] ${e.error_detail}`));
  process.exit(1);
}
logOk(`Published. Status: ${[].concat(pubResult.status || "(none)").join(", ")}`);
log(`Version ${version} submitted for review (typically 1–3 business days).`);
log("Dashboard: https://chrome.google.com/webstore/devconsole");
