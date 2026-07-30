import {
  AnyNode,
  Box,
  AlignAxis,
  LayoutInferenceOptions,
  DEFAULT_THRESHOLD_PX,
  DEFAULT_OVERLAP_RATIO,
  DEFAULT_TINY_AREA_RATIO,
  near,
  median,
  maxAbsDiff,
  nodeBox,
  visibleChildren,
  overlapCoverage,
  sharedCrossAlign,
  consecutiveGaps,
  snapshotLayoutFields,
  restoreLayoutSnapshot,
} from "./geometry";
import {
  FlexPlan,
  simulateFlexPositions,
  passesFidelity,
} from "./layoutFidelity";

export type InferSemanticLayoutOptions = LayoutInferenceOptions & {
  /** When false, no-op. Default true. */
  enabled?: boolean;
};

type StackDirection = "HORIZONTAL" | "VERTICAL";

type Classification = {
  flow: Box[];
  absolute: Box[];
};

/**
 * Bottom-up: rewrite absolute sibling groups into Auto Layout fields
 * that htmlMain already understands (flex). Failed inferences revert.
 */
export function inferSemanticLayout(
  roots: AnyNode | AnyNode[],
  options: InferSemanticLayoutOptions = {},
): AnyNode[] {
  if (options.enabled === false) {
    return Array.isArray(roots) ? roots : [roots];
  }

  const thresholdPx = options.thresholdPx ?? DEFAULT_THRESHOLD_PX;
  const overlapRatio = options.overlapRatio ?? DEFAULT_OVERLAP_RATIO;
  const tinyAreaRatio = options.tinyAreaRatio ?? DEFAULT_TINY_AREA_RATIO;
  const list = Array.isArray(roots) ? roots : [roots];

  for (const root of list) {
    inferNode(root, { thresholdPx, overlapRatio, tinyAreaRatio });
  }

  return list;
}

function inferNode(
  node: AnyNode,
  opts: Required<
    Pick<
      LayoutInferenceOptions,
      "thresholdPx" | "overlapRatio" | "tinyAreaRatio"
    >
  >,
): void {
  const kids = visibleChildren(node);
  for (const child of kids) {
    inferNode(child, opts);
  }

  // Only rewrite freeform parents; keep designer Auto Layout.
  const mode = node.layoutMode;
  if (mode === "HORIZONTAL" || mode === "VERTICAL") return;
  if (kids.length < 2) return;

  const parentBox = nodeBox({
    ...node,
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
  });
  if (!parentBox || parentBox.w <= 0 || parentBox.h <= 0) return;

  const childBoxes: Box[] = [];
  for (const child of kids) {
    const b = nodeBox(child);
    if (b) childBoxes.push(b);
  }
  if (childBoxes.length < 2) return;

  const snap = snapshotLayoutFields(node);
  const classified = classifyFlowVsAbsolute(childBoxes, opts);
  if (classified.flow.length < 2) return;

  const stack = detectStack(classified.flow, opts.thresholdPx);
  if (!stack) return;

  const plan = buildFlexPlan(
    parentBox,
    stack.direction,
    stack.crossAlign,
    classified.flow,
    classified.absolute,
    opts.thresholdPx,
  );
  if (!plan) return;

  applyPlan(node, plan);

  const simulated = simulateFlexPositions(plan);
  const allOriginal = [...classified.flow, ...classified.absolute];
  if (!passesFidelity(allOriginal, simulated, opts.thresholdPx)) {
    restoreLayoutSnapshot(node, snap);
    // Keep freeform relative positioning
    node.layoutMode = "NONE";
    node.isRelative = true;
  }
}

function classifyFlowVsAbsolute(
  boxes: Box[],
  opts: {
    thresholdPx: number;
    overlapRatio: number;
    tinyAreaRatio: number;
  },
): Classification {
  const areas = boxes.map((b) => b.area).filter((a) => a > 0);
  const medArea = median(areas) || 1;

  const absoluteIds = new Set<string>();
  const sortedByArea = [...boxes].sort((a, b) => b.area - a.area);

  // Overlaps: smaller box on larger → decoration
  for (let i = 0; i < sortedByArea.length; i++) {
    const main = sortedByArea[i];
    if (absoluteIds.has(main.id)) continue;
    for (let j = i + 1; j < sortedByArea.length; j++) {
      const other = sortedByArea[j];
      if (absoluteIds.has(other.id)) continue;
      const cov = overlapCoverage(main, other);
      if (cov < opts.overlapRatio) continue;

      const deco = other.area <= main.area ? other : main;
      absoluteIds.add(deco.id);
    }
  }

  // Tiny vectors relative to siblings → decoration even without heavy overlap
  for (const b of boxes) {
    if (absoluteIds.has(b.id)) continue;
    if (b.node.type === "VECTOR" && b.area < medArea * opts.tinyAreaRatio) {
      absoluteIds.add(b.id);
    }
  }

  const flow = boxes.filter((b) => !absoluteIds.has(b.id));
  const absolute = boxes.filter((b) => absoluteIds.has(b.id));

  if (flow.length < 2) {
    return { flow: boxes, absolute: [] };
  }

  return { flow, absolute };
}

function detectStack(
  flow: Box[],
  t: number,
): { direction: StackDirection; crossAlign: AlignAxis } | null {
  const yAlign = sharedCrossAlign(flow, "y", t);
  const xAlign = sharedCrossAlign(flow, "x", t);

  // Prefer the axis with tighter shared cross-align; require primary order gaps ≥ -t
  const horizontalOk =
    yAlign != null && canOrderWithoutHeavyOverlap(flow, "HORIZONTAL", t);
  const verticalOk =
    xAlign != null && canOrderWithoutHeavyOverlap(flow, "VERTICAL", t);

  if (horizontalOk && verticalOk) {
    // Prefer the direction with more consistent gaps
    const hSorted = sortAlong(flow, "HORIZONTAL");
    const vSorted = sortAlong(flow, "VERTICAL");
    const hGaps = consecutiveGaps(hSorted, "HORIZONTAL");
    const vGaps = consecutiveGaps(vSorted, "VERTICAL");
    const hSpread = maxAbsDiff(hGaps);
    const vSpread = maxAbsDiff(vGaps);
    if (hSpread <= vSpread) {
      return { direction: "HORIZONTAL", crossAlign: yAlign! };
    }
    return { direction: "VERTICAL", crossAlign: xAlign! };
  }

  if (horizontalOk && yAlign) {
    return { direction: "HORIZONTAL", crossAlign: yAlign };
  }
  if (verticalOk && xAlign) {
    return { direction: "VERTICAL", crossAlign: xAlign };
  }
  return null;
}

function sortAlong(boxes: Box[], direction: StackDirection): Box[] {
  return [...boxes].sort((a, b) =>
    direction === "HORIZONTAL"
      ? a.x - b.x || a.y - b.y
      : a.y - b.y || a.x - b.x,
  );
}

function canOrderWithoutHeavyOverlap(
  flow: Box[],
  direction: StackDirection,
  t: number,
): boolean {
  const sorted = sortAlong(flow, direction);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    // Allow slight overlap up to threshold (designer pixel error)
    if (direction === "HORIZONTAL") {
      if (b.x + t < a.x) return false;
      // Primary centers should progress
      if (b.cx + t < a.cx && b.x + t < a.right) {
        // If heavily nested overlap, not a clean row
        if (overlapCoverage(a, b) > 0.5) return false;
      }
    } else {
      if (b.y + t < a.y) return false;
      if (b.cy + t < a.cy && b.y + t < a.bottom) {
        if (overlapCoverage(a, b) > 0.5) return false;
      }
    }
  }
  return true;
}

function buildFlexPlan(
  parent: Box,
  direction: StackDirection,
  crossAlign: AlignAxis,
  flowIn: Box[],
  absolute: Box[],
  t: number,
): FlexPlan | null {
  const flow = sortAlong(flowIn, direction);
  const gaps = consecutiveGaps(flow, direction);

  // Negative gaps beyond threshold → not a clean stack
  if (gaps.some((g) => g < -t)) return null;

  const gapSpread = maxAbsDiff(gaps.map((g) => Math.max(0, g)));
  const positiveGaps = gaps.map((g) => Math.max(0, g));
  const gapMed = median(positiveGaps);

  const first = flow[0];
  const last = flow[flow.length - 1];

  let paddingLeft: number;
  let paddingRight: number;
  let paddingTop: number;
  let paddingBottom: number;
  let primaryAxisAlignItems: FlexPlan["primaryAxisAlignItems"] = "MIN";
  let itemSpacing = 0;

  if (direction === "HORIZONTAL") {
    paddingLeft = Math.max(0, first.x);
    paddingRight = Math.max(0, parent.w - last.right);

    if (crossAlign === "MIN") {
      paddingTop = Math.max(0, Math.min(...flow.map((b) => b.y)));
      paddingBottom = Math.max(
        0,
        parent.h - Math.max(...flow.map((b) => b.bottom)),
      );
    } else if (crossAlign === "MAX") {
      paddingBottom = Math.max(
        0,
        Math.min(...flow.map((b) => parent.h - b.bottom)),
      );
      paddingTop = Math.max(0, Math.min(...flow.map((b) => b.y)));
    } else {
      paddingTop = Math.max(0, Math.min(...flow.map((b) => b.y)));
      paddingBottom = Math.max(
        0,
        Math.min(...flow.map((b) => parent.h - b.bottom)),
      );
    }

    const contentW = parent.w - paddingLeft - paddingRight;
    const totalW = flow.reduce((s, b) => s + b.w, 0);
    const free = contentW - totalW;

    if (
      gaps.length > 0 &&
      near(paddingLeft, 0, t) &&
      near(paddingRight, 0, t) &&
      gaps.every((g) => near(g, gaps[0], t)) &&
      free > t
    ) {
      primaryAxisAlignItems = "SPACE_BETWEEN";
      itemSpacing = 0;
    } else if (gapSpread <= t) {
      itemSpacing = Math.max(0, gapMed);
      primaryAxisAlignItems = "MIN";
    } else if (gapSpread <= t * 2) {
      itemSpacing = Math.max(0, gapMed);
    } else {
      return null;
    }
  } else {
    paddingTop = Math.max(0, first.y);
    paddingBottom = Math.max(0, parent.h - last.bottom);

    if (crossAlign === "MIN") {
      paddingLeft = Math.max(0, Math.min(...flow.map((b) => b.x)));
      paddingRight = Math.max(
        0,
        parent.w - Math.max(...flow.map((b) => b.right)),
      );
    } else if (crossAlign === "MAX") {
      paddingRight = Math.max(
        0,
        Math.min(...flow.map((b) => parent.w - b.right)),
      );
      paddingLeft = Math.max(0, Math.min(...flow.map((b) => b.x)));
    } else {
      paddingLeft = Math.max(0, Math.min(...flow.map((b) => b.x)));
      paddingRight = Math.max(
        0,
        Math.min(...flow.map((b) => parent.w - b.right)),
      );
    }

    const contentH = parent.h - paddingTop - paddingBottom;
    const totalH = flow.reduce((s, b) => s + b.h, 0);
    const free = contentH - totalH;

    if (
      gaps.length > 0 &&
      near(paddingTop, 0, t) &&
      near(paddingBottom, 0, t) &&
      gaps.every((g) => near(g, gaps[0], t)) &&
      free > t
    ) {
      primaryAxisAlignItems = "SPACE_BETWEEN";
      itemSpacing = 0;
    } else if (gapSpread <= t) {
      itemSpacing = Math.max(0, gapMed);
      primaryAxisAlignItems = "MIN";
    } else if (gapSpread <= t * 2) {
      itemSpacing = Math.max(0, gapMed);
    } else {
      return null;
    }
  }

  // Round paddings/gaps for stable CSS
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    direction,
    paddingLeft: round(paddingLeft),
    paddingRight: round(paddingRight),
    paddingTop: round(paddingTop),
    paddingBottom: round(paddingBottom),
    itemSpacing: round(itemSpacing),
    primaryAxisAlignItems,
    counterAxisAlignItems: crossAlign,
    flow,
    absolute,
    parentW: parent.w,
    parentH: parent.h,
  };
}

function applyPlan(parent: AnyNode, plan: FlexPlan): void {
  parent.layoutMode = plan.direction;
  parent.itemSpacing = plan.itemSpacing;
  parent.paddingLeft = plan.paddingLeft;
  parent.paddingRight = plan.paddingRight;
  parent.paddingTop = plan.paddingTop;
  parent.paddingBottom = plan.paddingBottom;
  parent.primaryAxisAlignItems = plan.primaryAxisAlignItems;
  parent.counterAxisAlignItems = plan.counterAxisAlignItems;
  parent.isRelative = plan.absolute.length > 0;
  parent.layoutWrap = "NO_WRAP";
  parent.primaryAxisSizingMode = "FIXED";
  parent.counterAxisSizingMode = "FIXED";

  const flowIds = new Set(plan.flow.map((b) => b.id));
  const absIds = new Set(plan.absolute.map((b) => b.id));

  // Reorder children: flow in order, then absolutes (preserve relative paint order roughly)
  if (Array.isArray(parent.children)) {
    const byId = new Map(
      parent.children.map((c: AnyNode) => [String(c.id), c]),
    );
    const next: AnyNode[] = [];
    for (const b of plan.flow) {
      const n = byId.get(b.id);
      if (n) next.push(n);
    }
    for (const b of plan.absolute) {
      const n = byId.get(b.id);
      if (n) next.push(n);
    }
    // Append any children missing from boxes (no geometry)
    for (const c of parent.children) {
      const id = String(c.id);
      if (!flowIds.has(id) && !absIds.has(id)) next.push(c);
    }
    parent.children = next;
  }

  for (const b of plan.flow) {
    const n = b.node;
    delete n.layoutPositioning;
    n.layoutPositioning = "AUTO";
    n.layoutGrow = 0;
    n.layoutAlign = "INHERIT";
    n.layoutSizingHorizontal = "FIXED";
    n.layoutSizingVertical = "FIXED";
  }

  for (const b of plan.absolute) {
    const n = b.node;
    n.layoutPositioning = "ABSOLUTE";
    // Keep original x/y relative to parent
    n.x = b.x;
    n.y = b.y;
  }
}
