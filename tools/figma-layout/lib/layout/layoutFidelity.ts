import type { AlignAxis, Box } from "./geometry";
import { near } from "./geometry";

export type SimulatedChild = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FlexPlan = {
  direction: "HORIZONTAL" | "VERTICAL";
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  itemSpacing: number;
  primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems: AlignAxis;
  /** Flow children in primary-axis order (absolute decorations omitted). */
  flow: Box[];
  /** Absolute decorations keep original x/y. */
  absolute: Box[];
  parentW: number;
  parentH: number;
};

/**
 * Simulate Figma-like auto-layout packing for a single parent.
 * Enough for fidelity checks on inferred row/column stacks.
 */
export function simulateFlexPositions(plan: FlexPlan): SimulatedChild[] {
  const {
    direction,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingBottom,
    itemSpacing,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    flow,
    absolute,
    parentW,
    parentH,
  } = plan;

  const out: SimulatedChild[] = [];

  if (flow.length === 0) {
    for (const b of absolute) {
      out.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
    }
    return out;
  }

  const contentW = parentW - paddingLeft - paddingRight;
  const contentH = parentH - paddingTop - paddingBottom;
  const totalChildMain =
    direction === "HORIZONTAL"
      ? flow.reduce((s, b) => s + b.w, 0)
      : flow.reduce((s, b) => s + b.h, 0);
  const gapCount = Math.max(0, flow.length - 1);

  let cursorMain = direction === "HORIZONTAL" ? paddingLeft : paddingTop;

  let spaceBetweenExtra = 0;
  if (primaryAxisAlignItems === "SPACE_BETWEEN" && gapCount > 0) {
    const free =
      (direction === "HORIZONTAL" ? contentW : contentH) - totalChildMain;
    spaceBetweenExtra = Math.max(0, free / gapCount);
  } else if (primaryAxisAlignItems === "CENTER") {
    const used = totalChildMain + itemSpacing * gapCount;
    const free = (direction === "HORIZONTAL" ? contentW : contentH) - used;
    cursorMain += Math.max(0, free / 2);
  } else if (primaryAxisAlignItems === "MAX") {
    const used = totalChildMain + itemSpacing * gapCount;
    const free = (direction === "HORIZONTAL" ? contentW : contentH) - used;
    cursorMain += Math.max(0, free);
  }

  for (let i = 0; i < flow.length; i++) {
    const b = flow[i];
    let x: number;
    let y: number;

    if (direction === "HORIZONTAL") {
      x = cursorMain;
      if (counterAxisAlignItems === "CENTER") {
        y = paddingTop + (contentH - b.h) / 2;
      } else if (counterAxisAlignItems === "MAX") {
        y = parentH - paddingBottom - b.h;
      } else {
        y = paddingTop;
      }
      cursorMain +=
        b.w +
        (i < flow.length - 1
          ? primaryAxisAlignItems === "SPACE_BETWEEN"
            ? spaceBetweenExtra
            : itemSpacing
          : 0);
    } else {
      y = cursorMain;
      if (counterAxisAlignItems === "CENTER") {
        x = paddingLeft + (contentW - b.w) / 2;
      } else if (counterAxisAlignItems === "MAX") {
        x = parentW - paddingRight - b.w;
      } else {
        x = paddingLeft;
      }
      cursorMain +=
        b.h +
        (i < flow.length - 1
          ? primaryAxisAlignItems === "SPACE_BETWEEN"
            ? spaceBetweenExtra
            : itemSpacing
          : 0);
    }

    out.push({ id: b.id, x, y, w: b.w, h: b.h });
  }

  for (const b of absolute) {
    out.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
  }

  return out;
}

export function maxPositionDelta(
  original: Box[],
  simulated: SimulatedChild[],
): number {
  const byId = new Map(simulated.map((s) => [s.id, s]));
  let max = 0;
  for (const o of original) {
    const s = byId.get(o.id);
    if (!s) continue;
    max = Math.max(
      max,
      Math.abs(s.x - o.x),
      Math.abs(s.y - o.y),
      Math.abs(s.w - o.w),
      Math.abs(s.h - o.h),
    );
  }
  return max;
}

export function passesFidelity(
  original: Box[],
  simulated: SimulatedChild[],
  thresholdPx: number,
): boolean {
  return maxPositionDelta(original, simulated) <= thresholdPx + 1e-6;
}

/** Unused import guard-friendly re-export for callers that check near in tests. */
export { near };
