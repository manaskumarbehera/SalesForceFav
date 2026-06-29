/**
 * @jest-environment node
 */
// Runs in the Node environment (not jsdom) so globalThis.crypto.subtle (WebCrypto)
// is available — the same API the browser popup uses.
const SFVault = require("../popup/cryptovault.js");

const DATA = {
  credentials: [
    {
      credentialName: "Prod",
      environment: "production",
      username: "u",
      password: "s3cret",
      totp: "JBSWY3DPEHPK3PXP",
    },
  ],
};

describe("extension WebCrypto vault", () => {
  test("round-trips with the right passphrase", async () => {
    const sealed = await SFVault.encrypt(DATA, "correct horse");
    expect(await SFVault.decrypt(sealed, "correct horse")).toEqual(DATA);
  });

  test("stores no plaintext (password/secret/name absent from the blob)", async () => {
    const sealed = await SFVault.encrypt(DATA, "pw");
    const blob = JSON.stringify(sealed);
    expect(blob).not.toContain("s3cret");
    expect(blob).not.toContain("Prod");
    expect(blob).not.toContain("JBSWY3DPEHPK3PXP");
    expect(sealed.vault).toBe(1);
    expect(sealed.kdf).toBe("PBKDF2-SHA256");
  });

  test("fresh salt + IV each time", async () => {
    const a = await SFVault.encrypt(DATA, "pw");
    const b = await SFVault.encrypt(DATA, "pw");
    expect(a.cipher).not.toBe(b.cipher);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  test("wrong passphrase is rejected (authenticated)", async () => {
    const sealed = await SFVault.encrypt(DATA, "right");
    await expect(SFVault.decrypt(sealed, "wrong")).rejects.toThrow(/Wrong passphrase|corrupted/i);
  });

  test("tampered ciphertext is rejected", async () => {
    const sealed = await SFVault.encrypt(DATA, "pw");
    const bytes = Uint8Array.from(atob(sealed.cipher), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    sealed.cipher = btoa(String.fromCharCode(...bytes));
    await expect(SFVault.decrypt(sealed, "pw")).rejects.toThrow(/Wrong passphrase|corrupted/i);
  });

  test("rejects a non-vault object and empty passphrase", async () => {
    await expect(SFVault.decrypt({ nope: 1 }, "pw")).rejects.toThrow(/Not a SalesForceFav vault/i);
    await expect(SFVault.encrypt(DATA, "")).rejects.toThrow(/passphrase/i);
  });

  // The PRF wrap/unwrap (biometric) logic — the WebAuthn calls themselves are
  // verified on a real device, but the key-wrapping is testable with fixed bytes.
  describe("biometric PRF wrap/unwrap", () => {
    const prf = new Uint8Array(32).fill(7); // stand-in for the authenticator's PRF output
    test("unwraps with the same PRF bytes", async () => {
      const wrapped = await SFVault.wrapSecret("master-passphrase", prf);
      expect(await SFVault.unwrapSecret(wrapped, prf)).toBe("master-passphrase");
    });
    test("wrapped passphrase is not stored in the clear", async () => {
      const wrapped = await SFVault.wrapSecret("master-passphrase", prf);
      expect(JSON.stringify(wrapped)).not.toContain("master-passphrase");
    });
    test("different PRF bytes fail to unwrap", async () => {
      const wrapped = await SFVault.wrapSecret("master-passphrase", prf);
      const other = new Uint8Array(32).fill(8);
      await expect(SFVault.unwrapSecret(wrapped, other)).rejects.toThrow(/did not match/i);
    });
    test("requires 32 bytes of PRF output", async () => {
      await expect(SFVault.wrapSecret("x", new Uint8Array(16))).rejects.toThrow(/32 bytes/i);
    });
  });
});
