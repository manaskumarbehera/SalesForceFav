#!/usr/bin/env node
"use strict";

// SalesForceFav native-messaging host.
//
// Its ONLY job is to exist and answer a ping, so the extension popup can prove
// the sffav CLI is installed on this machine (chrome.runtime.sendNativeMessage).
// That gates the in-popup "built-in authenticator" — see popup.js probeCli().
//
// It exposes NO vault data and needs no passphrase: presence is the whole
// signal. Registered by `sffav install-host` (see sffav.cjs), which writes the
// host manifest that points Chrome/Edge at this file.
//
// Wire format (Chrome native messaging): each message is a 4-byte little-endian
// length prefix followed by that many bytes of UTF-8 JSON, both directions.

const HOST_NAME = "com.salesforcefav.host";

let version = "unknown";
try {
  version = require("../package.json").version || version;
} catch {
  /* package.json not resolvable when run oddly — presence still answers */
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  // Drain every complete frame currently buffered.
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break; // wait for the rest of this frame
    const body = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);
    let req = {};
    try {
      req = JSON.parse(body.toString("utf8"));
    } catch {
      /* malformed — still answer so the caller learns we're here */
    }
    send({
      ok: true,
      host: HOST_NAME,
      app: "SalesForceFav",
      version,
      echo: (req && req.type) || null,
    });
  }
});

// Chrome closes stdin after a sendNativeMessage round-trip; exit cleanly then.
process.stdin.on("end", () => process.exit(0));
