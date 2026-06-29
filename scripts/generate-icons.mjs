// Generates the extension icons (PNG, RGBA) with no external dependencies.
//
// Each icon is a rounded-square with a diagonal blue→indigo gradient and a white
// "Lightning" bolt. Rendering is supersampled 4× and box-averaged down, which
// gives smooth (anti-aliased) edges. PNG is encoded by hand via Node's zlib.
//
//   node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, "..", "icons");
mkdirSync(iconsDir, { recursive: true });

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersample factor

// Gradient stops (diagonal top-left → bottom-right). Restrained indigo duotone.
const STOPS = [
  [0.0, [91, 123, 214]], // #5B7BD6
  [1.0, [47, 74, 168]], // #2F4AA8
];

// Lightning-bolt polygon, normalized to the 0..1 icon box.
const BOLT = [
  [0.605, 0.085],
  [0.305, 0.545],
  [0.475, 0.545],
  [0.395, 0.915],
  [0.715, 0.435],
  [0.535, 0.435],
];

function gradientAt(t) {
  for (let i = 1; i < STOPS.length; i += 1) {
    const [p0, c0] = STOPS[i - 1];
    const [p1, c1] = STOPS[i];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function inRoundedRect(x, y, size, radius) {
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  // Inside the straight zones dx or dy is 0; corners use the circle test.
  if (x >= r && x <= size - r) return y >= 0 && y <= size;
  if (y >= r && y <= size - r) return x >= 0 && x <= size;
  return dx * dx + dy * dy <= r * r;
}

function inPolygon(x, y, poly, size) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0] * size;
    const yi = poly[i][1] * size;
    const xj = poly[j][0] * size;
    const yj = poly[j][1] * size;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Render one icon at native `size`, supersampled, returning an RGBA Buffer.
function renderRGBA(size) {
  const big = size * SS;
  const radius = big * 0.225;
  const sup = new Uint8ClampedArray(big * big * 4);

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const o = (y * big + x) * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5, big, radius)) continue; // transparent

      let [r, g, b] = gradientAt((x + y) / (2 * (big - 1)));

      // Subtle top highlight.
      const hi = Math.max(0, 0.12 * (1 - (y / big) * 2));
      r = Math.round(r + (255 - r) * hi);
      g = Math.round(g + (255 - g) * hi);
      b = Math.round(b + (255 - b) * hi);

      if (inPolygon(x + 0.5, y + 0.5, BOLT, big)) {
        r = g = b = 255;
      }
      sup[o] = r;
      sup[o + 1] = g;
      sup[o + 2] = b;
      sup[o + 3] = 255;
    }
  }

  // Box-average SS×SS blocks down to the target size (anti-aliasing).
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const o = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          r += sup[o];
          g += sup[o + 1];
          b += sup[o + 2];
          a += sup[o + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// --- minimal PNG encoder (RGBA, 8-bit) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0

  // Filter byte 0 per scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const png = encodePNG(renderRGBA(size), size);
  const file = path.join(iconsDir, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`✔ icons/icon-${size}.png (${png.length} bytes)`);
}
