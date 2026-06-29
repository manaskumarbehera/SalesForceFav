# Microsoft Edge Add-ons release

SalesForceFav publishes to the Edge Add-ons store via the Edge Add-ons API
(Update API v1.1, API-key auth), driven by `scripts/release-edge.mjs`. Same
shape as the Chrome release; publish is opt-in.

## One-time setup

1. **Product ID.** From [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview),
   open the SalesForceFav extension — the product ID (a GUID) is in the URL / overview.
2. **API credentials.** Partner Center → Settings → **Publish API** → create an
   API key. Note the **Client ID** and the **API key** value.
3. **Fill `.env`** (gitignored):
   ```
   EDGE_PRODUCT_ID=<guid>
   EDGE_CLIENT_ID=<client id>
   EDGE_API_KEY=<api key>
   ```

## Releasing

```bash
npm run release:edge:dry       # build + upload the package to the draft
npm run release:edge:publish   # build + upload + submit for certification
```

The script builds `build/edge/salesforcefav-vX.Y-edge.zip`, uploads it (polling the
async operation), and — only with `--publish` — submits for certification.

## Reviewer test login

Edge certification needs a Salesforce test account (same as Chrome). Two channels —
use **both**:

1. **Partner Center → Extension → Availability → "Notes for certification"** — the
   field the reviewer reads. Set it in the UI.
2. **The submission `notes` field** sent by `release-edge.mjs`. Put the text in
   `.edge-certification-notes.txt` (repo root, gitignored) or the `EDGE_CERT_NOTES`
   env var. Template + paste-ready text: `DOCUMENTATION/certification-notes.template.md`.

## What the API can and cannot do

The Edge Add-ons Update API (v1.1) **only** uploads the package and submits the
draft for certification (with a `notes` field). It **cannot** edit listing
metadata — **website URL, screenshots, description, privacy/support links, and
the "Notes for certification" listing field are all manual in Partner Center.**

## Handling a certification rejection

Reports list the failed policy. Two we have hit:

- **1.1.3 Distinct Function & Value / Accurate Representation — "URLs did not
  resolve."** A URL in the listing (Website / Support / Privacy) points somewhere
  dead. Fix in **Partner Center → Properties** (API can't). Use the public repo
  as the website URL: `https://github.com/manaskumarbehera/SalesForceFav`. The
  Website field is optional — leave it blank rather than point it anywhere that
  doesn't resolve. Verify every URL field resolves before resubmitting.
- **1.3.1 Product is Testable.** The reviewer couldn't exercise the extension —
  it needs a Salesforce login + steps (see "Reviewer test login" above). Confirm
  the test account still logs in.

## Status

The Edge tooling is scaffolded but **untested end-to-end** until Partner Center
API credentials are added — only `EDGE_PRODUCT_ID` is known so far.
