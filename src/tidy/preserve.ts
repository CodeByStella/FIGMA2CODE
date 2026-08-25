/** Pixel-perfect snapshot / validate / restore for tidy apply. */

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

/** Returns ids whose absolute box drifted from the snapshot. */
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
 * Place a node so its absoluteBoundingBox matches `target`, relative to
 * its current parent's absolute origin.
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
  } catch {
    // ignore
  }
  (node as LayoutMixin).x = target.x - originX;
  (node as LayoutMixin).y = target.y - originY;
  if ("resize" in node && typeof (node as LayoutMixin).resize === "function") {
    try {
      (node as LayoutMixin).resize(
        Math.max(1, target.w),
        Math.max(1, target.h),
      );
    } catch {
      // some nodes cannot resize
    }
  }
}

/**
 * Undo Auto Layout + tidy wrappers under `frame`, restoring every snapshotted
 * descendant to its pre-tidy absolute box. Parent stays freeform.
 */
export function restoreFramePixelPerfect(
  frame: FrameNode,
  before: Map<string, AbsSnap>,
): void {
  const wasLocked = frame.locked;
  if (wasLocked) frame.locked = false;

  try {
    // Turn off Auto Layout first so we can freely position.
    if ("layoutMode" in frame && frame.layoutMode !== "NONE") {
      frame.layoutMode = "NONE";
    }

    // Unwrap tidy wrappers deepest-first (children promoted to wrapper parent).
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
      } catch {
        // already gone
      }
    }

    // Restore frame size from snapshot if present
    const frameSnap = before.get(frame.id);
    if (frameSnap && "resize" in frame) {
      try {
        frame.resize(Math.max(1, frameSnap.w), Math.max(1, frameSnap.h));
      } catch {
        // ignore
      }
    }

    // Restore every remaining descendant that we snapshotted
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
