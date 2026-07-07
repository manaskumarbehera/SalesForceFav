// ─────────────────────────────────────────────────────────────────────────────
// SalesForceFav popup
//
// Pure logic (validation, search, sort, import/export) lives in credentials.js
// (exposed as SFFav) and is unit-tested. This file owns the DOM, chrome.* calls,
// and storage. Credential-derived strings are rendered via textContent only
// (never innerHTML) so an imported backup file can't inject markup.
// ─────────────────────────────────────────────────────────────────────────────

// ── storage map ──────────────────────────────────────────────────────────────
// Credential data lives in chrome.storage.local (durable across the profile;
// unlike localStorage it is not subject to browser storage-pressure eviction),
// accessed through a synchronous in-memory mirror (`store`) loaded once at
// startup by initStore(). Legacy localStorage values are migrated on first run.
// Values are kept as the same JSON strings the localStorage era used, so the
// vault format — and therefore CLI backup-file compatibility — is unchanged.
//
//   Key                 | API                  | Lifecycle
//   --------------------|----------------------|---------------------------------
//   STORAGE_KEY          | chrome.storage.local | Permanent. Legacy plaintext
//                        |  (via `store`)       | credential list (pre-encryption).
//   VAULT_KEY            | chrome.storage.local | Permanent. Encrypted credential
//                        |  (via `store`)       | list, once encryption is enabled
//                        |                      | (replaces STORAGE_KEY).
//   DEVICE_UNLOCK_KEY     | chrome.storage.local | Permanent until disabled. Touch
//                        |  (via `store`)       | ID/Hello record: {credentialId,
//                        |                      | salt, wrapped: <passphrase
//                        |                      | encrypted under the PRF secret>}.
//   THEME_KEY            | localStorage         | Permanent. Light/dark preference.
//                        |                      | Stays in localStorage on purpose:
//                        |                      | it's read synchronously before
//                        |                      | first paint (async would flash
//                        |                      | the wrong theme) and is cosmetic.
//   PENDING_TOTP_KEY      | chrome.storage.local | Ephemeral. Queue of {credential
//                        |  (direct, async)     | Name, secret} written by
//                        |                      | background.js after the on-page
//                        |                      | 2FA setup card, drained by
//                        |                      | applyPendingTotp() into the real
//                        |                      | (VAULT_KEY/STORAGE_KEY) list on
//                        |                      | next popup open/unlock. Matched
//                        |                      | by credentialName only — a
//                        |                      | duplicate name would misapply.
//   SESSION_PASS_KEY      | chrome.storage.     | Per-session. The passphrase,
//                        |  session (async)     | held so re-opening the popup
//                        |                      | doesn't re-prompt. Memory-only,
//                        |                      | wiped when the browser quits or
//                        |                      | on "Lock now". Never on disk.
//
// Only VAULT_KEY/STORAGE_KEY are the actual source of truth for credentials;
// DEVICE_UNLOCK_KEY and PENDING_TOTP_KEY are narrow, single-purpose handoffs.
// Security note: chrome.storage.local is plaintext-on-disk in the Chrome
// profile, exactly like localStorage was — at-rest confidentiality comes from
// the AES-256-GCM vault (cryptovault.js), not from the storage layer, and the
// migration doesn't change that model.
const STORAGE_KEY = "credentials"; // legacy plaintext (pre-encryption)
const VAULT_KEY = "sffav-vault"; // encrypted blob (when encryption is enabled)
const THEME_KEY = "sffav-theme";
// chrome.storage.local key background.js stages generated 2FA keys under —
// see the matching constant and comment in background.js.
const PENDING_TOTP_KEY = "sffav-pending-totp";
// Key for the Touch ID / Windows Hello convenience unlock — see the
// device-unlock section below.
const DEVICE_UNLOCK_KEY = "sffav-device-unlock";
// chrome.storage.session key holding the passphrase for the current browser
// session, so re-opening the popup doesn't re-prompt. session storage is
// memory-only, wiped when the browser fully quits, and unreadable by content
// scripts — see the "stay unlocked" section below.
const SESSION_PASS_KEY = "sffav-session-pass";

// In-memory view state. `credentials` is the source of truth (mirrors storage).
// `passphrase` is held only while unlocked (cleared on lock / popup close).
const state = {
  credentials: [],
  query: "",
  editIndex: null,
  passphrase: null,
};

// ── persisted-key mirror ─────────────────────────────────────────────────────
// In-memory mirror of the chrome.storage.local keys, so the rest of the file
// can keep reading synchronously. initStore() fills it once at startup (and
// migrates any legacy localStorage values); storeSet/storeRemove write through
// to chrome.storage.local. Values are raw JSON strings, same as before.
const store = { [STORAGE_KEY]: null, [VAULT_KEY]: null, [DEVICE_UNLOCK_KEY]: null };

async function initStore() {
  const keys = [STORAGE_KEY, VAULT_KEY, DEVICE_UNLOCK_KEY];
  let got = {};
  try {
    got = await chrome.storage.local.get(keys);
  } catch (e) {
    console.error("SalesForceFav: storage read failed:", e);
  }
  for (const key of keys) {
    if (typeof got[key] === "string") {
      store[key] = got[key];
      continue;
    }
    // One-time migration from the localStorage era. Copy first and only then
    // delete, so a failed write can't lose the only copy.
    const legacy = localStorage.getItem(key);
    if (legacy !== null) {
      store[key] = legacy;
      try {
        await chrome.storage.local.set({ [key]: legacy });
        localStorage.removeItem(key);
      } catch (e) {
        console.error("SalesForceFav: storage migration failed for", key, e);
      }
    }
  }
}

function storeGet(key) {
  return store[key]; // JSON string, or null when unset
}

function storeSet(key, value) {
  store[key] = value;
  chrome.storage.local.set({ [key]: value });
}

function storeRemove(key) {
  store[key] = null;
  chrome.storage.local.remove(key);
}

// ── stay unlocked for the browser session ────────────────────────────────────
// The passphrase lives in memory only while the popup is open, and the popup is
// a fresh page load every time it opens — so without this it would re-prompt on
// every open. Caching the passphrase in chrome.storage.session (memory-only,
// wiped when the browser fully quits, isolated to this extension) lets the popup
// silently re-derive the vault on open until the user quits the browser or hits
// "Lock now". All three helpers swallow errors: a missing/blocked session store
// simply falls back to the normal passphrase prompt.
async function sessionRememberPass(pass) {
  try {
    await chrome.storage.session.set({ [SESSION_PASS_KEY]: pass });
  } catch {
    /* no session storage → user just re-enters the passphrase next open */
  }
}
async function sessionGetPass() {
  try {
    const got = await chrome.storage.session.get(SESSION_PASS_KEY);
    return typeof got[SESSION_PASS_KEY] === "string" ? got[SESSION_PASS_KEY] : null;
  } catch {
    return null;
  }
}
async function sessionForgetPass() {
  try {
    await chrome.storage.session.remove(SESSION_PASS_KEY);
  } catch {
    /* best effort */
  }
}

const isEncrypted = () => storeGet(VAULT_KEY) !== null;

document.addEventListener("DOMContentLoaded", async function () {
  paintStaticIcons();
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  wireToolbar();
  wireLock();
  await initStore();
  probePlatformAuth(); // async; re-renders the biometric affordances when it resolves
  probeCli(); // async; reveals/hides the built-in authenticator once we know if the CLI is installed
  updateLockButton();
  updateDeviceUnlockButton();
  if (isEncrypted()) {
    // Vault exists. Try to resume this browser session silently; only fall back
    // to the lock screen when there's no cached passphrase (or it's stale).
    const resumed = await tryResumeSession();
    if (!resumed) showLock("unlock");
  } else {
    state.credentials = loadCredentials();
    render();
    applyPendingTotp();
  }
  setInterval(updateTotpChips, 1000); // live 2FA codes + countdown
});

// Adopt any 2FA keys generated by the post-login setup prompt (background.js)
// into their matching credential, now that we have a writable — and if
// applicable, unlocked — copy of state.credentials to persist() through.
// Entries that don't match a credential yet (e.g. it was renamed, or the
// vault is still locked) are left staged for the next call.
async function applyPendingTotp() {
  let pending;
  try {
    const stored = await chrome.storage.local.get(PENDING_TOTP_KEY);
    pending = Array.isArray(stored[PENDING_TOTP_KEY]) ? stored[PENDING_TOTP_KEY] : [];
  } catch {
    return;
  }
  if (!pending.length) return;

  const remaining = [];
  let applied = 0;
  for (const entry of pending) {
    const match = state.credentials.find(
      (c) => c.credentialName === entry.credentialName && !c.totp
    );
    if (match && SFFav.isValidTotpSecret(entry.secret)) {
      match.totp = entry.secret;
      applied++;
    } else {
      remaining.push(entry);
    }
  }
  await chrome.storage.local.set({ [PENDING_TOTP_KEY]: remaining });
  if (applied) {
    await persist();
    render();
    toast(applied === 1 ? "2FA key saved for 1 org" : `2FA keys saved for ${applied} orgs`);
  }
}

// Refresh every visible 2FA chip: current code (grouped "123 456") and a ring
// that shrinks over the 30s window. Reads the secret from the element property.
function updateTotpChips() {
  const now = Date.now() / 1000;
  const remaining = SFFav.totpSecondsRemaining(now);
  document.querySelectorAll(".totp-chip").forEach((chip) => {
    const value = SFFav.totp(chip._totpSecret, now);
    const codeEl = chip.querySelector(".totp-code");
    const ringEl = chip.querySelector(".totp-ring");
    if (codeEl) codeEl.textContent = value ? `${value.slice(0, 3)} ${value.slice(3)}` : "––– –––";
    if (ringEl) ringEl.style.setProperty("--totp-pct", `${(remaining / 30) * 100}%`);
    chip.classList.toggle("totp-expiring", remaining <= 5);
  });
}

// Paint the fixed toolbar/header icons (theme toggle is set by applyTheme).
function paintStaticIcons() {
  setIcon($("searchIcon"), "search");
  setIcon($("addBtn"), "plus");
  setIcon($("importBtn"), "upload");
  setIcon($("exportBtn"), "download");
  setIcon($("emptyIcon"), "bolt");
  setIcon($("lockDeviceIcon"), "fingerprint");
}

// ── persistence ──────────────────────────────────────────────────────────────

function loadCredentials() {
  try {
    const parsed = JSON.parse(storeGet(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Save state.credentials — encrypted (when unlocked with a passphrase) or, for
// users who haven't enabled encryption, as the legacy plaintext key.
// Returns a promise resolving true on a successful write (false if encryption
// failed) so callers that must sequence on it (enabling encryption) can await.
function persist() {
  if (state.passphrase) {
    return SFVault.encrypt({ credentials: state.credentials }, state.passphrase)
      .then((vault) => {
        storeSet(VAULT_KEY, JSON.stringify(vault));
        return true;
      })
      .catch((e) => {
        console.error("SalesForceFav: encrypt failed:", e);
        toast("Could not save (encryption error)");
        return false;
      });
  }
  storeSet(STORAGE_KEY, JSON.stringify(state.credentials));
  return Promise.resolve(true);
}

// ── encryption: lock screen, unlock, enable ──────────────────────────────────

function updateLockButton() {
  const btn = $("lockToggle");
  if (!btn) return;
  setIcon(btn, "lock");
  // Active = encryption on. Use the in-memory passphrase too, since persist()
  // writes the vault asynchronously right after enabling.
  const active = isEncrypted() || !!state.passphrase;
  btn.classList.toggle("on", active);
  btn.title = active
    ? state.passphrase
      ? "Lock now"
      : "Encrypted"
    : "Encrypt with a master passphrase";

  // "Turn off encryption" — only meaningful when unlocked and encrypted.
  const disableBtn = $("encDisable");
  if (disableBtn) {
    setIcon(disableBtn, "unlock");
    disableBtn.hidden = !(isEncrypted() && state.passphrase);
  }
}

// Decrypt back to plaintext and remove the vault, so there's no per-session
// passphrase prompt. Only available while unlocked.
function disableEncryption() {
  if (!isEncrypted() || !state.passphrase) return;
  const ok = confirm(
    "Turn off encryption?\n\nYour credentials will be stored UNENCRYPTED (no passphrase " +
      "needed to open the popup). You can re-enable encryption anytime. Continue?"
  );
  if (!ok) return;
  sessionForgetPass(); // no vault to resume anymore
  state.passphrase = null; // persist() now writes the legacy plaintext key
  persist();
  storeRemove(VAULT_KEY);
  storeRemove(DEVICE_UNLOCK_KEY); // device unlock only makes sense on top of the encrypted vault
  updateLockButton();
  updateDeviceUnlockButton();
  toast("Encryption turned off");
}

// ── device unlock (Touch ID / Windows Hello) ─────────────────────────────────
// A convenience shortcut layered on the passphrase vault, not a replacement:
// the passphrase is required to enable this (proves the vault is already
// unlockable) and is the ONLY recovery path on a new device/profile/OS
// install, since the platform authenticator's derived secret never leaves
// this machine. Uses the WebAuthn `prf` extension — the same (credential,
// salt) pair deterministically re-derives the same secret, so it works as a
// symmetric key without the authenticator ever exposing one.
//
// Design: reuse SFVault's existing PBKDF2/AES-GCM vault format to wrap the
// real passphrase under the PRF-derived secret (base64-encoded, fed in as if
// it were itself a passphrase) — no new crypto primitive to review, just a
// second, smaller vault stored alongside the real one.

// Whether THIS machine actually has a usable platform authenticator (Touch ID,
// Windows Hello, Android biometrics). The bare API-presence check (PublicKeyCredential
// exists) is true even on desktops with no biometric hardware, which is why the
// biometric affordances used to appear where they could never work. The real
// answer comes from isUserVerifyingPlatformAuthenticatorAvailable(), which is
// async — so we probe once at startup, cache the result, and re-render.
let platformAuthAvailable = false;
async function probePlatformAuth() {
  try {
    platformAuthAvailable =
      typeof PublicKeyCredential !== "undefined" &&
      !!navigator.credentials &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function" &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    platformAuthAvailable = false; // some browsers reject instead of resolving false
  }
  updateDeviceUnlockButton(); // reveal/refresh the biometric UI now that we know
}
const deviceUnlockSupported = () => platformAuthAvailable;
const hasDeviceUnlock = () => storeGet(DEVICE_UNLOCK_KEY) !== null;

// ── CLI presence (gates the built-in authenticator) ──────────────────────────
// The extension can't see a globally-installed binary directly, so the sffav
// CLI registers a native-messaging host (`sffav install-host`) and we ping it.
// A reply means the CLI is present → the in-popup 2FA authenticator is offered;
// no host (or no reply) → it's hidden behind an "install the CLI" hint. Probed
// once at startup and cached, then the 2FA surfaces re-render.
const NATIVE_HOST = "com.salesforcefav.host";
let cliInstalled = false;
async function probeCli() {
  cliInstalled = await new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    // A host that connects but never answers shouldn't hang the gate forever.
    const timer = setTimeout(() => done(false), 2000);
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "ping" }, (resp) => {
        clearTimeout(timer);
        // lastError fires when no host is registered — the "not installed" case.
        done(!chrome.runtime.lastError && !!(resp && resp.ok));
      });
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
  applyFormCliGate(); // update an open Add/Edit form
  render(); // re-render cards (2FA chip + "Set up 2FA" menu gate)
}

// Show the built-in-authenticator controls only when the CLI is present;
// otherwise show the "install the CLI" hint. No-op when no form is open.
function applyFormCliGate() {
  const controls = $("totpControls");
  const hint = $("totpCliHint");
  if (!controls || !hint) return;
  controls.hidden = !cliInstalled;
  hint.hidden = cliInstalled;
}

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

// Run the WebAuthn assertion ceremony and return the PRF secret, base64-encoded.
async function getDevicePrfSecret(credentialId, salt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: credentialId, type: "public-key" }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const results = assertion.getClientExtensionResults();
  const secret = results && results.prf && results.prf.results && results.prf.results.first;
  if (!secret) throw new Error("This device didn't return a usable key.");
  return bytesToB64(new Uint8Array(secret));
}

// The platform authenticator's name is OS-specific — "Touch ID" on Apple,
// "Windows Hello" on Windows — so show only the one that applies rather than
// both. Everything reachable here has already passed the availability probe, so
// the biometric path is always offered as an alternative to (an OR with) the
// master passphrase, never a replacement for it. Falls back to a generic label
// on Linux/ChromeOS/Android where the built-in authenticator has no one brand.
function deviceUnlockNoun() {
  const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || "";
  const plat = (uaPlatform || navigator.platform || navigator.userAgent || "").toLowerCase();
  if (/mac|iphone|ipad|ios/.test(plat)) return "Touch ID";
  if (/win/.test(plat)) return "Windows Hello";
  return "biometric unlock";
}

function updateDeviceUnlockButton() {
  const noun = deviceUnlockNoun();
  const toggle = $("deviceUnlockToggle");
  if (toggle) {
    const show = deviceUnlockSupported() && isEncrypted() && !!state.passphrase;
    toggle.hidden = !show;
    if (show) {
      const on = hasDeviceUnlock();
      setIcon(toggle, "fingerprint");
      toggle.classList.toggle("on", on);
      toggle.title = on ? `${noun} unlock is on — click to turn off` : `Enable ${noun} unlock`;
      toggle.setAttribute("aria-label", toggle.title);
    }
  }
  // Lock-screen button label follows the OS ("Touch ID" / "Windows Hello"), set
  // here since the static HTML can't know the platform. Kept terse — the icon
  // already says "biometric".
  const lockDeviceLabel = $("lockDeviceLabel");
  if (lockDeviceLabel) lockDeviceLabel.textContent = noun;
  // Side-by-side methods: when biometric unlock is enrolled, the Touch ID column
  // sits next to the passphrase column with an "or" between them. In setup mode
  // (nothing enrolled yet) the biometric column and the "or" are hidden and the
  // passphrase column spans the full width.
  const bioReady = deviceUnlockSupported() && hasDeviceUnlock();
  const lockDeviceBtn = $("lockDeviceBtn");
  const lockOr = $("lockOr");
  const inSetup = $("lockScreen") && $("lockScreen").dataset.mode === "setup";
  if (lockDeviceBtn) lockDeviceBtn.hidden = !bioReady || inSetup;
  if (lockOr) lockOr.hidden = !bioReady || inSetup;
}

// Registers a platform-authenticator credential and wraps the CURRENT
// passphrase under its PRF secret. Only reachable while unlocked, so the
// passphrase is always known here — see the header comment above.
async function enableDeviceUnlock() {
  if (!state.passphrase) return;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: "SalesForceFav" }, // no id — browser uses this extension's origin
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: "sffav-device-unlock",
          displayName: "SalesForceFav vault unlock",
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        // ES256 + RS256 — Chrome's recommended default pair; some authenticators
        // (older security keys, certain TPM-backed Windows Hello setups) only
        // support RS256, and registration can fail without it as a fallback.
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
        // Ask for the secret in this same ceremony — some platform authenticators
        // return it directly from create(), saving the user a second prompt.
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const createSecret = cred.getClientExtensionResults()?.prf?.results?.first;
    // Most authenticators only confirm PRF *support* during registration and
    // hand over the actual secret on a follow-up assertion — fall back to
    // that (a second prompt) only when this device didn't provide it above.
    const secretB64 = createSecret
      ? bytesToB64(new Uint8Array(createSecret))
      : await getDevicePrfSecret(cred.rawId, salt);
    const wrapped = await SFVault.encrypt({ passphrase: state.passphrase }, secretB64);
    storeSet(
      DEVICE_UNLOCK_KEY,
      JSON.stringify({
        credentialId: bytesToB64(new Uint8Array(cred.rawId)),
        salt: bytesToB64(salt),
        wrapped,
      })
    );
    updateDeviceUnlockButton();
    toast(`${deviceUnlockNoun()} unlock enabled`);
  } catch (e) {
    console.error("SalesForceFav: enabling device unlock failed:", e);
    toast("Couldn't enable device unlock");
  }
}

function disableDeviceUnlock() {
  storeRemove(DEVICE_UNLOCK_KEY);
  updateDeviceUnlockButton();
  toast("Device unlock turned off");
}

// Unlocks the real vault via the platform authenticator instead of a typed
// passphrase. Any failure (cancelled prompt, tampered storage, unsupported
// device) falls back to lockError — the passphrase field is always right
// there, since it's the only recovery path if this doesn't work.
async function onDeviceUnlockClick() {
  let record;
  try {
    record = JSON.parse(storeGet(DEVICE_UNLOCK_KEY));
  } catch {
    record = null;
  }
  if (!record) return;
  try {
    const secretB64 = await getDevicePrfSecret(
      b64ToBytes(record.credentialId),
      b64ToBytes(record.salt)
    );
    const unwrapped = await SFVault.decrypt(record.wrapped, secretB64);
    const vault = JSON.parse(storeGet(VAULT_KEY));
    const data = await SFVault.decrypt(vault, unwrapped.passphrase);
    state.credentials = Array.isArray(data.credentials) ? data.credentials : [];
    state.passphrase = unwrapped.passphrase;
    sessionRememberPass(unwrapped.passphrase); // stay unlocked for the rest of this browser session
    hideLock();
    updateLockButton();
    updateDeviceUnlockButton();
    render();
    applyPendingTotp();
  } catch (e) {
    console.error("SalesForceFav: device unlock failed:", e);
    lockError("Device unlock failed — enter your passphrase instead.");
  }
}

function wireLock() {
  const lockToggle = $("lockToggle");
  if (lockToggle) {
    lockToggle.addEventListener("click", () => {
      if (state.passphrase)
        lock(); // unlocked → lock now
      else if (!isEncrypted()) showLock("setup"); // not yet encrypted → set it up
    });
  }
  const btn = $("lockBtn");
  if (btn) btn.addEventListener("click", onLockSubmit);
  const lockReset = $("lockReset");
  if (lockReset) lockReset.addEventListener("click", resetVault);
  const encDisable = $("encDisable");
  if (encDisable) encDisable.addEventListener("click", disableEncryption);
  const lockDeviceBtn = $("lockDeviceBtn");
  if (lockDeviceBtn) lockDeviceBtn.addEventListener("click", onDeviceUnlockClick);
  const deviceUnlockToggle = $("deviceUnlockToggle");
  if (deviceUnlockToggle) {
    deviceUnlockToggle.addEventListener("click", () => {
      if (hasDeviceUnlock()) {
        if (confirm(`Turn off ${deviceUnlockNoun()} unlock on this device?`)) disableDeviceUnlock();
      } else {
        enableDeviceUnlock();
      }
    });
  }
  const lockPass = $("lockPass");
  if (lockPass) {
    lockPass.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onLockSubmit();
    });
  }
  const lockPassToggle = $("lockPassToggle");
  if (lockPassToggle && lockPass) {
    lockPassToggle.addEventListener("click", () => {
      const show = lockPass.type === "password";
      lockPass.type = show ? "text" : "password";
      setIcon(lockPassToggle, show ? "eye-off" : "eye");
    });
  }
}

function showLock(mode) {
  const screen = $("lockScreen");
  if (!screen) return;
  screen.dataset.mode = mode;

  $("lockTitle").textContent = mode === "setup" ? "Encrypt vault" : "Vault locked";
  const hint = $("lockHint");
  if (hint) {
    hint.textContent =
      mode === "setup" ? "Set a passphrase. If you forget it, the data can't be recovered." : "";
    hint.hidden = !hint.textContent; // no filler line on the unlock screen
  }
  // The submit is a compact arrow button inside the passphrase row; its meaning
  // ("Unlock" vs "Enable encryption") rides on the title/aria-label, not visible
  // text, so the row stays single-line. The heading + hint carry the wording.
  const lockBtn = $("lockBtn");
  if (lockBtn) {
    const submitLabel = mode === "setup" ? "Enable encryption" : "Unlock";
    lockBtn.setAttribute("aria-label", submitLabel);
    lockBtn.title = submitLabel;
    setIcon(lockBtn, "arrow-right");
  }
  // The reset escape hatch only appears after a failed unlock (revealed in the
  // unlock-error path) — not on every lock screen.
  if ($("lockReset")) $("lockReset").hidden = true;
  // Reset the show/hide toggle to hidden each time the screen opens.
  const lockPass = $("lockPass");
  if (lockPass) lockPass.type = "password";
  setIcon($("lockPassToggle"), "eye");

  $("lockError").hidden = true;
  $("lockPass").value = "";
  updateDeviceUnlockButton(); // shows the lock-screen Touch ID/Hello button when set up
  screen.hidden = false;
  document.body.classList.add("sff-locked"); // hide app chrome behind the lock card
  $("lockPass").focus();
}

function hideLock() {
  const screen = $("lockScreen");
  if (screen) screen.hidden = true;
  document.body.classList.remove("sff-locked");
  $("lockPass").value = "";
}

function lockError(msg) {
  const el = $("lockError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

// Silently re-open the vault from the session-cached passphrase (see
// sessionRememberPass). Returns true when the popup is now unlocked; false when
// there's nothing cached or the cache no longer decrypts the current vault (in
// which case it's cleared so the user gets a clean passphrase prompt).
async function tryResumeSession() {
  const pass = await sessionGetPass();
  if (!pass) return false;
  try {
    const vault = JSON.parse(storeGet(VAULT_KEY));
    const data = await SFVault.decrypt(vault, pass);
    state.credentials = Array.isArray(data.credentials) ? data.credentials : [];
    state.passphrase = pass;
    updateLockButton();
    updateDeviceUnlockButton();
    render();
    applyPendingTotp();
    return true;
  } catch {
    await sessionForgetPass();
    return false;
  }
}

async function onLockSubmit() {
  const mode = $("lockScreen").dataset.mode;
  const pass = $("lockPass").value;
  if (!pass) return lockError("Enter a passphrase.");

  if (mode === "setup") {
    if (pass.length < 6) return lockError("Use at least 6 characters.");
    state.passphrase = pass;
    // Only drop the plaintext copy AFTER the encrypted vault is confirmed written.
    const ok = await persist();
    if (!ok || !isEncrypted()) {
      state.passphrase = null;
      return lockError("Couldn't enable encryption — please try again.");
    }
    storeRemove(STORAGE_KEY);
    sessionRememberPass(pass); // stay unlocked for the rest of this browser session
    hideLock();
    updateLockButton();
    updateDeviceUnlockButton();
    render();
    toast("Encryption enabled");
    return;
  }

  // unlock
  try {
    const vault = JSON.parse(storeGet(VAULT_KEY));
    const data = await SFVault.decrypt(vault, pass);
    state.credentials = Array.isArray(data.credentials) ? data.credentials : [];
    state.passphrase = pass;
    sessionRememberPass(pass); // stay unlocked for the rest of this browser session
    hideLock();
    updateLockButton();
    updateDeviceUnlockButton();
    render();
    applyPendingTotp();
  } catch (e) {
    lockError(e.message || "Could not unlock.");
    // Offer the reset escape hatch only once the user has actually failed to unlock.
    if ($("lockReset")) $("lockReset").hidden = false;
  }
}

// Escape hatch for a forgotten passphrase: the encrypted data can't be decrypted
// without it, so reset clears the vault and starts fresh, unencrypted. Destructive —
// guarded by a confirm.
function resetVault() {
  const msg =
    "Forgot your passphrase?\n\nThe encrypted orgs can't be recovered without it. " +
    "Reset will DELETE the encrypted vault and start fresh (you'll re-add your orgs).\n\n" +
    "If you have a backup file you can restore it afterwards. Continue?";
  if (!confirm(msg)) return;
  sessionForgetPass();
  storeRemove(VAULT_KEY);
  storeRemove(STORAGE_KEY);
  storeRemove(DEVICE_UNLOCK_KEY); // the wrapped passphrase is unrecoverable without the vault anyway
  state.passphrase = null;
  state.credentials = [];
  hideLock();
  updateLockButton();
  updateDeviceUnlockButton();
  render();
  toast("Vault reset — encryption is off");
}

function lock() {
  sessionForgetPass(); // "Lock now" ends the stay-unlocked session
  state.passphrase = null;
  state.credentials = [];
  state.query = "";
  closeForm();
  const list = $("credentialList");
  if (list) list.textContent = ""; // don't leave secrets in the DOM behind the overlay
  updateLockButton();
  showLock("unlock");
}

// ═══════════════════════════════════════════════════════════════════════════
// Login launch — delegated to the background service worker (background.js).
//
// The popup CANNOT run the fill itself: opening a tab/window steals focus and
// closes the popup, killing any "wait for load, then inject" logic before it runs
// — that was the auto-fill-never-happens bug. The service worker persists across
// the popup closing, so it owns the open → wait-for-complete → inject flow. The
// popup just fires a message.
// ═══════════════════════════════════════════════════════════════════════════

function sendLogin(credential, loginType) {
  chrome.runtime.sendMessage({ type: "sffav-login", credential, loginType });
}

// Explicit, on-demand 2FA setup — logs in and shows the QR on the page, but
// only when the user asks for it via the "Set up 2FA" button (never
// automatically on a plain login).
function sendSetupTotp(credential) {
  chrome.runtime.sendMessage({ type: "sffav-setup-totp", credential });
}

const openInWindow = (credential) => sendLogin(credential, "newWindow");
const openIncognito = (credential) => sendLogin(credential, "incognito");
const openInTab = (credential) => sendLogin(credential, "newTab");

// ═══════════════════════════════════════════════════════════════════════════
// View layer — rendering, search, theme, backup/restore, and the form.
// ═══════════════════════════════════════════════════════════════════════════

const ENV_META = {
  sandbox: { label: "Sandbox", cls: "env-sandbox" },
  production: { label: "Production", cls: "env-production" },
  custom: { label: "My Domain", cls: "env-custom" },
  sso: { label: "SSO", cls: "env-sso" },
};

// Monochrome line icons (Feather-style). Inner markup only — no user data, so
// assigning via innerHTML is safe. They inherit color via `stroke: currentColor`.
const ICONS = {
  tab: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>',
  incognito:
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off":
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  "shield-off":
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="4" y1="3" x2="20" y2="21"/>',
  fingerprint:
    '<path d="M12 11a3 3 0 0 0-3 3c0 2 1 3 1 5"/><path d="M18 11a6 6 0 0 0-9.33-5"/><path d="M6 14a6 6 0 0 0 1 5"/><path d="M9 14a3 3 0 0 1 6 0c0 3-2 4-2 6"/><path d="M3 11a9 9 0 0 1 15.6-6.1"/><path d="M21 11a9 9 0 0 1-2.2 6.1"/>',
  more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};

// Return SVG markup for an icon. `fill` makes a solid glyph (used for pins).
function svgMarkup(name, fill) {
  return (
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="${fill ? "currentColor" : "none"}" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">${ICONS[name] || ""}</svg>`
  );
}

function setIcon(el, name, fill) {
  if (el) el.innerHTML = svgMarkup(name, fill);
}

function $(id) {
  return document.getElementById(id);
}

// ── toolbar wiring ───────────────────────────────────────────────────────────

function wireToolbar() {
  const search = $("searchInput");
  if (search) {
    search.addEventListener("input", () => {
      state.query = search.value;
      render();
    });
    // Enter launches the top match in a new tab — type a few letters, hit
    // Enter, logged in. The list is already sorted pinned-first/most-recent,
    // so the top match is the likeliest target.
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const visible = SFFav.sortCredentials(
        SFFav.filterCredentials(state.credentials, state.query)
      );
      if (visible.length > 0) launch(visible[0], openInTab);
    });
  }

  const addBtn = $("addBtn");
  if (addBtn) addBtn.addEventListener("click", () => openForm(null));

  const exportBtn = $("exportBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportBackup);

  const importBtn = $("importBtn");
  const importFile = $("importFile");
  if (importBtn && importFile) {
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", (e) => handleImportFile(e.target.files[0]));
  }

  const themeToggle = $("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  const auditBtn = $("auditBtn");
  if (auditBtn) auditBtn.addEventListener("click", toggleAuditPanel);

  // Esc closes the form; "/" focuses search (but not while typing in a field).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeForm();
      closeAuditPanel();
    }
    if (e.key === "/" && !isEditable(document.activeElement)) {
      e.preventDefault();
      if (search) search.focus();
    }
  });
}

// True when focus is in a text field, so global key shortcuts should stand down.
function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setIcon($("themeToggle"), theme === "dark" ? "sun" : "moon");
}

// ── rendering ────────────────────────────────────────────────────────────────

function render() {
  closeCardMenu(); // rebuilding the list would otherwise orphan an open menu's anchor button
  const list = $("credentialList");
  const empty = $("emptyState");
  if (!list) return;
  list.textContent = "";

  const visible = SFFav.sortCredentials(SFFav.filterCredentials(state.credentials, state.query));

  updateCount(visible.length);
  updateAudit();

  if (visible.length === 0) {
    if (empty) {
      empty.hidden = false;
      const sub = $("emptySub");
      if (sub) {
        sub.textContent =
          state.credentials.length === 0
            ? "Click + to add your first Salesforce login, or ↑ to restore a backup."
            : "No orgs match your search.";
      }
    }
    return;
  }
  if (empty) empty.hidden = true;

  visible.forEach((credential) => {
    list.appendChild(buildCard(credential));
  });
  // Fresh chips start with an empty code — updateTotpChips() only runs on the
  // 1s interval otherwise, so without this the code is blank for up to a
  // second after every render (unlock, search, add/edit).
  updateTotpChips();
}

function updateCount(visibleCount) {
  const label = $("countLabel");
  if (!label) return;
  const total = state.credentials.length;
  if (total === 0) {
    label.textContent = "No orgs saved";
  } else if (visibleCount === total) {
    label.textContent = `${total} org${total === 1 ? "" : "s"}`;
  } else {
    label.textContent = `${visibleCount} of ${total}`;
  }
}

// Security health shield in the header: green when clean, amber with a count when
// there are reused passwords or orgs without 2FA. Click opens the audit panel.
function updateAudit() {
  const btn = $("auditBtn");
  if (!btn) return;
  if (state.credentials.length === 0) {
    btn.hidden = true;
    return;
  }
  const a = SFFav.auditCredentials(state.credentials, Date.now());
  btn.hidden = false;
  btn.classList.toggle("audit-warn", a.issues > 0);
  btn.title = a.issues > 0 ? `${a.issues} security issue(s)` : "No security issues";
  btn.innerHTML =
    svgMarkup("shield", a.issues === 0) +
    (a.issues > 0 ? `<span class="audit-badge">${a.issues}</span>` : "");
  // Keep an already-open panel in sync (e.g. after "Set up 2FA" resolves).
  if (!$("auditPanel").hidden) renderAuditPanel();
}

function findCredentialByName(name) {
  return state.credentials.find((c) => c.credentialName === name) || null;
}

function toggleAuditPanel() {
  const panel = $("auditPanel");
  if (!panel) return;
  if (panel.hidden) openAuditPanel();
  else closeAuditPanel();
}

function openAuditPanel() {
  closeForm(); // the Add/Edit form and the audit panel don't need to coexist
  const panel = $("auditPanel");
  if (!panel) return;
  panel.hidden = false;
  renderAuditPanel();
}

function closeAuditPanel() {
  const panel = $("auditPanel");
  if (!panel) return;
  panel.innerHTML = "";
  panel.hidden = true;
}

// One row: the org name (click → jump to Edit) plus an optional action button.
function auditRow(name, actionLabel, onAction) {
  const row = document.createElement("div");
  row.className = "audit-row";
  const nameBtn = document.createElement("button");
  nameBtn.type = "button";
  nameBtn.className = "audit-row-name";
  nameBtn.textContent = name;
  nameBtn.title = "Edit this org";
  nameBtn.addEventListener("click", () => {
    const cred = findCredentialByName(name);
    if (cred) {
      closeAuditPanel();
      openForm(indexOf(cred));
    }
  });
  row.appendChild(nameBtn);
  if (actionLabel) {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "btn audit-row-action";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", () => {
      const cred = findCredentialByName(name);
      if (cred) onAction(cred);
    });
    row.appendChild(actionBtn);
  }
  return row;
}

function auditSection(title, names, actionLabel, onAction) {
  if (!names.length) return null;
  const section = document.createElement("div");
  section.className = "audit-section";
  const heading = document.createElement("h3");
  heading.textContent = `${title} (${names.length})`;
  section.appendChild(heading);
  names.forEach((name) => section.appendChild(auditRow(name, actionLabel, onAction)));
  return section;
}

function renderAuditPanel() {
  const panel = $("auditPanel");
  if (!panel) return;
  const a = SFFav.auditCredentials(state.credentials, Date.now());

  panel.textContent = "";
  const card = document.createElement("div");
  card.className = "cred-form audit-card";

  const head = document.createElement("div");
  head.className = "form-head";
  const title = document.createElement("strong");
  title.textContent = "Security Audit";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = svgMarkup("close");
  closeBtn.addEventListener("click", closeAuditPanel);
  head.appendChild(title);
  head.appendChild(closeBtn);
  card.appendChild(head);

  if (a.issues === 0 && a.stale.length === 0) {
    const clean = document.createElement("p");
    clean.className = "audit-clean";
    clean.textContent = "✓ Looks good — no reused passwords, 2FA on every org, and nothing stale.";
    card.appendChild(clean);
  } else {
    // Each reused-password group gets its own section, since "fixing" one
    // means changing that specific shared password across those specific orgs.
    a.reusedGroups.forEach((names, i) => {
      const section = auditSection(
        a.reusedGroups.length > 1 ? `Reused password (group ${i + 1})` : "Reused password",
        names,
        null,
        null
      );
      if (section) card.appendChild(section);
    });
    // The "Set up 2FA" action is part of the built-in authenticator, so it's
    // offered only when the CLI is installed; the list itself still shows.
    const noTwoFactorSection = auditSection(
      "Missing 2FA",
      a.noTwoFactor,
      cliInstalled ? "Set up 2FA" : null,
      (cred) => {
        closeAuditPanel();
        sendSetupTotp(cred);
      }
    );
    if (noTwoFactorSection) card.appendChild(noTwoFactorSection);

    const staleSection = auditSection("Not used in 90+ days", a.stale, null, null);
    if (staleSection) {
      staleSection.classList.add("audit-informational");
      card.appendChild(staleSection);
    }
  }

  panel.appendChild(card);
}

// Build one credential card. Credential-derived text uses textContent only.
function buildCard(credential) {
  const card = document.createElement("li");
  card.className = "cred-card";

  // Color rail reflecting the favicon color.
  const rail = document.createElement("span");
  rail.className = "cred-rail";
  rail.style.backgroundColor = credential.faviconColor || SFFav.DEFAULT_FAVICON_COLOR;
  card.appendChild(rail);

  // Main body: name row + meta row.
  const body = document.createElement("div");
  body.className = "cred-body";

  const nameRow = document.createElement("div");
  nameRow.className = "cred-name-row";

  if (credential.pinned) {
    const pin = document.createElement("span");
    pin.className = "cred-pin";
    pin.title = "Pinned";
    pin.innerHTML = svgMarkup("star", true);
    nameRow.appendChild(pin);
  }

  const name = document.createElement("span");
  name.className = "cred-name";
  name.textContent = credential.credentialName; // untrusted → textContent
  nameRow.appendChild(name);

  // Quick copy-username / copy-password affordances that fade in on card hover
  // (see .cred-copy). SSO orgs have no username/password, so they get none —
  // matching the overflow-menu guard. Icons mirror the menu (user / lock).
  if (credential.environment !== "sso") {
    const copyWrap = document.createElement("span");
    copyWrap.className = "cred-copy";
    const copyBtn = (icon, label, value, okMsg) =>
      iconButton(icon, label, "cred-copy-btn", (e) => {
        e.stopPropagation(); // don't trip any card-level handler
        copy(value, okMsg);
      });
    copyWrap.appendChild(copyBtn("user", "Copy username", credential.username, "Username copied"));
    copyWrap.appendChild(copyBtn("lock", "Copy password", credential.password, "Password copied"));
    nameRow.appendChild(copyWrap);
  }

  body.appendChild(nameRow);

  // Meta row: environment badge + username/URL. Keeping the badge here (rather
  // than next to the name) gives long org names the full width of the card.
  const meta = document.createElement("div");
  meta.className = "cred-meta";

  const env = ENV_META[credential.environment] || { label: credential.environment || "?", cls: "" };
  const badge = document.createElement("span");
  badge.className = `cred-badge ${env.cls}`;
  badge.textContent = env.label;
  meta.appendChild(badge);

  const sub = document.createElement("span");
  sub.className = "cred-sub";
  sub.textContent =
    credential.environment === "sso"
      ? credential.ssourl || "SSO login"
      : credential.username || "—";
  meta.appendChild(sub);

  body.appendChild(meta);

  // Live 2FA code chip — part of the built-in authenticator, so it's shown only
  // when the CLI is installed (see probeCli) and a key is stored. The secret is
  // attached as a JS property — never as a DOM attribute — so it isn't exposed in
  // the serialized HTML. updateTotpChips() refreshes the code/countdown each tick.
  if (cliInstalled && credential.totp && SFFav.isValidTotpSecret(credential.totp)) {
    const chip = document.createElement("button");
    chip.className = "totp-chip";
    chip.type = "button";
    chip.title = "Copy 2FA code";
    chip._totpSecret = credential.totp;

    const code = document.createElement("span");
    code.className = "totp-code";
    const ring = document.createElement("span");
    ring.className = "totp-ring";
    chip.appendChild(code);
    chip.appendChild(ring);

    chip.addEventListener("click", () => {
      const value = SFFav.totp(chip._totpSecret, Date.now() / 1000);
      if (value) copy(value, "2FA code copied");
    });
    body.appendChild(chip);
  }

  card.appendChild(body);

  // Actions.
  const actions = document.createElement("div");
  actions.className = "cred-actions";

  actions.appendChild(
    iconButton("tab", "Open in new tab", "", () => launch(credential, openInTab))
  );

  // Less-frequent actions live behind "more" instead of as permanent icons.
  const menuItems = [
    {
      label: "Open in new window",
      icon: "window",
      onClick: () => launch(credential, openInWindow),
    },
    {
      label: "Open in incognito",
      icon: "incognito",
      onClick: () => launch(credential, openIncognito),
    },
  ];
  // Copy username/password live as hover icons on the card name row now (see
  // .cred-copy), so they're no longer duplicated here in the overflow menu.
  // 2FA menu entries are part of the built-in authenticator — only when the CLI
  // is installed. "Remove 2FA key" stays available so a key saved earlier (or via
  // the CLI) can always be cleared, even if the CLI was since removed.
  if (credential.totp) {
    menuItems.push({
      label: "Remove 2FA key",
      icon: "shield-off",
      danger: true,
      onClick: () => removeTotp(credential),
    });
  } else if (cliInstalled) {
    menuItems.push({
      label: "Set up 2FA",
      icon: "shield",
      onClick: () => sendSetupTotp(credential),
    });
  }
  actions.appendChild(iconMenuButton(menuItems));

  actions.appendChild(
    iconButton(
      "star",
      credential.pinned ? "Unpin" : "Pin to top",
      credential.pinned ? "on" : "",
      () => togglePin(credential),
      credential.pinned
    )
  );
  actions.appendChild(iconButton("edit", "Edit", "", () => openForm(indexOf(credential))));
  actions.appendChild(iconButton("trash", "Delete", "danger", () => removeCard(credential)));

  card.appendChild(actions);
  return card;
}

function iconButton(name, title, extraClass, onClick, fill) {
  const btn = document.createElement("button");
  btn.className = `icon-btn ${extraClass || ""}`.trim();
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = svgMarkup(name, fill); // static SVG markup, no user data
  btn.addEventListener("click", onClick);
  return btn;
}

// ── card overflow menu ───────────────────────────────────────────────────────
// Less-frequent per-card actions live behind a "more" button instead of as
// permanent icons, so a card isn't 9 icons wide. Rendered into #cardMenuPortal
// (a fixed top-level container) rather than as a card child, since .cred-card
// has overflow:hidden (for the colored rail) and would clip a dropdown.
let openCardMenuBtn = null;

function closeCardMenu() {
  const portal = $("cardMenuPortal");
  if (portal) portal.textContent = "";
  openCardMenuBtn = null;
}

function openCardMenu(anchorBtn, items) {
  const alreadyOpenForThisButton = openCardMenuBtn === anchorBtn;
  closeCardMenu();
  if (alreadyOpenForThisButton) return; // clicking the same button again just closes it

  const portal = $("cardMenuPortal");
  if (!portal) return;
  const list = document.createElement("div");
  list.className = "card-menu-list";
  items.forEach(({ label, icon, onClick, danger }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `card-menu-item ${danger ? "danger" : ""}`.trim();
    const iconSpan = document.createElement("span");
    iconSpan.className = "card-menu-icon";
    iconSpan.innerHTML = svgMarkup(icon);
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    item.appendChild(iconSpan);
    item.appendChild(labelSpan);
    item.addEventListener("click", () => {
      closeCardMenu();
      onClick();
    });
    list.appendChild(item);
  });
  portal.appendChild(list);

  // Position from the button's actual screen coordinates (the portal has no
  // layout relationship to the card), keeping the menu on-screen horizontally.
  const rect = anchorBtn.getBoundingClientRect();
  const menuWidth = list.offsetWidth || 180;
  list.style.top = `${rect.bottom + 4}px`;
  list.style.left = `${Math.max(8, rect.right - menuWidth)}px`;
  openCardMenuBtn = anchorBtn;
}

function iconMenuButton(items) {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = "More actions";
  btn.setAttribute("aria-label", "More actions");
  btn.innerHTML = svgMarkup("more", true);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCardMenu(btn, items);
  });
  return btn;
}

// Close on outside click, Escape, or scrolling the list (a fixed-position
// menu would otherwise visually detach from its anchor as the list scrolls).
document.addEventListener("click", (e) => {
  if (
    openCardMenuBtn &&
    !e.target.closest(".card-menu-list") &&
    !openCardMenuBtn.contains(e.target)
  ) {
    closeCardMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCardMenu();
});
document.addEventListener(
  "scroll",
  (e) => {
    if (openCardMenuBtn && e.target.contains && e.target.contains(openCardMenuBtn)) closeCardMenu();
  },
  true
);

function indexOf(credential) {
  return state.credentials.indexOf(credential);
}

// ── card actions ───────────────────────────────────────────────────────────

function launch(credential, opener) {
  const idx = indexOf(credential);
  if (idx !== -1) {
    state.credentials = SFFav.markUsedAt(state.credentials, idx, Date.now());
    persist();
  }
  opener(credential);
  render();
}

function togglePin(credential) {
  const idx = indexOf(credential);
  if (idx === -1) return;
  state.credentials = SFFav.togglePinAt(state.credentials, idx);
  persist();
  render();
}

// Clears a stored 2FA key so "Set up 2FA" reappears — for a key that was
// generated but never actually registered with Salesforce (or the phone),
// which otherwise can't be cleared since the Add/Edit form no longer has a
// totp field (2FA setup lives in the post-login flow instead).
function removeTotp(credential) {
  const idx = indexOf(credential);
  if (idx === -1) return;
  const ok = confirm(
    `Remove the saved 2FA key for "${credential.credentialName}"?\n\n` +
      "Only do this if it was never actually registered with Salesforce or your phone " +
      "— otherwise you'll lose the ability to generate matching codes. " +
      '"Set up 2FA" will be available again afterward.'
  );
  if (!ok) return;
  state.credentials[idx] = { ...state.credentials[idx], totp: "" };
  persist();
  render();
  toast("2FA key removed");
}

function removeCard(credential) {
  const idx = indexOf(credential);
  if (idx === -1) return;
  if (!confirm(`Delete "${credential.credentialName}"?`)) return;
  // Deleting shifts indices, which would invalidate an in-progress edit; close
  // the form first so editIndex can't point at the wrong (or a missing) row.
  closeForm();
  state.credentials = SFFav.removeCredential(state.credentials, idx);
  persist();
  render();
}

function copy(text, okMessage) {
  if (!text) {
    toast("Nothing to copy");
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => toast(okMessage),
    () => toast("Copy failed")
  );
}

// ── backup / restore ─────────────────────────────────────────────────────────

function exportBackup() {
  if (state.credentials.length === 0) {
    toast("No credentials to back up");
    return;
  }
  const json = SFFav.serializeExport(state.credentials, Date.now());
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `salesforcefav-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Backed up ${state.credentials.length} org${state.credentials.length === 1 ? "" : "s"}`);
}

function handleImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { credentials, error } = SFFav.parseImport(String(reader.result));
    if (error) {
      toast(error);
      return;
    }
    const { merged, added, skipped } = SFFav.mergeImport(state.credentials, credentials);
    state.credentials = merged;
    persist();
    render();
    toast(`Imported ${added}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`);
  };
  reader.onerror = () => toast("Could not read file");
  reader.readAsText(file);
  // Allow re-importing the same file later.
  const input = $("importFile");
  if (input) input.value = "";
}

// ── toast ──────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 250);
  }, 2200);
}

// ── add / edit form ──────────────────────────────────────────────────────────

// Live-code refresh timer for the form's 2FA enrollment preview. Held at module
// scope so closeForm() can stop it (leaving it running would keep computing
// codes for a closed form). null when no form is open.
let formTotpTimer = null;

function openForm(editIndex) {
  closeAuditPanel(); // the audit panel and the Add/Edit form don't need to coexist
  state.editIndex = typeof editIndex === "number" && editIndex >= 0 ? editIndex : null;
  const container = $("formContainer");
  if (!container) return;
  container.innerHTML = formHtml; // static markup only (no credential strings)
  container.hidden = false;

  const cred = state.editIndex !== null ? state.credentials[state.editIndex] : null;

  const environment = $("environment");
  const pwToggle = $("pwToggle");
  const password = $("password");

  setIcon($("cancelForm"), "close");
  setIcon(pwToggle, "eye");

  environment.addEventListener("change", () => updateEnvFields(environment.value));

  if (pwToggle && password) {
    pwToggle.addEventListener("click", () => {
      const show = password.type === "password";
      password.type = show ? "text" : "password";
      setIcon(pwToggle, show ? "eye-off" : "eye");
    });
  }

  // Populate when editing (values set via .value — not innerHTML).
  if (cred) {
    $("title").textContent = "Edit org";
    $("credentialName").value = cred.credentialName || "";
    environment.value = cred.environment || "";
    $("ssourl").value = cred.ssourl || "";
    $("customurl").value = cred.customurl || "";
    $("username").value = cred.username || "";
    $("password").value = cred.password || "";
    $("faviconColor").value = cred.faviconColor || SFFav.DEFAULT_FAVICON_COLOR;
    $("pinned").checked = cred.pinned === true;
    $("totp").value = cred.totp || "";
  }
  updateEnvFields(environment.value);
  wireFormTotp();
  applyFormCliGate(); // built-in authenticator only when the CLI is installed

  $("newCredentialForm").addEventListener("submit", onFormSubmit);
  const cancel = (e) => {
    e.preventDefault();
    closeForm();
  };
  $("cancelForm").addEventListener("click", cancel);
  $("cancelFormBtn").addEventListener("click", cancel);

  $("credentialName").focus();
}

// Wire the in-form 2FA authenticator: Generate a key, live-preview the QR +
// rolling code as the user types, and copy the otpauth setup link. The key is a
// normal form field — onFormSubmit persists it like any other, and the card's
// live chip (updateTotpChips) takes over once saved.
function wireFormTotp() {
  const input = $("totp");
  if (!input) return;

  $("totpGenerate").addEventListener("click", () => {
    // 160-bit secret (RFC 6238 §5.1), Base32 like an authenticator app prints.
    input.value = SFFav.base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    refreshFormTotp();
    input.focus();
  });
  input.addEventListener("input", refreshFormTotp);

  $("totpCopyUri").addEventListener("click", () => {
    const uri = formOtpauthUri();
    if (uri) copy(uri, "Setup link copied");
  });

  refreshFormTotp();
  // Roll the live preview once a second while the form is open.
  if (formTotpTimer) clearInterval(formTotpTimer);
  formTotpTimer = setInterval(updateFormTotpLive, 1000);
}

// The otpauth:// URI for the key currently in the form, or null if it isn't a
// valid Base32 secret yet. Account label prefers the username, then the org name.
function formOtpauthUri() {
  const secret = $("totp").value.trim();
  if (!SFFav.isValidTotpSecret(secret)) return null;
  const account = $("username").value.trim() || $("credentialName").value.trim() || "account";
  return SFFav.buildOtpauthUri({ account, secret });
}

// Show/hide the enrollment block based on key validity and (re)render the QR.
function refreshFormTotp() {
  const enroll = $("totpEnroll");
  const uri = formOtpauthUri();
  if (!uri) {
    enroll.hidden = true;
    return;
  }
  enroll.hidden = false;
  const host = $("totpQr");
  try {
    const qr = qrcode(0, "Q"); // type 0 = auto-size; level Q tolerates screen glare
    qr.addData(uri);
    qr.make();
    host.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    host.textContent = "QR unavailable — use the key above.";
  }
  updateFormTotpLive();
}

// Refresh the form's live code + countdown (mirrors updateTotpChips for the card).
function updateFormTotpLive() {
  const codeEl = $("totpLiveCode");
  const leftEl = $("totpLiveLeft");
  if (!codeEl || !leftEl) return;
  const secret = $("totp").value.trim();
  if (!SFFav.isValidTotpSecret(secret)) return;
  const now = Date.now() / 1000;
  const code = SFFav.totp(secret, now);
  const left = SFFav.totpSecondsRemaining(now);
  if (code) codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  leftEl.textContent = `${left}s`;
}

function updateEnvFields(value) {
  const sso = value === "sso";
  const custom = value === "custom";
  $("ssoUrlFieldContainer").hidden = !sso;
  $("customUrlFieldContainer").hidden = !custom;
  $("usernameFieldContainer").hidden = sso;
  $("passwordFieldContainer").hidden = sso;
  // TOTP is meaningless for SSO (no password to protect; MFA lives at the IdP).
  $("totpFieldContainer").hidden = sso;
  $("username").required = !sso;
  $("password").required = !sso;
  $("ssourl").required = sso;
  $("customurl").required = custom;
}

function onFormSubmit(event) {
  event.preventDefault();
  const environment = $("environment").value;
  const isSSO = environment === "sso";
  // Re-resolve the credential being edited defensively — the list could have
  // changed (the editing index is only trustworthy if it still points at a row).
  const editing = state.editIndex !== null ? state.credentials[state.editIndex] : null;

  // Only persist the fields that belong to the chosen environment, so switching
  // (e.g. standard → SSO) doesn't leave a stale password or SSO URL in storage.
  const newCredential = {
    credentialName: $("credentialName").value.trim(),
    environment,
    ssourl: isSSO ? $("ssourl").value.trim() : "",
    customurl: environment === "custom" ? $("customurl").value.trim() : "",
    username: isSSO ? "" : $("username").value.trim(),
    password: isSSO ? "" : $("password").value,
    faviconColor: $("faviconColor").value,
    // 2FA key entered in the form (also settable via the post-login QR flow in
    // background.js). Cleared for SSO. validateCredential rejects a present-but-
    // invalid Base32 key, so no extra check is needed here.
    totp: isSSO ? "" : $("totp").value.trim(),
    pinned: $("pinned").checked,
    lastUsedAt: (editing && editing.lastUsedAt) || null,
  };

  const { valid, errors } = SFFav.validateCredential(
    newCredential,
    state.credentials,
    state.editIndex
  );
  if (!valid) {
    showFormErrors(errors);
    return;
  }

  state.credentials = SFFav.upsertCredential(state.credentials, newCredential, state.editIndex);
  persist();
  closeForm();
  render();
  toast(state.editIndex !== null ? "Saved" : "Org added");
}

function closeForm() {
  const container = $("formContainer");
  if (!container) return;
  if (formTotpTimer) {
    clearInterval(formTotpTimer);
    formTotpTimer = null;
  }
  container.innerHTML = "";
  container.hidden = true;
  state.editIndex = null;
}

// Render validation errors inline in the form (no blocking alert()).
function showFormErrors(errors) {
  const container = $("formErrors");
  if (!container) return;
  container.textContent = "";
  const messages = Object.keys(errors).map((field) => errors[field]);
  if (messages.length === 0) {
    container.hidden = true;
    return;
  }
  messages.forEach((m) => {
    const div = document.createElement("div");
    div.textContent = `• ${m}`; // error strings are static, but keep textContent
    container.appendChild(div);
  });
  container.hidden = false;
}

// Static form markup (no credential-derived strings).
const formHtml = `
  <form id="newCredentialForm" class="cred-form" novalidate>
    <div class="form-head">
      <strong id="title">Add org</strong>
      <button type="button" id="cancelForm" class="icon-btn" aria-label="Close"></button>
    </div>
    <div id="formErrors" class="form-errors" role="alert" hidden></div>

    <label for="credentialName">Name</label>
    <input type="text" id="credentialName" placeholder="e.g. Acme Production" required />

    <label for="environment">Environment</label>
    <select id="environment" required>
      <option value="" disabled selected>Select environment</option>
      <option value="sandbox">Sandbox</option>
      <option value="production">Production</option>
      <option value="custom">Custom domain (My Domain)</option>
      <option value="sso">SSO</option>
    </select>

    <div id="ssoUrlFieldContainer" hidden>
      <label for="ssourl">SSO URL</label>
      <input type="url" id="ssourl" placeholder="https://my.okta.com/…" />
    </div>

    <div id="customUrlFieldContainer" hidden>
      <label for="customurl">My Domain login URL</label>
      <input type="url" id="customurl" placeholder="https://acme.my.salesforce.com" />
    </div>

    <div id="usernameFieldContainer">
      <label for="username">Username</label>
      <input type="text" id="username" autocomplete="off" />
    </div>

    <div id="passwordFieldContainer">
      <label for="password">Password</label>
      <div class="pw-wrap">
        <input type="password" id="password" autocomplete="off" />
        <button type="button" id="pwToggle" class="icon-btn" aria-label="Show password"></button>
      </div>
    </div>

    <div id="totpFieldContainer">
      <!-- Built-in authenticator: shown only when the sffav CLI is installed
           (detected via native messaging — see probeCli). Otherwise the hint. -->
      <div id="totpCliHint" class="totp-cli-hint" hidden>
        <strong>Built-in authenticator</strong> needs the <code>sffav</code> CLI. Install it, run
        <code>sffav install-host</code>, then reopen this popup.
      </div>
      <div id="totpControls" hidden>
        <label for="totp">2FA / Authenticator key <span class="field-opt">(optional)</span></label>
        <div class="totp-input-row">
          <input type="text" id="totp" placeholder="Base32 key (e.g. JBSW Y3DP …)" autocomplete="off" spellcheck="false" />
          <button type="button" id="totpGenerate" class="btn">Generate</button>
        </div>
        <div id="totpEnroll" class="totp-enroll" hidden>
          <div id="totpQr" class="totp-qr" aria-hidden="true"></div>
          <div class="totp-enroll-side">
            <div class="totp-live">
              <span id="totpLiveCode" class="totp-live-code">— — —</span>
              <span id="totpLiveLeft" class="totp-live-left"></span>
            </div>
            <button type="button" id="totpCopyUri" class="btn btn-small">Copy setup link</button>
            <p class="totp-hint">
              Scan in Salesforce (Setup → Advanced User Details → App Registration:
              Authenticator Apps), or paste this key there.
            </p>
          </div>
        </div>
      </div>
    </div>


    <div class="form-row">
      <label for="faviconColor">Tab color</label>
      <input type="color" id="faviconColor" value="${SFFav.DEFAULT_FAVICON_COLOR}" />
      <label class="pin-label"><input type="checkbox" id="pinned" /> Pin to top</label>
    </div>

    <div class="form-actions">
      <button type="button" id="cancelFormBtn" class="btn">Cancel</button>
      <button type="submit" class="btn btn-primary">Save</button>
    </div>
  </form>
`;
