#!/usr/bin/env node
"use strict";

// SalesForceFav CLI — manage Salesforce logins in an ENCRYPTED vault from the
// terminal, and generate TOTP (2FA) codes. Reuses the same validated logic as
// the extension (popup/credentials.js) and the AES-256-GCM vault (cli/vault.cjs).
//
// The vault is never written in plaintext. The master passphrase comes from the
// SFFAV_PASSPHRASE env var, or an interactive hidden prompt.
//
//   sffav init                 create a new empty encrypted vault
//   sffav add --name "Prod" --env production --username u --password p [--totp KEY] [--color #2563eb]
//             --env custom needs --customurl https://acme.my.salesforce.com (My Domain login)
//   sffav list                 list orgs (no secrets printed)
//   sffav totp "Prod"          print the current 2FA code + seconds left
//     --raw                    print only the 6 digits (for agents / scripts)
//     --set <BASE32>           attach/replace the authenticator key
//     --new                    generate a fresh key (be your own authenticator)
//     --uri                    print the otpauth:// URI (QR / another app)
//   sffav url "Prod"           print the login URL for the org
//   sffav rm "Prod"            remove an org
//   sffav export <file>        write a PLAINTEXT backup (extension-compatible) — warns
//   sffav import <file>        merge a backup file into the vault
//   sffav install-host [id…]   register the native host so the EXTENSION can detect
//                              the CLI (gates its built-in authenticator). Pass your
//                              unpacked extension id(s); the store id is included.
//   sffav uninstall-host       remove the native-host registration
//
// Options: --vault <path> (default: ./sffav-vault.json or $SFFAV_VAULT)

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const readline = require("node:readline");
const SFFav = require("../popup/credentials.js");
const { encryptVault, decryptVault } = require("./vault.cjs");

// ── native-messaging host (extension "is the CLI installed?" detector) ─────────
// The browser extension can't see a globally-installed binary, so `install-host`
// registers a tiny native-messaging host (cli/native-host.cjs) that the popup
// pings to prove the CLI is present — which gates the in-popup built-in
// authenticator. See native-host.cjs and popup.js probeCli().
const NM_HOST_NAME = "com.salesforcefav.host";
// SalesForceFav's published Chrome Web Store id (memory: salesforcefav-store-ids).
// Included by default so an installed-from-store extension is detected without
// the user hunting for its id; unpacked/dev builds pass their own id as args.
const KNOWN_CHROME_EXT_ID = "jdhbfmfnmhmdcbjpojniceajeahbmpdg";

function nmHostPath() {
  return path.join(__dirname, "native-host.cjs");
}

function nmManifest(extIds) {
  return {
    name: NM_HOST_NAME,
    description: "SalesForceFav CLI presence detector for the browser extension",
    path: nmHostPath(),
    type: "stdio",
    allowed_origins: extIds.map((id) => `chrome-extension://${id}/`),
  };
}

// Browser NativeMessagingHosts directories to install into, per OS. Only those
// whose browser profile dir already exists are used (don't create config trees
// for browsers that aren't installed). SFFAV_NM_DIR overrides everything — a
// single explicit dir — which the test suite uses.
function nmTargets() {
  if (process.env.SFFAV_NM_DIR) {
    return [
      { browser: "SFFAV_NM_DIR", base: process.env.SFFAV_NM_DIR, dir: process.env.SFFAV_NM_DIR },
    ];
  }
  const home = os.homedir();
  let list = [];
  if (process.platform === "darwin") {
    const a = path.join(home, "Library", "Application Support");
    list = [
      ["Google Chrome", path.join(a, "Google", "Chrome")],
      ["Microsoft Edge", path.join(a, "Microsoft Edge")],
      ["Chromium", path.join(a, "Chromium")],
      ["Brave", path.join(a, "BraveSoftware", "Brave-Browser")],
    ];
  } else if (process.platform === "linux") {
    const c = path.join(home, ".config");
    list = [
      ["Google Chrome", path.join(c, "google-chrome")],
      ["Microsoft Edge", path.join(c, "microsoft-edge")],
      ["Chromium", path.join(c, "chromium")],
      ["Brave", path.join(c, "BraveSoftware", "Brave-Browser")],
    ];
  }
  return list.map(([browser, base]) => ({
    browser,
    base,
    dir: path.join(base, "NativeMessagingHosts"),
  }));
}

// ── arg parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const command = argv[0];
const positionals = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  } else {
    positionals.push(a);
  }
}

const VAULT_PATH = path.resolve(flags.vault || process.env.SFFAV_VAULT || "sffav-vault.json");

const out = (m) => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`${m}\n`);
function die(m) {
  err(`sffav: ${m}`);
  process.exit(1);
}

// ── passphrase (env or hidden prompt) ────────────────────────────────────────
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Mask typed characters.
    rl._writeToOutput = (s) => {
      if (s.includes("\n") || s.includes("\r")) rl.output.write(s);
    };
    rl.output.write(question);
    rl.question("", (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function getPassphrase(confirm) {
  if (process.env.SFFAV_PASSPHRASE) return process.env.SFFAV_PASSPHRASE;
  const pass = await promptHidden("Master passphrase: ");
  if (confirm) {
    const again = await promptHidden("Confirm passphrase: ");
    if (pass !== again) die("passphrases did not match.");
  }
  if (!pass) die("a passphrase is required.");
  return pass;
}

// ── vault I/O ────────────────────────────────────────────────────────────────
function vaultExists() {
  return fs.existsSync(VAULT_PATH);
}

async function loadVault() {
  if (!vaultExists()) die(`no vault at ${VAULT_PATH}. Run: sffav init`);
  const raw = JSON.parse(fs.readFileSync(VAULT_PATH, "utf8"));
  const pass = await getPassphrase(false);
  let data;
  try {
    data = decryptVault(raw, pass);
  } catch (e) {
    die(e.message);
  }
  return { data, pass };
}

function saveVault(data, pass) {
  const sealed = encryptVault(data, pass);
  fs.writeFileSync(VAULT_PATH, JSON.stringify(sealed, null, 2) + "\n", { mode: 0o600 });
}

function findIndex(credentials, name) {
  const target = SFFav.normalizeName(name);
  return credentials.findIndex((c) => SFFav.normalizeName(c.credentialName) === target);
}

// ── commands ─────────────────────────────────────────────────────────────────
const commands = {
  async init() {
    if (vaultExists()) die(`vault already exists at ${VAULT_PATH}.`);
    const pass = await getPassphrase(true);
    saveVault({ credentials: [] }, pass);
    out(`Created encrypted vault at ${VAULT_PATH}`);
  },

  async add() {
    const { data, pass } = await loadVault();
    const credential = {
      credentialName: String(flags.name || "").trim(),
      environment: String(flags.env || "").trim(),
      ssourl: String(flags.ssourl || "").trim(),
      customurl: String(flags.customurl || "").trim(),
      username: String(flags.username || "").trim(),
      password: typeof flags.password === "string" ? flags.password : "",
      totp: String(flags.totp || "").trim(),
      faviconColor: String(flags.color || SFFav.DEFAULT_FAVICON_COLOR),
      pinned: false,
      lastUsedAt: null,
    };
    if (!credential.password && credential.environment !== "sso") {
      credential.password = await promptHidden("Password: ");
    }
    const { valid, errors } = SFFav.validateCredential(credential, data.credentials, null);
    if (!valid) die(`invalid credential — ${Object.values(errors).join(" ")}`);
    data.credentials = SFFav.upsertCredential(data.credentials, credential, null);
    saveVault(data, pass);
    out(`Added "${credential.credentialName}".`);
  },

  async list() {
    const { data } = await loadVault();
    const creds = SFFav.sortCredentials(data.credentials);
    if (creds.length === 0) return out("(vault is empty)");
    out(`${creds.length} org(s) in ${VAULT_PATH}:\n`);
    for (const c of creds) {
      const tags = [c.environment, c.totp ? "2FA" : null, c.pinned ? "pinned" : null]
        .filter(Boolean)
        .join(", ");
      const who = c.environment === "sso" ? c.ssourl : c.username;
      out(`  • ${c.credentialName}  [${tags}]  ${who || ""}`);
    }
  },

  // 2FA management + code generation. Flags:
  //   --set <base32>  attach/replace the authenticator key
  //   --new           generate a brand-new key (be your own authenticator)
  //   --uri           print the otpauth:// provisioning URI (for a QR / another app)
  //   --raw           print only the 6 digits (for agents / scripts)
  async totp() {
    const name =
      positionals[0] || die("usage: sffav totp <name> [--set KEY | --new | --uri | --raw]");
    const { data, pass } = await loadVault();
    const idx = findIndex(data.credentials, name);
    if (idx < 0) die(`no org named "${name}".`);
    const cred = data.credentials[idx];

    // --set / --new mutate the stored secret.
    if (typeof flags.set === "string" || flags.new) {
      const secret = flags.new
        ? SFFav.base32Encode(crypto.randomBytes(20)) // 160-bit secret (RFC 6238 §5.1)
        : flags.set.replace(/\s/g, "").toUpperCase();
      if (!SFFav.isValidTotpSecret(secret)) die("not a valid Base32 authenticator key.");
      data.credentials[idx] = { ...cred, totp: secret };
      saveVault(data, pass);
      const uri = SFFav.buildOtpauthUri({ account: cred.username || name, secret });
      out(`Authenticator ${flags.new ? "generated" : "set"} for "${name}".`);
      if (flags.new) out(`  secret: ${secret}`);
      out(`  otpauth: ${uri}`);
      return;
    }

    if (!cred.totp) die(`"${name}" has no authenticator key (add one with --set or --new).`);

    if (flags.uri) {
      out(SFFav.buildOtpauthUri({ account: cred.username || name, secret: cred.totp }));
      return;
    }

    const code = SFFav.totp(cred.totp, Date.now() / 1000);
    if (!code) die("could not compute a code (invalid secret).");
    if (flags.raw)
      out(code); // machine-friendly: just the digits
    else out(`${code}   (expires in ${SFFav.totpSecondsRemaining(Date.now() / 1000)}s)`);
  },

  async url() {
    const name = positionals[0] || die("usage: sffav url <name>");
    const { data } = await loadVault();
    const idx = findIndex(data.credentials, name);
    if (idx < 0) die(`no org named "${name}".`);
    out(SFFav.resolveSalesforceUrl(data.credentials[idx]) || "(no URL)");
  },

  async rm() {
    const name = positionals[0] || die("usage: sffav rm <name>");
    const { data, pass } = await loadVault();
    const idx = findIndex(data.credentials, name);
    if (idx < 0) die(`no org named "${name}".`);
    data.credentials = SFFav.removeCredential(data.credentials, idx);
    saveVault(data, pass);
    out(`Removed "${name}".`);
  },

  async export() {
    const file = positionals[0] || die("usage: sffav export <file>");
    const { data } = await loadVault();
    fs.writeFileSync(file, SFFav.serializeExport(data.credentials, Date.now()) + "\n");
    err("WARNING: the exported file contains passwords in PLAINTEXT. Store it safely.");
    out(`Exported ${data.credentials.length} org(s) to ${file}`);
  },

  async import() {
    const file = positionals[0] || die("usage: sffav import <file>");
    const { data, pass } = await loadVault();
    const { credentials, error } = SFFav.parseImport(fs.readFileSync(file, "utf8"));
    if (error) die(error);
    const { merged, added, skipped } = SFFav.mergeImport(data.credentials, credentials);
    data.credentials = merged;
    saveVault(data, pass);
    out(`Imported ${added}, skipped ${skipped} duplicate(s).`);
  },

  async "install-host"() {
    const hostPath = nmHostPath();
    if (!fs.existsSync(hostPath)) die(`native host not found at ${hostPath}`);
    try {
      fs.chmodSync(hostPath, 0o755); // must be executable for native messaging (no-op on Windows)
    } catch {
      /* best effort */
    }
    // Dedupe: the published Chrome id plus any ids the user passed.
    const extIds = [KNOWN_CHROME_EXT_ID, ...positionals].filter(
      (v, i, a) => v && a.indexOf(v) === i
    );

    if (process.platform === "win32") return installHostWindows(extIds);

    const manifest = JSON.stringify(nmManifest(extIds), null, 2) + "\n";
    let wrote = 0;
    for (const t of nmTargets()) {
      if (!process.env.SFFAV_NM_DIR && !fs.existsSync(t.base)) continue; // browser not installed
      fs.mkdirSync(t.dir, { recursive: true });
      const file = path.join(t.dir, `${NM_HOST_NAME}.json`);
      fs.writeFileSync(file, manifest);
      out(`  ✓ ${t.browser}: ${file}`);
      wrote += 1;
    }
    if (wrote === 0)
      return out("No Chrome/Edge/Chromium/Brave profile found — nothing to register.");
    out(`\nRegistered "${NM_HOST_NAME}" for ${extIds.length} extension id(s):`);
    extIds.forEach((id) => out(`  • chrome-extension://${id}/`));
    if (positionals.length === 0) {
      out(
        "\nOnly the published Chrome id was registered. For an unpacked/dev build, re-run\n" +
          "with your extension id (copy it from chrome://extensions):  sffav install-host <id>"
      );
    }
    out("\nReopen the extension popup — the built-in authenticator will now appear.");
  },

  async "uninstall-host"() {
    if (process.platform === "win32") return uninstallHostWindows();
    let removed = 0;
    for (const t of nmTargets()) {
      const file = path.join(t.dir, `${NM_HOST_NAME}.json`);
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        out(`  ✓ removed ${file}`);
        removed += 1;
      }
    }
    out(removed ? `\nRemoved ${removed} host manifest(s).` : "No host manifest found.");
  },

  help() {
    out(
      fs
        .readFileSync(__filename, "utf8")
        .split("\n")
        .slice(3, 32)
        .join("\n")
        .replace(/^\/\/ ?/gm, "")
    );
  },
};

// Windows registers native hosts in the registry (not a dir), and the manifest
// `path` must be an executable — so wrap node+script in a .cmd. Best-effort:
// `reg` failures are reported, not fatal. Untested on CI (no Windows runner).
function installHostWindows(extIds) {
  const dir = path.join(process.env.APPDATA || os.homedir(), "SalesForceFav");
  fs.mkdirSync(dir, { recursive: true });
  const cmd = path.join(dir, "sffav-host.cmd");
  fs.writeFileSync(cmd, `@echo off\r\nnode "${nmHostPath()}" %*\r\n`);
  const file = path.join(dir, `${NM_HOST_NAME}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...nmManifest(extIds), path: cmd }, null, 2) + "\n");
  const keys = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NM_HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NM_HOST_NAME}`,
  ];
  let ok = 0;
  for (const key of keys) {
    try {
      execFileSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", file, "/f"], {
        stdio: "ignore",
      });
      out(`  ✓ ${key}`);
      ok += 1;
    } catch (e) {
      err(`  ! could not set ${key}: ${e.message}`);
    }
  }
  out(
    ok
      ? `\nRegistered for ${extIds.length} extension id(s). Reopen the popup.`
      : "No registry keys written."
  );
}

function uninstallHostWindows() {
  for (const browser of ["Google\\Chrome", "Microsoft\\Edge"]) {
    const key = `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${NM_HOST_NAME}`;
    try {
      execFileSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
      out(`  ✓ removed ${key}`);
    } catch {
      /* not present */
    }
  }
}

(async () => {
  const fn = commands[command] || (command ? null : commands.help);
  if (!fn) die(`unknown command "${command}". Try: sffav help`);
  await fn();
})().catch((e) => die(e.message));
