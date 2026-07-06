# SalesForceFav Privacy Policy

**Last Updated:** July 6, 2026

Your privacy is important to us. This Privacy Policy explains how SalesForceFav ("we," "us," or "our") handles your data when you use our Chrome/Edge extension ("SalesForceFav" or "the Extension").

**In short:** the Extension stores the data you enter **only on your own device**. We (the developer) have no server, receive nothing, and have no access to your data. There is no analytics and no tracking.

## 1. Information the Extension Stores (Locally, on Your Device)

### a. Salesforce login details

To sign you in, the Extension stores the login details you explicitly enter — org name, username, password, SSO or My Domain login URL, and **optionally a two-factor (2FA/TOTP) authenticator key** — in your browser's local storage on your own device. These can be encrypted with a master passphrase you set. We do **not** collect, receive, transmit, sell, or have any access to this data. Your credentials are sent only to the Salesforce or identity-provider login page **you** choose to open, in order to sign you in.

### b. Two-factor (2FA) keys

If you add a 2FA/TOTP key, it is stored locally alongside the matching org and is used **on your device** to compute time-based one-time codes. The key is never transmitted anywhere.

### c. Favicon colors and preferences

The tab colors and preferences (such as theme) you choose are stored locally and used only to visually identify your orgs. We have no access to them.

### d. Usage data

We do **not** track or log your interactions, browsing history, or Salesforce activity. There is no analytics.

## 2. Companion CLI Detection (Native Messaging)

The Extension can detect whether the optional companion `sffav` command-line tool is installed on your computer. It does this by exchanging a fixed presence "ping" with a locally-registered native-messaging host that you install yourself (via `sffav install-host`). **No credentials, 2FA keys, secrets, or browsing data are sent to or received from this host** — only a `{"type":"ping"}` message and a version-string reply. If the tool isn't installed, the related feature is simply hidden. You can remove the registration at any time with `sffav uninstall-host`.

## 3. How We Use Your Information

Because the Extension stores everything locally and we receive nothing, there is no information for us to use or share. The Extension's function is to help you save Salesforce logins, sign in to your chosen org, and (optionally) generate 2FA codes — all handled on your device.

## 4. Data Security

- **Local storage only.** All saved data stays in your browser on your device and is never transmitted to us or any third party.
- **Optional encryption.** Credentials and 2FA keys can be encrypted at rest with a master passphrase (AES-256-GCM) that only you know; we cannot recover it.
- **No external servers.** The Extension has no backend. The only network activity is your browser navigating to the login page you selected.

## 5. Third-Party Services

SalesForceFav does not integrate with any third-party analytics or data services, and no data is shared with third parties. The only third party involved is Salesforce (or the identity provider) whose login page you choose to open.

## 6. Your Control Over Your Data

- **Manage or delete** any saved org, 2FA key, or preference at any time through the Extension's interface.
- **Back up / restore** is entirely local — export writes a file you control.
- **Uninstallation** removes all Extension data from your browser.

## 7. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Significant changes will be noted here and via the store listing. Please review this policy periodically.

## 8. Contact Us

If you have any questions or concerns about this Privacy Policy or SalesForceFav, please contact us at:

**Email:** [behera.manas98@gmail.com](mailto:behera.manas98@gmail.com)  
**Address:** Falkonervænget 5, ST TH, Frederiksberg

By using SalesForceFav, you agree to the terms outlined in this Privacy Policy.
