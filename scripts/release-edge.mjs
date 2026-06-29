#!/usr/bin/env node
/**
 * release-edge.mjs
 *
 * Automated Microsoft Edge Add-ons release for SalesForceFav, using the Edge
 * Add-ons API (Update API v1.1, API-key auth). Counterpart to release-chrome.mjs.
 *
 * Usage:
 *   npm run release:edge:dry        # Build + upload the package to the draft
 *   npm run release:edge:publish    # Build + upload + submit for certification
 *   node scripts/release-edge.mjs --publish
 *
 * Credentials (env or .env at repo root):
 *   EDGE_PRODUCT_ID    Product ID from Partner Center (a GUID).
 *   EDGE_CLIENT_ID     API client ID from Partner Center → Publish API.
 *   EDGE_API_KEY       API key for that client ID.
 *
 * SAFETY: publish is opt-in. Without --publish the script uploads the package to
 * the draft and stops.
 *
 * Certification notes (reviewer test login + steps) are sent with the publish
 * call via the submission `notes` field. Source order:
 *   1. EDGE_CERT_NOTES env var (inline text), else
 *   2. .edge-certification-notes.txt at repo root (gitignored — keep the
 *      Salesforce test password here, NOT in git), else
 *   3. a bare "SalesForceFav vX.Y" fallback.
 * The API `notes` field does NOT replace the Partner Center "Notes for
 * certification" listing field — set that in the UI too. Listing metadata
 * (website URL, screenshots, privacy/support links) is NOT settable via this
 * API; edit it in Partner Center.
 * NOTE: untested end-to-end until Partner Center credentials are provided.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API = "https://api.addons.microsoftedge.microsoft.com";

const log = (m) => console.log(`[release-edge] ${m}`);
const logOk = (m) => console.log(`[release-edge] OK  ${m}`);
const logErr = (m) => console.error(`[release-edge] ERR ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Load .env (shared parser style with release-chrome.mjs) ─────────────────
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

const args = process.argv.slice(2);
const DRY_RUN =
  args.includes("--dry-run") || args.includes("--dry") || process.env.DRY_RUN === "true";
const PUBLISH = args.includes("--publish") || process.env.PUBLISH === "true";

// ─── 1. Credentials ──────────────────────────────────────────────────────────
const productId = process.env.EDGE_PRODUCT_ID;
const clientId = process.env.EDGE_CLIENT_ID;
const apiKey = process.env.EDGE_API_KEY;

const missing = [];
if (!productId) missing.push("EDGE_PRODUCT_ID");
if (!clientId) missing.push("EDGE_CLIENT_ID");
if (!apiKey) missing.push("EDGE_API_KEY");
if (missing.length) {
  logErr("Missing required credentials:");
  missing.forEach((v) => logErr(`  - ${v}`));
  logErr("");
  logErr("Create an API key in Partner Center → Publish API and add it to .env.");
  logErr("First-time setup: DOCUMENTATION/EDGE_ADDONS_RELEASE.md");
  process.exit(1);
}
logOk("Credentials present (values not printed).");

const authHeaders = { Authorization: `ApiKey ${apiKey}`, "X-ClientID": clientId };

// ─── 2. Build ────────────────────────────────────────────────────────────────
log("Building Edge package (npm run package:edge)...");
try {
  execSync("npm run package:edge", { cwd: ROOT, stdio: "inherit", env: { ...process.env } });
} catch (_) {
  logErr("Build failed.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const zipPath = path.join(ROOT, "build", "edge", `salesforcefav-v${version}-edge.zip`);
if (!fs.existsSync(zipPath)) {
  logErr(`Edge ZIP not found at ${zipPath}.`);
  process.exit(1);
}
logOk(`ZIP: ${zipPath} (${Math.round(fs.statSync(zipPath).size / 1024)} KB)`);

// ─── 3. Upload the package to the draft ──────────────────────────────────────
// POST returns 202 with the operation id in the Location header; poll until done.
log(`Uploading package to Edge product ${productId}...`);
const uploadRes = await fetch(`${API}/v1/products/${productId}/submissions/draft/package`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/zip" },
  body: fs.readFileSync(zipPath),
});
if (uploadRes.status !== 202) {
  logErr(`Upload HTTP ${uploadRes.status} ${uploadRes.statusText}: ${await uploadRes.text()}`);
  process.exit(1);
}
const uploadOpId = uploadRes.headers.get("location");
await pollOperation(
  `/v1/products/${productId}/submissions/draft/package/operations/${uploadOpId}`,
  "package upload"
);
logOk("Package uploaded to the draft.");

// ─── 4. Publish (opt-in) ─────────────────────────────────────────────────────
if (DRY_RUN || !PUBLISH) {
  log("");
  log(
    DRY_RUN
      ? "DRY RUN: uploaded to the draft, skipping publish."
      : "Uploaded to the draft. Publish SKIPPED (pass --publish to submit for certification)."
  );
  log("  Run: npm run release:edge:publish");
  process.exit(0);
}

const certNotes = resolveCertNotes(version);
log("Submitting for certification...");
log(`  notes source: ${certNotes.source} (${certNotes.text.length} chars)`);
const pubRes = await fetch(`${API}/v1/products/${productId}/submissions`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ notes: certNotes.text }),
});
if (pubRes.status !== 202) {
  logErr(`Publish HTTP ${pubRes.status} ${pubRes.statusText}: ${await pubRes.text()}`);
  process.exit(1);
}
const pubOpId = pubRes.headers.get("location");
await pollOperation(`/v1/products/${productId}/submissions/operations/${pubOpId}`, "publish");
logOk(`Version ${version} submitted to the Edge Add-ons store for certification.`);
log("Partner Center: https://partner.microsoft.com/dashboard/microsoftedge/overview");

// ─── Helper: resolve the certification notes sent with the submission ────────
function resolveCertNotes(ver) {
  const env = process.env.EDGE_CERT_NOTES;
  if (env && env.trim()) return { text: env.trim(), source: "EDGE_CERT_NOTES env" };
  const notesPath = path.join(ROOT, ".edge-certification-notes.txt");
  if (fs.existsSync(notesPath)) {
    const text = fs.readFileSync(notesPath, "utf8").trim();
    if (text) return { text, source: ".edge-certification-notes.txt" };
  }
  logErr("No certification notes found — sending a bare fallback.");
  logErr("  1.3.1 (Product is Testable) needs a reviewer test login + steps.");
  logErr(
    "  Create .edge-certification-notes.txt (see DOCUMENTATION/certification-notes.template.md)."
  );
  return { text: `SalesForceFav v${ver}`, source: "fallback (no notes provided)" };
}

// ─── Helper: poll an async operation until it succeeds or fails ───────────────
async function pollOperation(opPath, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5000);
    const res = await fetch(`${API}${opPath}`, { headers: authHeaders });
    if (!res.ok) {
      logErr(`${label} status HTTP ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    const data = await res.json();
    if (data.status === "Succeeded") return data;
    if (data.status === "Failed") {
      logErr(`${label} failed: ${data.message || ""}`);
      (data.errors || []).forEach((e) => logErr(`  ${e.message || JSON.stringify(e)}`));
      process.exit(1);
    }
    log(`${label}: ${data.status}... (${(attempt + 1) * 5}s)`);
  }
  logErr(`${label} timed out after 5 minutes.`);
  process.exit(1);
}
