// The native-messaging host is what lets the extension detect that the CLI is
// installed (which gates the in-popup built-in authenticator). These tests cover
// both halves: the host answers a framed ping, and `sffav install-host` writes a
// valid host manifest the browser can load.

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = path.resolve(__dirname, "..", "cli", "native-host.cjs");
const CLI = path.resolve(__dirname, "..", "cli", "sffav.cjs");
const HOST_NAME = "com.salesforcefav.host";

// Chrome native-messaging framing: 4-byte little-endian length prefix + JSON.
function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function pingHost(message) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [HOST]);
    let out = Buffer.alloc(0);
    proc.stdout.on("data", (d) => {
      out = Buffer.concat([out, d]);
      if (out.length >= 4) {
        const len = out.readUInt32LE(0);
        if (out.length >= 4 + len) {
          resolve(JSON.parse(out.subarray(4, 4 + len).toString("utf8")));
          proc.stdin.end();
        }
      }
    });
    proc.on("error", reject);
    proc.stdin.write(frame(message));
  });
}

describe("native-messaging host", () => {
  test("answers a framed ping with { ok: true } and the app version", async () => {
    const reply = await pingHost({ type: "ping" });
    expect(reply.ok).toBe(true);
    expect(reply.host).toBe(HOST_NAME);
    expect(reply.app).toBe("SalesForceFav");
    expect(reply.echo).toBe("ping");
  });
});

describe("sffav install-host", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sffav-nm-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(args) {
    return execFileSync("node", [CLI, ...args], {
      env: { ...process.env, SFFAV_NM_DIR: dir },
      encoding: "utf8",
    });
  }

  test("writes a valid host manifest pointing at an existing host script", () => {
    run(["install-host", "abcdefghijklmnopabcdefghijklmnop"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, `${HOST_NAME}.json`), "utf8"));
    expect(manifest.name).toBe(HOST_NAME);
    expect(manifest.type).toBe("stdio");
    expect(fs.existsSync(manifest.path)).toBe(true);
    // Always includes the published Chrome id, plus the dev id we passed.
    expect(manifest.allowed_origins).toContain(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    );
    expect(manifest.allowed_origins.some((o) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(o))).toBe(
      true
    );
  });

  test("uninstall-host removes the manifest", () => {
    run(["install-host"]);
    expect(fs.existsSync(path.join(dir, `${HOST_NAME}.json`))).toBe(true);
    run(["uninstall-host"]);
    expect(fs.existsSync(path.join(dir, `${HOST_NAME}.json`))).toBe(false);
  });
});
