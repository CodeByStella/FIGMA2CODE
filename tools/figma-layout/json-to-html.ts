/**
 * Generate HTML from Figma REST JSON (self-contained under tools/figma-layout).
 *
 * Usage (from this directory):
 *   pnpm html
 *   pnpm html -- data/figma_raw.json data/out.html
 *   pnpm html -- --no-infer data/figma_raw.json data/out.html
 *   pnpm html -- --threshold=2 data/figma_raw.json data/out.html
 *
 * Or from repo root:
 *   pnpm layout:html
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { htmlFromRestJson } from "./lib/html/htmlFromRestJson";
import { DEFAULT_THRESHOLD_PX } from "./lib/layout/geometry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

function parseArgs(argv: string[]) {
  let inferLayout = true;
  let layoutThresholdPx = DEFAULT_THRESHOLD_PX;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--no-infer") {
      inferLayout = false;
      continue;
    }
    if (arg.startsWith("--threshold=")) {
      const n = Number(arg.slice("--threshold=".length));
      if (Number.isFinite(n) && n >= 0) layoutThresholdPx = n;
      continue;
    }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }

  return {
    inferLayout,
    layoutThresholdPx,
    inputPath: path.resolve(
      positional[0] || path.join(DATA_DIR, "figma_raw.json"),
    ),
    outputPath: path.resolve(
      positional[1] || path.join(DATA_DIR, "from-figma.html"),
    ),
  };
}

const { inferLayout, layoutThresholdPx, inputPath, outputPath } = parseArgs(
  process.argv.slice(2),
);

function unwrapRoot(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.document && typeof obj.document === "object") return obj.document;
  if (obj.nodes && typeof obj.nodes === "object") {
    const first = Object.values(obj.nodes as Record<string, any>)[0];
    if (first?.document) return first.document;
  }
  return raw;
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const root = unwrapRoot(raw);
  const name =
    root && typeof root === "object" && "name" in (root as any)
      ? String((root as any).name)
      : "Figma export";

  console.log(`Converting ${inputPath} …`);
  console.log(`inferLayout=${inferLayout} thresholdPx=${layoutThresholdPx}`);
  const started = Date.now();
  const result = await htmlFromRestJson(root, {
    title: name,
    fullDocument: true,
    htmlGenerationMode: "html",
    inferLayout,
    layoutThresholdPx,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.document ?? result.html, "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(`Elapsed: ${Date.now() - started}ms`);
  if (result.css) {
    console.log(`CSS rules collected: ${result.css.length} chars`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
