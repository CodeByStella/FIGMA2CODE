/**
 * Filter Figma REST/export JSON to size & position (layout) fields only.
 *
 * Usage (from repo root):
 *   node tools/figma-layout/filter-layout.js
 *   node tools/figma-layout/filter-layout.js tools/figma-layout/data/figma_raw.json tools/figma-layout/data/figma_layout.json
 *
 * Then serve the viewer:
 *   python -m http.server 8765 --directory tools/figma-layout
 *   open http://localhost:8765/layout-rects.html
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const INPUT = path.resolve(
  process.argv[2] || path.join(DATA_DIR, "figma_raw.json"),
);
const OUTPUT = path.resolve(
  process.argv[3] || path.join(DATA_DIR, "figma_layout.json"),
);

/** Keep node identity so the tree stays readable */
const IDENTITY_KEYS = new Set(["id", "type", "children"]);

/** Geometry, bounds, and auto-layout / constraint fields */
const LAYOUT_KEYS = new Set([
  // Axis-aligned box of the node in page/canvas space: { x, y, width, height }
  "absoluteBoundingBox",
  // Visible render bounds after effects/strokes (may differ from layout box)
  "absoluteRenderBounds",
  // Local or absolute X origin (when present as a top-level number)
  "x",
  // Local or absolute Y origin (when present as a top-level number)
  "y",
  // Node width in px (top-level; also appears inside bounding boxes)
  "width",
  // Node height in px (top-level; also appears inside bounding boxes)
  "height",
  // Inset/edge helpers sometimes used on nested geometry (e.g. padding-like objects)
  "left",
  "right",
  "top",
  "bottom",
  // How the node pins/scales inside its parent: { vertical, horizontal } e.g. TOP/LEFT/SCALE
  "constraints",
  // Auto Layout direction on frames: "NONE" | "HORIZONTAL" | "VERTICAL"
  "layoutMode",
  // Child alignment in parent auto-layout: e.g. "INHERIT" | "STRETCH"
  "layoutAlign",
  // Flex grow along the primary axis (0 = fixed, 1 = fill remaining space)
  "layoutGrow",
  // Horizontal sizing mode: "FIXED" | "HUG" | "FILL"
  "layoutSizingHorizontal",
  // Vertical sizing mode: "FIXED" | "HUG" | "FILL"
  "layoutSizingVertical",
  // Whether auto-layout children wrap onto multiple lines
  "layoutWrap",
  // Internal Figma layout model version for this node
  "layoutVersion",
  // Main-axis alignment of children (justify): MIN | CENTER | MAX | SPACE_BETWEEN
  "primaryAxisAlignItems",
  // Cross-axis alignment of children (align): MIN | CENTER | MAX | BASELINE
  "counterAxisAlignItems",
  // Whether the frame’s size on the main axis hugs content or is fixed
  "primaryAxisSizingMode",
  // Whether the frame’s size on the cross axis hugs content or is fixed
  "counterAxisSizingMode",
  // Gap between auto-layout children (px)
  "itemSpacing",
  // Inner padding on each side of an auto-layout frame (px)
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  // Optional size clamps (px); omit when unlimited
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  // Rotation in degrees (or radians depending on export); affects visual placement
  "rotation",
  // 2×3 affine transform vs parent: [[a,c,tx],[b,d,ty]]
  "relativeTransform",
  // Explicit size object when exported as { x, y } or { width, height }
  "size",
  // Uniform corner radius (px); kept as a size-related visual metric
  "cornerRadius",
]);

const KEEP = new Set([...IDENTITY_KEYS, ...LAYOUT_KEYS]);

function filterNode(node) {
  if (node == null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(filterNode);
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;

    if (key === "children" && Array.isArray(value)) {
      out.children = value.map(filterNode);
      continue;
    }

    // Nested geometry objects (bbox, constraints, etc.) — keep as-is
    out[key] = value;
  }

  return out;
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`Input not found: ${INPUT}`);
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const raw = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const filtered = filterNode(raw);

  fs.writeFileSync(OUTPUT, JSON.stringify(filtered, null, 2), "utf8");

  const inBytes = fs.statSync(INPUT).size;
  const outBytes = fs.statSync(OUTPUT).size;
  console.log(`Wrote ${OUTPUT}`);
  console.log(
    `Size: ${(inBytes / 1024 / 1024).toFixed(2)} MB → ${(outBytes / 1024 / 1024).toFixed(2)} MB`,
  );
}

main();
