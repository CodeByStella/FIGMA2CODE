/** Shared geometry, tolerances, and band-splitting for tidy inference. */

export const ALIGN_EPS = 2;
export const GAP_EPS = 4;
export const OVERLAP_AREA_RATIO = 0.3;
export const BG_COVER_RATIO = 0.85;
export const COUNTER_OVERLAP_RATIO = 0.5;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const rectRight = (r: Rect) => r.x + r.width;
export const rectBottom = (r: Rect) => r.y + r.height;
export const rectCenterX = (r: Rect) => r.x + r.width / 2;
export const rectCenterY = (r: Rect) => r.y + r.height / 2;
export const rectArea = (r: Rect) =>
  Math.max(0, r.width) * Math.max(0, r.height);

export function roundPx(n: number): number {
  return Math.round(n);
}

export function nearlyEqual(a: number, b: number, eps = ALIGN_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function intervalOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = intervalOverlap(a.x, rectRight(a), b.x, rectRight(b));
  const h = intervalOverlap(a.y, rectBottom(a), b.y, rectBottom(b));
  return w * h;
}

export function overlapRatioOfMin(a: Rect, b: Rect): number {
  const minA = Math.min(rectArea(a), rectArea(b));
  if (minA <= 0) return 0;
  return overlapArea(a, b) / minA;
}

/** Counter-axis overlap ratio vs the smaller extent on that axis. */
export function counterOverlapRatio(
  a: Rect,
  b: Rect,
  axis: "HORIZONTAL" | "VERTICAL",
): number {
  if (axis === "HORIZONTAL") {
    // Primary axis is X; counter-axis overlap is measured on Y.
    const o = intervalOverlap(a.y, rectBottom(a), b.y, rectBottom(b));
    const m = Math.min(a.height, b.height);
    return m <= 0 ? 0 : o / m;
  }
  const o = intervalOverlap(a.x, rectRight(a), b.x, rectRight(b));
  const m = Math.min(a.width, b.width);
  return m <= 0 ? 0 : o / m;
}

export function coversParent(
  child: Rect,
  parent: Rect,
  ratio = BG_COVER_RATIO,
): boolean {
  if (parent.width <= 0 || parent.height <= 0) return false;
  const coverW = intervalOverlap(child.x, rectRight(child), 0, parent.width);
  const coverH = intervalOverlap(child.y, rectBottom(child), 0, parent.height);
  return (coverW * coverH) / (parent.width * parent.height) >= ratio;
}

export function containsPoint(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= rectRight(r) && py >= r.y && py <= rectBottom(r);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function consecutiveGaps(
  rects: Rect[],
  axis: "HORIZONTAL" | "VERTICAL",
): number[] {
  if (rects.length < 2) return [];
  const sorted = [...rects].sort((a, b) =>
    axis === "HORIZONTAL" ? a.x - b.x : a.y - b.y,
  );
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const gap =
      axis === "HORIZONTAL"
        ? next.x - rectRight(prev)
        : next.y - rectBottom(prev);
    gaps.push(gap);
  }
  return gaps;
}

export type ChildGeom = {
  node: SceneNode;
  index: number;
  rect: Rect;
  /** Layout width/height when available — preferred over bbox for padding/gap inference. */
  layoutW: number;
  layoutH: number;
  layoutX: number;
  layoutY: number;
};

export function parentLocalRect(node: SceneNode): Rect {
  const w = "width" in node ? (node as LayoutMixin).width : 0;
  const h = "height" in node ? (node as LayoutMixin).height : 0;
  return { x: 0, y: 0, width: w, height: h };
}

export function childGeom(
  child: SceneNode,
  index: number,
  parentAbs: Rect | null,
): ChildGeom | null {
  if (!("absoluteBoundingBox" in child) || !child.absoluteBoundingBox) {
    if ("x" in child && "width" in child) {
      const lm = child as LayoutMixin;
      return {
        node: child,
        index,
        rect: { x: lm.x, y: lm.y, width: lm.width, height: lm.height },
        layoutW: lm.width,
        layoutH: lm.height,
        layoutX: lm.x,
        layoutY: lm.y,
      };
    }
    return null;
  }
  const box = child.absoluteBoundingBox;
  let x = box.x;
  let y = box.y;
  if (parentAbs) {
    x -= parentAbs.x;
    y -= parentAbs.y;
  }
  const layoutW = "width" in child ? (child as LayoutMixin).width : box.width;
  const layoutH =
    "height" in child ? (child as LayoutMixin).height : box.height;
  const layoutX = "x" in child ? (child as LayoutMixin).x : x;
  const layoutY = "y" in child ? (child as LayoutMixin).y : y;
  return {
    node: child,
    index,
    rect: { x, y, width: box.width, height: box.height },
    layoutW,
    layoutH,
    layoutX,
    layoutY,
  };
}

export function parentAbsRect(node: SceneNode): Rect | null {
  if (!("absoluteBoundingBox" in node) || !node.absoluteBoundingBox)
    return null;
  const b = node.absoluteBoundingBox;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/**
 * Group flow items into row/column bands by counter-axis overlap.
 * Requires primary-axis overlap too — counter-aligned but separated items start a new band.
 */
export function bandSplit(
  items: ChildGeom[],
  /** VERTICAL = horizontal row bands stacked by Y; HORIZONTAL = vertical column bands stacked by X. */
  bandAxis: "HORIZONTAL" | "VERTICAL",
): ChildGeom[][] {
  if (items.length === 0) return [];
  const counter: "HORIZONTAL" | "VERTICAL" =
    bandAxis === "VERTICAL" ? "HORIZONTAL" : "VERTICAL";

  const sorted = [...items].sort((a, b) =>
    bandAxis === "VERTICAL" ? a.rect.y - b.rect.y : a.rect.x - b.rect.x,
  );

  const bands: ChildGeom[][] = [];
  let current: ChildGeom[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const overlapsBand = current.some(
      (c) =>
        counterOverlapRatio(c.rect, item.rect, counter) >=
        COUNTER_OVERLAP_RATIO,
    );
    // Counter-axis overlap alone is insufficient — items must also overlap on the band axis.
    const primaryOverlap = current.some((c) => {
      if (bandAxis === "VERTICAL") {
        return (
          intervalOverlap(
            c.rect.y,
            rectBottom(c.rect),
            item.rect.y,
            rectBottom(item.rect),
          ) > ALIGN_EPS
        );
      }
      return (
        intervalOverlap(
          c.rect.x,
          rectRight(c.rect),
          item.rect.x,
          rectRight(item.rect),
        ) > ALIGN_EPS
      );
    });

    if (overlapsBand && primaryOverlap) {
      current.push(item);
    } else if (overlapsBand) {
      bands.push(current);
      current = [item];
    } else {
      bands.push(current);
      current = [item];
    }
  }
  bands.push(current);

  // Order within each band follows the flow direction (left-to-right or top-to-bottom).
  for (const band of bands) {
    band.sort((a, b) =>
      bandAxis === "VERTICAL" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
    );
  }
  return bands;
}

/** True when items form a non-overlapping stack along one axis — safe for direct Auto Layout. */
export function isCleanStack(
  items: ChildGeom[],
  axis: "HORIZONTAL" | "VERTICAL",
): boolean {
  if (items.length < 2) return true;
  const sorted = [...items].sort((a, b) =>
    axis === "HORIZONTAL" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const gap =
      axis === "HORIZONTAL"
        ? next.rect.x - rectRight(prev.rect)
        : next.rect.y - rectBottom(prev.rect);
    if (gap < -ALIGN_EPS) return false;
    if (
      counterOverlapRatio(prev.rect, next.rect, axis) < COUNTER_OVERLAP_RATIO
    ) {
      return false;
    }
  }
  return true;
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, rectRight(r));
    maxY = Math.max(maxY, rectBottom(r));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
