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

  let bg: ChildGeom | null = covers[0] ?? null;
  // Plain fill shapes can be folded into the parent frame; complex backgrounds stay absolute.
  const plainCover = covers.find((c) => isPlainFillShape(c.node));
  if (plainCover) bg = plainCover;

  const rest = candidates.filter((c) => c !== bg);
  if (bg) backgrounds.push(bg);

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
  if (overlapPairs.length >= 3 && rest.length >= 3) {
    const heavilyOverlapped = new Set<ChildGeom>();
    for (const [a, b] of overlapPairs) {
      heavilyOverlapped.add(a);
      heavilyOverlapped.add(b);
    }
    if (heavilyOverlapped.size >= 3) {
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
