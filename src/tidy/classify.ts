/** Classifies frame children into layout roles before Auto Layout inference. */

import {
  ALIGN_EPS,
  BG_COVER_RATIO,
  ChildGeom,
  OVERLAP_AREA_RATIO,
  Rect,
  containsPoint,
  coversParent,
  nearlyEqual,
  overlapRatioOfMin,
  rectArea,
  rectCenterX,
  rectCenterY,
} from "./geometry";

export type Role = "background" | "overlay" | "flow" | "absolute";

export type Classified = {
  backgrounds: ChildGeom[];
  overlays: ChildGeom[];
  flow: ChildGeom[];
  absolute: ChildGeom[];
};

export function isAutoLayoutFrame(node: SceneNode): boolean {
  return (
    "layoutMode" in node &&
    (node as BaseFrameMixin).layoutMode !== "NONE" &&
    (node as BaseFrameMixin).layoutMode !== undefined
  );
}

export function canHaveChildren(
  node: SceneNode,
): node is SceneNode & ChildrenMixin {
  return "children" in node;
}

export function isLeafType(type: NodeType): boolean {
  return (
    type === "TEXT" ||
    type === "RECTANGLE" ||
    type === "ELLIPSE" ||
    type === "LINE" ||
    type === "VECTOR" ||
    type === "STAR" ||
    type === "POLYGON" ||
    type === "BOOLEAN_OPERATION" ||
    type === "INSTANCE" ||
    type === "SLICE"
  );
}

export function isRotatable(node: SceneNode): boolean {
  return "rotation" in node && Math.abs((node as LayoutMixin).rotation) > 0.5;
}

export function isPlainFillShape(node: SceneNode): boolean {
  if (node.type !== "RECTANGLE" && node.type !== "ELLIPSE") return false;
  const n = node as GeometryMixin & MinimalFillsMixin & MinimalStrokesMixin;
  if (!("fills" in n) || n.fills === figma.mixed) return false;
  if (!Array.isArray(n.fills) || n.fills.length === 0) return false;
  if ("strokes" in n && Array.isArray(n.strokes) && n.strokes.length > 0) {
    return false;
  }
  if ("effects" in n && Array.isArray(n.effects) && n.effects.length > 0) {
    return false;
  }
  return true;
}

/** Vectors/shapes that stack into a composite icon rather than page chrome. */
export function isDecorativeLayer(node: SceneNode): boolean {
  return (
    node.type === "VECTOR" ||
    node.type === "BOOLEAN_OPERATION" ||
    node.type === "STAR" ||
    node.type === "POLYGON" ||
    node.type === "LINE" ||
    node.type === "ELLIPSE" ||
    node.type === "RECTANGLE"
  );
}

function siblingsSitInside(cover: ChildGeom, others: ChildGeom[]): boolean {
  if (others.length === 0) return false;
  return others.every((o) =>
    containsPoint(cover.rect, rectCenterX(o.rect), rectCenterY(o.rect)),
  );
}

/** Nested GROUP/FRAME of only decorative shapes is still a stacked icon piece. */
function isDecorativeOrIconGroup(node: SceneNode): boolean {
  if (isDecorativeLayer(node)) return true;
  if (
    (node.type === "GROUP" || node.type === "FRAME") &&
    "children" in node &&
    node.children.length > 0 &&
    node.children.every((c) => isDecorativeLayer(c as SceneNode))
  ) {
    return true;
  }
  return false;
}

export function parentHasFills(node: SceneNode): boolean {
  if (!("fills" in node)) return false;
  const fills = (node as MinimalFillsMixin).fills;
  if (fills === figma.mixed) return true;
  return Array.isArray(fills) && fills.length > 0;
}

/**
 * Split visible children into flow vs absolute buckets. Paint order (`index`) matters
 * for background detection; rotated nodes are always absolute because AL cannot represent them.
 */
export function classifyChildren(
  items: ChildGeom[],
  parentRect: Rect,
): Classified {
  const visible = items.filter((c) => c.node.visible !== false);
  const backgrounds: ChildGeom[] = [];
  const overlays: ChildGeom[] = [];
  const absolute: ChildGeom[] = [];
  const candidates: ChildGeom[] = [];

  for (const item of visible) {
    if (isRotatable(item.node)) {
      absolute.push(item);
      continue;
    }
    candidates.push(item);
  }

  // Full-bleed layer behind content — lowest paint index wins among covers.
  const covers = candidates
    .filter((c) => coversParent(c.rect, parentRect, BG_COVER_RATIO))
    .sort((a, b) => a.index - b.index);

  // Plain fills can fold into the parent. A covering VECTOR with siblings
  // nested inside it is a stacked icon (LINE mark), not a page background.
  let bg: ChildGeom | null = null;
  const plainCover = covers.find((c) => isPlainFillShape(c.node));
  if (plainCover) {
    bg = plainCover;
  } else if (covers[0]) {
    const cover = covers[0];
    const others = candidates.filter((c) => c !== cover);
    const stackedIcon =
      others.length > 0 &&
      isDecorativeOrIconGroup(cover.node) &&
      others.every((o) => isDecorativeOrIconGroup(o.node)) &&
      siblingsSitInside(cover, others);
    if (!stackedIcon) bg = cover;
  }

  const rest = candidates.filter((c) => c !== bg);
  if (bg) backgrounds.push(bg);

  // Marks/icons sitting on a folded background were never paired for overlay
  // detection (bg left `rest`) — treat them as overlays so one-child VERTICAL
  // Auto Layout does not stack them under the tile.
  if (bg) {
    for (const item of [...rest]) {
      if (
        rectArea(item.rect) < rectArea(bg.rect) * 0.4 &&
        containsPoint(bg.rect, rectCenterX(item.rect), rectCenterY(item.rect))
      ) {
        overlays.push(item);
        const idx = rest.indexOf(item);
        if (idx >= 0) rest.splice(idx, 1);
      }
    }
  }

  // If bg was a stacked-icon base (decorative cover + icon-group siblings still
  // in rest), put it back so the heavy-overlap path keeps the whole mark absolute.
  if (
    bg &&
    isDecorativeOrIconGroup(bg.node) &&
    rest.length > 0 &&
    rest.every((o) => isDecorativeOrIconGroup(o.node)) &&
    siblingsSitInside(bg, rest)
  ) {
    rest.unshift(bg);
    backgrounds.pop();
    bg = null;
  }

  const flowSet = new Set(rest);
  const overlapPairs: Array<[ChildGeom, ChildGeom]> = [];

  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[i];
      const b = rest[j];
      const ratio = overlapRatioOfMin(a.rect, b.rect);
      if (ratio >= OVERLAP_AREA_RATIO) {
        overlapPairs.push([a, b]);
      }
    }
  }

  // Overlapping siblings that are all decorative (badges, icons) cannot share one Auto Layout flow.
  if (rest.length >= 2) {
    const heavilyOverlapped = new Set<ChildGeom>();
    for (const [a, b] of overlapPairs) {
      heavilyOverlapped.add(a);
      heavilyOverlapped.add(b);
    }
    if (
      (overlapPairs.length >= 3 && heavilyOverlapped.size >= 3) ||
      (heavilyOverlapped.size === rest.length &&
        overlapPairs.length >= rest.length - 1)
    ) {
      for (const item of heavilyOverlapped) {
        if (flowSet.has(item)) {
          absolute.push(item);
          flowSet.delete(item);
        }
      }
    }
  }

  for (const [a, b] of overlapPairs) {
    if (!flowSet.has(a) || !flowSet.has(b)) continue;
    const smaller = rectArea(a.rect) <= rectArea(b.rect) ? a : b;
    const larger = smaller === a ? b : a;
    // Badge/icon on a card: small layer centered inside a larger sibling stays absolute overlay.
    if (
      rectArea(smaller.rect) < rectArea(larger.rect) * 0.4 &&
      containsPoint(
        larger.rect,
        rectCenterX(smaller.rect),
        rectCenterY(smaller.rect),
      )
    ) {
      overlays.push(smaller);
      flowSet.delete(smaller);
      continue;
    }
    // Heavy mutual overlap without containment — neither sibling belongs in Auto Layout flow.
    if (overlapRatioOfMin(a.rect, b.rect) >= 0.5) {
      if (flowSet.has(a)) {
        absolute.push(a);
        flowSet.delete(a);
      }
      if (flowSet.has(b)) {
        absolute.push(b);
        flowSet.delete(b);
      }
    }
  }

  // Small edge-adjacent floaters that overlap content are overlays, not flow items.
  for (const item of [...flowSet]) {
    const area = rectArea(item.rect);
    const parentArea = rectArea(parentRect);
    if (parentArea > 0 && area / parentArea < 0.08) {
      const nearEdge =
        item.rect.x <= ALIGN_EPS * 4 ||
        item.rect.y <= ALIGN_EPS * 4 ||
        nearlyEqual(
          item.rect.x + item.rect.width,
          parentRect.width,
          ALIGN_EPS * 4,
        ) ||
        nearlyEqual(
          item.rect.y + item.rect.height,
          parentRect.height,
          ALIGN_EPS * 4,
        );
      const overlapsOther = [...flowSet].some(
        (o) => o !== item && overlapRatioOfMin(o.rect, item.rect) > 0.1,
      );
      if (nearEdge && overlapsOther) {
        overlays.push(item);
        flowSet.delete(item);
      }
    }
  }

  // Layers extending well outside the parent bounds break Auto Layout — keep absolute.
  for (const item of [...flowSet]) {
    if (
      item.rect.x < -ALIGN_EPS ||
      item.rect.y < -ALIGN_EPS ||
      item.rect.x + item.rect.width > parentRect.width + ALIGN_EPS ||
      item.rect.y + item.rect.height > parentRect.height + ALIGN_EPS
    ) {
      // Require substantial overflow — minor sub-pixel bleed is tolerated.
      const outside =
        item.rect.x < -ALIGN_EPS * 2 ||
        item.rect.y < -ALIGN_EPS * 2 ||
        item.rect.x + item.rect.width > parentRect.width + ALIGN_EPS * 2 ||
        item.rect.y + item.rect.height > parentRect.height + ALIGN_EPS * 2;
      if (outside) {
        absolute.push(item);
        flowSet.delete(item);
      }
    }
  }

  return {
    backgrounds,
    overlays,
    flow: [...flowSet].sort((a, b) => a.index - b.index),
    absolute,
  };
}
