// WebCrypto vault for the extension's at-rest encryption.
//
// Mirrors the CLI vault (cli/vault.cjs) but for the browser: a master passphrase
// is stretched with PBKDF2-SHA256 into an AES-256-GCM key, and the credentials are
// sealed with a random salt + IV per save. GCM is authenticated, so a wrong
// passphrase or any tampering fails the decrypt. The passphrase is never stored.
//
// Exposed as the global `SFVault` for the popup, and via module.exports for jest
// (run those tests with `@jest-environment node`, where globalThis.crypto exists).

(function (root) {
  "use strict";

  const ITERATIONS = 210000; // PBKDF2-SHA256
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function fromB64(str) {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  }

  async function deriveKey(passphrase, salt, iterations) {
    if (typeof passphrase !== "string" || passphrase.length === 0) {
      throw new Error("A non-empty passphrase is required.");
    }
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
      "deriveKey",
    ]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Seal a JSON-serializable value into a vault object.
  async function encrypt(data, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(data))
    );
    return {
      app: "SalesForceFav",
      vault: 1,
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      salt: toB64(salt),
      iv: toB64(iv),
      cipher: toB64(new Uint8Array(ct)),
    };
  }

  // Open a vault object. Rejects on a wrong passphrase or tampered ciphertext.
  async function decrypt(vaultObj, passphrase) {
    if (!vaultObj || vaultObj.vault !== 1) {
      throw new Error("Not a SalesForceFav vault.");
    }
    const salt = fromB64(vaultObj.salt);
    const iv = fromB64(vaultObj.iv);
    const ct = fromB64(vaultObj.cipher);
    const key = await deriveKey(passphrase, salt, vaultObj.iterations || ITERATIONS);
    let pt;
    try {
      pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    } catch {
      throw new Error("Wrong passphrase or corrupted vault.");
    }
    return JSON.parse(dec.decode(pt));
  }

  const api = { encrypt, decrypt, ITERATIONS };
  root.SFVault = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
