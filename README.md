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
- **Backup & Restore** — export all credentials to a JSON file and import them back,
  with validation and automatic de-duplication.
- **Light / Dark theme** — toggle and it's remembered.
- **Color-coded favicons** — assign each credential a color so logged-in tabs are
  instantly recognizable.
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

- Credentials are stored locally in the browser's `localStorage` as JSON.
- On login, the extension opens the correct Salesforce URL, waits for the page to
  load, then injects a script (`chrome.scripting`) to fill the login form and submit it.
- After a successful login it recolors the favicon of all tabs on that org's origin.

> ⚠️ **Security note:** credentials (including passwords) are stored in plaintext in
> the browser's local storage and never leave your machine. Use on trusted devices only.

## Project structure

```
manifest.json             # MV3 manifest (permissions, icons, popup entry)
icons/                    # Generated PNG icons (16/32/48/128)
popup/
  popup.html              # Popup UI
  popup.css               # Popup styles (light/dark themes)
  popup.js                # DOM, chrome.* and login automation (side effects)
  credentials.js          # Pure, unit-tested logic (SFFav): validate/search/sort/import
tests/                    # Jest unit tests
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

## Roadmap

### Shipped

- [x] Form validation, unique-name enforcement, and inline error messages.
- [x] Instant search across name / environment / username / URL.
- [x] Backup (export) and Restore (import) with validation + de-duplication.
- [x] Pin favorites and most-recently-used sorting.
- [x] Copy username / password to clipboard.
- [x] Light / dark theme.
- [x] Extension icon + color-coded environment badges.
- [x] Automated tests (Jest) and Chrome/Edge build.

### Missing features common to this kind of extension

Ideas that would make SalesForceFav stand out further — roughly highest-impact first:

**Security**

- [ ] **Encrypt credentials at rest** behind an optional master password (currently
      plaintext in `localStorage`).
- [ ] **Encrypted backups** (password-protected export).
- [ ] **TOTP / 2FA** code generation and autofill.

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
