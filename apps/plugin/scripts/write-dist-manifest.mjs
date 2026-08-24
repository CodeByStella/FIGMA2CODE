import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(pluginDir, "../../..");
const distDir = resolve(repoRoot, "dist");

const manifest = JSON.parse(
  readFileSync(resolve(repoRoot, "manifest.json"), "utf8"),
);
manifest.main = "code.js";
manifest.ui = "index.html";

mkdirSync(distDir, { recursive: true });
writeFileSync(
  resolve(distDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
