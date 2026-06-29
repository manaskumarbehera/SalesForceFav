"use strict";

// Encrypted-vault primitives for the SalesForceFav CLI.
//
// Credentials are NEVER written in plaintext. They are sealed with AES-256-GCM
// under a key derived from the user's passphrase via PBKDF2-SHA256. GCM is
// authenticated, so a wrong passphrase or any tampering fails the decrypt rather
// than returning garbage. Salt and IV are random per save.
//
// The vault file is JSON metadata + a base64 ciphertext blob:
//   { app, vault:1, kdf, iterations, salt, iv, tag, cipher }

const crypto = require("node:crypto");

const KDF_ITERATIONS = 210000; // OWASP-ish PBKDF2-SHA256 floor
const KEY_BYTES = 32; // AES-256
const SALT_BYTES = 16;
const IV_BYTES = 12; // GCM standard nonce

function deriveKey(passphrase, salt, iterations) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("A non-empty passphrase is required.");
  }
  return crypto.pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, iterations, KEY_BYTES, "sha256");
}

// Seal an arbitrary JSON-serializable value into a vault object.
function encryptVault(data, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt, KDF_ITERATIONS);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    app: "SalesForceFav",
    vault: 1,
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    cipher: enc.toString("base64"),
  };
}

// Open a vault object. Throws on a wrong passphrase or tampered ciphertext.
function decryptVault(vaultObj, passphrase) {
  if (!vaultObj || vaultObj.vault !== 1) {
    throw new Error("Not a SalesForceFav vault file.");
  }
  const salt = Buffer.from(vaultObj.salt, "base64");
  const iv = Buffer.from(vaultObj.iv, "base64");
  const tag = Buffer.from(vaultObj.tag, "base64");
  const enc = Buffer.from(vaultObj.cipher, "base64");
  const key = deriveKey(passphrase, salt, vaultObj.iterations || KDF_ITERATIONS);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let dec;
  try {
    dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase or corrupted vault.");
  }
  return JSON.parse(dec.toString("utf8"));
}

module.exports = { encryptVault, decryptVault, deriveKey, KDF_ITERATIONS };
