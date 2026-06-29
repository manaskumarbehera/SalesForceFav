# AGENT.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repository.

## What this project is

**SalesForceFav** is a Google Chrome extension (Manifest V3) that stores Salesforce
login credentials and automates signing in. From the toolbar popup the user can:

- Save credentials for **Sandbox**, **Production**, or **SSO** environments.
- Launch a login in a **new tab**, **new window**, or **incognito window**.
- Auto-fill the Salesforce username/password fields and click the login button.
- **Search** orgs, **pin** favorites (most-recently-used sorting), and **copy**
  username/password to the clipboard.
- **Back up / restore** all credentials as a JSON file (validated + de-duplicated).
- Toggle a **light / dark** theme (persisted).
- Tag each credential with a **favicon color** so logged-in tabs are visually distinct.
- **Edit** and **delete** saved credentials.

The shipped extension has no runtime build step, framework, or backend — it is plain
HTML/CSS/JS loaded directly by the browser. npm is used only for dev tooling
(lint/format/test) and for zipping store packages.

## Repository layout

```
manifest.json             # MV3 manifest: name, version, permissions, icons, popup
icons/                    # Generated PNG icons (16/32/48/128)
popup/
  popup.html              # Popup markup — header, toolbar, list, form container
  popup.css               # Popup styling (light/dark via [data-theme])
  popup.js                # DOM, chrome.* and login automation (side effects)
  credentials.js          # Pure, unit-tested logic (SFFav): validate/search/sort/import
tests/                    # Jest unit tests for credentials.js
scripts/build.mjs         # Stages runtime files into dist/
scripts/generate-icons.mjs# Regenerates icons/ PNGs (zlib, no deps)
build.sh                  # Builds + zips Chrome/Edge store packages
.github/workflows/        # CI: lint + test + build
Privacy Policy.md         # Privacy policy (no data leaves the browser)
README.md                 # Product overview + roadmap
AGENT.md                  # This file
```

`popup/popup.js` is the heart of the extension. It is heavily commented with numbered
steps (`// 1.`, `// 2.`, …); keep that numbering coherent when you edit. Pure,
testable helpers live in `popup/credentials.js`.

## How it works (key flows)

- **Storage:** credentials are persisted in `localStorage` under the `"credentials"`
  key as a JSON array. Each entry has `credentialName`, `environment`, `ssourl`,
  `username`, `password`, `faviconColor`, `pinned`, and `lastUsedAt`. Theme is stored
  under `"sffav-theme"`.
- **Rendering:** the popup keeps an in-memory `state` and re-renders the list through
  `SFFav.filterCredentials` → `SFFav.sortCredentials`. Credential-derived strings are
  written with `textContent` only (never `innerHTML`) — an imported backup file is
  untrusted input, so this prevents markup injection in the privileged popup.
- **Backup/restore:** export builds a versioned JSON envelope; import parses + merges,
  skipping name duplicates. All of this is pure logic in `credentials.js`.
- **Environment → URL:** `sandbox` → `https://test.salesforce.com/`,
  `production` → `https://login.salesforce.com/`, `sso` → the user's `ssourl`.
- **Login automation:** the extension opens the chosen URL, waits for the tab to
  finish loading, then `chrome.scripting.executeScript`s `loginSalesforce()` into the
  page to fill `#username` / `#password` and click `#Login`.
- **Favicon recoloring:** after login, `checkLoginSuccess` → `changeFavicon` recolors
  the favicon of every tab sharing the logged-in origin.

## Conventions

- **No bundler at runtime.** The shipped extension is plain scripts with zero runtime
  dependencies — do not introduce a bundler or transpiler for the extension itself.
  (npm is used only for dev tooling: lint, format, test, packaging.)
- **Manifest V3 only.** Use `chrome.*` MV3 APIs (`scripting`, `tabs`, `windows`,
  `storage`). Do not reintroduce MV2 patterns (e.g. background pages, `tabs.executeScript`).
- **Vanilla JS / DOM.** No external libraries are bundled. Keep runtime dependencies at zero.
- Match the existing style: `const`/arrow functions, two-space indent, numbered
  step comments. Run `npm run format` (Prettier) and `npm run lint` (ESLint) before committing.
- Keep the popup self-contained — all runtime logic lives in `popup/`.
- **Pure logic goes in `popup/credentials.js`** (exposed as `SFFav`), which is unit-tested.
  DOM/`chrome.*`/storage side effects stay in `popup/popup.js`.
- **Injected functions must be self-contained.** Anything passed to
  `chrome.scripting.executeScript({function})` runs in the _page_ context — it cannot
  reference `chrome.*`, the popup scope, or `SFFav`. Pass everything in via `args`.

## Testing & verifying changes

### Automated (pure logic)

```bash
npm install        # one-time
npm test           # jest — unit tests for popup/credentials.js
npm run lint       # eslint
npm run validate   # lint + test (what CI runs)
```

Tests live in `tests/` and cover the pure logic in `popup/credentials.js`
(URL resolution, validation, unique-name checks, immutable CRUD, hex→RGB, search,
sort, and backup import/export/merge). There is no headless-browser test — the popup's
DOM rendering, search, theme, and form can be spot-checked by serving the repo
(`python3 -m http.server`) and opening `popup/popup.html`; the `chrome.*` login/launch
path is verified by loading the unpacked extension manually.

### Manual (popup + login automation)

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root folder.
4. Click the extension icon to open the popup and exercise the changed flow.
5. For incognito logins, open the extension **Details** and enable
   **Allow in Incognito**.

Use the popup DevTools (right-click the popup → Inspect) and the target tab's console
to read `console.log` / `console.error` output while debugging.
See the `load-extension` skill (`.claude/skills/load-extension/`) for a full checklist.

### Building store packages

```bash
./build.sh            # build + zip for chrome and edge → build/<store>/
./build.sh chrome     # one target only
```

One MV3 build serves both Chrome and Edge; `build.sh` only changes the ZIP filename
per store. `scripts/build.mjs` stages runtime files into `dist/`.

## Things to be careful about

- **Credentials are stored in plaintext** in `localStorage`. Do not add code that
  transmits credentials off-device or logs passwords. The privacy posture (everything
  stays local) is a product promise — see `Privacy Policy.md`.
- `host_permissions` is `<all_urls>` and `permissions` includes `scripting`/`tabs`.
  Avoid widening permissions further without a clear reason.
- The login script depends on Salesforce's DOM (`#username`, `#password`, `#Login`).
  If Salesforce changes its markup, this is where breakage will appear.
- Avoid `alert()`-driven flows in new code where possible — prefer in-popup feedback
  (the roadmap calls for real-time validation messages).

## When making changes

- Keep edits minimal and focused; this is a small codebase.
- Bump `version` in `manifest.json` for user-facing releases.
- Update `README.md` if you change or add user-facing behavior.
