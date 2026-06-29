# Notes for certification (reviewer test login)

SalesForceFav signs the user in to **a real Salesforce org**, so the reviewer needs
a working Salesforce test account to exercise it. Edge policy **1.3.1 Product is
Testable** fails if this information is missing or the account doesn't work.

## How to use this

1. Copy the block below into a file named **`.edge-certification-notes.txt`** at
   the repo root (gitignored — a safe place for the test password). The release
   script sends it as the submission `notes`.
2. **Also paste the same text** into Partner Center → Extension →
   **Availability → "Notes for certification"** — the field the reviewer reads
   directly. (The API `notes` field supplements it; don't rely on it alone.)
3. Fill in real credentials and **verify the account logs in** (no expired
   password, and either no MFA or an MFA method the reviewer can complete) before
   submitting.

---

## Paste-ready notes (fill the placeholders)

```
Product ID: <EDGE_PRODUCT_ID GUID — include for faster review>

WHAT THIS EXTENSION DOES
SalesForceFav is a credential manager that signs you in to Salesforce. From the
toolbar popup you save one or more orgs (Sandbox, Production, or an SSO URL). When
you click an org, the extension opens the matching login page and fills in your
saved username and password (or opens your SSO URL).

TEST ACCOUNT (Salesforce)
  Environment: Production
  Login URL:   https://login.salesforce.com
  Username:    <test-username>
  Password:    <test-password>
  (A free Salesforce Developer Edition org works: https://developer.salesforce.com/signup)

STEPS TO REVIEW
1. Install the extension in Edge and pin its toolbar icon.
2. Click the SalesForceFav icon to open the popup.
3. Click "+", then add a credential:
     Name: Test Org
     Environment: Production
     Username / Password: the test account above
   Save.
4. On the new card, click the "Open in new tab" action. A tab opens at
   login.salesforce.com and the username/password are filled in and submitted.
5. (Optional) Use the search box, the light/dark toggle, and the Back up / Restore
   buttons to verify the rest of the UI.

NOTES
- Credentials are stored only in the browser's local storage; nothing is sent
  anywhere except the Salesforce/SSO login page the user opens.
- No analytics, no remote server, no remote code.
```
