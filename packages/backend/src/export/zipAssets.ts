/**
 * Asset export for ZIP + conversion (ported accuracy rules from figma-code plugin).
 */
import { ZipExportPayload } from "types";
import {
  CachedAsset,
  bytesToDataUrl,
  clearAssetCache,
  setAssetCache,
  uint8ToBase64,
} from "./assetCache";
import { postBackendMessage } from "../messaging";

const VECTOR_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  "REGULAR_POLYGON",
]);

type ExportFormat = "SVG" | "PNG";
type Target = { node: SceneNode; format: ExportFormat };

function safeId(id: string): string {
  return String(id || "")
    .replace(/:/g, "-")
    .replace(/[;/]/g, "_");
}

function safeSlug(name: string): string {
  const s = String(name || "asset")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || "asset";
}

function sanitizeFolder(name: string): string {
  return String(name || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function nodeBox(node: SceneNode): { width: number; height: number } | null {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { width: b.width, height: b.height };
}

function hasImageFill(node: SceneNode): boolean {
  try {
    if (!("fills" in node)) return false;
    const fills = (node as GeometryMixin).fills;
    if (!fills || fills === figma.mixed || !Array.isArray(fills)) return false;
    return fills.some(
      (p) =>
        p &&
        p.visible !== false &&
        (p.type === "IMAGE" || !!(p as ImagePaint).imageHash),
    );
  } catch {
    return false;
  }
}

function hasArrowStrokeCap(node: SceneNode): boolean {
  try {
    if (!("strokeCap" in node)) return false;
    const cap = (node as VectorNode).strokeCap;
    if (cap === figma.mixed) return true;
    const s = String(cap || "");
    return (
      s.startsWith("ARROW_") || s.includes("TRIANGLE") || s.includes("DIAMOND")
    );
  } catch {
    return false;
  }
}

function hasVisiblePaint(node: SceneNode): boolean {
  try {
    if ("fills" in node) {
      const fills = (node as GeometryMixin).fills;
      if (Array.isArray(fills) && fills.some((p) => p && p.visible !== false))
        return true;
    }
    if ("strokes" in node) {
      const strokes = (node as GeometryMixin).strokes;
      if (
        Array.isArray(strokes) &&
        strokes.some((p) => p && p.visible !== false)
      )
        return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function shouldExportShapeAsSvg(node: SceneNode): boolean {
  if (node.type !== "RECTANGLE" && node.type !== "ELLIPSE") return false;
  if (hasImageFill(node)) return false;
  return hasVisiblePaint(node);
}

function shouldExportTextAsSvg(node: TextNode): boolean {
  try {
    const fills = node.fills;
    if (!Array.isArray(fills)) return false;
    for (const p of fills) {
      if (!p || p.visible === false) continue;
      if (
        p.type === "GRADIENT_LINEAR" ||
        p.type === "GRADIENT_RADIAL" ||
        p.type === "GRADIENT_ANGULAR" ||
        p.type === "GRADIENT_DIAMOND"
      ) {
        const stops = p.gradientStops || [];
        if (stops.length >= 2) {
          const parent = node.parent;
          if (
            parent &&
            (parent.type === "GROUP" ||
              parent.type === "FRAME" ||
              parent.type === "COMPONENT" ||
              parent.type === "INSTANCE")
          ) {
            return true;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function countVectorDescendants(node: SceneNode): {
  vector: number;
  total: number;
  hasText: boolean;
  hasMask: boolean;
} {
  let vector = 0;
  let total = 0;
  let hasText = false;
  let hasMask = false;
  const walk = (n: SceneNode) => {
    if (n.visible === false) return;
    total += 1;
    if (n.type === "TEXT") hasText = true;
    if ("isMask" in n && (n as BlendMixin & { isMask?: boolean }).isMask)
      hasMask = true;
    if (VECTOR_TYPES.has(n.type)) vector += 1;
    if ("children" in n) {
      for (const c of n.children) walk(c);
    }
  };
  walk(node);
  return { vector, total, hasText, hasMask };
}

function shouldExportAsRaster(node: SceneNode): boolean {
  if (!("children" in node)) {
    return hasImageFill(node) && !("children" in node);
  }
  if (
    hasImageFill(node) &&
    (!("children" in node) || node.children.length === 0)
  ) {
    return true;
  }
  const { vector, total, hasText, hasMask } = countVectorDescendants(node);
  if (hasText || hasMask) return false;
  return vector >= 6 && total > 0 && vector / total >= 0.65;
}

function isIconLikeComponent(node: SceneNode): boolean {
  if (node.type !== "INSTANCE" && node.type !== "COMPONENT") return false;
  const box = nodeBox(node);
  if (!box) return false;
  const { width: w, height: h } = box;
  if (w < 8 || h < 8 || w > 96 || h > 96) {
    // still allow if mostly vectors and no text
  } else {
    /* ok size */
  }
  const name = (node.name || "").toLowerCase();
  if (
    /button|menu|nav|card|modal|dialog|input|field|checkbox|radio|toggle|switch|tab/.test(
      name,
    )
  ) {
    return false;
  }
  try {
    if (
      node.type === "INSTANCE" &&
      node.componentProperties &&
      Object.keys(node.componentProperties).length > 0
    ) {
      // variants often not pure icons — still allow small shells
      if (Math.max(w, h) > 96) return false;
    }
  } catch {
    /* ignore */
  }
  const { vector, hasText } = countVectorDescendants(node);
  if (hasText) return false;
  return vector >= 1 || (w >= 8 && h >= 8 && w <= 96 && h <= 96);
}

function collectImageFillTargets(node: SceneNode, list: Target[]): void {
  if (node.visible === false) return;
  if (hasImageFill(node)) {
    const box = nodeBox(node);
    if (box && Math.max(box.width, box.height) >= 1) {
      list.push({ node, format: "PNG" });
    }
  }
  if ("children" in node) {
    for (const c of node.children) collectImageFillTargets(c, list);
  }
}

function collectExportTargets(
  node: SceneNode,
  list: Target[],
  opts: { insideInstance?: boolean } = {},
): void {
  if (!node || node.visible === false) return;
  const insideInstance =
    !!opts.insideInstance ||
    node.type === "INSTANCE" ||
    node.type === "COMPONENT";
  const box = nodeBox(node);
  const w = box ? box.width : 0;
  const h = box ? box.height : 0;

  if (node.type === "TEXT") {
    if (shouldExportTextAsSvg(node) && w >= 1 && h >= 1) {
      list.push({ node, format: "SVG" });
    }
    return;
  }

  if (hasImageFill(node)) {
    if (Math.max(w, h) >= 1) list.push({ node, format: "PNG" });
    if (shouldExportAsRaster(node)) return;
    if ("children" in node) {
      for (const c of node.children) {
        collectExportTargets(c, list, { insideInstance });
      }
    }
    return;
  }

  if (isIconLikeComponent(node)) {
    if (w >= 1 && h >= 1) list.push({ node, format: "SVG" });
    return;
  }

  if (VECTOR_TYPES.has(node.type)) {
    const hairline =
      node.type === "LINE" || hasArrowStrokeCap(node) || w < 1 || h < 1;
    if (hairline) {
      if (Math.max(w, h) >= 1) list.push({ node, format: "SVG" });
      return;
    }
    const minSide = insideInstance ? 1 : 6;
    const minArea = insideInstance ? 1 : 36;
    if (w >= minSide && h >= minSide && w * h >= minArea) {
      list.push({ node, format: "SVG" });
    } else if (
      "isMask" in node &&
      (node as BlendMixin & { isMask?: boolean }).isMask &&
      Math.max(w, h) >= 1
    ) {
      list.push({ node, format: "SVG" });
    }
    return;
  }

  if (shouldExportShapeAsSvg(node)) {
    if (w >= 1 && h >= 1) list.push({ node, format: "SVG" });
    return;
  }

  if (shouldExportAsRaster(node)) {
    if (w >= 6 && h >= 6) list.push({ node, format: "PNG" });
    if ("children" in node) collectImageFillTargets(node, list);
    return;
  }

  if ("children" in node) {
    for (const c of node.children) {
      collectExportTargets(c, list, { insideInstance });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ExportResult = { bytes: Uint8Array; format: string; ext?: string };

async function trySettings(
  target: SceneNode,
  settingsList: ExportSettings[],
): Promise<ExportResult> {
  let lastErr: unknown = null;
  for (const settings of settingsList) {
    try {
      const bytes = await target.exportAsync(settings as any);
      return { bytes, format: settings.format };
    } catch (err) {
      lastErr = err;
    }
  }
  await sleep(80);
  try {
    const last = settingsList[settingsList.length - 1];
    const bytes = await target.exportAsync(last as any);
    return { bytes, format: last.format };
  } catch (err) {
    lastErr = err;
  }
  throw lastErr || new Error("exportAsync failed");
}

async function withUnclippedAncestors<T>(
  node: SceneNode,
  fn: () => Promise<T>,
): Promise<T> {
  const restored: { n: FrameNode; clips: boolean }[] = [];
  let p: BaseNode | null = node.parent;
  while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
    if ("clipsContent" in p) {
      const frame = p as FrameNode;
      if (frame.clipsContent) {
        restored.push({ n: frame, clips: true });
        frame.clipsContent = false;
      }
    }
    p = p.parent;
  }
  try {
    return await fn();
  } finally {
    for (const { n, clips } of restored) n.clipsContent = clips;
  }
}

async function withHiddenChildren<T>(
  node: SceneNode,
  fn: () => Promise<T>,
): Promise<T> {
  if (!("children" in node) || node.children.length === 0) return fn();
  const vis = new Map<SceneNode, boolean>();
  for (const c of node.children) {
    vis.set(c, c.visible);
    c.visible = false;
  }
  try {
    return await fn();
  } finally {
    for (const [c, v] of vis) c.visible = v;
  }
}

async function exportImageNodePng(node: SceneNode): Promise<ExportResult> {
  const pngAttempts: ExportSettingsImage[] = [
    { format: "PNG", constraint: { type: "SCALE", value: 2 } },
    { format: "PNG", constraint: { type: "SCALE", value: 1 } },
  ];

  // Prefer node-rendered PNG (scaleMode + effects). Clear rotation for framed size.
  const originalRotation =
    "rotation" in node ? (node as LayoutMixin).rotation : 0;
  let clearedRotation = false;
  try {
    if ("rotation" in node && Math.abs((node as LayoutMixin).rotation) > 0.01) {
      (node as LayoutMixin).rotation = 0;
      clearedRotation = true;
    }
  } catch {
    /* ignore */
  }

  try {
    return await withUnclippedAncestors(node, async () => {
      if ("children" in node && node.children.length > 0) {
        return withHiddenChildren(node, () => trySettings(node, pngAttempts));
      }
      return trySettings(node, pngAttempts);
    });
  } finally {
    if (clearedRotation && "rotation" in node) {
      try {
        (node as LayoutMixin).rotation = originalRotation;
      } catch {
        /* ignore */
      }
    }
  }
}

async function exportNodeBytes(
  node: SceneNode,
  format: ExportFormat,
): Promise<ExportResult> {
  const pngAttempts: ExportSettingsImage[] = [
    { format: "PNG", constraint: { type: "SCALE", value: 2 } },
    { format: "PNG", constraint: { type: "SCALE", value: 1 } },
  ];
  const svgAttempts: ExportSettingsSVGString[] = [
    { format: "SVG", svgIdAttribute: true } as any,
    { format: "SVG" } as any,
  ];

  if (format === "PNG" && hasImageFill(node)) {
    try {
      return await exportImageNodePng(node);
    } catch {
      /* fall through */
    }
  }

  if (format === "SVG" && node.type === "TEXT") {
    return trySettings(node, svgAttempts as ExportSettings[]);
  }

  if (format === "SVG") {
    try {
      return await withUnclippedAncestors(node, () =>
        trySettings(node, svgAttempts as ExportSettings[]),
      );
    } catch {
      return withUnclippedAncestors(node, () => trySettings(node, pngAttempts));
    }
  }

  return withUnclippedAncestors(node, () => trySettings(node, pngAttempts));
}

function dedupeTargets(targets: Target[]): Target[] {
  const byId: Record<string, Target> = {};
  for (const t of targets) {
    const id = t.node.id;
    const prev = byId[id];
    if (!prev) {
      byId[id] = t;
      continue;
    }
    if (hasImageFill(t.node)) {
      if (t.format === "PNG") byId[id] = t;
      continue;
    }
    if (hasImageFill(prev.node)) {
      if (prev.format === "PNG") continue;
      if (t.format === "PNG") byId[id] = t;
      continue;
    }
    if (t.format === "SVG") byId[id] = t;
  }
  return Object.values(byId);
}

function mimeFor(format: string, path: string): string {
  if (format === "SVG" || path.endsWith(".svg")) return "image/svg+xml";
  if (format === "JPG" || path.endsWith(".jpg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function annotateDocument(
  doc: any,
  assetsMap: Record<string, string>,
  cache: Map<string, CachedAsset>,
): any {
  if (!doc || typeof doc !== "object") return doc;
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    const id = n.id;
    if (id && assetsMap[id]) {
      n.exportAsAsset = true;
      const cached = cache.get(id);
      if (cached) {
        if (cached.format === "SVG") {
          n.assetOnly = true;
          n.effectsBaked = cached.effectsBaked;
        }
        if (cached.imageAssetFramed) {
          n.imageAssetFramed = true;
          n.effectsBaked = true;
        }
      }
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  };
  walk(doc);
  return doc;
}

async function serializeRoot(root: SceneNode): Promise<any> {
  try {
    const rest = await root.exportAsync({ format: "JSON_REST_V1" } as any);
    // exportAsync JSON_REST_V1 returns { document: ... } wrapping
    const payload = rest as any;
    if (payload && payload.document) return payload.document;
    return payload;
  } catch {
    // minimal fallback
    return {
      id: root.id,
      name: root.name,
      type: root.type,
      absoluteBoundingBox: root.absoluteBoundingBox,
    };
  }
}

export type ZipExportResult = {
  zipExport: ZipExportPayload;
  assetsMap: Record<string, string>;
};

/** Export all assets for selection roots, fill cache, build ZIP payload. */
export async function exportZipAssets(
  roots: readonly SceneNode[],
): Promise<ZipExportResult> {
  clearAssetCache();
  const root = roots[0];
  if (!root) {
    return {
      zipExport: { folder: "export", files: {}, assetCount: 0, failedCount: 0 },
      assetsMap: {},
    };
  }

  postBackendMessage({
    type: "progress",
    message: `Exporting assets for “${root.name}”…`,
    percent: 5,
  });

  const document = await serializeRoot(root);
  const targets: Target[] = [];
  for (const r of roots) collectExportTargets(r, targets);
  const unique = dedupeTargets(targets);

  postBackendMessage({
    type: "progress",
    message: `Exporting ${unique.length} asset(s)…`,
    percent: 12,
  });

  const assetsMap: Record<string, string> = {};
  const assetsB64: Record<string, string> = {};
  const cache = new Map<string, CachedAsset>();
  let failed = 0;

  for (let i = 0; i < unique.length; i++) {
    let format = unique[i].format;
    const node = unique[i].node;
    try {
      if (hasImageFill(node)) format = "PNG";
      const result = await exportNodeBytes(node, format);
      format = (result.format as ExportFormat) || format;
      const ext =
        result.ext ||
        (format === "SVG" ? ".svg" : format === "JPG" ? ".jpg" : ".png");
      const rel = `assets/${safeSlug(node.name)}_${safeId(node.id)}${ext}`;
      const b64 = uint8ToBase64(result.bytes);
      assetsMap[node.id] = rel;
      assetsB64[rel] = b64;
      const mime = mimeFor(format, rel);
      const effectsBaked = format === "SVG" || hasImageFill(node);
      const imageAssetFramed = hasImageFill(node) && format === "PNG";
      let layoutWidth: number | undefined;
      let layoutHeight: number | undefined;
      let flipHorizontal: boolean | undefined;
      let flipVertical: boolean | undefined;
      let rotationDeg: number | undefined;
      try {
        if ("width" in node && "height" in node) {
          layoutWidth = (node as LayoutMixin).width;
          layoutHeight = (node as LayoutMixin).height;
        }
        if ("rotation" in node) {
          rotationDeg = (node as LayoutMixin).rotation;
        }
        if ("relativeTransform" in node) {
          const m = (node as LayoutMixin).relativeTransform;
          // det < 0 ⇒ flip
          const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
          if (det < 0) {
            flipHorizontal = m[0][0] < 0;
            flipVertical = m[1][1] < 0;
          }
        }
      } catch {
        /* ignore */
      }
      cache.set(node.id, {
        path: rel,
        mime,
        bytes: result.bytes,
        dataUrl: bytesToDataUrl(result.bytes, mime),
        format: format === "SVG" ? "SVG" : "PNG",
        effectsBaked,
        imageAssetFramed,
        layoutWidth,
        layoutHeight,
        flipHorizontal,
        flipVertical,
        rotationDeg,
      });
    } catch (err) {
      failed += 1;
      console.warn("[zipAssets] export failed", node.id, node.name, err);
    }
    if (i % 5 === 0 || i === unique.length - 1) {
      const pct = 12 + Math.round(((i + 1) / Math.max(unique.length, 1)) * 55);
      postBackendMessage({
        type: "progress",
        message: `Exported ${i + 1}/${unique.length} assets`,
        percent: Math.min(pct, 70),
      });
    }
  }

  setAssetCache(cache);
  const annotated = annotateDocument(document, assetsMap, cache);

  const files: Record<string, string> = {
    "figma_raw.json": uint8ToBase64(
      new TextEncoder().encode(JSON.stringify(annotated, null, 2) + "\n"),
    ),
    "assets_map.json": uint8ToBase64(
      new TextEncoder().encode(JSON.stringify(assetsMap, null, 2) + "\n"),
    ),
    ...assetsB64,
  };

  // Store JSON as utf-8 base64 — UI zip builder expects base64 for all files
  // Fix: figma_raw / assets_map should be base64 of utf8 bytes (already above)

  postBackendMessage({
    type: "progress",
    message: "Generating code…",
    percent: 75,
  });

  return {
    zipExport: {
      folder: sanitizeFolder(root.name) || "export",
      files,
      assetCount: Object.keys(assetsMap).length,
      failedCount: failed,
    },
    assetsMap,
  };
}
