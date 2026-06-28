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

  const api = {
    SF_LOGIN_URLS,
    ENVIRONMENTS,
    resolveSalesforceUrl,
    normalizeName,
    findDuplicateIndex,
    isValidHttpUrl,
    validateCredential,
    upsertCredential,
    removeCredential,
    hexToRgb,
  };

  // Expose on the global for the popup runtime.
  root.SFFav = api;

  // Make importable by the jest suite without touching the global.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof self !== "undefined" ? self : this);
