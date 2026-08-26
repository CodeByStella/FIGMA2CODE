/**
 * Repairs bad designer containment before section split:
 * unwrap mega-groups that span multiple visual bands, and reparent orphans
 * that visually sit inside a sibling frame (e.g. a row card left outside the row).
 * Always preserves world x/y via absoluteBoundingBox → placeLocalBox.
 */

import {
  intervalOverlap,
  parentAbsRect,
  rectArea,
  type Rect,
} from "./geometry";
import { placeLocalBox } from "./preserve";
import { tidyWarn } from "./warnings";
import { logError, safeNodeRef } from "../shared/log";

export type TreeRepairStats = {
  unwrapped: number;
  reparented: number;
};

/** Never touch `.name` after remove — Figma throws in get_name. */
function nodeLabel(node: SceneNode): string {
  try {
    const name = node.name;
    if (typeof name === "string" && name.length > 0) return name;
  } catch {
    /* removed */
  }
  return safeNodeRef(node);
}

function rootLocalRect(node: SceneNode, rootAbs: Rect): Rect | null {
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  return {
    x: box.x - rootAbs.x,
    y: box.y - rootAbs.y,
    width: box.width,
    height: box.height,
  };
}

function canHostChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return (
    "children" in node &&
    "appendChild" in node &&
    (node.type === "FRAME" ||
      node.type === "COMPONENT" ||
      node.type === "COMPONENT_SET")
  );
}

/** Move `node` under `dest` without changing its world-space box. */
function reparentKeepWorld(
  node: SceneNode,
  dest: SceneNode & ChildrenMixin,
): boolean {
  const snap = node.absoluteBoundingBox;
  if (!snap || !("x" in node)) return false;
  try {
    dest.appendChild(node);
    const destAbs = dest.absoluteBoundingBox;
    if (!destAbs) return false;
    placeLocalBox(node, snap.x - destAbs.x, snap.y - destAbs.y);
    return true;
  } catch (e) {
    logError(`reparentKeepWorld failed (${safeNodeRef(node)})`, e);
    return false;
  }
}

/**
 * Groups/frames whose height covers a large share of the page (or more than one
 * sibling band) usually glue unrelated sections together — unwrap to the parent.
 */
function shouldUnwrapMega(
  node: SceneNode,
  rootAbs: Rect,
  siblingRects: Rect[],
): boolean {
  if (node.type !== "GROUP" && node.type !== "FRAME") return false;
  if (!("children" in node) || node.children.length < 2) return false;
  // Leave Auto Layout frames alone — they are intentional structure.
  if (
    node.type === "FRAME" &&
    "layoutMode" in node &&
    (node as BaseFrameMixin).layoutMode !== "NONE"
  ) {
    return false;
  }

  const rect = rootLocalRect(node, rootAbs);
  if (!rect || rect.height < 400) return false;

  if (rect.height >= rootAbs.height * 0.35) return true;

  let centersInside = 0;
  for (const s of siblingRects) {
    const cy = s.y + s.height / 2;
    if (cy <= rect.y + 8 || cy >= rect.y + rect.height - 8) continue;
    if (s.height < 40 || s.height > rootAbs.height * 0.8) continue;
    if (s.width < rootAbs.width * 0.2) continue;
    centersInside += 1;
  }
  return centersInside >= 2 && rect.height >= rootAbs.height * 0.2;
}

function unwrapIntoParent(node: SceneNode & ChildrenMixin): number {
  const parent = node.parent;
  if (!parent || !("insertChild" in parent) || !("children" in parent)) {
    return 0;
  }
  const insertAt = parent.children.indexOf(node as SceneNode);
  if (insertAt < 0) return 0;

  const kids = [...node.children] as SceneNode[];
  let moved = 0;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    const snap = child.absoluteBoundingBox;
    try {
      parent.insertChild(insertAt + i, child);
      if (snap && "x" in child) {
        const pAbs =
          "absoluteBoundingBox" in parent ? parent.absoluteBoundingBox : null;
        if (pAbs) {
          placeLocalBox(child, snap.x - pAbs.x, snap.y - pAbs.y);
        }
      }
      moved += 1;
    } catch (e) {
      logError(`unwrap child failed (${safeNodeRef(child)})`, e);
    }
  }

  try {
    if (node.parent) node.remove();
  } catch (e) {
    logError(`unwrap remove failed (${safeNodeRef(node)})`, e);
  }
  return moved > 0 ? 1 : 0;
}

/**
 * Direct child whose center sits inside a wider sibling frame — e.g. community
 * card beside feature cards but left as a root sibling of Frame 39.
 */
function findVisualHost(
  orphan: SceneNode,
  orphanRect: Rect,
  siblings: SceneNode[],
  rootAbs: Rect,
): (SceneNode & ChildrenMixin) | null {
  const ox = orphanRect.x + orphanRect.width / 2;
  const oy = orphanRect.y + orphanRect.height / 2;
  let best: { node: SceneNode & ChildrenMixin; area: number } | null = null;

  for (const sib of siblings) {
    if (sib === orphan) continue;
    if (!canHostChildren(sib)) continue;
    const sr = rootLocalRect(sib, rootAbs);
    if (!sr) continue;
    if (sr.width < rootAbs.width * 0.5) continue;
    if (sr.height < orphanRect.height * 0.5) continue;
    if (orphanRect.width >= rootAbs.width * 0.85) continue;
    if (
      ox < sr.x ||
      ox > sr.x + sr.width ||
      oy < sr.y ||
      oy > sr.y + sr.height
    ) {
      continue;
    }
    const area = rectArea(sr);
    if (!best || area < best.area) best = { node: sib, area };
  }
  return best?.node ?? null;
}

/**
 * Root frames that substantially overlap in Y cannot both be page flow children —
 * pin the later one absolute (JOIN vs performance table).
 */
function pinOverlappingRootFrames(root: FrameNode, rootAbs: Rect): number {
  const frames = root.children.filter(
    (c) => c.type === "FRAME" && c.visible !== false,
  ) as FrameNode[];

  const rects = frames.map((f) => ({ f, r: rootLocalRect(f, rootAbs) }));
  let pinned = 0;
  const already = new Set<string>();

  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    if (!a.r) continue;
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (!b.r) continue;
      const yOv = intervalOverlap(
        a.r.y,
        a.r.y + a.r.height,
        b.r.y,
        b.r.y + b.r.height,
      );
      const minH = Math.min(a.r.height, b.r.height);
      if (minH <= 0 || yOv < minH * 0.15) continue;

      const pin = a.r.y <= b.r.y ? b.f : a.f;
      const keep = pin === a.f ? b.f : a.f;
      if (already.has(pin.id)) continue;
      already.add(pin.id);

      try {
        const x = pin.x;
        const y = pin.y;
        if ("layoutPositioning" in pin) {
          pin.layoutPositioning = "ABSOLUTE";
        }
        pin.x = x;
        pin.y = y;
        pinned += 1;
        const pinLabel = nodeLabel(pin);
        const keepLabel = nodeLabel(keep);
        tidyWarn(
          `Overlapping root frames "${pinLabel}" vs "${keepLabel}" — kept "${pinLabel}" absolute`,
        );
      } catch (e) {
        logError(`pin overlapping frame failed (${safeNodeRef(pin)})`, e);
      }
    }
  }
  return pinned;
}

/**
 * Run containment repair on the tidy clone root. Call before AI section wrap.
 */
export function repairTreeContainment(root: SceneNode): TreeRepairStats {
  const stats: TreeRepairStats = { unwrapped: 0, reparented: 0 };
  if (root.type !== "FRAME" || !("children" in root)) return stats;

  const frame = root as FrameNode;
  const rootAbs = parentAbsRect(frame);
  if (!rootAbs) return stats;

  // Pass 1: unwrap mega-groups at root (repeat while progress).
  let guard = 0;
  while (guard++ < 8) {
    const kids = [...frame.children] as SceneNode[];
    const siblingRects = kids
      .map((k) => rootLocalRect(k, rootAbs))
      .filter((r): r is Rect => !!r);

    let unwrappedThisRound = 0;
    for (const child of kids) {
      if (!child.parent) continue;
      if (!shouldUnwrapMega(child, rootAbs, siblingRects)) continue;
      if (!("children" in child)) continue;
      // Capture label before unwrap — remove() invalidates .name (get_name throws).
      const label = nodeLabel(child);
      const n = unwrapIntoParent(child as SceneNode & ChildrenMixin);
      if (n > 0) {
        unwrappedThisRound += n;
        tidyWarn(
          `Unwrapped mega-group "${label}" that spanned multiple visual bands`,
        );
      }
    }
    stats.unwrapped += unwrappedThisRound;
    if (unwrappedThisRound === 0) break;
  }

  // Pass 2: reparent visual orphans into sibling hosts.
  const afterUnwrap = [...frame.children] as SceneNode[];
  for (const child of afterUnwrap) {
    if (!child.parent || child.parent !== frame) continue;
    const rect = rootLocalRect(child, rootAbs);
    if (!rect) continue;
    const host = findVisualHost(child, rect, afterUnwrap, rootAbs);
    if (!host) continue;
    const childLabel = nodeLabel(child);
    const hostLabel = nodeLabel(host);
    if (reparentKeepWorld(child, host)) {
      stats.reparented += 1;
      tidyWarn(
        `Reparented "${childLabel}" into visual host "${hostLabel}" (kept world position)`,
      );
    }
  }

  return stats;
}

/**
 * After sections exist, pin root frames that still overlap in Y so page
 * vertical Auto Layout does not invent a false order.
 */
export function repairOverlappingPageSections(root: SceneNode): number {
  if (root.type !== "FRAME") return 0;
  const rootAbs = parentAbsRect(root);
  if (!rootAbs) return 0;
  return pinOverlappingRootFrames(root as FrameNode, rootAbs);
}
