// Integration test: the sffav CLI is a REAL RFC-6238 authenticator, not a stub.
//
// It drives the actual CLI binary (child process) against a throwaway encrypted
// vault and asserts the code it prints matches what the unit-tested library
// (popup/credentials.js) computes for the same secret and time. This is the
// "it should be real 2FA" proof: same algorithm, end to end, through the vault.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const SFFav = require("../popup/credentials.js");

const CLI = path.resolve(__dirname, "..", "cli", "sffav.cjs");
const PASS = "test-pass-123";
const SECRET = "JBSWY3DPEHPK3PXP"; // valid Base32 authenticator key

// Run the CLI with the passphrase supplied via env (no interactive prompt) and
// an explicit throwaway vault path.
function run(args, vault) {
  return execFileSync("node", [CLI, ...args, "--vault", vault], {
    env: { ...process.env, SFFAV_PASSPHRASE: PASS },
    encoding: "utf8",
  });
}

describe("sffav CLI — real TOTP authenticator", () => {
  let dir;
  let vault;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sffav-cli-"));
    vault = path.join(dir, "vault.json");
    run(["init"], vault);
    run(
      ["add", "--name", "Prod", "--env", "production", "--username", "u@x.com", "--password", "p"],
      vault
    );
    run(["totp", "Prod", "--set", SECRET], vault);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("--raw prints a 6-digit code that matches the library algorithm", () => {
    const raw = run(["totp", "Prod", "--raw"], vault).trim();
    expect(raw).toMatch(/^\d{6}$/);
    // Accept the adjacent windows too, so a 30s boundary crossing mid-exec
    // (library computed, then the CLI process runs) can't flake the test.
    const now = Date.now() / 1000;
    const acceptable = new Set([
      SFFav.totp(SECRET, now - 1),
      SFFav.totp(SECRET, now),
      SFFav.totp(SECRET, now + 1),
    ]);
    expect(acceptable.has(raw)).toBe(true);
  });

  test("--uri emits a scannable otpauth URI carrying the stored secret", () => {
    const uri = run(["totp", "Prod", "--uri"], vault).trim();
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${SECRET}`);
    expect(uri).toContain("period=30");
  });

  test("the key is stored ENCRYPTED — the secret never appears in the vault file", () => {
    const onDisk = fs.readFileSync(vault, "utf8");
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).not.toContain("u@x.com");
  });
});
