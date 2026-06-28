const SFFav = require("../popup/credentials.js");

const {
  resolveSalesforceUrl,
  normalizeName,
  findDuplicateIndex,
  isValidHttpUrl,
  validateCredential,
  upsertCredential,
  removeCredential,
  hexToRgb,
} = SFFav;

describe("resolveSalesforceUrl", () => {
  test("maps sandbox and production to fixed hosts", () => {
    expect(resolveSalesforceUrl({ environment: "sandbox" })).toBe("https://test.salesforce.com/");
    expect(resolveSalesforceUrl({ environment: "production" })).toBe(
      "https://login.salesforce.com/"
    );
  });

  test("uses the supplied URL for SSO", () => {
    expect(resolveSalesforceUrl({ environment: "sso", ssourl: "https://my.okta.com" })).toBe(
      "https://my.okta.com"
    );
  });

  test("returns null for SSO without a URL and for unknown environments", () => {
    expect(resolveSalesforceUrl({ environment: "sso" })).toBeNull();
    expect(resolveSalesforceUrl({ environment: "nope" })).toBeNull();
    expect(resolveSalesforceUrl(null)).toBeNull();
  });
});

describe("normalizeName", () => {
  test("trims and lowercases", () => {
    expect(normalizeName("  My Org ")).toBe("my org");
  });

  test("handles null/undefined", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("findDuplicateIndex", () => {
  const creds = [{ credentialName: "Prod" }, { credentialName: "Sandbox" }];

  test("finds a case-insensitive duplicate", () => {
    expect(findDuplicateIndex(creds, "prod")).toBe(0);
    expect(findDuplicateIndex(creds, "SANDBOX")).toBe(1);
  });

  test("returns -1 for a unique name", () => {
    expect(findDuplicateIndex(creds, "Dev")).toBe(-1);
  });

  test("ignores the credential being edited", () => {
    expect(findDuplicateIndex(creds, "Prod", 0)).toBe(-1);
  });

  test("empty name is never a duplicate", () => {
    expect(findDuplicateIndex(creds, "   ")).toBe(-1);
  });
});

describe("isValidHttpUrl", () => {
  test("accepts http/https", () => {
    expect(isValidHttpUrl("https://example.com")).toBe(true);
    expect(isValidHttpUrl("http://example.com")).toBe(true);
  });

  test("rejects junk and non-http protocols", () => {
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
  });
});

describe("validateCredential", () => {
  const existing = [{ credentialName: "Prod", environment: "production" }];

  test("valid standard credential passes", () => {
    const { valid, errors } = validateCredential(
      {
        credentialName: "Dev",
        environment: "sandbox",
        username: "a@b.com",
        password: "secret",
      },
      existing,
      null
    );
    expect(valid).toBe(true);
    expect(errors).toEqual({});
  });

  test("requires name, environment, username, password", () => {
    const { valid, errors } = validateCredential({}, existing, null);
    expect(valid).toBe(false);
    expect(errors.credentialName).toBeDefined();
    expect(errors.environment).toBeDefined();
  });

  test("flags duplicate names", () => {
    const { valid, errors } = validateCredential(
      { credentialName: "Prod", environment: "sandbox", username: "u", password: "p" },
      existing,
      null
    );
    expect(valid).toBe(false);
    expect(errors.credentialName).toMatch(/already exists/i);
  });

  test("editing keeps its own name", () => {
    const { valid } = validateCredential(
      { credentialName: "Prod", environment: "production", username: "u", password: "p" },
      existing,
      0
    );
    expect(valid).toBe(true);
  });

  test("SSO requires a valid URL and skips username/password", () => {
    const bad = validateCredential(
      { credentialName: "X", environment: "sso", ssourl: "nope" },
      [],
      null
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors.ssourl).toBeDefined();

    const good = validateCredential(
      { credentialName: "X", environment: "sso", ssourl: "https://sso.example.com" },
      [],
      null
    );
    expect(good.valid).toBe(true);
  });
});

describe("upsertCredential", () => {
  test("appends without mutating the input", () => {
    const original = [{ credentialName: "A" }];
    const next = upsertCredential(original, { credentialName: "B" }, null);
    expect(next).toHaveLength(2);
    expect(original).toHaveLength(1);
  });

  test("updates at the edit index", () => {
    const original = [{ credentialName: "A" }, { credentialName: "B" }];
    const next = upsertCredential(original, { credentialName: "B2" }, 1);
    expect(next[1].credentialName).toBe("B2");
    expect(original[1].credentialName).toBe("B");
  });
});

describe("removeCredential", () => {
  test("removes at index without mutating the input", () => {
    const original = [{ credentialName: "A" }, { credentialName: "B" }];
    const next = removeCredential(original, 0);
    expect(next).toEqual([{ credentialName: "B" }]);
    expect(original).toHaveLength(2);
  });

  test("out-of-range index is a no-op", () => {
    const original = [{ credentialName: "A" }];
    expect(removeCredential(original, 5)).toEqual(original);
  });
});

describe("hexToRgb", () => {
  test("parses a valid hex color", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("00ff00")).toEqual([0, 255, 0]);
  });

  test("falls back to black for malformed input", () => {
    expect(hexToRgb("xyz")).toEqual([0, 0, 0]);
    expect(hexToRgb(null)).toEqual([0, 0, 0]);
  });
});
