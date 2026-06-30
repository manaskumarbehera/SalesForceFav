# SalesForceFav — store listing copy & assets (v1.9.6)

Ready-to-paste copy and generated image assets for the Chrome Web Store and Edge
Add-ons listings. Assets in this folder:

- `screenshot-1280x800.png` — store screenshot (exact 1280×800, Edge/Chrome valid).
- `store-logo-300x300.png` — Edge "Store logo" (exact 300×300).

## Name

```
SalesForceFav
```

## Short description (≤132 chars)

```
Save your Salesforce logins and sign in with one click — Sandbox, Production & SSO — with built-in 2FA. Everything stays on your device.
```

## Description

```
SalesForceFav is a lightweight extension that stores your Salesforce logins and signs you in automatically — across Sandbox, Production, and SSO orgs. Everything stays on your device: no accounts, no servers, no telemetry.

FEATURES
• Credential manager — save, edit, and delete named Salesforce logins from a modern, card-based popup.
• Multiple environments — Sandbox (test.salesforce.com), Production (login.salesforce.com), or a custom SSO URL, each with a color-coded badge.
• One-click login — open and auto-sign-in to Salesforce in a new Tab, Window, or Incognito window.
• Auto-fill — fills the username/password and clicks log in for you.
• Built-in 2FA (TOTP) — store or generate an org's authenticator key; the card shows a live 6-digit code with a countdown, one click to copy. A scannable QR code is rendered locally, so the secret never leaves your browser.
• Instant search — filter orgs as you type by name, environment, username, or URL.
• Pin & smart sort — pin favorites to the top; the rest sort by most-recently used.
• Copy to clipboard — one-click copy of a credential's username or password.
• Backup & Restore — export all credentials to a JSON file and import them back.

PRIVACY
SalesForceFav stores only the credentials you enter, locally in your browser. It has no analytics and no server of its own, and sends credentials only to the Salesforce/identity-provider login page you choose to open.
```

## Privacy policy URL

```
https://github.com/manaskumarbehera/SalesForceFav/blob/main/Privacy%20Policy.md
```

## Category

Productivity / Developer Tools

---

## Finish checklist

### Chrome (item `jdhbfmfnmhmdcbjpojniceajeahbmpdg`) — v1.9.6 already uploaded to the draft

1. https://chrome.google.com/webstore/devconsole → open SalesForceFav → **Privacy practices** tab.
2. Fill it from `DOCUMENTATION/store-privacy-answers.md` (single purpose, the 5 permission
   justifications, "no data sold/transferred", privacy-policy URL above). Save.
3. Tell Claude → it runs `npm run release:chrome:publish -- --skip-version-check` to submit.

### Edge (new product `19b51b3a-e9d0-47c5-ae05-587febe8016f`) — v1.9.6 package uploaded & verified

1. Partner Center → the new extension → **Store listings**. If "Add a language" is disabled,
   it's because the package declares no locale — add **English (en)** once it's selectable
   (or add `"default_locale": "en"` + a `_locales/en/messages.json` to the package and re-upload).
2. Paste the **Name**, **Short description**, **Description** above; set the **privacy policy URL**.
3. Upload **Store logo** = `store-logo-300x300.png`; **Screenshot** = `screenshot-1280x800.png`.
4. **Properties** → category + privacy policy URL; **Availability** → markets.
5. **Notes for certification** (Availability) — paste the Salesforce reviewer test login
   from `DOCUMENTATION/certification-notes.template.md`.
6. Click **Publish** (or tell Claude to run `npm run release:edge:publish` once the listing is complete).
