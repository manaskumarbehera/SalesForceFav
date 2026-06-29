"use strict";

// SalesForceFav background service worker.
//
// The login flow lives here, NOT in the popup. Opening a tab/window steals focus
// and closes the action popup, which would kill any listener the popup registered
// before the login page finished loading — so the credential fill never ran. The
// service worker persists across the popup closing, so it can reliably do
//   open tab/window → wait for the page to finish loading → inject the fill.
//
// IMPORTANT (MV3 worker lifetime): the onMessage handler returns `true` and the
// work is fully awaited, so Chrome keeps the worker alive across the page load
// instead of reaping it mid-flight (which would reproduce the original bug).

importScripts("popup/credentials.js"); // exposes self.SFFav (pure helpers)

// ── function injected into the PAGE (self-contained: no chrome.*, no SW scope) ──
async function fillSalesforceLogin(username, password) {
  try {
    // Give the login form a beat to finish wiring up after load.
    await new Promise((r) => setTimeout(r, 400));
    const userField = document.getElementById("username");
    const passField = document.getElementById("password");
    const loginButton = document.querySelector("#Login");
    if (!userField || !passField) {
      console.error("SalesForceFav: username/password fields not found on this page.");
      return;
    }
    userField.value = username;
    passField.value = password;
    if (loginButton) loginButton.click();
  } catch (e) {
    console.error("SalesForceFav: login fill failed:", e);
  }
}

// Recolor the page's favicon to the credential's color (page context, self-contained).
// Best-effort: cross-origin favicons taint the canvas and are skipped.
function tintFaviconInPage(color) {
  try {
    const existing = document.querySelector("link[rel*='icon']");
    const faviconUrl = (existing && existing.href) || new URL("/favicon.ico", location.origin).href;
    const link = existing || document.createElement("link");
    link.rel = "icon";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      try {
        canvas.width = img.width || 16;
        canvas.height = img.height || 16;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          px[i] = color[0];
          px[i + 1] = color[1];
          px[i + 2] = color[2];
        }
        ctx.putImageData(data, 0, 0);
        link.href = canvas.toDataURL("image/png");
        document.head.appendChild(link);
      } catch (e) {
        console.error("SalesForceFav: favicon recolor failed:", e);
      }
    };
    img.src = faviconUrl;
  } catch (e) {
    console.error("SalesForceFav: favicon setup failed:", e);
  }
}

// Fill a one-time-code field on the Salesforce verification page (page context).
// SAFETY: fills but NEVER submits — a TOTP can roll over between compute and
// submit, and repeated bad MFA attempts lock accounts. The user confirms. Strictly
// no-op when no verification field is present (most logins won't show one).
function fillTotpCodeInPage(code) {
  try {
    const selectors = [
      'input[autocomplete="one-time-code"]', // standard MFA code attribute
      "input#emc",
      "input#smc",
      "input#tan",
      'input[name="tan"]',
    ];
    let field = null;
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && !el.disabled && !el.value) {
        field = el;
        break;
      }
    }
    if (!field) return; // not a verification page — do nothing
    field.value = code;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    // Intentionally NOT clicking submit — the human commits the code.
  } catch (e) {
    console.error("SalesForceFav: 2FA code fill failed:", e);
  }
}

// ── orchestration (service worker context) ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "sffav-login" && msg.credential) {
    handleLogin(msg.credential, msg.loginType)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        console.error("SalesForceFav: login flow failed:", e);
        sendResponse({ ok: false });
      });
    return true; // keep the message channel (and worker) alive for the async work
  }
  return false;
});

async function handleLogin(credential, loginType) {
  const url = self.SFFav.resolveSalesforceUrl(credential);
  if (!url) {
    console.error("SalesForceFav: could not resolve a URL for this credential.");
    return;
  }
  // SSO opens the identity provider and lets the user authenticate there; the
  // Salesforce username/password filler doesn't apply to the IdP page.
  const shouldFill = credential.environment !== "sso";

  let tab;
  if (loginType === "newWindow" || loginType === "incognito") {
    const win = await chrome.windows.create({ url, incognito: loginType === "incognito" });
    tab = win && Array.isArray(win.tabs) ? win.tabs[0] : null;
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }
  if (!tab || tab.id == null) {
    console.error("SalesForceFav: no tab was created for the login.");
    return;
  }
  if (!shouldFill) return;

  await waitForTabComplete(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillSalesforceLogin,
    args: [credential.username, credential.password],
  });

  // Tint the tab's favicon to the credential color so the logged-in tab is
  // visually distinct (best-effort; runs in the page).
  if (credential.faviconColor) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: tintFaviconInPage,
        args: [self.SFFav.hexToRgb(credential.faviconColor)],
      });
    } catch (e) {
      console.error("SalesForceFav: favicon tint failed:", e);
    }
  }

  // If the org has an authenticator key, fill the 2FA code on the verification
  // page that Salesforce shows after login (untrusted-device challenge). Filled,
  // never submitted; no-op if the challenge doesn't appear. Best-effort against
  // Salesforce's DOM — see the note in fillTotpCodeInPage.
  if (credential.totp && self.SFFav.isValidTotpSecret(credential.totp)) {
    try {
      await waitForNextComplete(tab.id, 10000); // the post-login navigation
      const code = self.SFFav.totp(credential.totp, Date.now() / 1000);
      if (code) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: fillTotpCodeInPage,
          args: [code],
        });
      }
    } catch (e) {
      console.error("SalesForceFav: 2FA autofill step failed:", e);
    }
  }
}

// Resolve on the NEXT tab "complete" (the post-login navigation), or after a
// timeout if none happens — bounds the worker's lifetime.
function waitForNextComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs || 10000);
  });
}

// Resolve once the tab has finished loading. Handles the case where it already
// completed before we started listening (fast/cached loads).
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      if (tab && tab.status === "complete") {
        resolve();
        return;
      }
      const listener = (updatedId, info) => {
        if (updatedId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
