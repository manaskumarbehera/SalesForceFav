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
  auditCredentials,
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  isValidTotpSecret,
  hotp,
  totp,
  totpSecondsRemaining,
  filterCredentials,
  sortCredentials,
  togglePinAt,
  markUsedAt,
  serializeExport,
  parseImport,
  mergeImport,
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

  test("uses the supplied My Domain URL for custom, null when missing", () => {
    expect(
      resolveSalesforceUrl({ environment: "custom", customurl: "https://acme.my.salesforce.com" })
    ).toBe("https://acme.my.salesforce.com");
    expect(resolveSalesforceUrl({ environment: "custom" })).toBeNull();
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

  test("custom environment requires a valid My Domain URL plus username/password", () => {
    const base = { credentialName: "Acme", environment: "custom", username: "u", password: "p" };
    expect(validateCredential({ ...base, customurl: "not a url" }, [], null).valid).toBe(false);
    expect(
      validateCredential({ ...base, customurl: "https://acme.my.salesforce.com" }, [], null).valid
    ).toBe(true);
    const missingCreds = validateCredential(
      {
        credentialName: "Acme",
        environment: "custom",
        customurl: "https://acme.my.salesforce.com",
      },
      [],
      null
    );
    expect(missingCreds.valid).toBe(false);
    expect(missingCreds.errors.username).toBeDefined();
    expect(missingCreds.errors.password).toBeDefined();
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

describe("TOTP / 2FA (RFC 4226 + RFC 6238 vectors)", () => {
  // RFC test secret: ASCII "12345678901234567890" → Base32 below.
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  test("base32Decode recovers the RFC ASCII secret", () => {
    const bytes = base32Decode(SECRET);
    expect(Buffer.from(bytes).toString("ascii")).toBe("12345678901234567890");
  });

  test("base32Decode ignores spaces and padding", () => {
    expect(Array.from(base32Decode("GEZD GNBV GY3T QOJQ ="))).toEqual(
      Array.from(base32Decode("GEZDGNBVGY3TQOJQ"))
    );
  });

  test("base32Encode is the inverse of decode (and matches the RFC secret)", () => {
    const ascii = Buffer.from("12345678901234567890", "ascii");
    expect(base32Encode(ascii)).toBe(SECRET);
    // round-trip any byte sequence
    const bytes = base32Decode(SECRET);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });

  test("buildOtpauthUri produces a valid provisioning URI a code can be derived from", () => {
    const uri = buildOtpauthUri({ account: "me@acme.com", secret: SECRET });
    expect(uri.startsWith("otpauth://totp/SalesForceFav:me%40acme.com?")).toBe(true);
    const u = new URL(uri);
    expect(u.searchParams.get("secret")).toBe(SECRET);
    expect(u.searchParams.get("issuer")).toBe("SalesForceFav");
    expect(u.searchParams.get("period")).toBe("30");
    // the secret in the URI yields the same code as the raw secret
    expect(totp(u.searchParams.get("secret"), 59)).toBe(totp(SECRET, 59));
  });

  test("HOTP matches RFC 4226 Appendix D (counters 0–9)", () => {
    const key = base32Decode(SECRET);
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expected.forEach((code, counter) => expect(hotp(key, counter, 6)).toBe(code));
  });

  test("TOTP matches RFC 6238 Appendix B (SHA-1, 8 digits)", () => {
    const cases = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [time, code] of cases) {
      expect(totp(SECRET, time, { digits: 8 })).toBe(code);
    }
  });

  test("6-digit TOTP is the last 6 digits of the 8-digit code", () => {
    expect(totp(SECRET, 59, { digits: 6 })).toBe("287082");
  });

  test("totp returns null for an empty/invalid secret", () => {
    expect(totp("", 59)).toBeNull();
    expect(totp("   ", 59)).toBeNull();
  });

  test("totpSecondsRemaining counts down within the 30s window", () => {
    expect(totpSecondsRemaining(0)).toBe(30);
    expect(totpSecondsRemaining(1)).toBe(29);
    expect(totpSecondsRemaining(29)).toBe(1);
    expect(totpSecondsRemaining(30)).toBe(30);
  });

  test("isValidTotpSecret accepts Base32 and rejects junk", () => {
    expect(isValidTotpSecret(SECRET)).toBe(true);
    expect(isValidTotpSecret("jbsw y3dp")).toBe(true);
    expect(isValidTotpSecret("not-base32!")).toBe(false);
    expect(isValidTotpSecret("")).toBe(false);
  });
});

describe("validateCredential — TOTP", () => {
  test("optional, but rejects a malformed secret", () => {
    const base = { credentialName: "X", environment: "sandbox", username: "u", password: "p" };
    expect(validateCredential({ ...base, totp: "" }, [], null).valid).toBe(true);
    expect(validateCredential({ ...base, totp: "JBSWY3DPEHPK3PXP" }, [], null).valid).toBe(true);
    const bad = validateCredential({ ...base, totp: "abc!!!" }, [], null);
    expect(bad.valid).toBe(false);
    expect(bad.errors.totp).toBeDefined();
  });
});

describe("auditCredentials (security health)", () => {
  test("flags reused passwords and orgs without 2FA", () => {
    const { reusedGroups, noTwoFactor, issues } = auditCredentials([
      {
        credentialName: "Prod",
        environment: "production",
        password: "same",
        totp: "JBSWY3DPEHPK3PXP",
      },
      { credentialName: "QA", environment: "sandbox", password: "same" },
      { credentialName: "Dev", environment: "sandbox", password: "unique" },
    ]);
    expect(reusedGroups).toEqual([["Prod", "QA"]]);
    expect(noTwoFactor.sort()).toEqual(["Dev", "QA"]); // Prod has 2FA
    expect(issues).toBe(3); // 1 reused group + 2 no-2FA
  });

  test("excludes SSO orgs and empty passwords from both checks", () => {
    const { reusedGroups, noTwoFactor, issues } = auditCredentials([
      { credentialName: "Okta1", environment: "sso", ssourl: "https://a", password: "" },
      { credentialName: "Okta2", environment: "sso", ssourl: "https://b", password: "" },
      {
        credentialName: "Secure",
        environment: "production",
        password: "x",
        totp: "JBSWY3DPEHPK3PXP",
      },
    ]);
    expect(reusedGroups).toEqual([]); // SSO empty passwords not grouped
    expect(noTwoFactor).toEqual([]); // SSO not flagged; Secure has 2FA
    expect(issues).toBe(0);
  });

  test("clean vault reports no issues", () => {
    expect(auditCredentials([]).issues).toBe(0);
  });

  test("flags orgs unused for 90+ days as stale, without affecting issues", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 1_700_000_000_000;
    const { stale, issues } = auditCredentials(
      [
        {
          credentialName: "Fresh",
          environment: "production",
          password: "unique1",
          totp: "JBSWY3DPEHPK3PXP",
          lastUsedAt: now - 10 * DAY,
        },
        {
          credentialName: "Old",
          environment: "sandbox",
          password: "unique2",
          totp: "JBSWY3DPEHPK3PXP",
          lastUsedAt: now - 100 * DAY,
        },
        {
          credentialName: "NeverUsed",
          environment: "sandbox",
          password: "unique3",
          totp: "JBSWY3DPEHPK3PXP",
          lastUsedAt: null,
        },
      ],
      now
    );
    expect(stale).toEqual(["Old"]);
    expect(issues).toBe(0); // staleness is informational, not a security issue
  });
});

describe("filterCredentials", () => {
  const creds = [
    { credentialName: "Prod", environment: "production", username: "admin@acme.com" },
    { credentialName: "QA Sandbox", environment: "sandbox", username: "qa@acme.com" },
    { credentialName: "Okta", environment: "sso", ssourl: "https://acme.okta.com" },
  ];

  test("empty query returns all (a copy)", () => {
    const out = filterCredentials(creds, "");
    expect(out).toHaveLength(3);
    expect(out).not.toBe(creds);
  });

  test("matches name, environment, username, and SSO URL (case-insensitive)", () => {
    expect(filterCredentials(creds, "prod")).toHaveLength(1);
    expect(filterCredentials(creds, "SANDBOX")).toHaveLength(1);
    expect(filterCredentials(creds, "qa@acme")).toHaveLength(1);
    expect(filterCredentials(creds, "okta.com")).toHaveLength(1);
    expect(filterCredentials(creds, "acme")).toHaveLength(3);
  });

  test("no match returns empty", () => {
    expect(filterCredentials(creds, "zzz")).toEqual([]);
  });
});

describe("sortCredentials", () => {
  test("pinned first, then most-recent, then name; input untouched", () => {
    const input = [
      { credentialName: "Beta", lastUsedAt: 100 },
      { credentialName: "Alpha", pinned: true, lastUsedAt: 1 },
      { credentialName: "Gamma", lastUsedAt: 200 },
      { credentialName: "Delta" },
    ];
    const out = sortCredentials(input);
    expect(out.map((c) => c.credentialName)).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
    expect(input[0].credentialName).toBe("Beta"); // not mutated
  });
});

describe("togglePinAt / markUsedAt", () => {
  test("togglePinAt flips the flag immutably", () => {
    const input = [{ credentialName: "A" }];
    const out = togglePinAt(input, 0);
    expect(out[0].pinned).toBe(true);
    expect(input[0].pinned).toBeUndefined();
  });

  test("markUsedAt stamps the timestamp immutably", () => {
    const input = [{ credentialName: "A" }];
    const out = markUsedAt(input, 0, 1234);
    expect(out[0].lastUsedAt).toBe(1234);
    expect(input[0].lastUsedAt).toBeUndefined();
  });
});

describe("serializeExport / parseImport round trip", () => {
  const creds = [
    { credentialName: "Prod", environment: "production", username: "u", password: "p" },
  ];

  test("export produces a versioned envelope", () => {
    const json = serializeExport(creds, 999);
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe("SalesForceFav");
    expect(parsed.exportedAt).toBe(999);
    expect(parsed.credentials).toHaveLength(1);
  });

  test("import reads the envelope back", () => {
    const json = serializeExport(creds, 999);
    const { credentials, error } = parseImport(json);
    expect(error).toBeNull();
    expect(credentials[0].credentialName).toBe("Prod");
  });

  test("import accepts a bare array", () => {
    const { credentials, error } = parseImport(
      JSON.stringify([{ credentialName: "X", environment: "sandbox" }])
    );
    expect(error).toBeNull();
    expect(credentials).toHaveLength(1);
  });

  test("import defaults missing pinned/lastUsedAt fields", () => {
    const { credentials } = parseImport(
      JSON.stringify([{ credentialName: "X", environment: "sandbox" }])
    );
    expect(credentials[0].pinned).toBe(false);
    expect(credentials[0].lastUsedAt).toBeNull();
    expect(credentials[0].faviconColor).toBe("#3a5ccc");
  });

  test("import rejects junk and empties", () => {
    expect(parseImport("not json").error).toMatch(/valid JSON/i);
    expect(parseImport(JSON.stringify({ nope: 1 })).error).toMatch(/No credentials/i);
    expect(parseImport(JSON.stringify([{}])).error).toMatch(/No valid/i);
  });

  test("import rejects records with an unknown environment", () => {
    const { credentials, error } = parseImport(
      JSON.stringify([
        { credentialName: "Good", environment: "production" },
        { credentialName: "Bad", environment: "Prod" },
        { credentialName: "NoEnv" },
      ])
    );
    expect(error).toBeNull();
    expect(credentials.map((c) => c.credentialName)).toEqual(["Good"]);
  });
});

describe("mergeImport", () => {
  test("adds new, skips case-insensitive duplicates, reports counts", () => {
    const existing = [{ credentialName: "Prod" }];
    const imported = [{ credentialName: "prod" }, { credentialName: "Dev" }];
    const { merged, added, skipped } = mergeImport(existing, imported);
    expect(added).toBe(1);
    expect(skipped).toBe(1);
    expect(merged.map((c) => c.credentialName)).toEqual(["Prod", "Dev"]);
    expect(existing).toHaveLength(1); // not mutated
  });
});
