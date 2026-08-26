/** Absolute bounding-box snapshots used to validate and rollback tidy apply. */

import { logError, safeNodeRef } from "../shared/log";

export const PIXEL_EPS = 0.5;
export const TIDY_WRAPPER_KEY = "tidyWrapper";

export type AbsSnap = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function snapAbs(node: SceneNode): AbsSnap | null {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

export function snapTree(root: SceneNode): Map<string, AbsSnap> {
  const map = new Map<string, AbsSnap>();
  const visit = (node: SceneNode) => {
    const s = snapAbs(node);
    if (s) map.set(node.id, s);
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  };
  visit(root);
  return map;
}

export function nearlySameAbs(
  a: AbsSnap,
  b: AbsSnap,
  eps = PIXEL_EPS,
): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}

/** Layer ids whose absolute box moved beyond tolerance since the pre-apply snapshot. */
export function driftedIds(
  root: SceneNode,
  before: Map<string, AbsSnap>,
  eps = PIXEL_EPS,
): string[] {
  const bad: string[] = [];
  const visit = (node: SceneNode) => {
    const prev = before.get(node.id);
    if (prev) {
      const now = snapAbs(node);
      if (!now || !nearlySameAbs(prev, now, eps)) {
        bad.push(node.id);
      }
    }
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  };
  visit(root);
  return bad;
}

function isTidyWrapper(node: BaseNode): boolean {
  return (
    node.type === "FRAME" &&
    typeof (node as FrameNode).getPluginData === "function" &&
    (node as FrameNode).getPluginData(TIDY_WRAPPER_KEY) === "1"
  );
}

function depthOf(node: BaseNode): number {
  let d = 0;
  let p: BaseNode | null = node.parent;
  while (p) {
    d += 1;
    p = p.parent;
  }
  return d;
}

/**
 * node.x/y minus the visual AABB origin in parent space.
 * Zero when unrotated; for 180° rotation this is typically (+width, +height)
 * because `x` is the transform translation, not the bounding-box left.
 */
export function transformOriginOffset(node: SceneNode): {
  dx: number;
  dy: number;
} {
  if (!("x" in node)) return { dx: 0, dy: 0 };
  const box = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
  if (!box) return { dx: 0, dy: 0 };
  const parent = node.parent;
  const parentBox =
    parent && "absoluteBoundingBox" in parent
      ? parent.absoluteBoundingBox
      : null;
  const originX = parentBox?.x ?? 0;
  const originY = parentBox?.y ?? 0;
  const lm = node as LayoutMixin;
  return {
    dx: lm.x - (box.x - originX),
    dy: lm.y - (box.y - originY),
  };
}

/**
 * Write x/y (and optional size) so absoluteBoundingBox lands at the parent-local
 * box. Assigning AABB left/top to `node.x`/`node.y` shifts rotated layers.
 */
export function placeLocalBox(
  node: SceneNode,
  localX: number,
  localY: number,
  w?: number,
  h?: number,
): void {
  if (!("x" in node)) return;
  const rotated =
    "rotation" in node && Math.abs((node as LayoutMixin).rotation) > 0.5;
  // AABB size is larger than layout size when rotated; resizing to the box grows the node.
  if (
    !rotated &&
    typeof w === "number" &&
    typeof h === "number" &&
    "resize" in node
  ) {
    try {
      (node as LayoutMixin).resize(Math.max(1, w), Math.max(1, h));
    } catch (e) {
      logError(`resize failed (${safeNodeRef(node)})`, e);
    }
  }
  const { dx, dy } = transformOriginOffset(node);
  try {
    (node as LayoutMixin).x = localX + dx;
    (node as LayoutMixin).y = localY + dy;
  } catch (e) {
    logError(`absolute box write failed (${safeNodeRef(node)})`, e);
  }
}

/**
 * Position a node so its absoluteBoundingBox matches the snapshot, compensating
 * for rotation (node.x is the transform origin, not the AABB left).
 */
function restoreNodeAbs(node: SceneNode, target: AbsSnap): void {
  if (!("x" in node)) return;
  const parent = node.parent;
  let originX = 0;
  let originY = 0;
  if (parent && "absoluteBoundingBox" in parent && parent.absoluteBoundingBox) {
    originX = parent.absoluteBoundingBox.x;
    originY = parent.absoluteBoundingBox.y;
  }
  try {
    if ("layoutPositioning" in node) {
      (node as FrameNode).layoutPositioning = "AUTO";
    }
  } catch (e) {
    logError(`layoutPositioning write failed (${safeNodeRef(node)})`, e);
  }
  placeLocalBox(
    node,
    target.x - originX,
    target.y - originY,
    target.w,
    target.h,
  );
}

/**
 * Revert a frame subtree to pre-tidy absolute positions: disable Auto Layout,
 * unwrap tidy wrapper frames, and restore every snapshotted descendant.
 */
export function restoreFramePixelPerfect(
  frame: FrameNode,
  before: Map<string, AbsSnap>,
): void {
  const wasLocked = frame.locked;
  if (wasLocked) frame.locked = false;

  try {
    // Auto Layout must be off before absolute repositioning is allowed.
    if ("layoutMode" in frame && frame.layoutMode !== "NONE") {
      frame.layoutMode = "NONE";
    }

    // Unwrap inference wrappers deepest-first so children land in the correct parent.
    const wrappers = frame.findAll(isTidyWrapper) as FrameNode[];
    wrappers.sort((a, b) => depthOf(b) - depthOf(a));

    for (const wrapper of wrappers) {
      const parent = wrapper.parent;
      if (!parent || !("appendChild" in parent)) continue;
      const insertAt = parent.children.indexOf(wrapper);
      const kids = [...wrapper.children];
      for (const child of kids) {
        const snap = before.get(child.id) ?? snapAbs(child);
        parent.insertChild(
          insertAt >= 0 ? insertAt : parent.children.length,
          child,
        );
        if (snap) restoreNodeAbs(child, snap);
      }
      try {
        if (wrapper.parent) wrapper.remove();
      } catch (e) {
        logError(`wrapper remove failed (${safeNodeRef(wrapper)})`, e);
      }
    }

    // Restore frame outer size from snapshot when available.
    const frameSnap = before.get(frame.id);
    if (frameSnap && "resize" in frame) {
      try {
        frame.resize(Math.max(1, frameSnap.w), Math.max(1, frameSnap.h));
      } catch (e) {
        logError(`frame resize failed (${safeNodeRef(frame)})`, e);
      }
    }

    // Walk remaining descendants — every snapshotted node returns to its absolute box.
    const restoreVisit = (node: SceneNode) => {
      const snap = before.get(node.id);
      if (snap && node.id !== frame.id) {
        restoreNodeAbs(node, snap);
      }
      if ("children" in node) {
        for (const child of (node as ChildrenMixin).children) {
          restoreVisit(child as SceneNode);
        }
      }
    };
    restoreVisit(frame);
  } finally {
    if (wasLocked) frame.locked = true;
  }
}
