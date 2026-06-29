#!/usr/bin/env node
// chrome-oauth-token.mjs — mint a Chrome Web Store API refresh token, once.
//
// Why you need this: release-chrome.mjs exchanges CHROME_REFRESH_TOKEN for an
// access token. If that token was issued while the OAuth consent screen is in
// "Testing" status, Google expires it after 7 DAYS — hence the repeated
// `invalid_grant` on every release. DURABLE FIX: set the OAuth consent screen to
// "In production" (Google Cloud Console → APIs & Services → OAuth consent
// screen → Publish app). Then mint once with this script and it stays valid.
//
// Uses the loopback flow (Google deprecated the old copy/paste "oob" flow): it
// starts a local server on a FIXED port, you approve in the browser, it captures
// the code and exchanges it for a refresh token.
//
// REDIRECT URI: the script redirects to  http://localhost:8976  (override the
// port with CHROME_OAUTH_PORT). For this to be accepted:
//   - "Desktop app" OAuth client  → loopback is allowed automatically. Just run.
//   - "Web application" OAuth client → add EXACTLY  http://localhost:8976  to the
//     client's "Authorized redirect URIs" in Google Cloud Console first.
//     (A random port can never be pre-registered — that is what caused
//     `Error 400: redirect_uri_mismatch`.)
//
// Usage:
//   node scripts/chrome-oauth-token.mjs           # prints the token
//   node scripts/chrome-oauth-token.mjs --write    # also updates .env in place
//   CHROME_OAUTH_PORT=9001 node scripts/chrome-oauth-token.mjs --write
//
// Reads CHROME_CLIENT_ID / CHROME_CLIENT_SECRET from .env (or the environment).

import http from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const log = (m) => console.log(`[chrome-oauth] ${m}`);

// ─── Load .env ───────────────────────────────────────────────────────────────
function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();

const clientId = process.env.CHROME_CLIENT_ID;
const clientSecret = process.env.CHROME_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("[chrome-oauth] Missing CHROME_CLIENT_ID / CHROME_CLIENT_SECRET in .env.");
  process.exit(1);
}
const WRITE = process.argv.includes("--write");

// ─── Loopback OAuth flow (fixed port so a Web-app client can register it) ─────
const port = Number(process.env.CHROME_OAUTH_PORT) || 8976;
const redirectUri = `http://localhost:${port}`;
const server = http.createServer();
await new Promise((resolve, reject) => {
  server.once("error", (e) => {
    console.error(
      e.code === "EADDRINUSE"
        ? `[chrome-oauth] Port ${port} is busy. Set CHROME_OAUTH_PORT to a free port and re-run.`
        : `[chrome-oauth] Could not start local server: ${e.message}`
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", resolve);
});

const authParams = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent", // force a fresh refresh_token every time
});
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams}`;

log("Open this URL in your browser, sign in with the developer account, approve:");
console.log(`\n${authUrl}\n`);
// Best-effort auto-open (macOS `open`, Linux `xdg-open`); harmless if absent.
execFile(process.platform === "darwin" ? "open" : "xdg-open", [authUrl], () => {});

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out after 5 min")), 300000);
  server.on("request", (req, res) => {
    const u = new URL(req.url, redirectUri);
    const c = u.searchParams.get("code");
    const err = u.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<html><body style="font:16px system-ui;padding:40px">` +
        (c
          ? "✅ SalesForceFav: authorization received. You can close this tab."
          : `❌ Authorization failed: ${err || "no code"}`) +
        `</body></html>`
    );
    clearTimeout(timer);
    server.close();
    c ? resolve(c) : reject(new Error(err || "no code in redirect"));
  });
});

log("Exchanging code for a refresh token...");
const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  }),
});
const data = await res.json();
if (!res.ok || !data.refresh_token) {
  console.error(`[chrome-oauth] Token exchange failed: ${JSON.stringify(data)}`);
  if (!data.refresh_token && data.access_token)
    console.error(
      "[chrome-oauth] Got an access token but no refresh_token — revoke prior grants at " +
        "https://myaccount.google.com/permissions and retry (prompt=consent forces one)."
    );
  process.exit(1);
}

log("Refresh token obtained:");
console.log(`\nCHROME_REFRESH_TOKEN=${data.refresh_token}\n`);

if (WRITE) {
  const p = path.join(ROOT, ".env");
  let env = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  if (/^CHROME_REFRESH_TOKEN=.*$/m.test(env))
    env = env.replace(/^CHROME_REFRESH_TOKEN=.*$/m, `CHROME_REFRESH_TOKEN=${data.refresh_token}`);
  else
    env += `${env.endsWith("\n") || !env ? "" : "\n"}CHROME_REFRESH_TOKEN=${data.refresh_token}\n`;
  fs.writeFileSync(p, env);
  log("Wrote CHROME_REFRESH_TOKEN to .env (gitignored).");
} else {
  log("Re-run with --write to update .env automatically, or paste the line above.");
}
