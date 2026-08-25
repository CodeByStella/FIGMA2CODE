/** Applies an inferred TidyPlan to the live clone with pixel-drift rollback. */

import type {
  AutoLayoutSpec,
  FrameTidySpec,
  TidyPlan,
  WrapperSpec,
} from "./types";
import {
  AbsSnap,
  TIDY_WRAPPER_KEY,
  driftedIds,
  restoreFramePixelPerfect,
  snapAbs,
  snapTree,
} from "./preserve";
import { tidyWarn } from "./warnings";

async function getNode(id: string): Promise<BaseNode | null> {
  return figma.getNodeByIdAsync(id);
}

function applyAutoLayout(frame: BaseFrameMixin, layout: AutoLayoutSpec): void {
  // FIXED outer size prevents Auto Layout from resizing the frame away from the snapshot.
  frame.layoutMode = layout.layoutMode;
  frame.primaryAxisSizingMode = "FIXED";
  frame.counterAxisSizingMode = "FIXED";
  frame.paddingLeft = layout.paddingLeft;
  frame.paddingRight = layout.paddingRight;
  frame.paddingTop = layout.paddingTop;
  frame.paddingBottom = layout.paddingBottom;
  frame.itemSpacing = layout.itemSpacing;
  // Conservative alignment: only use inferred values when they were explicitly chosen.
  frame.primaryAxisAlignItems =
    layout.primaryAxisAlignItems === "SPACE_BETWEEN"
      ? "SPACE_BETWEEN"
      : layout.primaryAxisAlignItems === "CENTER"
        ? "CENTER"
        : layout.primaryAxisAlignItems === "MAX"
          ? "MAX"
          : "MIN";
  frame.counterAxisAlignItems =
    layout.counterAxisAlignItems === "MAX"
      ? "MAX"
      : layout.counterAxisAlignItems === "CENTER"
        ? "CENTER"
        : "MIN";
  if (layout.layoutWrap === "WRAP") {
    frame.layoutWrap = "WRAP";
    if (
      typeof layout.counterAxisSpacing === "number" &&
      "counterAxisSpacing" in frame
    ) {
      (frame as FrameNode).counterAxisSpacing = layout.counterAxisSpacing;
    }
  } else if ("layoutWrap" in frame) {
    frame.layoutWrap = "NO_WRAP";
  }
}

/** Pin child to FIXED sizing so convert sees the same pixel box as before tidy. */
function pinFixedSize(node: SceneNode, w: number, h: number): void {
  if (!("layoutSizingHorizontal" in node)) return;
  const n = node as SceneNode & {
    layoutSizingHorizontal: "FIXED" | "HUG" | "FILL";
    layoutSizingVertical: "FIXED" | "HUG" | "FILL";
    layoutAlign: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
    layoutGrow: number;
  };
  try {
    n.layoutSizingHorizontal = "FIXED";
    n.layoutSizingVertical = "FIXED";
    n.layoutGrow = 0;
    n.layoutAlign = "MIN";
    if ("resize" in n) {
      (n as LayoutMixin).resize(Math.max(1, w), Math.max(1, h));
    }
  } catch {
    // Some node types reject layout sizing writes.
  }
}

function applyAbsoluteAt(
  node: SceneNode,
  x: number,
  y: number,
  w?: number,
  h?: number,
): void {
  try {
    if ("layoutPositioning" in node) {
      (node as FrameNode).layoutPositioning = "ABSOLUTE";
    }
    if ("x" in node) {
      (node as LayoutMixin).x = x;
      (node as LayoutMixin).y = y;
    }
    if (typeof w === "number" && typeof h === "number" && "resize" in node) {
      (node as LayoutMixin).resize(Math.max(1, w), Math.max(1, h));
    }
  } catch {
    // Absolute positioning is not supported on every node type.
  }
}

function safeRemove(node: BaseNode): void {
  try {
    if (!node.parent) return;
    node.remove();
  } catch {
    // Figma may have already removed the node (e.g. empty group cleanup).
  }
}

function convertGroupToFrame(group: GroupNode): FrameNode {
  const parent = group.parent;
  if (!parent || !("appendChild" in parent)) {
    throw new Error(`Group "${group.name}" has no parent`);
  }

  const index = parent.children.indexOf(group);
  const children = [...group.children].map((child) => ({
    node: child,
    x: child.x,
    y: child.y,
  }));

  const frame = figma.createFrame();
  frame.name = group.name;
  frame.resizeWithoutConstraints(
    Math.max(1, group.width),
    Math.max(1, group.height),
  );
  frame.x = group.x;
  frame.y = group.y;
  frame.fills = [];
  frame.clipsContent = false;

  if ("opacity" in group) frame.opacity = group.opacity;
  if ("blendMode" in group) frame.blendMode = group.blendMode;
  if ("isMask" in group) frame.isMask = group.isMask;
  if ("locked" in group) frame.locked = group.locked;
  if ("visible" in group) frame.visible = group.visible;

  parent.insertChild(index >= 0 ? index : parent.children.length, frame);

  for (const { node, x, y } of children) {
    if (!node.parent) continue;
    try {
      frame.appendChild(node);
      node.x = x;
      node.y = y;
    } catch {
      // Child may refuse reparenting during group→frame conversion.
    }
  }

  safeRemove(group);
  return frame;
}

function unwrapGroup(group: GroupNode): SceneNode {
  const parent = group.parent;
  if (!parent || !("appendChild" in parent) || group.children.length !== 1) {
    return group;
  }
  const child = group.children[0];
  const gx = group.x;
  const gy = group.y;
  const index = parent.children.indexOf(group);
  parent.insertChild(index >= 0 ? index : parent.children.length, child);
  child.x = gx + child.x;
  child.y = gy + child.y;
  safeRemove(group);
  return child;
}

async function createWrapperFrame(
  parent: BaseFrameMixin & ChildrenMixin,
  spec: WrapperSpec,
  before: Map<string, AbsSnap>,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.fills = [];
  frame.clipsContent = false;
  frame.setPluginData(TIDY_WRAPPER_KEY, "1");
  frame.resizeWithoutConstraints(
    Math.max(1, spec.bounds.width),
    Math.max(1, spec.bounds.height),
  );
  frame.x = spec.bounds.x;
  frame.y = spec.bounds.y;

  const moved: Array<{
    node: SceneNode;
    lx: number;
    ly: number;
    index: number;
    w: number;
    h: number;
  }> = [];
  for (const id of spec.childNodeIds) {
    const n = await getNode(id);
    if (!n || n.type === "DOCUMENT" || n.type === "PAGE") continue;
    const child = n as SceneNode;
    if (!("x" in child)) continue;
    const index = parent.children.indexOf(child);
    const snap = before.get(child.id);
    moved.push({
      node: child,
      lx: (child as LayoutMixin).x - spec.bounds.x,
      ly: (child as LayoutMixin).y - spec.bounds.y,
      index: index >= 0 ? index : parent.children.length,
      w: snap?.w ?? (child as LayoutMixin).width,
      h: snap?.h ?? (child as LayoutMixin).height,
    });
  }

  const insertAt =
    moved.length > 0
      ? Math.min(...moved.map((m) => m.index))
      : parent.children.length;

  parent.insertChild(insertAt, frame);

  for (const { node, lx, ly, w, h } of moved) {
    frame.appendChild(node);
    if ("x" in node) {
      (node as LayoutMixin).x = lx;
      (node as LayoutMixin).y = ly;
    }
    pinFixedSize(node, w, h);
  }

  // Apply layout only after children are pinned — still re-pin afterward because AL can nudge sizes.
  applyAutoLayout(frame, {
    ...spec.layout,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
  });
  frame.resizeWithoutConstraints(
    Math.max(1, spec.bounds.width),
    Math.max(1, spec.bounds.height),
  );

  for (const { node, w, h } of moved) {
    pinFixedSize(node, w, h);
  }

  return frame;
}

/**
 * Background layers stay absolute at their snapshot box — folding fills into the parent
 * drops strokes/radius and shifts paint, breaking pixel fidelity for convert.
 */
async function pinBackgroundAbsolute(
  bgId: string,
  before: Map<string, AbsSnap>,
  frame: FrameNode,
): Promise<void> {
  const bg = await getNode(bgId);
  if (!bg || bg.type === "DOCUMENT" || bg.type === "PAGE") return;
  const snap = before.get(bgId) ?? snapAbs(bg as SceneNode);
  const frameAbs = frame.absoluteBoundingBox;
  if (!snap || !frameAbs) return;
  applyAbsoluteAt(
    bg as SceneNode,
    snap.x - frameAbs.x,
    snap.y - frameAbs.y,
    snap.w,
    snap.h,
  );
}

async function applyFrameSpec(
  spec: FrameTidySpec,
  before: Map<string, AbsSnap>,
): Promise<void> {
  if (spec.skipLayout) return;
  const node = await getNode(spec.nodeId);
  if (!node || !("children" in node) || !("layoutMode" in node)) return;

  const frame = node as FrameNode;
  const wasLocked = frame.locked;
  if (wasLocked) frame.locked = false;

  const frameSnap = before.get(frame.id) ?? snapAbs(frame);
  const preChildren = snapTree(frame);

  try {
    // Pin backgrounds before wrappers/Auto Layout so decorative fills never enter the flow.
    const bgId = spec.foldBackgroundId || spec.stretchBackgroundId;
    if (bgId) {
      await pinBackgroundAbsolute(bgId, before, frame);
    }

    for (const wrapper of spec.wrappers) {
      await createWrapperFrame(frame, wrapper, before);
    }

    // Overlays and rotated layers use pre-tidy absolute coords relative to the frame.
    const frameAbsNow = frame.absoluteBoundingBox;
    for (const abs of spec.absoluteChildren) {
      const child = await getNode(abs.nodeId);
      if (!child || child.type === "DOCUMENT" || child.type === "PAGE")
        continue;
      const snap = before.get(abs.nodeId);
      if (snap && frameAbsNow) {
        applyAbsoluteAt(
          child as SceneNode,
          snap.x - frameAbsNow.x,
          snap.y - frameAbsNow.y,
          snap.w,
          snap.h,
        );
      } else {
        applyAbsoluteAt(child as SceneNode, abs.x, abs.y);
      }
    }

    if (spec.layout) {
      const w = frameSnap?.w ?? frame.width;
      const h = frameSnap?.h ?? frame.height;

      // Pin flow children to FIXED before enabling Auto Layout so reflow cannot resize them.
      for (const child of [...frame.children]) {
        if (
          "layoutPositioning" in child &&
          (child as FrameNode).layoutPositioning === "ABSOLUTE"
        ) {
          continue;
        }
        const snap = before.get(child.id) ?? preChildren.get(child.id);
        if (snap) pinFixedSize(child, snap.w, snap.h);
        else if ("width" in child) {
          pinFixedSize(child, child.width, child.height);
        }
      }

      applyAutoLayout(frame, {
        ...spec.layout,
        // Only honor MAX/CENTER when inference explicitly detected them; otherwise MIN for stability.
        counterAxisAlignItems:
          spec.layout.counterAxisAlignItems === "MAX" ||
          spec.layout.counterAxisAlignItems === "CENTER"
            ? spec.layout.counterAxisAlignItems
            : "MIN",
      });
      frame.resize(Math.max(1, w), Math.max(1, h));
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "FIXED";

      // Auto Layout can still nudge text/hug nodes — re-pin from the snapshot.
      for (const child of [...frame.children]) {
        if (
          "layoutPositioning" in child &&
          (child as FrameNode).layoutPositioning === "ABSOLUTE"
        ) {
          const snap = before.get(child.id);
          const fa = frame.absoluteBoundingBox;
          if (snap && fa) {
            applyAbsoluteAt(
              child,
              snap.x - fa.x,
              snap.y - fa.y,
              snap.w,
              snap.h,
            );
          }
          continue;
        }
        const snap = before.get(child.id) ?? preChildren.get(child.id);
        if (snap) pinFixedSize(child, snap.w, snap.h);
      }
    }

    // Revert this frame if any descendant moved — convert must see identical pixels.
    const bad = driftedIds(frame, before);
    if (bad.length > 0) {
      tidyWarn(
        `Reverted Auto Layout on "${frame.name}" — would shift ${bad.length} layer(s)`,
      );
      restoreFramePixelPerfect(frame, before);
    }
  } finally {
    if (wasLocked) frame.locked = true;
  }
}

/**
 * Mutates the clone tree in place. Any frame that would shift pixels is rolled back
 * to freeform absolute positions matching the pre-apply snapshot.
 */
export async function applyTidyPlan(
  plan: TidyPlan,
  root: SceneNode,
): Promise<void> {
  const unwrapIds = [...new Set(plan.groupsToUnwrap)];
  const frameIds = [...new Set(plan.groupsToFrame)];

  for (const id of unwrapIds) {
    const n = await getNode(id);
    if (n && n.type === "GROUP") {
      unwrapGroup(n as GroupNode);
    }
  }

  const idRemap = new Map<string, string>();
  for (const id of frameIds) {
    const n = await getNode(id);
    if (!n) continue;
    if (n.type === "GROUP") {
      const frame = convertGroupToFrame(n as GroupNode);
      idRemap.set(id, frame.id);
    } else if (n.type === "FRAME") {
      idRemap.set(id, n.id);
    }
  }

  const mapId = (id: string) => idRemap.get(id) ?? id;

  for (const spec of plan.frames) {
    spec.nodeId = mapId(spec.nodeId);
    if (spec.foldBackgroundId) {
      spec.foldBackgroundId = mapId(spec.foldBackgroundId);
    }
    if (spec.stretchBackgroundId) {
      spec.stretchBackgroundId = mapId(spec.stretchBackgroundId);
    }
    for (const abs of spec.absoluteChildren) {
      abs.nodeId = mapId(abs.nodeId);
    }
    for (const sizing of spec.childSizing) {
      sizing.nodeId = mapId(sizing.nodeId);
    }
    for (const wrapper of spec.wrappers) {
      wrapper.childNodeIds = wrapper.childNodeIds.map(mapId);
      for (const sizing of wrapper.childSizing) {
        sizing.nodeId = mapId(sizing.nodeId);
      }
    }
  }

  // Snapshot after group→frame conversion (visually identical) but before Auto Layout runs.
  const before = snapTree(root);

  // Deepest frames first so parent layout sees finalized child structure.
  const ordered = [...plan.frames].reverse();
  for (const spec of ordered) {
    await applyFrameSpec(spec, before);
  }

  // Last-resort rollback on the root if nested frames left residual drift.
  const finalBad = driftedIds(root, before);
  if (finalBad.length > 0 && root.type === "FRAME") {
    tidyWarn(
      `Final pixel check failed (${finalBad.length} layers) — restoring freeform on root`,
    );
    restoreFramePixelPerfect(root as FrameNode, before);
  }
}
