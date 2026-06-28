# AGENT.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repository.

## What this project is

**SalesForceFav** is a Google Chrome extension (Manifest V3) that stores Salesforce
login credentials and automates signing in. From the toolbar popup the user can:

- Save credentials for **Sandbox**, **Production**, or **SSO** environments.
- Launch a login in a **new tab**, **new window**, or **incognito window**.
- Auto-fill the Salesforce username/password fields and click the login button.
- Tag each credential with a **favicon color** so logged-in tabs are visually distinct.
- **Edit** and **delete** saved credentials.

There is no build step, no framework, and no backend. It is plain HTML/CSS/JS loaded
directly by Chrome.

## Repository layout

```
manifest.json        # MV3 manifest: name, version, permissions, popup entry
popup/
  popup.html         # Popup markup — credential list + form container
  popup.css          # Popup styling
  popup.js           # All logic: storage, UI rendering, login automation
Privacy Policy.md    # Privacy policy (no data leaves the browser)
README.md            # Product overview + roadmap
AGENT.md             # This file
```

`popup/popup.js` is the heart of the extension. It is heavily commented with numbered
steps (`// 1.`, `// 2.`, …); keep that numbering coherent when you edit.

## How it works (key flows)

- **Storage:** credentials are persisted in `localStorage` under the `"credentials"`
  key as a JSON array. Each entry is
  `{ credentialName, environment, ssourl, username, password, faviconColor }`.
- **Environment → URL:** `sandbox` → `https://test.salesforce.com/`,
  `production` → `https://login.salesforce.com/`, `sso` → the user's `ssourl`.
- **Login automation:** the extension opens the chosen URL, waits for the tab to
  finish loading, then `chrome.scripting.executeScript`s `loginSalesforce()` into the
  page to fill `#username` / `#password` and click `#Login`.
- **Favicon recoloring:** after login, `checkLoginSuccess` → `changeFavicon` recolors
  the favicon of every tab sharing the logged-in origin.

## Conventions

- **No build tooling.** Do not introduce npm, bundlers, or transpilers unless explicitly
  asked. Edit the source files directly.
- **Manifest V3 only.** Use `chrome.*` MV3 APIs (`scripting`, `tabs`, `windows`,
  `storage`). Do not reintroduce MV2 patterns (e.g. background pages, `tabs.executeScript`).
- **Vanilla JS / DOM.** No external libraries are bundled. Keep dependencies at zero.
- Match the existing style: `const`/arrow functions, two-space indent, numbered
  step comments.
- Keep the popup self-contained — all logic lives in `popup/`.

## Testing & verifying changes

There is no automated test suite. To verify a change, load the unpacked extension:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root folder.
4. Click the extension icon to open the popup and exercise the changed flow.
5. For incognito logins, open the extension **Details** and enable
   **Allow in Incognito**.

Use the popup DevTools (right-click the popup → Inspect) and the target tab's console
to read `console.log` / `console.error` output while debugging.

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
