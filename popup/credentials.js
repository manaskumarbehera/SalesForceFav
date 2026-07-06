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

  // "custom" is a My Domain login URL (https://acme.my.salesforce.com) with
  // standard username/password fill — required for orgs that block the generic
  // login.salesforce.com host ("Prevent login from login.salesforce.com").
  const ENVIRONMENTS = ["sandbox", "production", "custom", "sso"];

  // Default tab/favicon color for new and imported credentials (matches the
  // CSS --accent token). Single source of truth so it can't drift.
  const DEFAULT_FAVICON_COLOR = "#3a5ccc";

  // Resolve the URL to open for a credential. SSO and custom (My Domain) use
  // the user-supplied URL; standard environments map to a fixed Salesforce
  // host. Returns null when the environment is unknown or a URL-based
  // credential has no URL.
  function resolveSalesforceUrl(credential) {
    if (!credential) return null;
    if (credential.environment === "sso") {
      return credential.ssourl ? credential.ssourl : null;
    }
    if (credential.environment === "custom") {
      return credential.customurl ? credential.customurl : null;
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
      if (c.environment === "custom" && !isValidHttpUrl(c.customurl)) {
        errors.customurl = "Enter a valid My Domain URL (https://acme.my.salesforce.com).";
      }
      if (!c.username || !String(c.username).trim()) {
        errors.username = "Username is required.";
      }
      if (!c.password || !String(c.password).trim()) {
        errors.password = "Password is required.";
      }
    }

    // TOTP secret is optional, but if present it must be valid Base32.
    if (c.totp && String(c.totp).trim() && !isValidTotpSecret(c.totp)) {
      errors.totp = "Authenticator key must be a Base32 secret (A–Z, 2–7).";
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

  const STALE_DAYS = 90;

  // Security health audit over the saved credentials. Returns the groups of orgs
  // that share a password and the orgs without 2FA. SSO orgs are excluded from
  // both (their password is empty and their MFA lives at the identity provider).
  // `stale` (orgs unused for 90+ days) is informational, not a security issue —
  // it's reported separately and left out of `issues` on purpose, so it doesn't
  // shift the meaning of an existing, already-relied-on count. `nowMs` is taken
  // as a parameter (never Date.now() internally) to keep this deterministic and
  // testable, matching the rest of this module's convention (see totp()).
  function auditCredentials(credentials, nowMs) {
    const list = Array.isArray(credentials) ? credentials : [];
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    const byPassword = new Map();
    const noTwoFactor = [];
    const stale = [];
    for (const c of list) {
      if (!c || c.environment === "sso") continue;
      if (c.password) {
        if (!byPassword.has(c.password)) byPassword.set(c.password, []);
        byPassword.get(c.password).push(c.credentialName);
      }
      if (!c.totp || !String(c.totp).trim()) noTwoFactor.push(c.credentialName);
      if (c.lastUsedAt && now - c.lastUsedAt > STALE_DAYS * 24 * 60 * 60 * 1000) {
        stale.push(c.credentialName);
      }
    }
    const reusedGroups = [...byPassword.values()].filter((names) => names.length > 1);
    return {
      reusedGroups,
      noTwoFactor,
      stale,
      issues: reusedGroups.length + noTwoFactor.length,
    };
  }

  // ── TOTP (RFC 6238) authenticator ────────────────────────────────────────
  // Pure, dependency-free SHA-1 / HMAC-SHA1 / Base32 so 2FA codes are computed
  // locally and the implementation is unit-testable against the published RFC
  // 4226 / 6238 vectors. Time is always passed in (never Date.now() here) so the
  // module stays deterministic.

  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  // Decode an RFC 4648 Base32 secret to bytes. Spaces and padding are ignored;
  // characters outside the alphabet are skipped (authenticator apps print the
  // secret in spaced groups).
  function base32Decode(input) {
    const clean = String(input || "")
      .toUpperCase()
      .replace(/=+$/, "");
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
      const idx = BASE32_ALPHABET.indexOf(ch);
      if (idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  // Encode bytes to an (unpadded) RFC 4648 Base32 secret. Inverse of base32Decode
  // for whole-byte inputs — used to provision a brand-new authenticator secret.
  function base32Encode(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let bits = 0;
    let value = 0;
    let out = "";
    for (let i = 0; i < arr.length; i += 1) {
      value = (value << 8) | arr[i];
      bits += 8;
      while (bits >= 5) {
        out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  // Build an otpauth:// provisioning URI (what authenticator apps and QR codes
  // encode), so SalesForceFav can hand a new secret to another app — or be the
  // authenticator itself. period/digits default to the TOTP standard.
  function buildOtpauthUri(opts) {
    const o = opts || {};
    const issuer = o.issuer || "SalesForceFav";
    const account = o.account || "account";
    // Conventional otpauth label is "Issuer:Account" with a literal colon; each
    // side is URL-encoded individually (Google Authenticator format).
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    const params = new URLSearchParams({
      secret: String(o.secret || "")
        .replace(/\s/g, "")
        .toUpperCase(),
      issuer,
      algorithm: "SHA1",
      digits: String(o.digits || 6),
      period: String(o.period || 30),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  // A Base32 secret is valid if, ignoring spaces/padding, it is non-empty and
  // contains only alphabet characters.
  function isValidTotpSecret(input) {
    const clean = String(input || "")
      .toUpperCase()
      .replace(/[\s=]+/g, "");
    return clean.length > 0 && /^[A-Z2-7]+$/.test(clean);
  }

  function sha1(bytes) {
    const ml = bytes.length * 8;
    const total = (((bytes.length + 8) >> 6) + 1) << 6; // 64-byte blocks incl. 0x80 + length
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[bytes.length] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(total - 8, Math.floor(ml / 0x100000000));
    dv.setUint32(total - 4, ml >>> 0);

    let h0 = 0x67452301,
      h1 = 0xefcdab89,
      h2 = 0x98badcfe,
      h3 = 0x10325476,
      h4 = 0xc3d2e1f0;
    const w = new Int32Array(80);
    for (let i = 0; i < total; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = dv.getInt32(i + j * 4);
      for (let j = 16; j < 80; j++) {
        const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
        w[j] = (n << 1) | (n >>> 31);
      }
      let a = h0,
        b = h1,
        c = h2,
        d = h3,
        e = h4;
      for (let j = 0; j < 80; j++) {
        let f, k;
        if (j < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (j < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (j < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
        e = d;
        d = c;
        c = (b << 30) | (b >>> 2);
        b = a;
        a = t;
      }
      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
    }
    const out = new Uint8Array(20);
    new DataView(out.buffer).setInt32(0, h0);
    new DataView(out.buffer).setInt32(4, h1);
    new DataView(out.buffer).setInt32(8, h2);
    new DataView(out.buffer).setInt32(12, h3);
    new DataView(out.buffer).setInt32(16, h4);
    return out;
  }

  function hmacSha1(key, message) {
    const block = 64;
    let k = key.length > block ? sha1(key) : key;
    const padded = new Uint8Array(block);
    padded.set(k);
    const ipad = new Uint8Array(block);
    const opad = new Uint8Array(block);
    for (let i = 0; i < block; i++) {
      ipad[i] = padded[i] ^ 0x36;
      opad[i] = padded[i] ^ 0x5c;
    }
    const inner = sha1(concatBytes(ipad, message));
    return sha1(concatBytes(opad, inner));
  }

  function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  // RFC 4226 HOTP for a key (bytes) and counter, zero-padded to `digits`.
  function hotp(keyBytes, counter, digits) {
    const d = digits || 6;
    const msg = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) {
      msg[i] = c & 0xff;
      c = Math.floor(c / 256);
    }
    const hash = hmacSha1(keyBytes, msg);
    const offset = hash[19] & 0x0f;
    const bin =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);
    return String(bin % 10 ** d).padStart(d, "0");
  }

  // RFC 6238 TOTP. `timeSeconds` is the Unix time (passed in for determinism).
  // Returns the code string, or null if the secret is empty/invalid.
  function totp(secretBase32, timeSeconds, opts) {
    const step = (opts && opts.step) || 30;
    const digits = (opts && opts.digits) || 6;
    const key = base32Decode(secretBase32);
    if (key.length === 0) return null;
    const counter = Math.floor(timeSeconds / step);
    return hotp(key, counter, digits);
  }

  // Seconds left in the current TOTP window (for the countdown UI).
  function totpSecondsRemaining(timeSeconds, step) {
    const s = step || 30;
    return s - (Math.floor(timeSeconds) % s);
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
      customurl: raw.customurl || "",
      username: raw.username || "",
      password: raw.password || "",
      faviconColor: raw.faviconColor || DEFAULT_FAVICON_COLOR,
      totp: typeof raw.totp === "string" ? raw.totp : "",
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
    auditCredentials,
    base32Decode,
    base32Encode,
    buildOtpauthUri,
    isValidTotpSecret,
    hotp,
    totp,
    totpSecondsRemaining,
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
