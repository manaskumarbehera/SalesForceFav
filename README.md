# SalesForceFav

A lightweight **Google Chrome extension (Manifest V3)** that stores your Salesforce
login credentials and signs you in automatically — across Sandbox, Production, and
SSO orgs.

Everything stays on your device. No accounts, no servers, no telemetry.
See [Privacy Policy](./Privacy%20Policy.md).

## Features

- **Credential manager** — save, edit, and delete named Salesforce logins from a
  simple popup.
- **Multiple environments** — Sandbox (`test.salesforce.com`), Production
  (`login.salesforce.com`), or a custom **SSO** URL.
- **One-click login** — open and auto-sign-in to Salesforce in a:
  - new **Tab**
  - new **Window**
  - **Incognito** window
- **Auto-fill** — fills the username/password and clicks login for you.
- **Color-coded favicons** — assign each credential a color so logged-in tabs are
  instantly recognizable.

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
4. For any saved credential, click:
   - **➜ Tab** — log in to a new tab
   - **🗗 Window** — log in to a new window
   - **🥸 Incognito** — log in to an incognito window
   - **✎ Edit** / **✖ Delete** — manage the credential

## How it works

- Credentials are stored locally in the browser's `localStorage` as JSON.
- On login, the extension opens the correct Salesforce URL, waits for the page to
  load, then injects a script (`chrome.scripting`) to fill the login form and submit it.
- After a successful login it recolors the favicon of all tabs on that org's origin.

> ⚠️ **Security note:** credentials (including passwords) are stored in plaintext in
> the browser's local storage and never leave your machine. Use on trusted devices only.

## Project structure

```
manifest.json   # MV3 manifest (permissions, popup entry)
popup/
  popup.html    # Popup UI
  popup.css     # Popup styles
  popup.js      # Storage, UI, and login automation logic
```

## Development

There is no build step — edit the source files and reload the extension from
`chrome://extensions/`. For contributor and AI-agent guidance see [AGENT.md](./AGENT.md).

## Roadmap

Planned and in-progress enhancements:

### Add Credential improvements
- Make the add (**+**) icon dynamic — switch to a cancel (**×**) icon when the form is
  open, using an `action-icon` class instead of a hardcoded symbol.
- Validate all input fields (environment, username, password, SSO URL).
- Enforce **unique credential names**.
- Show real-time success/error feedback messages.
- Replace the hardcoded save (💾) / cancel (🚫) controls with icon-class buttons.

### Search
- Real-time, case-insensitive filtering of saved credentials.
- Support partial matches across name, environment, and other metadata.

### Import / Export
- Export all credentials to a JSON backup file.
- Import credentials from a JSON file, with error handling for bad formats and duplicates.

### Testing
- Investigate and add automated tests for the extension.

## Privacy

This extension does not collect, transmit, or share any data. All credentials are
stored locally in your browser. See the full [Privacy Policy](./Privacy%20Policy.md).
