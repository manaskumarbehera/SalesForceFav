const { encryptVault, decryptVault } = require("../cli/vault.cjs");

const SAMPLE = {
  credentials: [
    { credentialName: "Prod", environment: "production", username: "u", password: "s3cret" },
  ],
};

describe("encrypted vault", () => {
  test("round-trips the data with the right passphrase", () => {
    const sealed = encryptVault(SAMPLE, "correct horse");
    expect(decryptVault(sealed, "correct horse")).toEqual(SAMPLE);
  });

  test("never stores plaintext", () => {
    const sealed = encryptVault(SAMPLE, "pw");
    const blob = JSON.stringify(sealed);
    expect(blob).not.toContain("s3cret");
    expect(blob).not.toContain("Prod");
    expect(sealed.vault).toBe(1);
    expect(sealed.kdf).toBe("PBKDF2-SHA256");
  });

  test("uses a fresh salt + IV each time (ciphertext differs)", () => {
    const a = encryptVault(SAMPLE, "pw");
    const b = encryptVault(SAMPLE, "pw");
    expect(a.cipher).not.toBe(b.cipher);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  test("wrong passphrase fails (authenticated decryption)", () => {
    const sealed = encryptVault(SAMPLE, "right");
    expect(() => decryptVault(sealed, "wrong")).toThrow(/Wrong passphrase|corrupted/i);
  });

  test("tampered ciphertext is rejected", () => {
    const sealed = encryptVault(SAMPLE, "pw");
    const bytes = Buffer.from(sealed.cipher, "base64");
    bytes[0] ^= 0xff;
    sealed.cipher = bytes.toString("base64");
    expect(() => decryptVault(sealed, "pw")).toThrow(/Wrong passphrase|corrupted/i);
  });

  test("rejects a non-vault object and empty passphrase", () => {
    expect(() => decryptVault({ nope: 1 }, "pw")).toThrow(/Not a SalesForceFav vault/i);
    expect(() => encryptVault(SAMPLE, "")).toThrow(/passphrase/i);
  });
});
