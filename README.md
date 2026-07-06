# SalesForceFav

A lightweight **Google Chrome extension (Manifest V3)** that stores your Salesforce
login credentials and signs you in automatically — across Sandbox, Production, and
SSO orgs.

Everything stays on your device. No accounts, no servers, no telemetry.
See [Privacy Policy](./Privacy%20Policy.md).

## Features

- **Credential manager** — save, edit, and delete named Salesforce logins from a
  modern, card-based popup.
- **Multiple environments** — Sandbox (`test.salesforce.com`), Production
  (`login.salesforce.com`), or a custom **SSO** URL, each with a color-coded badge.
- **One-click login** — open and auto-sign-in to Salesforce in a new **Tab**,
  new **Window**, or **Incognito** window.
- **Auto-fill** — fills the username/password and clicks login for you.
- **Instant search** — filter orgs as you type by name, environment, username, or URL
  (press <kbd>/</kbd> to jump to the search box).
- **Pin & smart sort** — pin favorites to the top; the rest sort by most-recently used.
- **Copy to clipboard** — one-click copy of a credential's username or password.
- **Built-in 2FA (TOTP)** — store (or **generate**) an org's authenticator key and the
  card shows a **live 6-digit code with a countdown**, one-click to copy. The add/edit
  form shows a **scannable QR code** (rendered locally — the secret never leaves the
  browser) plus **Copy key** / **Copy setup link**, so you can register the org's 2FA
  with your phone or Salesforce — SalesForceFav can be **its own authenticator**.
  Standard RFC 6238 codes, verified against the official RFC test vectors.
- **Backup & Restore** — export all credentials to a JSON file and import them back,
  with validation and automatic de-duplication.
- **Encrypted vault (optional)** — turn on a **master passphrase** to encrypt every
  credential and 2FA key at rest (WebCrypto **PBKDF2-SHA256 + AES-256-GCM**). The popup
  then opens to a **lock screen**; nothing is readable until you unlock. Opt-in, and you
  can **turn it back off** anytime (the open-padlock button) to return to no-passphrase
  storage — your credentials are kept.
- **Security health check** — a header shield flags **reused passwords** across orgs
  and orgs **without 2FA** (SSO orgs excluded); click it for a plain-language summary.
- **Light / Dark theme** — toggle and it's remembered.
- **Color tags + favicon recolor** — give each org a color shown on its card, and the
  logged-in tab's favicon is tinted to match so you can tell orgs apart at a glance.
- **Custom icon** — generated procedurally (`scripts/generate-icons.mjs`); no binary
  design assets to maintain.

## Installation (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin the **SalesForceFav** icon to your toolbar.

To use **Incognito** logins, open the extension's **Details** page and enable
**Allow in Incognito**.

## Usage

1. Click the SalesForceFav toolbar icon to open the popup.
2. Click **➕** to add a credential and fill in the form:
   - **Environment** — Sandbox, Production, or SSO.
   - **Credential Name** — a label for this login.
   - **SSO URL** (SSO only) **or** **Username + Password**.
   - **Favicon Color** — a color to tag logged-in tabs.
3. Save. Your credential appears in the list.
4. For any saved credential, use the card actions (clean line icons):
   - **Tab / Window / Incognito** — log in that way
   - **Copy username / Copy password** — to the clipboard
   - **Pin** — keep it at the top of the list
   - **Edit / Delete** — manage the credential

### Backup & Restore

- Click **↓** to **back up** all credentials to a `salesforcefav-backup-<date>.json`
  file (saved via your browser's normal download).
- Click **↑** to **restore** from such a file. Existing names are kept; duplicates in
  the file are skipped, and you're told how many were imported vs. skipped.

> ⚠️ A backup file contains your passwords in **plain text**. Store it somewhere safe
> (an encrypted disk or password manager), and delete stray copies.

## How it works

- Credentials are stored locally in the browser's `localStorage`. With the **encrypted
  vault** enabled (click the 🔒 in the header → set a passphrase), they're sealed with
  PBKDF2-SHA256 + AES-256-GCM and the popup requires that passphrase to unlock each
  session. **If you forget the passphrase, the data can't be recovered** — keep a
  backup (export) somewhere safe. Without the vault, storage is plaintext (legacy).
- On login, the **background service worker** opens the correct Salesforce URL, waits
  for the page to load, then injects a script (`chrome.scripting`) to fill the login
  form and submit it. (Running this in the worker — not the popup — is what makes
  auto-fill reliable: opening a tab closes the popup.) It then tints the tab's favicon.
- **2FA autofill (optional, opt-in by storing a key):** if the org has an authenticator
  key, the worker also fills the verification code on Salesforce's MFA challenge page —
  **it fills but never submits**, so you confirm (a TOTP can roll over, and repeated bad
  attempts lock accounts). Selectors are best-effort against Salesforce's DOM.

> ⚠️ **Security notes:**
>
> - Credentials (including passwords **and** authenticator keys) are stored in plaintext
>   in `localStorage` and never leave your machine. Use on trusted devices only.
> - Storing the password and the 2FA key together — and auto-filling both — means anyone
>   with your unlocked browser has **both factors**. That weakens what 2FA protects against.
>   Enable 2FA autofill only if that tradeoff is acceptable for the org; for high-value
>   orgs, keep the 2FA key in a separate authenticator.

## Project structure

```
manifest.json             # MV3 manifest (permissions, icons, popup entry)
icons/                    # Generated PNG icons (16/32/48/128)
popup/
  popup.html              # Popup UI
  popup.css               # Popup styles (light/dark themes)
  popup.js                # DOM, chrome.* and login automation (side effects)
  credentials.js          # Pure, unit-tested logic (SFFav): validate/search/sort/import
cli/
  sffav.cjs               # Companion CLI (reuses credentials.js)
  vault.cjs               # AES-256-GCM encrypted vault (PBKDF2-SHA256)
tests/                    # Jest unit tests (credentials + vault)
scripts/build.mjs         # Stages runtime files into dist/
scripts/generate-icons.mjs# Regenerates the PNG icons (no external deps)
build.sh                  # Builds + zips Chrome/Edge packages
```

## Development

The extension ships as plain scripts with **no runtime build step** — edit the source
and reload from `chrome://extensions/`. npm is used only for dev tooling.

```bash
npm install            # install dev tooling (once)
npm test               # run the jest unit tests
npm run lint           # eslint
npm run format         # prettier --write
npm run validate       # lint + test (what CI runs)
./build.sh             # build + zip Chrome and Edge packages → build/
./build.sh chrome      # build a single store target
```

A single Manifest V3 build serves both the **Chrome Web Store** and the
**Microsoft Edge Add-ons** store. CI (`.github/workflows/ci.yml`) runs lint, tests,
and a build on every push. For contributor and AI-agent guidance see
[AGENT.md](./AGENT.md).

## CLI + encrypted vault

A companion Node CLI (`sffav`) manages your logins from the terminal and — unlike the
extension's `localStorage` — keeps them in an **encrypted vault**, never plaintext.

```bash
npm link          # exposes `sffav` for development (or: npm run cli -- <args>)
# or install it globally from the repo:  npm i -g .

sffav init                                   # create an encrypted vault (prompts for a passphrase)
sffav add --name "Acme Prod" --env production --username me@acme.com --password '…' --totp BASE32KEY
sffav list                                   # list orgs (no secrets printed)
sffav url  "Acme Prod"                        # the login URL for the org
sffav export backup.json                     # extension-compatible backup (PLAINTEXT — warns)
sffav import backup.json                     # merge a backup into the vault
```

The master passphrase comes from an interactive hidden prompt or `SFFAV_PASSPHRASE`.
The vault path defaults to `./sffav-vault.json` (override with `--vault` or `$SFFAV_VAULT`).

### Built-in authenticator (2FA)

The CLI can **be its own authenticator** — generate a TOTP secret, store it, and print
the `otpauth://` URI to register the _same_ secret with Salesforce (or another app):

```bash
sffav totp "Acme Prod" --new          # generate a fresh key + print its otpauth:// URI
sffav totp "Acme Prod" --set BASE32   # attach/replace an existing authenticator key
sffav totp "Acme Prod" --uri          # print the otpauth:// URI (turn into a QR for your phone)
sffav totp "Acme Prod"                # the current 6-digit code + seconds left
sffav totp "Acme Prod" --raw          # just the 6 digits (for scripts/agents)
```

These are real RFC-6238 TOTP codes (SHA-1, 6 digits, 30s), the same algorithm authenticator
apps use — so `sffav totp … --raw` and Google Authenticator print the **same code** for the
same key. `tests/cli.test.js` proves this end-to-end: it drives the CLI against a throwaway
vault and asserts its output matches the unit-tested library, and that the key is stored
encrypted (never in the vault file as plaintext). The extension popup shows the same live
code on each org card, and can auto-fill it on Salesforce's login challenge.

### The extension's built-in authenticator requires this CLI

By design, the in-popup 2FA authenticator (the key field + QR + live code on each card) is
available **only when the `sffav` CLI is installed** — the CLI is the encrypted, testable
source of truth for authenticator keys. A browser extension can't see a globally-installed
binary directly, so the CLI registers a tiny **native-messaging host** that the popup pings:

```bash
npm i -g .                                   # install the CLI
sffav install-host                           # register the native host (published build)
sffav install-host <your-extension-id>       # …or pass your unpacked/dev id (chrome://extensions)
```

Reopen the popup and the built-in authenticator appears; without it, the popup shows an
"install the CLI" hint instead. `sffav uninstall-host` removes the registration.
`tests/native-host.test.js` covers the host handshake and the manifest it writes.

### Agents / CI (non-interactive)

An automated agent can pull a live MFA code without any prompt — set the passphrase in
the environment and use `--raw`:

```bash
export SFFAV_PASSPHRASE="…"
CODE=$(sffav totp "Acme Prod" --raw)        # 6 digits, ready to type into Salesforce MFA
```

(Username/password for scripted login can be read from `sffav export` — which is
plaintext, so treat that file as a secret.)

### How "not plaintext" works

- The vault is sealed with **AES-256-GCM**; the key is derived from your passphrase via
  **PBKDF2-SHA256 (210k iterations)** with a random salt. A random IV is used per save.
- GCM is **authenticated** — a wrong passphrase or any tampering makes the decrypt
  _fail_ rather than return garbage. The passphrase is never stored.
- The vault file contains only `salt`, `iv`, `tag`, and the ciphertext — **no plaintext
  credentials** (there's a unit test asserting exactly that).
- See `cli/vault.cjs`; the same approach (via the browser's WebCrypto) is the planned
  path to encrypting the extension's own storage — see the roadmap.

> The extension popup still stores credentials in `localStorage` in plaintext today;
> the CLI vault is the secure-storage model we'll bring to the extension next.

## Publishing (Chrome Web Store + Edge Add-ons)

Releases are automated but **credential-gated and publish-opt-in** — uploading
always goes to the store _draft_ first; submitting for review is a separate,
explicit step. You need your own developer accounts and API credentials.

```bash
cp .env.example .env        # then fill in your store credentials
npm run chrome:auth         # one-time: mint the Chrome refresh token

# Dry run — build + upload to the DRAFT only (never submits):
npm run release:chrome:dry
npm run release:edge:dry

# Submit for review / certification (opt-in):
npm run release:chrome:publish
npm run release:edge:publish

npm run release             # bump version + ship BOTH stores (see script header)
```

Or push a `v*` tag and let `.github/workflows/release.yml` upload to each
store's draft (publishing stays a manual `workflow_dispatch` with `publish=true`).
Secrets go in the repo's **Settings → Secrets → Actions**, never in git.

First-time setup and the exact credentials are documented in
[`DOCUMENTATION/CHROME_WEBSTORE_RELEASE.md`](./DOCUMENTATION/CHROME_WEBSTORE_RELEASE.md)
and [`DOCUMENTATION/EDGE_ADDONS_RELEASE.md`](./DOCUMENTATION/EDGE_ADDONS_RELEASE.md).
Store listing/privacy answers are in
[`DOCUMENTATION/store-privacy-answers.md`](./DOCUMENTATION/store-privacy-answers.md).

## Roadmap

### Shipped

- [x] Form validation, unique-name enforcement, and inline error messages.
- [x] Instant search across name / environment / username / URL.
- [x] Backup (export) and Restore (import) with validation + de-duplication.
- [x] Pin favorites and most-recently-used sorting.
- [x] Copy username / password to clipboard.
- [x] Light / dark theme.
- [x] Extension icon + color-coded environment badges.
- [x] Built-in TOTP/2FA code generator (RFC 6238) with live countdown + copy.
- [x] Automated tests (Jest) and Chrome/Edge build.

### Missing features common to this kind of extension

Ideas that would make SalesForceFav stand out further — roughly highest-impact first:

**Security**

- [x] **Encrypted vault in the CLI** (AES-256-GCM + PBKDF2-SHA256) — see `cli/`.
- [ ] **Encrypt the extension's storage** at rest behind a master password (the CLI
      vault is the model; bring it to the popup via WebCrypto).
- [ ] **Encrypted backups** (password-protected export from the extension).
- [ ] **TOTP / 2FA autofill** — codes are generated in-app today (copy to paste);
      auto-typing the code into the Salesforce verification page is the next step.

**Smarter login**

- [ ] **Session/`frontdoor.jsp` login** via OAuth or a session id, instead of typing
      credentials into the page (more reliable, survives login-form changes).
- [ ] **"Login As"** another user within an org (Setup → Users).
- [ ] **Deep links** — jump straight to Setup, Object Manager, Flows, or a saved path.
- [ ] **Detect the current org** in the active tab and highlight the matching credential.

**Organization & UX**

- [ ] **Tags / groups / folders** for managing many orgs.
- [ ] **Drag-to-reorder** and bulk select/delete.
- [ ] **Per-credential notes** and a custom My Domain / login URL.
- [ ] **Keyboard command** to open the popup and quick-launch by number.
- [ ] Open an org in a specific **Chrome profile / container**.

**Sync & reliability**

- [ ] **`chrome.storage.sync`** to sync orgs across devices.
- [ ] **Session health check** — show whether a saved org still has a live session.

### Known cleanups

- [ ] Make the add (**+**) control swap to a cancel (**×**) state while the form is open.

## Privacy

This extension does not collect, transmit, or share any data. All credentials are
stored locally in your browser. See the full [Privacy Policy](./Privacy%20Policy.md).
