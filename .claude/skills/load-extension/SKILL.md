---
name: load-extension
description: Load, reload, and manually test the SalesForceFav Chrome extension. Use when the user wants to run, install, reload, debug, or verify the extension's popup or Salesforce login automation.
---

# Load & Test SalesForceFav

SalesForceFav is a Manifest V3 Chrome extension (no build step). It is run by loading
the repo folder unpacked into Chrome. See `AGENT.md` and `README.md` for product details.

## Load the extension (first time)

1. Open `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the repository root (the folder containing
   `manifest.json`).
4. The **SalesForceFav** card appears. Pin it to the toolbar.
5. For incognito logins: open the card's **Details** → enable **Allow in Incognito**.

## Reload after a code change

There is no build. After editing any file in `popup/` or `manifest.json`:

1. Go to `chrome://extensions/`.
2. Click the **reload** (↻) icon on the SalesForceFav card.
3. Re-open the popup to pick up the change.

If you edited `manifest.json`, a reload is required for the change to register.

## Manual test checklist

Exercise these flows after a change:

- **Add credential** — click ➕, pick an environment (Sandbox / Production / SSO),
  fill the form, save; confirm it appears in the list.
- **SSO vs standard** — selecting **SSO** hides username/password and shows the SSO URL
  field; other environments show username/password.
- **Login in Tab / Window / Incognito** — verify the correct Salesforce URL opens and
  the username/password are auto-filled and submitted.
- **Favicon color** — after login, tabs on that org's origin should recolor to the
  chosen favicon color.
- **Edit / Delete** — edit repopulates the form correctly; delete removes the entry and
  persists across popup re-open.
- **Persistence** — close and re-open the popup; saved credentials remain
  (stored in `localStorage` under the `"credentials"` key).

## Debugging

- **Popup logs:** right-click the popup → **Inspect** to open its DevTools console.
- **Target page logs:** open DevTools on the Salesforce tab to see the injected
  `loginSalesforce()` output (it logs to that page's console).
- The login script targets Salesforce DOM ids `#username`, `#password`, `#Login`.
  If auto-fill breaks, check whether Salesforce changed those selectors.

## Browser automation (optional)

If verifying interactively with the `claude-in-chrome` MCP tools, load them via
ToolSearch first, then drive the popup. Do **not** trigger native `alert()` dialogs —
the extension uses `alert()` in some error paths, which blocks automation.
