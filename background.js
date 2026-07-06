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
// Some orgs have "Login Discovery" enabled on My Domain: the first page only
// asks for the username, and the password field only appears on a SEPARATE
// page after submitting it (a real navigation, which tears down this
// function's execution — it can't just "wait" through that from in here).
// So this fills+submits whatever step is present and reports back which case
// it hit; the caller (handleLogin) is responsible for waiting for the
// follow-up page and injecting fillSalesforcePasswordStep there.
async function fillSalesforceLogin(username, password) {
  try {
    // Poll for the field for a couple seconds instead of a single fixed wait —
    // a redirect chain (e.g. a geo/POD bounce) can leave the real login page
    // still settling after the tab's "complete" event fires.
    let userField = null;
    for (let i = 0; i < 25; i += 1) {
      userField = document.getElementById("username");
      if (userField) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!userField) {
      console.error("SalesForceFav: username field not found on this page.");
      return "no-username-field";
    }
    userField.value = username;
    userField.dispatchEvent(new Event("input", { bubbles: true }));

    const passField = document.getElementById("password");
    const submitButton = document.querySelector("#Login");
    if (passField) {
      // Standard single-page login — fill both and submit now.
      passField.value = password;
      if (submitButton) submitButton.click();
      return "filled";
    }
    // Login Discovery — no password field yet. Submit the username step; the
    // password step happens on whatever page this navigates to.
    if (submitButton) {
      submitButton.click();
      return "needs-password-step";
    }
    console.error("SalesForceFav: no password field and no submit button found.");
    return "stuck";
  } catch (e) {
    console.error("SalesForceFav: login fill failed:", e);
    return "error";
  }
}

// Fills the password step of a Login Discovery flow, on the page reached
// after fillSalesforceLogin submitted the username. Same polling approach —
// this page can still be settling right after "complete" fires.
async function fillSalesforcePasswordStep(password) {
  try {
    let passField = null;
    for (let i = 0; i < 10; i += 1) {
      passField = document.getElementById("password");
      if (passField) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!passField) {
      console.error("SalesForceFav: password field not found on the follow-up page.");
      return;
    }
    passField.value = password;
    passField.dispatchEvent(new Event("input", { bubbles: true }));
    const submitButton = document.querySelector("#Login");
    if (submitButton) submitButton.click();
  } catch (e) {
    console.error("SalesForceFav: password step fill failed:", e);
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

// Paint the org's color INSIDE the page: a slim stripe across the very top of
// the viewport, plus a matching accent on the SLDS global header when present
// (Lightning). Page context, idempotent — safe to re-run on every navigation.
function tintOrgHeaderInPage(colorHex) {
  try {
    let stripe = document.getElementById("sffav-org-stripe");
    if (!stripe) {
      stripe = document.createElement("div");
      stripe.id = "sffav-org-stripe";
      stripe.style.cssText =
        "position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483647;pointer-events:none;";
      document.documentElement.appendChild(stripe);
    }
    stripe.style.background = colorHex;

    let style = document.getElementById("sffav-org-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "sffav-org-style";
      document.documentElement.appendChild(style);
    }
    // inset box-shadow rather than border so the Lightning header's height
    // (which its own JS measures) is unchanged.
    style.textContent =
      `.slds-global-header{box-shadow:inset 0 3px 0 ${colorHex} !important;}` +
      `.slds-global-header__logo{filter:drop-shadow(0 2px 0 ${colorHex});}`;
  } catch (e) {
    console.error("SalesForceFav: header tint failed:", e);
  }
}

// Fill a one-time-code field on the Salesforce verification page (page context).
// Fills only by default; clicks the verify/submit control when `submit` is true.
// Auto-submit is gated by the caller (handleLogin) on the code's remaining
// validity — a TOTP can roll over between compute and submit, and repeated bad
// MFA attempts lock accounts. Strictly no-op when no verification field is
// present (most logins won't show one).
function fillTotpCodeInPage(code, submit) {
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
    if (!submit) return; // fill-only (default) — the human commits the code
    // Auto-submit: click the verify/submit control if one is present. The
    // caller only sets submit=true after guarding the code's remaining validity
    // (see handleLogin), so the code it just typed has a full window to land.
    const submitBtn =
      document.querySelector("#save") ||
      document.querySelector('input[type="submit"]') ||
      document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.click();
  } catch (e) {
    console.error("SalesForceFav: 2FA code fill failed:", e);
  }
}

// Offer to set up 2FA on the post-login page, for orgs that don't have an
// authenticator key saved yet (page context; relies on the vendored QR
// encoder being injected as a file just before this function). The secret is
// generated up front but only reported back to the extension — via
// chrome.runtime.sendMessage, which content-script-world code can call even
// though this function itself never touches chrome.storage — once the user
// confirms they've scanned it. Labeled "SalesForceFav" (the otpauth issuer)
// so it's identifiable in whatever authenticator app scans it.
function showTotpSetupPrompt(credentialName, secret, otpauthUri) {
  try {
    if (document.getElementById("sffav-totp-prompt")) return; // already showing
    const card = document.createElement("div");
    card.id = "sffav-totp-prompt";
    card.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483647;width:300px;" +
      "background:#fff;color:#1a1a1a;border:1px solid #d9d9d9;border-radius:10px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.2);padding:14px;" +
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;";

    // Branded header — an unmarked floating card on an identity-verification
    // page reads as suspicious rather than trustworthy, so this is explicit
    // about which extension put it there (plain inline SVG, not an <img> tag,
    // since chrome-extension:// image URLs need web_accessible_resources to
    // load from a page context — inline markup needs no such declaration).
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
    header.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#3a5ccc" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
      '<strong style="font-size:13px;">SalesForceFav</strong>';
    card.appendChild(header);

    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;margin-bottom:6px;";
    title.textContent = "Set up 2FA for this org?";
    card.appendChild(title);

    const body = document.createElement("div");
    body.id = "sffav-totp-body";
    card.appendChild(body);
    document.body.appendChild(card);

    const showOffer = () => {
      body.textContent = "";
      const hint = document.createElement("p");
      hint.style.cssText = "margin:0 0 10px;color:#555;";
      hint.textContent = "SalesForceFav (this extension) can be this org's authenticator.";
      const yes = document.createElement("button");
      yes.textContent = "Set up";
      yes.style.marginRight = "8px";
      const no = document.createElement("button");
      no.textContent = "Not now";
      no.addEventListener("click", () => card.remove());
      yes.addEventListener("click", showQr);
      body.appendChild(hint);
      body.appendChild(yes);
      body.appendChild(no);
    };

    // Renders the QR at `cellSize` into `qrHost` — factored out so the "view
    // larger" toggle can re-render bigger without duplicating the QR setup.
    const renderQr = (qrHost, cellSize) => {
      qrHost.innerHTML = "";
      try {
        const qr = qrcode(0, "Q"); // type 0 = auto-size, error-correction level Q (tolerates screen glare)
        qr.addData(otpauthUri);
        qr.make();
        qrHost.innerHTML = qr.createSvgTag({ cellSize, margin: 2, scalable: true });
      } catch (e) {
        qrHost.textContent = "QR render failed — use the key below.";
      }
    };

    const showQr = () => {
      body.textContent = "";
      const hint = document.createElement("p");
      hint.style.cssText = "margin:0 0 8px;color:#555;";
      hint.textContent =
        'In Setup → Advanced User Details, use "App Registration: Authenticator Apps" ' +
        '(not "Built-In Authenticators" — that\'s for device biometrics/security keys) ' +
        "and scan this, or paste the key manually.";
      body.appendChild(hint);

      const qrHost = document.createElement("div");
      qrHost.style.cssText =
        "background:#fff;padding:6px;border-radius:6px;width:150px;margin:0 auto;cursor:zoom-in;";
      qrHost.title = "Click to enlarge";
      let enlarged = false;
      qrHost.addEventListener("click", () => {
        enlarged = !enlarged;
        qrHost.style.width = enlarged ? "260px" : "150px";
        qrHost.style.cursor = enlarged ? "zoom-out" : "zoom-in";
        renderQr(qrHost, enlarged ? 8 : 5);
      });
      renderQr(qrHost, 5);
      body.appendChild(qrHost);

      const key = document.createElement("code");
      key.textContent = secret.replace(/(.{4})/g, "$1 ").trim();
      key.style.cssText =
        "display:block;margin:8px 0;text-align:center;font-weight:600;word-break:break-all;";
      body.appendChild(key);

      // The tradeoff of this whole feature, stated once, where the decision
      // actually happens — not just something explained in a chat that goes
      // away: the key lives next to the saved password, so a compromised
      // browser exposes both factors together. Fine for disposable dev/test
      // orgs; skip it for a production admin account.
      const caveat = document.createElement("p");
      caveat.style.cssText = "margin:8px 0 0;color:#8a6d00;font-size:11px;line-height:1.4;";
      caveat.textContent =
        "Note: this stores the 2FA key next to the saved password in the extension — " +
        "convenient for dev/test orgs, but means a compromised browser exposes both. " +
        "Skip this for production admin accounts.";
      body.appendChild(caveat);

      const save = document.createElement("button");
      save.textContent = "I've scanned it — save";
      save.style.marginRight = "8px";
      save.style.marginTop = "8px";
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.style.marginTop = "8px";
      cancel.addEventListener("click", () => card.remove());
      save.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "sffav-save-totp", credentialName, secret });
        card.remove();
      });
      body.appendChild(save);
      body.appendChild(cancel);
    };

    showOffer();
  } catch (e) {
    console.error("SalesForceFav: 2FA setup prompt failed:", e);
  }
}

// Storage key for authenticator keys generated by showTotpSetupPrompt but not
// yet written to a credential. The service worker has no localStorage (where
// the popup keeps its — possibly encrypted — vault) and no passphrase, so it
// can't persist the key itself; it stages it here, and the popup adopts it
// into the matching credential (and re-encrypts, if applicable) next time it
// opens. See applyPendingTotp() in popup.js.
const PENDING_TOTP_KEY = "sffav-pending-totp";

async function stagePendingTotp(credentialName, secret) {
  const stored = await chrome.storage.local.get(PENDING_TOTP_KEY);
  const pending = Array.isArray(stored[PENDING_TOTP_KEY]) ? stored[PENDING_TOTP_KEY] : [];
  pending.push({ credentialName, secret });
  await chrome.storage.local.set({ [PENDING_TOTP_KEY]: pending });
}

// ── org color following the tab ──────────────────────────────────────────────
// tabId → faviconColor for tabs opened by a login. Kept in chrome.storage.session
// (not a module variable) because MV3 service workers restart constantly, and in
// session (not local) storage so stale tab ids don't accumulate across browser
// restarts. The onUpdated listener below re-applies the favicon + header tint on
// EVERY completed navigation in a tracked tab — a login-time one-shot injection
// would be wiped by the first post-login redirect.
const TAB_COLORS_KEY = "sffav-tab-colors";

async function getTabColors() {
  try {
    const stored = await chrome.storage.session.get(TAB_COLORS_KEY);
    return stored[TAB_COLORS_KEY] || {};
  } catch {
    return {};
  }
}

// Best-effort: the org tint is cosmetic, so a storage.session hiccup here must
// never propagate and abort the login fill that follows it in handleLogin.
async function rememberTabColor(tabId, color) {
  try {
    const map = await getTabColors();
    map[String(tabId)] = color;
    await chrome.storage.session.set({ [TAB_COLORS_KEY]: map });
  } catch (e) {
    console.error("SalesForceFav: could not remember tab color (non-fatal):", e);
  }
}

// Only tint Salesforce-owned hosts — the user can navigate a tracked tab
// anywhere, and the org color shouldn't follow them onto unrelated sites.
function isSalesforceHost(url) {
  try {
    const host = new URL(url).hostname;
    return [
      ".salesforce.com",
      ".force.com",
      ".cloudforce.com",
      ".visualforce.com",
      ".salesforce-setup.com",
    ].some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

// Injection can lose a race with the page itself: "complete" fires, the page
// immediately redirects (login flows chain redirects), and by the time
// executeScript reaches the tab its frame is gone. That's expected — the next
// navigation's own "complete" event re-applies the tint — so those errors are
// swallowed rather than logged as failures.
function isGoneError(e) {
  const msg = String((e && e.message) || e);
  return /frame with id|no tab with id|tab was closed|cannot access/i.test(msg);
}

async function applyTabColor(tabId, color) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: tintFaviconInPage,
      args: [self.SFFav.hexToRgb(color)],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: tintOrgHeaderInPage,
      args: [color],
    });
  } catch (e) {
    if (!isGoneError(e)) console.error("SalesForceFav: tab tint failed:", e);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !tab || !isSalesforceHost(tab.url)) return;
  const map = await getTabColors();
  const color = map[String(tabId)];
  if (color) await applyTabColor(tabId, color);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getTabColors();
  if (map[String(tabId)] === undefined) return;
  delete map[String(tabId)];
  await chrome.storage.session.set({ [TAB_COLORS_KEY]: map });
});

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
  if (msg && msg.type === "sffav-save-totp" && msg.credentialName && msg.secret) {
    stagePendingTotp(msg.credentialName, msg.secret)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        console.error("SalesForceFav: staging 2FA key failed:", e);
        sendResponse({ ok: false });
      });
    return true;
  }
  if (msg && msg.type === "sffav-setup-totp" && msg.credential) {
    handleTotpSetup(msg.credential)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        console.error("SalesForceFav: 2FA setup flow failed:", e);
        sendResponse({ ok: false });
      });
    return true;
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

  if (loginType === "incognito") {
    // Without this permission, chrome.windows.create({incognito: true}) still
    // creates the window, but its `tabs` come back empty/undefined (the
    // extension isn't allowed to see into it) — which otherwise surfaces as
    // an unhelpful "no tab was created" with no clue why. Check and explain
    // it up front instead.
    const allowed = await chrome.extension.isAllowedIncognitoAccess();
    if (!allowed) {
      console.error(
        'SalesForceFav: incognito login needs "Allow in incognito" enabled for this ' +
          "extension — go to chrome://extensions, open SalesForceFav's Details, and turn it on."
      );
      return;
    }
  }

  let tab;
  if (loginType === "newWindow" || loginType === "incognito") {
    const win = await chrome.windows.create({ url, incognito: loginType === "incognito" });
    tab = win && Array.isArray(win.tabs) ? win.tabs[0] : null;
    // The tab object returned inline by windows.create can be a placeholder
    // whose id/url don't yet match the real loading tab — re-resolve by
    // querying the new window's active tab, which is authoritative.
    if (win && win.id != null) {
      try {
        const [active] = await chrome.tabs.query({ windowId: win.id, active: true });
        if (active && active.id != null) tab = active;
      } catch (e) {
        console.error("SalesForceFav: could not query the new window's tab:", e);
      }
    }
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }
  if (!tab || tab.id == null) {
    console.error("SalesForceFav: no tab was created for the login.");
    return;
  }
  console.log(`SalesForceFav: login (${loginType}) using tab ${tab.id}`);

  // Register the org color for this tab FIRST — the onUpdated listener then
  // re-applies the favicon + header tint on every navigation (login page,
  // post-login redirect, Lightning), not just once.
  if (credential.faviconColor) {
    await rememberTabColor(tab.id, credential.faviconColor);
  }

  if (!shouldFill) return;

  await waitForTabComplete(tab.id);
  let [fillResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillSalesforceLogin,
    args: [credential.username, credential.password],
  });
  // A fresh window (newWindow/incognito) spins up its own renderer and loads
  // slower than a new tab in the current process — the login page can still be
  // arriving when the first fill polls out. If the field wasn't found, wait for
  // the next completed load and try once more before giving up.
  if (fillResult && fillResult.result === "no-username-field") {
    try {
      await waitForTabComplete(tab.id);
      [fillResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillSalesforceLogin,
        args: [credential.username, credential.password],
      });
    } catch (e) {
      console.error("SalesForceFav: login fill retry failed:", e);
    }
  }
  if (fillResult && fillResult.result === "needs-password-step") {
    // Login Discovery org: the username step just submitted and navigated to
    // a separate password step — wait for that page and fill it there.
    try {
      await waitForTabComplete(tab.id);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillSalesforcePasswordStep,
        args: [credential.password],
      });
    } catch (e) {
      console.error("SalesForceFav: password step failed:", e);
    }
  }

  // Immediate tint for the page that's already loaded (the onUpdated listener
  // may have fired before rememberTabColor finished on the very first load).
  if (credential.faviconColor) {
    await applyTabColor(tab.id, credential.faviconColor);
  }

  // If the org has an authenticator key, fill AND submit the 2FA code on the
  // verification page Salesforce shows after login (untrusted-device challenge).
  // No-op if the challenge doesn't appear. Best-effort against Salesforce's DOM
  // — see the note in fillTotpCodeInPage.
  //
  // Auto-submit tradeoff: repeated bad MFA codes lock accounts, so we never
  // submit a code that's about to roll over. If under 5s remain in the current
  // 30s window, wait for the next window first, then compute a fresh code — that
  // way the code we submit has a near-full window to be accepted server-side.
  if (credential.totp && self.SFFav.isValidTotpSecret(credential.totp)) {
    try {
      await waitForNextComplete(tab.id, 10000); // the post-login navigation
      const secondsLeft = self.SFFav.totpSecondsRemaining(Date.now() / 1000);
      if (secondsLeft < 5) {
        await new Promise((r) => setTimeout(r, (secondsLeft + 0.3) * 1000));
      }
      const code = self.SFFav.totp(credential.totp, Date.now() / 1000);
      if (code) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: fillTotpCodeInPage,
          args: [code, true], // submit=true — guarded above
        });
      }
    } catch (e) {
      console.error("SalesForceFav: 2FA autofill step failed:", e);
    }
  }
  // No automatic prompt when the org has no key — 2FA setup is only offered
  // when explicitly requested (see handleTotpSetup below), not on every login.
}

// Explicit, on-demand counterpart to the 2FA autofill above: opens the org,
// logs in, and always shows the setup prompt (skipping the "already has a
// key?" check, since the caller — the popup's "Set up 2FA" button — only
// offers this for credentials that don't have one yet).
async function handleTotpSetup(credential) {
  const url = self.SFFav.resolveSalesforceUrl(credential);
  if (!url) {
    console.error("SalesForceFav: could not resolve a URL for this credential.");
    return;
  }
  const shouldFill = credential.environment !== "sso";

  const tab = await chrome.tabs.create({ url, active: true });
  if (!tab || tab.id == null) {
    console.error("SalesForceFav: no tab was created for 2FA setup.");
    return;
  }
  if (credential.faviconColor) {
    await rememberTabColor(tab.id, credential.faviconColor);
  }

  await waitForTabComplete(tab.id);
  if (shouldFill) {
    const [fillResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillSalesforceLogin,
      args: [credential.username, credential.password],
    });
    if (fillResult && fillResult.result === "needs-password-step") {
      // Login Discovery org — fill the password on the separate follow-up page.
      try {
        await waitForTabComplete(tab.id);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: fillSalesforcePasswordStep,
          args: [credential.password],
        });
      } catch (e) {
        console.error("SalesForceFav: password step failed:", e);
      }
    }
    await waitForNextComplete(tab.id, 10000); // the post-login navigation
  }

  try {
    const bytes = new Uint8Array(20); // 160-bit secret (RFC 6238 §5.1)
    crypto.getRandomValues(bytes);
    const secret = self.SFFav.base32Encode(bytes);
    const otpauthUri = self.SFFav.buildOtpauthUri({
      account: credential.username || credential.credentialName || "account",
      secret,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["popup/vendor/qrcode.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showTotpSetupPrompt,
      args: [credential.credentialName, secret, otpauthUri],
    });
  } catch (e) {
    console.error("SalesForceFav: 2FA setup prompt failed:", e);
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

// Resolve once the tab has finished loading AND settled on its final URL.
// A freshly created tab can report "complete" for its transient about:blank
// frame before the real navigation even starts, and Salesforce's login flow
// can bounce through a client-side redirect (e.g. test.salesforce.com →
// login.salesforce.com) that fires its OWN "complete" on the intermediate
// page before navigating again — either case would make a naive "wait for
// one complete event" resolve too early and run the fill script against a
// page with no login form yet. So after each "complete", this waits a short
// grace period and re-checks: if the URL is still changing, it waits for the
// next "complete" too, instead of assuming the first one was the real page.
function waitForTabComplete(tabId) {
  const isRealPage = (url) => !!url && url !== "about:blank" && !url.startsWith("chrome://");
  return new Promise((resolve) => {
    const waitForNextCompleteEvent = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve();
          return;
        }
        if (tab && tab.status === "complete" && isRealPage(tab.url)) {
          settle(tab.url);
          return;
        }
        const listener = (updatedId, info, updatedTab) => {
          if (updatedId === tabId && info.status === "complete" && isRealPage(updatedTab.url)) {
            chrome.tabs.onUpdated.removeListener(listener);
            settle(updatedTab.url);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    };
    // Confirms the tab is still on `urlAtComplete` after a beat — if it moved
    // on since, a redirect is still in flight, so wait for the next completion.
    const settle = (urlAtComplete) => {
      setTimeout(() => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            resolve();
            return;
          }
          if (tab.status === "complete" && tab.url === urlAtComplete) {
            resolve();
          } else {
            waitForNextCompleteEvent();
          }
        });
      }, 500);
    };
    waitForNextCompleteEvent();
  });
}
