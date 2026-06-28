// Stage the runtime sources into dist/. The extension ships as plain scripts
// with no npm imports, so there is no bundler step — files are copied verbatim,
// with manifest.json landing at the dist root (the ZIP root for both stores).
import { cp, mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");

// Flat runtime files copied verbatim into dist/.
const requiredFiles = ["manifest.json"];

// Directories copied recursively into dist/.
const requiredDirs = ["popup"];

for (const entry of [...requiredFiles, ...requiredDirs]) {
  try {
    await access(path.join(root, entry));
  } catch {
    throw new Error(`Missing required path: ${entry}`);
  }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of requiredFiles) {
  await cp(path.join(root, file), path.join(distDir, file));
}

for (const dir of requiredDirs) {
  await cp(path.join(root, dir), path.join(distDir, dir), { recursive: true });
}

console.log("Build complete: dist/");
