# Partner Center / Chrome "Privacy" page — paste-ready answers

The store **Privacy** / data-use / permissions sections are **listing metadata —
there is no API for them**. Fill them in the dashboard with the text below.

Privacy policy URL (resolves, public):
`https://github.com/manaskumarbehera/SalesForceFav/blob/main/Privacy%20Policy.md`

## Single purpose

> SalesForceFav stores the user's Salesforce login credentials locally and signs
> them in to their chosen org (Sandbox, Production, or an SSO URL) by opening the
> login page and filling in the username and password for them.

## Does the extension collect or use personal data?

> The extension stores credentials the user explicitly enters (org name, username,
> password, or SSO URL) **locally in the browser only**. It does not transmit,
> sell, or share them, has no analytics and no remote server of its own, and sends
> the credentials only to the Salesforce/identity-provider login page the user
> chose to open.

## Permission justifications

| Permission                      | Justification                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                          | Open the chosen Salesforce login URL in a new tab/window and detect when it finishes loading so the login form can be filled.                                              |
| `scripting`                     | Inject a small script into the Salesforce login page to fill the username/password and click Log In, and to tint the tab's favicon with the user's color.                  |
| `activeTab`                     | Interact with the tab opened for the login flow.                                                                                                                           |
| `storage`                       | Persist the user's saved credentials and preferences (theme) locally. Never leaves the browser.                                                                            |
| Host permissions (`<all_urls>`) | The login page may be `login.salesforce.com`, `test.salesforce.com`, or any user-supplied SSO URL, so the login-fill script must be injectable on the host the user picks. |

> Note: `<all_urls>` is broad because SSO login URLs are user-defined. A future
> release may narrow this to Salesforce hosts plus per-credential SSO origins.

## Remote code

> No remote code. All logic ships inside the package; the only network activity is
> the browser navigating to the login page the user selected.

## Data handling certifications (check these)

- Does **not** sell user data.
- Does **not** use/transfer data for purposes unrelated to the single purpose.
- Does **not** use/transfer data to determine creditworthiness or for lending.
