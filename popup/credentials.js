// Pure, side-effect-free credential logic shared by the popup and the jest suite.
//
// This file runs in two contexts:
//   - the browser popup, where it attaches its API to the global as `SFFav`;
//   - the jest test runner, where it is required via module.exports.
//
// IMPORTANT: nothing here may touch `chrome.*`, the DOM, or storage. Those live
// in popup.js. Keeping this module pure is what makes it unit-testable.

(function (root) {
  "use strict";

  // Salesforce login endpoints per environment.
  const SF_LOGIN_URLS = {
    sandbox: "https://test.salesforce.com/",
    production: "https://login.salesforce.com/",
  };

  const ENVIRONMENTS = ["sandbox", "production", "sso"];

  // Default tab/favicon color for new and imported credentials (matches the
  // CSS --accent token). Single source of truth so it can't drift.
  const DEFAULT_FAVICON_COLOR = "#3a5ccc";

  // Resolve the URL to open for a credential. SSO uses the user-supplied URL;
  // standard environments map to a fixed Salesforce host. Returns null when the
  // environment is unknown or an SSO credential has no URL.
  function resolveSalesforceUrl(credential) {
    if (!credential) return null;
    if (credential.environment === "sso") {
      return credential.ssourl ? credential.ssourl : null;
    }
    return SF_LOGIN_URLS[credential.environment] || null;
  }

  // Case-insensitive, trimmed name used for uniqueness comparisons.
  function normalizeName(name) {
    return String(name == null ? "" : name)
      .trim()
      .toLowerCase();
  }

  // Index of an existing credential that shares the given name, ignoring the
  // credential currently being edited. Returns -1 when the name is unique.
  function findDuplicateIndex(credentials, name, editIndex) {
    const target = normalizeName(name);
    if (!target) return -1;
    const list = Array.isArray(credentials) ? credentials : [];
    for (let i = 0; i < list.length; i += 1) {
      if (i === editIndex) continue;
      if (normalizeName(list[i] && list[i].credentialName) === target) return i;
    }
    return -1;
  }

  function isValidHttpUrl(value) {
    if (typeof value !== "string" || value.trim() === "") return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  // Validate a credential against the existing list. Returns
  // { valid: boolean, errors: { field: message } }. `editIndex` (or null) lets
  // an edited credential keep its own name without tripping the unique check.
  function validateCredential(credential, credentials, editIndex) {
    const errors = {};
    const c = credential || {};
    const idx = typeof editIndex === "number" ? editIndex : null;

    if (!c.credentialName || !String(c.credentialName).trim()) {
      errors.credentialName = "Credential name is required.";
    } else if (findDuplicateIndex(credentials, c.credentialName, idx) !== -1) {
      errors.credentialName = "A credential with this name already exists.";
    }

    if (!ENVIRONMENTS.includes(c.environment)) {
      errors.environment = "Select an environment.";
    }

    if (c.environment === "sso") {
      if (!isValidHttpUrl(c.ssourl)) {
        errors.ssourl = "Enter a valid SSO URL (http/https).";
      }
    } else if (ENVIRONMENTS.includes(c.environment)) {
      if (!c.username || !String(c.username).trim()) {
        errors.username = "Username is required.";
      }
      if (!c.password || !String(c.password).trim()) {
        errors.password = "Password is required.";
      }
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Immutable insert/update. Returns a NEW array; never mutates the input.
  function upsertCredential(credentials, credential, editIndex) {
    const list = Array.isArray(credentials) ? credentials.slice() : [];
    if (typeof editIndex === "number" && editIndex >= 0 && editIndex < list.length) {
      list[editIndex] = credential;
    } else {
      list.push(credential);
    }
    return list;
  }

  // Immutable delete. Returns a NEW array; out-of-range indexes are a no-op.
  function removeCredential(credentials, index) {
    const list = Array.isArray(credentials) ? credentials.slice() : [];
    if (index >= 0 && index < list.length) list.splice(index, 1);
    return list;
  }

  // Convert "#rrggbb" to [r, g, b]. Falls back to black for malformed input.
  function hexToRgb(hex) {
    const value = typeof hex === "string" ? hex.replace(/^#/, "") : "";
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return [0, 0, 0];
    const bigint = parseInt(value, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }

  // Case-insensitive filter across name, environment, username, and SSO URL.
  function filterCredentials(credentials, query) {
    const q = normalizeName(query);
    const list = Array.isArray(credentials) ? credentials : [];
    if (!q) return list.slice();
    return list.filter((c) => {
      const hay = [c.credentialName, c.environment, c.username, c.ssourl]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }

  // Stable display order: pinned first, then most-recently-used, then by name.
  // Returns a NEW array; never mutates the input.
  function sortCredentials(credentials) {
    const list = Array.isArray(credentials) ? credentials.slice() : [];
    return list.sort((a, b) => {
      const pa = a.pinned ? 1 : 0;
      const pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const la = Number(a.lastUsedAt) || 0;
      const lb = Number(b.lastUsedAt) || 0;
      if (la !== lb) return lb - la;
      return normalizeName(a.credentialName).localeCompare(normalizeName(b.credentialName));
    });
  }

  // Immutable toggle of the `pinned` flag at an index.
  function togglePinAt(credentials, index) {
    const list = Array.isArray(credentials) ? credentials.slice() : [];
    if (index >= 0 && index < list.length) {
      list[index] = { ...list[index], pinned: !list[index].pinned };
    }
    return list;
  }

  // Immutable stamp of `lastUsedAt` at an index (timestamp passed in — this
  // module stays free of Date.now() so it remains deterministic and testable).
  function markUsedAt(credentials, index, timestamp) {
    const list = Array.isArray(credentials) ? credentials.slice() : [];
    if (index >= 0 && index < list.length) {
      list[index] = { ...list[index], lastUsedAt: timestamp };
    }
    return list;
  }

  const EXPORT_APP = "SalesForceFav";
  const EXPORT_FORMAT = 1;

  // Build the backup payload (timestamp passed in for determinism).
  function buildExport(credentials, timestamp) {
    return {
      app: EXPORT_APP,
      format: EXPORT_FORMAT,
      exportedAt: timestamp || null,
      credentials: Array.isArray(credentials) ? credentials : [],
    };
  }

  function serializeExport(credentials, timestamp) {
    return JSON.stringify(buildExport(credentials, timestamp), null, 2);
  }

  // Ensure an imported record has the fields the app expects (defaults for
  // files written by older versions that lack pinned/lastUsedAt).
  function normalizeImported(raw) {
    return {
      credentialName: String(raw.credentialName || "").trim(),
      environment: raw.environment || "",
      ssourl: raw.ssourl || "",
      username: raw.username || "",
      password: raw.password || "",
      faviconColor: raw.faviconColor || DEFAULT_FAVICON_COLOR,
      pinned: raw.pinned === true,
      lastUsedAt: typeof raw.lastUsedAt === "number" ? raw.lastUsedAt : null,
    };
  }

  // Parse a backup file. Accepts either a bare array of credentials or a
  // { credentials: [...] } envelope. Returns { credentials, error }.
  function parseImport(jsonString) {
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch {
      return { credentials: [], error: "File is not valid JSON." };
    }
    const arr = Array.isArray(data) ? data : data && data.credentials;
    if (!Array.isArray(arr)) {
      return { credentials: [], error: "No credentials found in this file." };
    }
    const credentials = arr
      .filter((c) => c && typeof c === "object")
      .map(normalizeImported)
      // Require a name and a recognized environment, else the card's launch
      // buttons would resolve no URL and silently do nothing.
      .filter((c) => c.credentialName && ENVIRONMENTS.includes(c.environment));
    if (credentials.length === 0) {
      return { credentials: [], error: "No valid credentials found in this file." };
    }
    return { credentials, error: null };
  }

  // Merge imported credentials into the existing list, skipping name duplicates
  // (case-insensitive). Returns { merged, added, skipped } — never mutates input.
  function mergeImport(existing, imported) {
    const merged = Array.isArray(existing) ? existing.slice() : [];
    let added = 0;
    let skipped = 0;
    for (const cred of imported || []) {
      if (findDuplicateIndex(merged, cred.credentialName, null) !== -1) {
        skipped += 1;
      } else {
        merged.push(cred);
        added += 1;
      }
    }
    return { merged, added, skipped };
  }

  const api = {
    SF_LOGIN_URLS,
    ENVIRONMENTS,
    DEFAULT_FAVICON_COLOR,
    EXPORT_APP,
    EXPORT_FORMAT,
    resolveSalesforceUrl,
    normalizeName,
    findDuplicateIndex,
    isValidHttpUrl,
    validateCredential,
    upsertCredential,
    removeCredential,
    hexToRgb,
    filterCredentials,
    sortCredentials,
    togglePinAt,
    markUsedAt,
    buildExport,
    serializeExport,
    normalizeImported,
    parseImport,
    mergeImport,
  };

  // Expose on the global for the popup runtime.
  root.SFFav = api;

  // Make importable by the jest suite without touching the global.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof self !== "undefined" ? self : this);
