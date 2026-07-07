# Changelog

All notable changes to SalesForceFav are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) (loosely — it's a browser extension) and the
[Keep a Changelog](https://keepachangelog.com/) format. Releases before 1.10.0 predate this
file; see the git history and tags for those.

## [1.11.0] — 2026-07-07

Reliability, login speed, and UI polish.

### Fixed

- **Login autofill now survives the login page's redirect chain.** A My Domain / POD
  redirect firing mid-injection threw `Frame with ID 0 was removed`, which aborted the
  whole login and left username/password unfilled. The fill now tolerates the frame
  teardown and retries across navigations.
- **Native-messaging host launches under Chrome's minimal PATH (macOS/Linux).** A
  browser started from the Dock couldn't find Homebrew/nvm `node`, so the CLI-gated 2FA
  authenticator never appeared. `sffav install-host` now writes an absolute-node launcher.

### Changed

- **Faster login** — the fill fires as soon as the login URL commits, instead of waiting
  for the whole page to finish loading.
- **New icon** — a shield with a lightning bolt (secure, fast login).
- **UX** — the toolbar's primary action is now a labeled "Add org" button, and the empty
  state has an "Add org" call-to-action.

### Added

- `npm run secrets:sync` — pushes store-release credentials from `.env` into GitHub
  Actions secrets for the release workflow.

## [1.10.0] — 2026-07-06

Turns the extension into a complete, CLI-backed 2FA authenticator, plus copy and unlock
quality-of-life changes.

### ⚠️ Breaking / action required for existing users

- **The in-popup 2FA / built-in authenticator now requires the `sffav` CLI.** A browser
  extension can't see a globally-installed binary, so the CLI registers a native-messaging
  host that the popup pings to confirm it's present. Without it, the 2FA UI (form key field,
  live code chip, "Set up 2FA") is replaced by an "install the CLI" hint. To keep 2FA:
  ```bash
  npm i -g .                              # install the CLI
  sffav install-host                      # published build
  sffav install-host <your-extension-id>  # …or an unpacked/dev id (from chrome://extensions)
  ```
  `sffav uninstall-host` removes it. (Already-saved keys can still be **removed** without the CLI.)
- **New `nativeMessaging` permission.** This changes the install prompt ("communicate with
  cooperating native applications") and requires re-review on the Chrome Web Store and Edge
  Add-ons before the next publish.

### Added

- **In-popup authenticator** — the Add/Edit form gains a 2FA key field: paste an existing
  Base32 secret or **Generate** a 160-bit one, with an inline **QR + otpauth "setup link"**
  to register with Salesforce and a **live rolling-code preview**.
- **Auto-submit on the login challenge** — the TOTP code is now submitted (not just filled),
  guarded so a code with under 5s left rolls to a fresh window before submitting.
- **Hover-to-copy** — username/password copy icons fade in on each org card (non-SSO),
  keyboard-accessible via `:focus-within`.
- **Stay unlocked for the browser session** — once unlocked, the popup no longer re-prompts
  on every open until the browser is fully closed (`chrome.storage.session`, memory-only).
- **CLI** — `sffav install-host` / `uninstall-host` (native-host registration); `sffav`
  remains a real RFC-6238 authenticator (`totp --new/--set/--uri/--raw`), now proven by
  `tests/cli.test.js` (codes match the library; key stored encrypted).
- **Custom "My Domain" environment** — logins to `https://acme.my.salesforce.com` for orgs
  that block the generic `login.salesforce.com` host.
- **Stale-org audit** — the security check flags orgs unused for 90+ days (informational).
- **Org-color tinting that follows the tab** — a top stripe + Lightning header accent,
  re-applied across post-login redirects.
- **Login Discovery support** — fills the separate password step when My Domain shows the
  username and password on different pages.

### Changed

- **OS-aware biometric label** — the unlock affordance now shows only **"Touch ID"** on
  Apple or **"Windows Hello"** on Windows (never both; a generic label elsewhere), and only
  when the platform actually has a usable authenticator
  (`isUserVerifyingPlatformAuthenticatorAvailable`). It's presented as an alternative to the
  master passphrase, never a replacement.

### Security

- 2FA keys live in the AES-256-GCM vault; a test asserts the CLI never writes the secret to
  the vault file in plaintext.

### Notes

- **Auto-submit carries an account-lockout risk** on a wrong or clock-skewed code — the >5s
  guard only covers window-boundary expiry, not a bad secret or server clock skew.

[1.10.0]: https://github.com/manaskumarbehera/SalesForceFav/releases/tag/v1.10.0
