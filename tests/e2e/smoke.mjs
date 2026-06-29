// End-to-end smoke test for the auto-login flow — the one path jest/jsdom and the
// HTTP preview can't exercise, and exactly where the popup-lifetime bug lived.
//
// It loads the real unpacked extension in Chrome, then:
//   1. opens the popup page, seeds a Production credential, clicks "open in new tab"
//   2. IMMEDIATELY closes the popup — simulating the action popup closing on focus
//      loss (the original bug). Only the background service worker can still finish.
//   3. asserts the opened login page got username/password filled and Login clicked.
//
// login.salesforce.com is redirected to a local HTTPS mock via --host-resolver-rules,
// so nothing touches real Salesforce.
//
// Run: npm run test:e2e   (set CHROME_PATH to choose the Chrome binary)
//
// NOTE on Chrome compatibility: current stable Chrome (≈137+) blocks loading and
// navigating unpacked-extension pages under automation, so this test needs a Chrome
// that still allows it — pin one via `npx @puppeteer/browsers install chrome@123…`
// and point CHROME_PATH at it (that's what .github/workflows/e2e.yml does). The
// test loads the extension via the CDP Extensions domain and opens the popup via
// Target.createTarget (page.goto to a chrome-extension URL is also blocked).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");
const PORT = 8788;
const TESTUSER = "e2e.user@example.com";
const TESTPASS = "e2e-Secret-123";

const log = (m) => console.log(`[e2e] ${m}`);

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    {
      darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
      ],
      win32: ["C:/Program Files/Google/Chrome/Application/chrome.exe"],
    }[process.platform] || [];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome not found — set CHROME_PATH to your Chrome binary.");
  return found;
}

function makeCert(dir) {
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" }
  );
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function main() {
  // 1. Stage the extension into dist/.
  log("building dist/ ...");
  execFileSync("node", [path.join(ROOT, "scripts", "build.mjs")], { stdio: "ignore" });
  assert.ok(fs.existsSync(path.join(DIST, "background.js")), "dist/background.js missing");

  // 2. Local HTTPS mock for the Salesforce login host.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sffav-e2e-"));
  const { key, cert } = makeCert(tmp);
  const mockHtml = fs.readFileSync(path.join(__dirname, "mock-login.html"));
  const server = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(mockHtml);
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  log(`mock login server on https://127.0.0.1:${PORT}`);

  // Current Chrome blocks the old --load-extension CLI switch, so load the unpacked
  // extension via the CDP Extensions domain (needs --enable-unsafe-extension-debugging).
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: process.env.PUPPETEER_HEADFUL ? false : "new",
    args: [
      "--enable-unsafe-extension-debugging",
      "--remote-debugging-pipe",
      `--host-resolver-rules=MAP login.salesforce.com 127.0.0.1:${PORT},MAP test.salesforce.com 127.0.0.1:${PORT}`,
      "--ignore-certificate-errors",
      "--no-sandbox",
      "--no-first-run",
    ],
  });

  try {
    // 3. Load the unpacked extension and get its id.
    log("loading the unpacked extension via CDP ...");
    const client = await browser.target().createCDPSession();
    const { id: extId } = await client.send("Extensions.loadUnpacked", { path: DIST });
    log(`extension id: ${extId}`);

    // 4. Open the popup. Current Chrome blocks page.goto() to a chrome-extension
    //    page, but the CDP Target.createTarget command opens it fine.
    const popupUrl = `chrome-extension://${extId}/popup/popup.html`;
    await client.send("Target.createTarget", { url: popupUrl });
    const popupTarget = await browser.waitForTarget((t) => t.url() === popupUrl, {
      timeout: 10000,
    });
    const popup = await popupTarget.page();
    await popup.waitForSelector("#addBtn", { timeout: 10000 }); // popup HTML is loaded

    // Seed a Production credential, then reload (in-page) so the app renders it.
    await popup.evaluate(
      (user, pass) => {
        localStorage.setItem(
          "credentials",
          JSON.stringify([
            {
              credentialName: "E2E Prod",
              environment: "production",
              username: user,
              password: pass,
              faviconColor: "#3a5ccc",
            },
          ])
        );
      },
      TESTUSER,
      TESTPASS
    );
    await Promise.all([
      popup.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      popup.evaluate(() => location.reload()),
    ]);
    await popup.waitForSelector(".cred-card", { timeout: 10000 });
    log("popup rendered the seeded credential");

    // 5. Click "open in new tab", then IMMEDIATELY close the popup (simulates the
    //    action popup closing on focus loss — the original failure condition).
    const sfTargetPromise = browser.waitForTarget((t) => t.url().includes("login.salesforce.com"), {
      timeout: 15000,
    });
    await popup.click('button[aria-label="Open in new tab"]');
    await popup.close();
    log("clicked launch and closed the popup");

    // 6. The service worker must still open the page and inject the fill.
    const sfTarget = await sfTargetPromise;
    const sfPage = await sfTarget.page();
    await sfPage.waitForFunction(
      () => {
        const u = document.getElementById("username");
        return u && u.value.length > 0;
      },
      { timeout: 15000 }
    );
    const result = await sfPage.evaluate(() => ({
      username: document.getElementById("username").value,
      password: document.getElementById("password").value,
      clicked: window.__loginClicked,
    }));

    assert.equal(result.username, TESTUSER, "username was not filled by the service worker");
    assert.equal(result.password, TESTPASS, "password was not filled by the service worker");
    assert.equal(result.clicked, true, "the Login button was not clicked");
    log("PASS — service worker filled username + password and clicked Login");
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  () => {
    log("smoke test passed ✅");
    process.exit(0);
  },
  (e) => {
    console.error(`[e2e] FAILED: ${e.message}`);
    process.exit(1);
  }
);
