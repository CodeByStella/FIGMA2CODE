import {
  AnyNode,
  Box,
  DEFAULT_THRESHOLD_PX,
  near,
  nodeBox,
  visibleChildren,
  snapshotLayoutFields,
  restoreLayoutSnapshot,
  maxAbsDiff,
  median,
} from "./geometry";
import {
  FlexPlan,
  simulateFlexPositions,
  passesFidelity,
} from "./layoutFidelity";

const FULL_BLEED_RATIO = 0.85;

/**
 * Stack artboard / page-level children top-to-bottom in DOM order with
 * vertical Auto Layout, gaps from Y spacing, and overflow padding for
 * content that extends above the frame (e.g. hero at negative y).
 *
 * Narrow overlapping layers stay absolute decorations.
 */
export function inferPageSectionStack(
  node: AnyNode,
  thresholdPx: number = DEFAULT_THRESHOLD_PX,
): boolean {
  const kids = visibleChildren(node);
  if (kids.length < 2) return false;

  const mode = node.layoutMode;
  // Allow re-stacking freeform pages; skip tight designer auto-layout that
  // already looks like a component row/column (short parents).
  if (mode === "HORIZONTAL") return false;
  if (mode === "VERTICAL" && (node.height ?? 0) < 800) return false;

  const parentW = Number(node.width) || 0;
  const parentH = Number(node.height) || 0;
  if (parentW <= 0 || parentH <= 0) return false;

  // Page-like: tall frame or several large siblings
  const boxes: Box[] = [];
  for (const child of kids) {
    const b = nodeBox(child);
    if (b) boxes.push(b);
  }
  if (boxes.length < 2) return false;

  const largeCount = boxes.filter(
    (b) => b.w >= parentW * FULL_BLEED_RATIO || b.h >= 200,
  ).length;
  if (parentH < 800 && largeCount < 3) return false;

  const snap = snapshotLayoutFields(node);

  // Sort visually top → bottom for DOM order
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);

  const minY = Math.min(...boxes.map((b) => b.y));
  const overflowTop = Math.max(0, -minY);

  // Shift into non-negative space for packing math
  const shifted = boxes.map((b) => ({
    ...b,
    y: b.y + overflowTop,
    cy: b.cy + overflowTop,
    bottom: b.bottom + overflowTop,
  }));

  const { flow, absolute } = classifyPageSections(
    shifted,
    parentW,
    thresholdPx,
  );
  if (flow.length < 2) {
    // Still reorder DOM by Y and apply overflow padding for absolute page
    reorderChildrenByY(node, boxes);
    if (overflowTop > 0) {
      applyOverflowPadding(node, boxes, overflowTop);
    }
    return overflowTop > 0;
  }

  const plan = buildSectionPlan(
    parentW,
    parentH,
    overflowTop,
    flow,
    absolute,
    thresholdPx,
  );

  const tryApply = (p: FlexPlan, spacers: AnyNode[] = []): boolean => {
    applySectionPlan(node, p, overflowTop, spacers);
    const simulated = simulateFlexPositions(p);
    const checkBoxes = [...p.flow, ...absolute];
    if (passesFidelity(checkBoxes, simulated, thresholdPx + 1)) return true;
    restoreLayoutSnapshot(node, snap);
    return false;
  };

  if (plan && tryApply(plan)) {
    return true;
  }

  // Uneven section gaps → spacer nodes between sections
  const spaced = buildSectionPlanWithSpacers(
    parentW,
    parentH,
    overflowTop,
    flow,
    absolute,
    thresholdPx,
  );
  if (spaced && tryApply(spaced.plan, spaced.spacers)) {
    return true;
  }

  restoreLayoutSnapshot(node, snap);
  reorderChildrenByY(node, boxes);
  if (overflowTop > 0) applyOverflowPadding(node, boxes, overflowTop);
  return overflowTop > 0;
}

function classifyPageSections(
  boxes: Box[],
  parentW: number,
  t: number,
): { flow: Box[]; absolute: Box[] } {
  const absoluteIds = new Set<string>();

  const isFullBleedSection = (b: Box) =>
    b.w >= parentW * FULL_BLEED_RATIO &&
    (b.node.type === "FRAME" ||
      b.node.type === "INSTANCE" ||
      b.node.type === "COMPONENT");

  // Full-bleed frames are the section spine
  const sections = boxes.filter(isFullBleedSection);

  for (const b of boxes) {
    if (isFullBleedSection(b)) continue;

    // Overlaps a section band → decoration (hero art, floating groups)
    let overlapsSection = false;
    for (const s of sections) {
      const overlapY = Math.min(b.bottom, s.bottom) - Math.max(b.y, s.y);
      if (overlapY > t) {
        overlapsSection = true;
        break;
      }
    }

    if (overlapsSection || b.w < parentW * FULL_BLEED_RATIO) {
      // Keep non-overlapping mid-width blocks in flow only if they don't
      // intersect any section (standalone bands).
      if (overlapsSection || b.h < 160 || b.node.type === "GROUP") {
        absoluteIds.add(b.id);
      }
    }
  }

  // Small frames overlapping sections (e.g. floating chips) → absolute
  for (const b of boxes) {
    if (absoluteIds.has(b.id) || !isFullBleedSection(b)) continue;
    // keep sections
  }

  // Nav-sized full-bleed is still a section (short header) — keep in flow

  let flow = boxes.filter((b) => !absoluteIds.has(b.id));
  const absolute = boxes.filter((b) => absoluteIds.has(b.id));

  if (flow.length < 2) {
    // Fall back: all full-bleed + anything else large
    flow = boxes
      .filter(
        (b) => isFullBleedSection(b) || (b.h >= 200 && !absoluteIds.has(b.id)),
      )
      .sort((a, b) => a.y - b.y);
    if (flow.length < 2) {
      flow = [...boxes].sort((a, b) => a.y - b.y);
      return { flow, absolute: [] };
    }
    return {
      flow,
      absolute: boxes.filter((b) => !flow.some((f) => f.id === b.id)),
    };
  }

  return { flow: flow.sort((a, b) => a.y - b.y), absolute };
}

function buildSectionPlan(
  parentW: number,
  parentH: number,
  overflowTop: number,
  flow: Box[],
  absolute: Box[],
  t: number,
): FlexPlan | null {
  const gaps: number[] = [];
  for (let i = 0; i < flow.length - 1; i++) {
    gaps.push(flow[i + 1].y - flow[i].bottom);
  }

  // Overlapping consecutive sections → 0 gap (visual overlap ok for hero)
  const normGaps = gaps.map((g) => Math.max(0, g));
  const gapSpread = maxAbsDiff(normGaps);
  const gapMed = median(normGaps);

  const first = flow[0];
  const last = flow[flow.length - 1];

  const paddingTop = Math.max(0, first.y); // includes overflow shift
  const paddingBottom = Math.max(0, parentH + overflowTop - last.bottom);
  const paddingLeft = Math.max(0, Math.min(...flow.map((b) => b.x)));
  const paddingRight = Math.max(
    0,
    Math.min(...flow.map((b) => parentW - b.right)),
  );

  // Cross-axis: center if sections are roughly centered
  const centers = flow.map((b) => b.cx);
  const parentCx = parentW / 2;
  const centered = centers.every((c) => near(c, parentCx, Math.max(t, 24)));
  const counterAxisAlignItems = centered
    ? "CENTER"
    : paddingLeft <= t
      ? "MIN"
      : "MIN";

  let itemSpacing = 0;
  let primaryAxisAlignItems: FlexPlan["primaryAxisAlignItems"] = "MIN";

  if (gapSpread <= Math.max(t, 8)) {
    itemSpacing = gapMed;
  } else {
    // Uneven gaps — caller may retry with spacers; use median as first attempt
    itemSpacing = gapMed;
    if (gapSpread > 80) return null;
  }

  return {
    direction: "VERTICAL",
    paddingLeft: round2(
      centered ? Math.min(paddingLeft, paddingRight) : paddingLeft,
    ),
    paddingRight: round2(
      centered ? Math.min(paddingLeft, paddingRight) : paddingRight,
    ),
    paddingTop: round2(paddingTop),
    paddingBottom: round2(Math.max(0, paddingBottom - overflowTop)),
    itemSpacing: round2(itemSpacing),
    primaryAxisAlignItems,
    counterAxisAlignItems,
    flow,
    absolute,
    parentW,
    parentH: parentH + overflowTop,
  };
}

function buildSectionPlanWithSpacers(
  parentW: number,
  parentH: number,
  overflowTop: number,
  flow: Box[],
  absolute: Box[],
  t: number,
): { plan: FlexPlan; spacers: AnyNode[] } | null {
  const spacers: AnyNode[] = [];
  const flowWithSpacers: Box[] = [];

  for (let i = 0; i < flow.length; i++) {
    flowWithSpacers.push(flow[i]);
    if (i >= flow.length - 1) continue;
    const gap = Math.max(0, flow[i + 1].y - flow[i].bottom);
    if (gap <= t) continue;

    const spacerNode = makeSpacerNode(gap, parentW);
    spacers.push(spacerNode);
    const sb = nodeBox(spacerNode);
    if (!sb) continue;
    // Place spacer box where the gap is for simulation
    const placed: Box = {
      ...sb,
      x: 0,
      y: flow[i].bottom,
      cy: flow[i].bottom + gap / 2,
      right: sb.w,
      bottom: flow[i].bottom + gap,
      node: spacerNode,
    };
    // Fix spacer node y for absolute-free flex (AUTO)
    spacerNode.x = 0;
    spacerNode.y = 0;
    spacerNode.width = Math.max(1, parentW);
    spacerNode.height = gap;
    flowWithSpacers.push(placed);
  }

  const first = flowWithSpacers[0];
  const last = flowWithSpacers[flowWithSpacers.length - 1];
  const paddingTop = Math.max(0, first.y);
  const paddingBottom = Math.max(0, parentH + overflowTop - last.bottom);
  const paddingLeft = Math.max(0, Math.min(...flow.map((b) => b.x)));
  const paddingRight = Math.max(
    0,
    Math.min(...flow.map((b) => parentW - b.right)),
  );

  // Rebuild flow boxes with y packed from paddingTop for simulation:
  // simulateFlexPositions packs from padding — so set flow y to expected
  // by using itemSpacing 0 and heights only. Override flow boxes to use
  // sequential packing origins matching heights.
  let cursor = paddingTop;
  const packedFlow: Box[] = flowWithSpacers.map((b) => {
    const nb: Box = {
      ...b,
      x: paddingLeft,
      y: cursor,
      cy: cursor + b.h / 2,
      right: paddingLeft + b.w,
      bottom: cursor + b.h,
    };
    cursor += b.h;
    return nb;
  });

  const plan: FlexPlan = {
    direction: "VERTICAL",
    paddingLeft: round2(paddingLeft),
    paddingRight: round2(paddingRight),
    paddingTop: round2(paddingTop),
    paddingBottom: round2(Math.max(0, paddingBottom - overflowTop)),
    itemSpacing: 0,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    flow: packedFlow,
    absolute,
    parentW,
    parentH: parentH + overflowTop,
  };

  return { plan, spacers };
}

function makeSpacerNode(height: number, parentW: number): AnyNode {
  const id = `spacer-${Math.round(height)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: "section-spacer",
    type: "RECTANGLE",
    visible: true,
    width: Math.max(1, parentW),
    height: Math.max(0, height),
    x: 0,
    y: 0,
    opacity: 0,
    fills: [],
    strokes: [],
    effects: [],
    layoutPositioning: "AUTO",
    layoutSizingHorizontal: "FILL",
    layoutSizingVertical: "FIXED",
    uniqueName: id,
    canBeFlattened: false,
    isRelative: false,
  };
}

function applySectionPlan(
  parent: AnyNode,
  plan: FlexPlan,
  overflowTop: number,
  spacers: AnyNode[] = [],
): void {
  parent.layoutMode = "VERTICAL";
  parent.itemSpacing = plan.itemSpacing;
  parent.paddingLeft = plan.paddingLeft;
  parent.paddingRight = plan.paddingRight;
  parent.paddingTop = plan.paddingTop;
  parent.paddingBottom = plan.paddingBottom;
  parent.primaryAxisAlignItems = plan.primaryAxisAlignItems;
  parent.counterAxisAlignItems = plan.counterAxisAlignItems;
  parent.isRelative = plan.absolute.length > 0 || overflowTop > 0;
  parent.layoutWrap = "NO_WRAP";
  parent.primaryAxisSizingMode = "FIXED";
  parent.counterAxisSizingMode = "FIXED";
  if (overflowTop > 0) {
    // Grow frame so shifted content fits; keep visual canvas
    parent.height = plan.parentH;
  }
  // Allow hero absolute to paint outside if needed
  (parent as AnyNode).clipsContent = false;

  const byId = new Map(
    (parent.children || []).map((c: AnyNode) => [String(c.id), c]),
  );

  const next: AnyNode[] = [];

  // Absolute decorations first (hero etc.) so they appear early in DOM,
  // sorted by original Y
  const absSorted = [...plan.absolute].sort((a, b) => a.y - b.y);
  for (const b of absSorted) {
    const n = byId.get(b.id);
    if (!n) continue;
    n.layoutPositioning = "ABSOLUTE";
    // Convert shifted coords back? plan absolute boxes are shifted —
    // store document coords relative to padded parent: y_shifted is
    // correct for CSS top inside padded flex container...
    // For absolute children, top is relative to padding edge of containing
    // block. With padding-top on parent, absolute positions are relative
    // to the padding box in CSS... actually absolute is relative to
    // padding edge of relative parent. So top should be original y
    // (unshifted) if parent wasn't height-expanded...
    // We shifted for flow math. For absolute: use shifted y so they
    // align with visual after overflow padding.
    n.x = b.x;
    n.y = b.y;
    next.push(n);
  }

  // Flow sections (+ spacers interleaved by packed order)
  const spacerById = new Map(spacers.map((s) => [String(s.id), s]));
  for (const b of plan.flow) {
    if (spacerById.has(b.id)) {
      next.push(spacerById.get(b.id)!);
      continue;
    }
    const n = byId.get(b.id);
    if (!n) continue;
    n.layoutPositioning = "AUTO";
    n.layoutGrow = 0;
    n.layoutAlign = "INHERIT";
    n.layoutSizingHorizontal =
      n.width >= plan.parentW * FULL_BLEED_RATIO ? "FILL" : "FIXED";
    n.layoutSizingVertical = "FIXED";
    next.push(n);
  }

  // Any leftovers
  for (const c of parent.children || []) {
    if (!next.includes(c)) next.push(c);
  }

  parent.children = next;
}

function reorderChildrenByY(parent: AnyNode, boxes: Box[]): void {
  if (!Array.isArray(parent.children)) return;
  const order = new Map(boxes.map((b, i) => [b.id, i]));
  parent.children = [...parent.children].sort((a, b) => {
    const ia = order.get(String(a.id));
    const ib = order.get(String(b.id));
    if (ia == null || ib == null) return 0;
    return ia - ib;
  });
  parent.isRelative = true;
  parent.layoutMode = "NONE";
}

function applyOverflowPadding(
  parent: AnyNode,
  boxes: Box[],
  overflowTop: number,
): void {
  // Shift children down and add top space conceptually via increasing
  // parent height; keep absolute positioning.
  for (const b of boxes) {
    b.node.y = b.y + overflowTop;
  }
  parent.height = Number(parent.height) + overflowTop;
  parent.isRelative = true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
