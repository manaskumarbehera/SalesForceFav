// ─────────────────────────────────────────────────────────────────────────────
// SalesForceFav popup
//
// Pure logic (validation, search, sort, import/export) lives in credentials.js
// (exposed as SFFav) and is unit-tested. This file owns the DOM, chrome.* calls,
// and localStorage. Credential-derived strings are rendered via textContent only
// (never innerHTML) so an imported backup file can't inject markup.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "credentials"; // legacy plaintext (pre-encryption)
const VAULT_KEY = "sffav-vault"; // encrypted blob (when encryption is enabled)
const THEME_KEY = "sffav-theme";

// In-memory view state. `credentials` is the source of truth (mirrors storage).
// `passphrase` is held only while unlocked (cleared on lock / popup close).
const state = {
  credentials: [],
  query: "",
  editIndex: null,
  passphrase: null,
};

const isEncrypted = () => localStorage.getItem(VAULT_KEY) !== null;

document.addEventListener("DOMContentLoaded", function () {
  paintStaticIcons();
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  wireToolbar();
  wireLock();
  updateLockButton();
  if (isEncrypted()) {
    // Vault exists → start locked; credentials load only after unlock.
    showLock("unlock");
  } else {
    state.credentials = loadCredentials();
    render();
  }
  setInterval(updateTotpChips, 1000); // live 2FA codes + countdown
});

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
}

// ── persistence ──────────────────────────────────────────────────────────────

function loadCredentials() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
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
        localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
        return true;
      })
      .catch((e) => {
        console.error("SalesForceFav: encrypt failed:", e);
        toast("Could not save (encryption error)");
        return false;
      });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.credentials));
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
  state.passphrase = null; // persist() now writes the legacy plaintext key
  persist();
  localStorage.removeItem(VAULT_KEY);
  updateLockButton();
  toast("Encryption turned off");
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

  $("lockTitle").textContent = mode === "setup" ? "Encrypt your vault" : "Vault locked";
  $("lockHint").textContent =
    mode === "setup"
      ? "Set a master passphrase to encrypt all credentials and 2FA keys. If you forget it, the data can't be recovered."
      : "Enter your master passphrase to unlock.";
  $("lockBtn").textContent = mode === "setup" ? "Enable encryption" : "Unlock";
  // The reset escape hatch only appears after a failed unlock (revealed in the
  // unlock-error path) — not on every lock screen.
  if ($("lockReset")) $("lockReset").hidden = true;
  // Reset the show/hide toggle to hidden each time the screen opens.
  const lockPass = $("lockPass");
  if (lockPass) lockPass.type = "password";
  setIcon($("lockPassToggle"), "eye");

  $("lockError").hidden = true;
  $("lockPass").value = "";
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
    localStorage.removeItem(STORAGE_KEY);
    hideLock();
    updateLockButton();
    render();
    toast("Encryption enabled");
    return;
  }

  // unlock
  try {
    const vault = JSON.parse(localStorage.getItem(VAULT_KEY));
    const data = await SFVault.decrypt(vault, pass);
    state.credentials = Array.isArray(data.credentials) ? data.credentials : [];
    state.passphrase = pass;
    hideLock();
    updateLockButton();
    render();
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
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(STORAGE_KEY);
  state.passphrase = null;
  state.credentials = [];
  hideLock();
  updateLockButton();
  render();
  toast("Vault reset — encryption is off");
}

function lock() {
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

const openInWindow = (credential) => sendLogin(credential, "newWindow");
const openIncognito = (credential) => sendLogin(credential, "incognito");
const openInTab = (credential) => sendLogin(credential, "newTab");

// ═══════════════════════════════════════════════════════════════════════════
// View layer — rendering, search, theme, backup/restore, and the form.
// ═══════════════════════════════════════════════════════════════════════════

const ENV_META = {
  sandbox: { label: "Sandbox", cls: "env-sandbox" },
  production: { label: "Production", cls: "env-production" },
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
  if (auditBtn) auditBtn.addEventListener("click", () => toast(auditSummary()));

  // Esc closes the form; "/" focuses search (but not while typing in a field).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeForm();
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
// there are reused passwords or orgs without 2FA. Click for a plain-language summary.
function updateAudit() {
  const btn = $("auditBtn");
  if (!btn) return;
  if (state.credentials.length === 0) {
    btn.hidden = true;
    return;
  }
  const a = SFFav.auditCredentials(state.credentials);
  btn.hidden = false;
  btn.classList.toggle("audit-warn", a.issues > 0);
  btn.title = a.issues > 0 ? `${a.issues} security issue(s)` : "No security issues";
  btn.innerHTML =
    svgMarkup("shield", a.issues === 0) +
    (a.issues > 0 ? `<span class="audit-badge">${a.issues}</span>` : "");
}

function auditSummary() {
  const a = SFFav.auditCredentials(state.credentials);
  if (a.issues === 0) return "Looks good — no reused passwords and 2FA on every org.";
  const parts = [];
  if (a.reusedGroups.length) {
    const orgs = a.reusedGroups.reduce((n, g) => n + g.length, 0);
    parts.push(`${orgs} orgs reuse a password`);
  }
  if (a.noTwoFactor.length) {
    parts.push(`${a.noTwoFactor.length} org${a.noTwoFactor.length === 1 ? "" : "s"} without 2FA`);
  }
  return parts.join(" · ");
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

  // Live 2FA code chip (only when an authenticator key is stored). The secret is
  // attached as a JS property — never as a DOM attribute — so it isn't exposed in
  // the serialized HTML. updateTotpChips() refreshes the code/countdown each tick.
  if (credential.totp && SFFav.isValidTotpSecret(credential.totp)) {
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
  actions.appendChild(
    iconButton("window", "Open in new window", "", () => launch(credential, openInWindow))
  );
  actions.appendChild(
    iconButton("incognito", "Open in incognito", "", () => launch(credential, openIncognito))
  );

  if (credential.environment !== "sso") {
    actions.appendChild(
      iconButton("user", "Copy username", "", () => copy(credential.username, "Username copied"))
    );
    actions.appendChild(
      iconButton("lock", "Copy password", "", () => copy(credential.password, "Password copied"))
    );
  }

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

function openForm(editIndex) {
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

  // Authenticator (2FA): SalesForceFav can be its own authenticator — "New"
  // generates a fresh Base32 secret; the setup row reveals the key + an
  // otpauth:// link to register the same secret with Salesforce or a phone.
  const totp = $("totp");
  const totpSetup = $("totpSetup");
  const totpSetupKey = $("totpSetupKey");
  const totpQr = $("totpQr");
  // Build the otpauth:// URI for the current secret (account = username/name).
  const currentOtpauthUri = () =>
    SFFav.buildOtpauthUri({
      account: $("username").value.trim() || $("credentialName").value.trim() || "account",
      secret: totp.value.trim(),
    });
  const showTotpSetup = () => {
    const secret = totp.value.trim();
    const valid = secret && SFFav.isValidTotpSecret(secret);
    // Show the key + QR setup only once a valid Base32 key is present.
    if (!valid) {
      totpSetup.hidden = true;
      totpQr.innerHTML = "";
      return;
    }
    totpSetupKey.textContent = secret.replace(/(.{4})/g, "$1 ").trim();
    // Render the QR locally (the secret never leaves the browser). The SVG is
    // built from static rects by the vendored encoder — safe to inject.
    try {
      const qr = qrcode(0, "M"); // type 0 = auto-size, error-correction level M
      qr.addData(currentOtpauthUri());
      qr.make();
      totpQr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) {
      totpQr.innerHTML = "";
      console.error("QR render failed:", e);
    }
    totpSetup.hidden = false;
  };
  totp.addEventListener("input", showTotpSetup);
  $("totpCopyKey").addEventListener("click", () => copy(totp.value.trim(), "Key copied"));
  $("totpCopyUri").addEventListener("click", () => copy(currentOtpauthUri(), "Setup link copied"));

  // Populate when editing (values set via .value — not innerHTML).
  if (cred) {
    $("title").textContent = "Edit org";
    $("credentialName").value = cred.credentialName || "";
    environment.value = cred.environment || "";
    $("ssourl").value = cred.ssourl || "";
    $("username").value = cred.username || "";
    $("password").value = cred.password || "";
    $("faviconColor").value = cred.faviconColor || SFFav.DEFAULT_FAVICON_COLOR;
    $("totp").value = cred.totp || "";
    showTotpSetup();
    $("pinned").checked = cred.pinned === true;
  }
  updateEnvFields(environment.value);

  $("newCredentialForm").addEventListener("submit", onFormSubmit);
  const cancel = (e) => {
    e.preventDefault();
    closeForm();
  };
  $("cancelForm").addEventListener("click", cancel);
  $("cancelFormBtn").addEventListener("click", cancel);

  $("credentialName").focus();
}

function updateEnvFields(value) {
  const sso = value === "sso";
  $("ssoUrlFieldContainer").hidden = !sso;
  $("usernameFieldContainer").hidden = sso;
  $("passwordFieldContainer").hidden = sso;
  $("username").required = !sso;
  $("password").required = !sso;
  $("ssourl").required = sso;
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
    username: isSSO ? "" : $("username").value.trim(),
    password: isSSO ? "" : $("password").value,
    faviconColor: $("faviconColor").value,
    totp: $("totp").value.trim(),
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
      <option value="sso">SSO</option>
    </select>

    <div id="ssoUrlFieldContainer" hidden>
      <label for="ssourl">SSO URL</label>
      <input type="url" id="ssourl" placeholder="https://my.okta.com/…" />
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

    <label for="totp">Authenticator key (2FA) — optional</label>
    <input type="text" id="totp" autocomplete="off" placeholder="Base32 secret from your authenticator" />
    <div id="totpSetup" class="totp-setup" hidden>
      <p class="totp-setup-title">Scan to add this org's 2FA</p>
      <p class="totp-setup-hint">
        Scan with your phone's authenticator, or in Salesforce choose "use an
        authenticator app" and enter the key below.
      </p>
      <div id="totpQr" class="totp-qr" aria-label="2FA setup QR code"></div>
      <div class="totp-setup-keyrow">
        <code id="totpSetupKey" class="totp-setup-key"></code>
      </div>
      <div class="totp-setup-actions">
        <button type="button" id="totpCopyKey" class="btn">Copy key</button>
        <button type="button" id="totpCopyUri" class="btn">Copy setup link</button>
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
