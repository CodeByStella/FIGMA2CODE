export type AnyNode = Record<string, any>;

export type Box = {
  node: AnyNode;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  right: number;
  bottom: number;
  area: number;
};

export type AlignAxis = "MIN" | "CENTER" | "MAX";

export type LayoutInferenceOptions = {
  thresholdPx?: number;
  /** Min overlap ratio (intersection / smaller area) to treat as decoration */
  overlapRatio?: number;
  /** Child area / median sibling area below this → candidate decoration */
  tinyAreaRatio?: number;
};

export const DEFAULT_THRESHOLD_PX = 4;
export const DEFAULT_OVERLAP_RATIO = 0.3;
export const DEFAULT_TINY_AREA_RATIO = 0.15;

export function near(a: number, b: number, t: number): boolean {
  return Math.abs(a - b) <= t;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function maxAbsDiff(values: number[]): number {
  if (values.length <= 1) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max - min;
}

export function nodeBox(node: AnyNode): Box | null {
  const w = Number(node.width);
  const h = Number(node.height);
  const x = Number(node.x);
  const y = Number(node.y);
  if (![w, h, x, y].every((n) => Number.isFinite(n))) return null;
  if (w < 0 || h < 0) return null;
  return {
    node,
    id: String(node.id ?? ""),
    x,
    y,
    w,
    h,
    cx: x + w / 2,
    cy: y + h / 2,
    right: x + w,
    bottom: y + h,
    area: w * h,
  };
}

export function visibleChildren(node: AnyNode): AnyNode[] {
  if (!Array.isArray(node.children)) return [];
  return node.children.filter(
    (c) => c && typeof c === "object" && c.visible !== false,
  );
}

export function intersectionArea(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.right, b.right);
  const y2 = Math.min(a.bottom, b.bottom);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

/** Intersection over the smaller box area (coverage of the smaller by overlap). */
export function overlapCoverage(a: Box, b: Box): number {
  const inter = intersectionArea(a, b);
  if (inter <= 0) return 0;
  const smaller = Math.min(a.area, b.area) || 1;
  return inter / smaller;
}

export function sharedCrossAlign(
  boxes: Box[],
  axis: "x" | "y",
  t: number,
): AlignAxis | null {
  if (boxes.length === 0) return null;
  const edges =
    axis === "y"
      ? {
          MIN: boxes.map((b) => b.y),
          CENTER: boxes.map((b) => b.cy),
          MAX: boxes.map((b) => b.bottom),
        }
      : {
          MIN: boxes.map((b) => b.x),
          CENTER: boxes.map((b) => b.cx),
          MAX: boxes.map((b) => b.right),
        };

  const candidates: AlignAxis[] = ["MIN", "CENTER", "MAX"];
  let best: AlignAxis | null = null;
  let bestSpread = Infinity;
  for (const key of candidates) {
    const spread = maxAbsDiff(edges[key]);
    if (spread <= t && spread < bestSpread) {
      best = key;
      bestSpread = spread;
    }
  }
  return best;
}

export function consecutiveGaps(
  boxes: Box[],
  direction: "HORIZONTAL" | "VERTICAL",
): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i];
    const b = boxes[i + 1];
    const gap = direction === "HORIZONTAL" ? b.x - a.right : b.y - a.bottom;
    gaps.push(gap);
  }
  return gaps;
}

export function snapshotLayoutFields(node: AnyNode): Record<string, unknown> {
  return {
    layoutMode: node.layoutMode,
    itemSpacing: node.itemSpacing,
    paddingLeft: node.paddingLeft,
    paddingRight: node.paddingRight,
    paddingTop: node.paddingTop,
    paddingBottom: node.paddingBottom,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    isRelative: node.isRelative,
    layoutWrap: node.layoutWrap,
    primaryAxisSizingMode: node.primaryAxisSizingMode,
    counterAxisSizingMode: node.counterAxisSizingMode,
    childOrder: Array.isArray(node.children)
      ? node.children.map((c: AnyNode) => String(c.id))
      : [],
    children: Array.isArray(node.children)
      ? node.children.map((c: AnyNode) => ({
          id: c.id,
          x: c.x,
          y: c.y,
          width: c.width,
          height: c.height,
          layoutPositioning: c.layoutPositioning,
          layoutGrow: c.layoutGrow,
          layoutAlign: c.layoutAlign,
          layoutSizingHorizontal: c.layoutSizingHorizontal,
          layoutSizingVertical: c.layoutSizingVertical,
        }))
      : [],
  };
}

export function restoreLayoutSnapshot(
  node: AnyNode,
  snap: Record<string, unknown>,
): void {
  node.layoutMode = snap.layoutMode;
  node.itemSpacing = snap.itemSpacing;
  node.paddingLeft = snap.paddingLeft;
  node.paddingRight = snap.paddingRight;
  node.paddingTop = snap.paddingTop;
  node.paddingBottom = snap.paddingBottom;
  node.primaryAxisAlignItems = snap.primaryAxisAlignItems;
  node.counterAxisAlignItems = snap.counterAxisAlignItems;
  node.isRelative = snap.isRelative;
  node.layoutWrap = snap.layoutWrap;
  node.primaryAxisSizingMode = snap.primaryAxisSizingMode;
  node.counterAxisSizingMode = snap.counterAxisSizingMode;
  const childSnaps = snap.children as Array<Record<string, unknown>>;
  const order = snap.childOrder as string[];
  if (!Array.isArray(node.children) || !Array.isArray(childSnaps)) return;
  const byId = new Map(node.children.map((c: AnyNode) => [String(c.id), c]));
  const fieldById = new Map(childSnaps.map((c) => [String(c.id), c]));
  for (const child of node.children) {
    const s = fieldById.get(String(child.id));
    if (!s) continue;
    child.x = s.x;
    child.y = s.y;
    child.width = s.width;
    child.height = s.height;
    child.layoutPositioning = s.layoutPositioning;
    child.layoutGrow = s.layoutGrow;
    child.layoutAlign = s.layoutAlign;
    child.layoutSizingHorizontal = s.layoutSizingHorizontal;
    child.layoutSizingVertical = s.layoutSizingVertical;
  }
  if (Array.isArray(order) && order.length > 0) {
    const next: AnyNode[] = [];
    for (const id of order) {
      const c = byId.get(id);
      if (c) next.push(c);
    }
    for (const c of node.children) {
      if (!order.includes(String(c.id))) next.push(c);
    }
    node.children = next;
  }
}
