/**
 * Main-thread asset export for ZIP downloads: decides SVG vs PNG targets,
 * calls exportAsync with accuracy rules from the legacy figma-code plugin,
 * and streams each file to the UI via zipFile messages.
 */
import { ZipFileMessage } from "types";
import { CachedAsset, clearAssetCache, setAssetCache } from "./cache";
import { postBackendMessage } from "../messaging";
import { EXPORT_TIMEOUT_MS, withTimeout } from "../convert/media/exportAsync";
import { logError, safeNodeRef } from "../shared/log";

const VECTOR_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  /** Plugin API name; REST / JSON_REST_V1 uses REGULAR_POLYGON */
  "POLYGON",
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
    return false;
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
    return false;
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
    /* oversized instances are filtered below via name / variant checks */
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
      /** Variant instances are rarely pure icons; allow only small shells */
      if (Math.max(w, h) > 96) return false;
    }
  } catch {}
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
      const bytes = await withTimeout(
        target.exportAsync(settings as any),
        EXPORT_TIMEOUT_MS,
        `${target.type}:${target.id} ${settings.format}`,
      );
      return { bytes, format: settings.format };
    } catch (err) {
      lastErr = err;
      logError(
        `exportAsync failed for ${target.type}:${target.id} ${settings.format}`,
        err,
      );
    }
  }
  await sleep(80);
  try {
    const last = settingsList[settingsList.length - 1];
    const bytes = await withTimeout(
      target.exportAsync(last as any),
      EXPORT_TIMEOUT_MS,
      `${target.type}:${target.id} ${last.format} retry`,
    );
    return { bytes, format: last.format };
  } catch (err) {
    lastErr = err;
    logError(`exportAsync retry failed for ${target.type}:${target.id}`, err);
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

function pngAttempts(): ExportSettingsImage[] {
  return [{ format: "PNG", constraint: { type: "SCALE", value: 1 } }];
}

function assetRelPath(node: SceneNode, format: ExportFormat): string {
  const ext = format === "SVG" ? ".svg" : ".png";
  return `assets/${safeSlug(node.name)}_${safeId(node.id)}${ext}`;
}

function nodeLayoutFlags(
  node: SceneNode,
): Pick<
  CachedAsset,
  | "layoutWidth"
  | "layoutHeight"
  | "flipHorizontal"
  | "flipVertical"
  | "rotationDeg"
> {
  const flags: Pick<
    CachedAsset,
    | "layoutWidth"
    | "layoutHeight"
    | "flipHorizontal"
    | "flipVertical"
    | "rotationDeg"
  > = {};
  try {
    if ("width" in node && "height" in node) {
      flags.layoutWidth = (node as LayoutMixin).width;
      flags.layoutHeight = (node as LayoutMixin).height;
    }
    if ("rotation" in node) {
      flags.rotationDeg = (node as LayoutMixin).rotation;
    }
    if ("relativeTransform" in node) {
      const m = (node as LayoutMixin).relativeTransform;
      const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
      if (det < 0) {
        flags.flipHorizontal = m[0][0] < 0;
        flags.flipVertical = m[1][1] < 0;
      }
    }
  } catch {
    return flags;
  }
  return flags;
}

function plannedFormat(node: SceneNode, format: ExportFormat): ExportFormat {
  return hasImageFill(node) ? "PNG" : format;
}

function pathOnlyAsset(
  node: SceneNode,
  format: ExportFormat,
  rel: string,
): CachedAsset {
  return {
    path: rel,
    mime: mimeFor(format, rel),
    format: format === "SVG" ? "SVG" : "PNG",
    effectsBaked: format === "SVG" || hasImageFill(node),
    imageAssetFramed: hasImageFill(node) && format === "PNG",
    ...nodeLayoutFlags(node),
  };
}

/** Plan assets/* paths and cache flags without calling exportAsync (live preview). */
export function planAssetTargets(roots: readonly SceneNode[]): void {
  clearAssetCache();
  const cache = new Map<string, CachedAsset>();
  const targets: Target[] = [];
  for (const r of roots) collectExportTargets(r, targets);
  for (const t of dedupeTargets(targets)) {
    const format = plannedFormat(t.node, t.format);
    const rel = assetRelPath(t.node, format);
    cache.set(t.node.id, pathOnlyAsset(t.node, format, rel));
  }
  setAssetCache(cache);
}

async function exportImageNodePng(node: SceneNode): Promise<ExportResult> {
  const attempts = pngAttempts();

  /** PNG from the node preserves scaleMode and effects; rotation is cleared for layout size. */
  const originalRotation =
    "rotation" in node ? (node as LayoutMixin).rotation : 0;
  let clearedRotation = false;
  try {
    if ("rotation" in node && Math.abs((node as LayoutMixin).rotation) > 0.01) {
      (node as LayoutMixin).rotation = 0;
      clearedRotation = true;
    }
  } catch {}

  try {
    return await withUnclippedAncestors(node, async () => {
      if ("children" in node && node.children.length > 0) {
        return withHiddenChildren(node, () => trySettings(node, attempts));
      }
      return trySettings(node, attempts);
    });
  } finally {
    if (clearedRotation && "rotation" in node) {
      try {
        (node as LayoutMixin).rotation = originalRotation;
      } catch {}
    }
  }
}

async function exportNodeBytes(
  node: SceneNode,
  format: ExportFormat,
): Promise<ExportResult> {
  const attempts = pngAttempts();
  const svgAttempts: ExportSettingsSVGString[] = [
    { format: "SVG", svgIdAttribute: true } as any,
    { format: "SVG" } as any,
  ];

  if (format === "PNG" && hasImageFill(node)) {
    try {
      return await exportImageNodePng(node);
    } catch (e) {
      logError(`PNG image-fill export failed (${safeNodeRef(node)})`, e);
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
    } catch (e) {
      logError(`SVG export failed (${safeNodeRef(node)})`, e);
      return withUnclippedAncestors(node, () => trySettings(node, attempts));
    }
  }

  return withUnclippedAncestors(node, () => trySettings(node, attempts));
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
    /** JSON_REST_V1 wraps the tree in { document } */
    const payload = rest as any;
    if (payload && payload.document) return payload.document;
    return payload;
  } catch (e) {
    logError("REST JSON serialize failed", e);
    /** Minimal node stub when REST export is unavailable */
    return {
      id: root.id,
      name: root.name,
      type: root.type,
      absoluteBoundingBox: root.absoluteBoundingBox,
    };
  }
}

export type ZipExportResult = {
  folder: string;
  assetCount: number;
  failedCount: number;
  assetsMap: Record<string, string>;
  rawDocument: unknown;
  formatDrift: boolean;
};

function postZipFile(path: string, bytes: Uint8Array): void {
  postBackendMessage({
    type: "zipFile",
    path,
    bytes,
  } as ZipFileMessage);
}

/** Export assets, stream each file to the UI, then retain path + flags in cache. */
export async function exportZipAssets(
  roots: readonly SceneNode[],
): Promise<ZipExportResult> {
  const root = roots[0];
  if (!root) {
    clearAssetCache();
    return {
      folder: "export",
      assetCount: 0,
      failedCount: 0,
      assetsMap: {},
      rawDocument: {},
      formatDrift: false,
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
  const cache = new Map<string, CachedAsset>();
  let failed = 0;
  let formatDrift = false;

  for (let i = 0; i < unique.length; i++) {
    const node = unique[i].node;
    const planned = plannedFormat(node, unique[i].format);
    try {
      const result = await exportNodeBytes(node, planned);
      const actual: ExportFormat = result.format === "SVG" ? "SVG" : "PNG";
      if (actual !== planned) formatDrift = true;
      const rel = assetRelPath(node, actual);
      assetsMap[node.id] = rel;
      postZipFile(rel, result.bytes);
      cache.set(node.id, pathOnlyAsset(node, actual, rel));
    } catch (e) {
      logError(`asset export failed (${safeNodeRef(node)})`, e);
      failed += 1;
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

  postBackendMessage({
    type: "progress",
    message: "Packaging files…",
    percent: 75,
  });

  return {
    folder: sanitizeFolder(root.name) || "export",
    assetCount: Object.keys(assetsMap).length,
    failedCount: failed,
    assetsMap,
    rawDocument: annotated,
    formatDrift,
  };
}
