# Chrome Web Store release

SalesForceFav publishes via the official Chrome Web Store API, driven by
`scripts/release-chrome.mjs` (same mechanism as the sibling Week Number /
TrackForcePro extensions). Publish is opt-in and never happens by accident.

## One-time setup

1. **Create the store item.** In the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole), create a
   new item (you can upload the first `build/chrome/salesforcefav-vX.Y-chrome.zip`
   manually to register it). Copy its **32-character item ID**.
2. **OAuth client.** In Google Cloud Console → APIs & Services → Credentials,
   create an OAuth 2.0 Client ID of type **Desktop app**. Note the client id and
   secret. (A single client can manage every item owned by the same developer
   account, so this is shared across sibling extensions.)
3. **Publish the OAuth consent screen to Production.** Google Cloud Console →
   APIs & Services → **OAuth consent screen** → **Publish app** (status must read
   "In production", not "Testing"). **This is the step that makes the refresh
   token long-lived.** Tokens minted while the screen is in "Testing" status
   expire after **7 days** — that is the usual cause of `invalid_grant` on a
   release that worked last week.
4. **Refresh token.** With the consent screen in Production, mint the token once:
   ```bash
   npm run chrome:auth     # opens the consent flow, writes CHROME_REFRESH_TOKEN to .env
   ```
   `scripts/chrome-oauth-token.mjs` runs the loopback flow for the
   `https://www.googleapis.com/auth/chromewebstore` scope and redirects to
   **`http://localhost:8976`** (override with `CHROME_OAUTH_PORT`). Whether you
   need to register that URI depends on the OAuth client **type** (step 2):
   - **Desktop app** client → loopback is allowed automatically; just run it.
   - **Web application** client → first add EXACTLY `http://localhost:8976` to the
     client's **Authorized redirect URIs** in Google Cloud Console, or you get
     `Error 400: redirect_uri_mismatch`. (Easiest long-term: use a Desktop-app
     client and skip this.)
5. **Fill the rest of `.env`.** Copy `.env.example` → `.env` and set:
   - `CHROME_EXTENSION_ID` — **SalesForceFav's own** item ID (never another extension's).
   - `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` (the minter reads these to obtain
     `CHROME_REFRESH_TOKEN`). `.env` is gitignored — never commit it.

## Releasing

```bash
# Bump the version in manifest.json AND package.json first (npm run check:versions).
npm run release:chrome:dry       # build + upload to the draft; no submit
npm run release:chrome:publish   # build + upload + submit for review
```

The script:

1. loads `.env`, validates credentials are present (values are never printed);
2. builds the Chrome ZIP (`./build.sh chrome`);
3. refuses to re-upload a version equal to the last git tag (unless
   `--skip-version-check`);
4. verifies `manifest.json` is at the ZIP root;
5. exchanges the refresh token for an access token, uploads the ZIP, and — only
   with `--publish` — submits for review.

Review typically takes 1–3 business days.

## CI

`.github/workflows/release.yml` runs the same script on a pushed `v*` tag, using
repository **secrets** (`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`,
`CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`). Add those under
Settings → Secrets and variables → Actions before tagging a release.

## Troubleshooting

- **`invalid_grant: Token has been expired or revoked`** — the refresh token is
  dead. The durable fix is one-time setup step 3 (consent screen → **Production**);
  a token from a "Testing"-status client only lasts 7 days. Re-mint with
  `npm run chrome:auth` and, for CI, update the `CHROME_REFRESH_TOKEN` repo secret
  too. Other (rarer) causes: the token was unused for 6 months, >100 tokens were
  issued for the client (oldest auto-revoked), or access was revoked at
  myaccount.google.com/permissions.
- **`Error 400: redirect_uri_mismatch`** during `npm run chrome:auth` — your OAuth
  client is a **Web application** type and doesn't list the redirect URI. Either
  add `http://localhost:8976` to its Authorized redirect URIs, or (simpler) create
  a **Desktop app** OAuth client and put its id/secret in `.env` — Desktop clients
  accept loopback automatically.
- **Minter returns no `refresh_token`** — you previously granted access, so Google
  withholds a new refresh token. Revoke the old grant at
  myaccount.google.com/permissions and re-run `npm run chrome:auth`
  (`prompt=consent` then forces a fresh one).
