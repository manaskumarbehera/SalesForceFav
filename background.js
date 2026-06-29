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
