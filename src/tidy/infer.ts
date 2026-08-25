/** Walks the clone tree and builds a TidyPlan (Auto Layout specs, wrappers, group conversions). */

import {
  ALIGN_EPS,
  ChildGeom,
  GAP_EPS,
  Rect,
  bandSplit,
  childGeom,
  consecutiveGaps,
  isCleanStack,
  median,
  nearlyEqual,
  parentAbsRect,
  parentLocalRect,
  rectBottom,
  rectCenterX,
  rectCenterY,
  rectRight,
  roundPx,
  stddev,
  unionRect,
} from "./geometry";
import {
  canHaveChildren,
  classifyChildren,
  isAutoLayoutFrame,
  isLeafType,
  isPlainFillShape,
  parentHasFills,
} from "./classify";
import type {
  AlignCounter,
  AlignPrimary,
  AutoLayoutSpec,
  ChildAlign,
  ChildSizingSpec,
  FrameTidySpec,
  TidyPlan,
  WrapperSpec,
} from "./types";
import { tidyWarn } from "./warnings";

let wrapperKeyCounter = 0;
function nextWrapperKey(): string {
  wrapperKeyCounter += 1;
  return `__tidy_wrap_${wrapperKeyCounter}`;
}

function collectChildrenGeom(parent: SceneNode & ChildrenMixin): ChildGeom[] {
  const pAbs = parentAbsRect(parent);
  const out: ChildGeom[] = [];
  parent.children.forEach((child, index) => {
    if (child.type === "SLICE") return;
    const g = childGeom(child, index, pAbs);
    if (g) out.push(g);
  });
  return out;
}

function constraintHints(node: SceneNode): {
  preferFillH: boolean;
  preferFillV: boolean;
  preferCenterH: boolean;
  preferCenterV: boolean;
} {
  if (!("constraints" in node)) {
    return {
      preferFillH: false,
      preferFillV: false,
      preferCenterH: false,
      preferCenterV: false,
    };
  }
  const c = (node as ConstraintMixin).constraints;
  return {
    preferFillH: c.horizontal === "STRETCH" || c.horizontal === "SCALE",
    preferFillV: c.vertical === "STRETCH" || c.vertical === "SCALE",
    preferCenterH: c.horizontal === "CENTER",
    preferCenterV: c.vertical === "CENTER",
  };
}

function childSizingFor(
  item: ChildGeom,
  contentBox: Rect,
  _axis: "HORIZONTAL" | "VERTICAL" | null,
): ChildSizingSpec {
  // Convert always needs FIXED boxes — HUG/FILL reflows and shifts pixels away from the design.
  void contentBox;
  return {
    nodeId: item.node.id,
    horizontal: "FIXED",
    vertical: "FIXED",
    layoutAlign: "MIN",
  };
}

function inferCounterAlign(
  items: ChildGeom[],
  contentBox: Rect,
  axis: "HORIZONTAL" | "VERTICAL",
): { parent: AlignCounter; perChild: Map<string, ChildAlign> } {
  const perChild = new Map<string, ChildAlign>();
  if (items.length === 0) {
    return { parent: "MIN", perChild };
  }

  const starts: number[] = [];
  const centers: number[] = [];
  const ends: number[] = [];
  let allStretch = true;

  for (const item of items) {
    if (axis === "HORIZONTAL") {
      // Counter-axis is Y when the primary flow is horizontal.
      starts.push(item.rect.y);
      centers.push(rectCenterY(item.rect));
      ends.push(rectBottom(item.rect));
      if (!nearlyEqual(item.layoutH, contentBox.height, ALIGN_EPS * 2)) {
        allStretch = false;
      }
    } else {
      starts.push(item.rect.x);
      centers.push(rectCenterX(item.rect));
      ends.push(rectRight(item.rect));
      if (!nearlyEqual(item.layoutW, contentBox.width, ALIGN_EPS * 2)) {
        allStretch = false;
      }
    }
  }

  if (allStretch) {
    for (const item of items) perChild.set(item.node.id, "STRETCH");
    return { parent: "MIN", perChild };
  }

  const startSame = starts.every((s) => nearlyEqual(s, starts[0]));
  const endSame = ends.every((e) => nearlyEqual(e, ends[0]));
  const centerSame = centers.every((c) => nearlyEqual(c, centers[0]));

  // Text+icon rows may align on baseline instead of box edges.
  if (
    axis === "HORIZONTAL" &&
    items.every(
      (i) =>
        i.node.type === "TEXT" ||
        i.node.type === "INSTANCE" ||
        i.node.type === "VECTOR" ||
        i.node.type === "ELLIPSE" ||
        i.node.type === "RECTANGLE",
    ) &&
    items.some((i) => i.node.type === "TEXT")
  ) {
    const textHeights = items
      .filter((i) => i.node.type === "TEXT")
      .map((i) => i.layoutH);
    const iconish = items.filter((i) => i.node.type !== "TEXT");
    if (
      textHeights.length > 0 &&
      iconish.every((i) =>
        nearlyEqual(i.layoutH, median(textHeights), ALIGN_EPS * 3),
      )
    ) {
      return { parent: "BASELINE", perChild };
    }
  }

  if (startSame && !endSame) return { parent: "MIN", perChild };
  if (endSame && !startSame) return { parent: "MAX", perChild };
  if (centerSame) return { parent: "CENTER", perChild };

  // Per-child alignment when siblings disagree — constraints and position hints break ties.
  for (const item of items) {
    const hints = constraintHints(item.node);
    if (axis === "HORIZONTAL") {
      if (nearlyEqual(item.layoutH, contentBox.height, ALIGN_EPS * 2)) {
        perChild.set(item.node.id, "STRETCH");
      } else if (
        hints.preferCenterV ||
        nearlyEqual(
          rectCenterY(item.rect),
          contentBox.y + contentBox.height / 2,
        )
      ) {
        perChild.set(item.node.id, "CENTER");
      } else if (
        nearlyEqual(rectBottom(item.rect), contentBox.y + contentBox.height)
      ) {
        perChild.set(item.node.id, "MAX");
      } else {
        perChild.set(item.node.id, "MIN");
      }
    } else {
      if (nearlyEqual(item.layoutW, contentBox.width, ALIGN_EPS * 2)) {
        perChild.set(item.node.id, "STRETCH");
      } else if (
        hints.preferCenterH ||
        nearlyEqual(rectCenterX(item.rect), contentBox.x + contentBox.width / 2)
      ) {
        perChild.set(item.node.id, "CENTER");
      } else if (
        nearlyEqual(rectRight(item.rect), contentBox.x + contentBox.width)
      ) {
        perChild.set(item.node.id, "MAX");
      } else {
        perChild.set(item.node.id, "MIN");
      }
    }
  }
  return { parent: "MIN", perChild };
}

function inferPrimaryMetrics(
  items: ChildGeom[],
  parentRect: Rect,
  axis: "HORIZONTAL" | "VERTICAL",
): {
  padding: { left: number; right: number; top: number; bottom: number };
  itemSpacing: number;
  primaryAlign: AlignPrimary;
  contentBox: Rect;
} {
  const sorted = [...items].sort((a, b) =>
    axis === "HORIZONTAL" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  );

  let padL = Infinity;
  let padT = Infinity;
  let padR = Infinity;
  let padB = Infinity;
  for (const item of sorted) {
    padL = Math.min(padL, item.rect.x);
    padT = Math.min(padT, item.rect.y);
    padR = Math.min(padR, parentRect.width - rectRight(item.rect));
    padB = Math.min(padB, parentRect.height - rectBottom(item.rect));
  }
  if (!Number.isFinite(padL)) padL = 0;
  if (!Number.isFinite(padT)) padT = 0;
  if (!Number.isFinite(padR)) padR = 0;
  if (!Number.isFinite(padB)) padB = 0;
  padL = Math.max(0, roundPx(padL));
  padT = Math.max(0, roundPx(padT));
  padR = Math.max(0, roundPx(padR));
  padB = Math.max(0, roundPx(padB));

  const gaps = consecutiveGaps(
    sorted.map((s) => s.rect),
    axis,
  ).map((g) => (g < 0 && g >= -ALIGN_EPS ? 0 : g));

  let itemSpacing = 0;
  let primaryAlign: AlignPrimary = "MIN";

  const positiveGaps = gaps.filter((g) => g >= 0);
  if (positiveGaps.length > 0 && positiveGaps.every((g) => g >= -ALIGN_EPS)) {
    const med = median(positiveGaps.map((g) => Math.max(0, g)));
    const sd = stddev(positiveGaps.map((g) => Math.max(0, g)));

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const startInset = axis === "HORIZONTAL" ? first.rect.x : first.rect.y;
    const endInset =
      axis === "HORIZONTAL"
        ? parentRect.width - rectRight(last.rect)
        : parentRect.height - rectBottom(last.rect);

    const hugsEdges = startInset <= ALIGN_EPS * 2 && endInset <= ALIGN_EPS * 2;
    const gapsVary = sd > GAP_EPS;

    if (hugsEdges && gapsVary && sorted.length >= 2) {
      primaryAlign = "SPACE_BETWEEN";
      itemSpacing = 0;
      padL = axis === "HORIZONTAL" ? 0 : padL;
      padR = axis === "HORIZONTAL" ? 0 : padR;
      padT = axis === "VERTICAL" ? 0 : padT;
      padB = axis === "VERTICAL" ? 0 : padB;
    } else if (sd <= GAP_EPS) {
      itemSpacing = roundPx(Math.max(0, med));
      // Content cluster centered in the parent with equal leading/trailing inset.
      const contentStart = axis === "HORIZONTAL" ? first.rect.x : first.rect.y;
      const contentEnd =
        axis === "HORIZONTAL" ? rectRight(last.rect) : rectBottom(last.rect);
      const parentSpan =
        axis === "HORIZONTAL" ? parentRect.width : parentRect.height;
      const contentSpan = contentEnd - contentStart;
      const lead = contentStart;
      const trail = parentSpan - contentEnd;
      if (
        nearlyEqual(lead, trail, ALIGN_EPS * 3) &&
        lead > itemSpacing + ALIGN_EPS &&
        contentSpan < parentSpan * 0.85
      ) {
        primaryAlign = "CENTER";
        if (axis === "HORIZONTAL") {
          padL = 0;
          padR = 0;
        } else {
          padT = 0;
          padB = 0;
        }
      }
    } else {
      // Mixed gap scales (e.g. section spacing vs item spacing) — use the tighter cluster gap.
      const sortedGaps = [...positiveGaps]
        .map((g) => Math.max(0, g))
        .sort((a, b) => a - b);
      const small = sortedGaps.filter((g) => g <= sortedGaps[0] + GAP_EPS);
      itemSpacing = roundPx(median(small.length ? small : sortedGaps));
      tidyWarn(
        `Inconsistent gaps in ${axis.toLowerCase()} stack — using ${itemSpacing}px; consider wrappers`,
      );
    }
  }

  // Residual overlap in an otherwise clean stack → treat spacing as zero.
  if (gaps.some((g) => g < -ALIGN_EPS)) {
    itemSpacing = 0;
  }

  const contentBox: Rect = {
    x: padL,
    y: padT,
    width: Math.max(0, parentRect.width - padL - padR),
    height: Math.max(0, parentRect.height - padT - padB),
  };

  return {
    padding: { left: padL, right: padR, top: padT, bottom: padB },
    itemSpacing,
    primaryAlign,
    contentBox,
  };
}

function makeLayout(
  axis: "HORIZONTAL" | "VERTICAL",
  metrics: ReturnType<typeof inferPrimaryMetrics>,
  counter: AlignCounter,
  wrap?: "WRAP",
): AutoLayoutSpec {
  return {
    layoutMode: axis,
    paddingLeft: metrics.padding.left,
    paddingRight: metrics.padding.right,
    paddingTop: metrics.padding.top,
    paddingBottom: metrics.padding.bottom,
    itemSpacing: metrics.itemSpacing,
    primaryAxisAlignItems: metrics.primaryAlign,
    counterAxisAlignItems: counter,
    layoutWrap: wrap ?? "NO_WRAP",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
  };
}

function wrapperName(items: ChildGeom[], kind: "row" | "col"): string {
  if (items.length === 1) return items[0].node.name || kind;
  return kind;
}

function buildWrapper(
  items: ChildGeom[],
  axis: "HORIZONTAL" | "VERTICAL",
  _parentContent: Rect,
): WrapperSpec {
  const bounds = unionRect(items.map((i) => i.rect)) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  // Metrics are relative to the wrapper's union bounds, not the parent frame.
  const localItems: ChildGeom[] = items.map((i) => ({
    ...i,
    rect: {
      x: i.rect.x - bounds.x,
      y: i.rect.y - bounds.y,
      width: i.rect.width,
      height: i.rect.height,
    },
  }));
  const localParent: Rect = {
    x: 0,
    y: 0,
    width: bounds.width,
    height: bounds.height,
  };
  const metrics = inferPrimaryMetrics(localItems, localParent, axis);
  const { parent: counter, perChild } = inferCounterAlign(
    localItems,
    metrics.contentBox,
    axis,
  );
  const childSizing = localItems.map((item) => {
    const s = childSizingFor(item, metrics.contentBox, axis);
    const align = perChild.get(item.node.id);
    if (align) s.layoutAlign = align;
    return s;
  });

  return {
    key: nextWrapperKey(),
    name: wrapperName(items, axis === "HORIZONTAL" ? "row" : "col"),
    childNodeIds: items.map((i) => i.node.id),
    layout: makeLayout(axis, metrics, counter),
    childSizing,
    bounds,
  };
}

function inferStructure(
  flow: ChildGeom[],
  parentRect: Rect,
): {
  layout: AutoLayoutSpec | null;
  wrappers: WrapperSpec[];
  childSizing: ChildSizingSpec[];
  fallbackAbsolute: ChildGeom[];
} {
  if (flow.length === 0) {
    return {
      layout: null,
      wrappers: [],
      childSizing: [],
      fallbackAbsolute: [],
    };
  }

  if (flow.length === 1) {
    const item = flow[0];
    const metrics = inferPrimaryMetrics(flow, parentRect, "VERTICAL");
    const sizing = childSizingFor(item, metrics.contentBox, "VERTICAL");
    const hints = constraintHints(item.node);
    if (hints.preferCenterH || hints.preferCenterV) {
    }
    return {
      layout: makeLayout("VERTICAL", metrics, "MIN"),
      wrappers: [],
      childSizing: [sizing],
      fallbackAbsolute: [],
    };
  }

  // Single-axis stacks map directly to one Auto Layout frame.
  if (isCleanStack(flow, "VERTICAL")) {
    const metrics = inferPrimaryMetrics(flow, parentRect, "VERTICAL");
    const { parent: counter, perChild } = inferCounterAlign(
      flow,
      metrics.contentBox,
      "VERTICAL",
    );
    const childSizing = flow.map((item) => {
      const s = childSizingFor(item, metrics.contentBox, "VERTICAL");
      const align = perChild.get(item.node.id);
      if (align) s.layoutAlign = align;
      return s;
    });
    return {
      layout: makeLayout("VERTICAL", metrics, counter),
      wrappers: [],
      childSizing,
      fallbackAbsolute: [],
    };
  }

  if (isCleanStack(flow, "HORIZONTAL")) {
    const metrics = inferPrimaryMetrics(flow, parentRect, "HORIZONTAL");
    const { parent: counter, perChild } = inferCounterAlign(
      flow,
      metrics.contentBox,
      "HORIZONTAL",
    );
    const childSizing = flow.map((item) => {
      const s = childSizingFor(item, metrics.contentBox, "HORIZONTAL");
      const align = perChild.get(item.node.id);
      if (align) s.layoutAlign = align;
      return s;
    });
    return {
      layout: makeLayout("HORIZONTAL", metrics, counter),
      wrappers: [],
      childSizing,
      fallbackAbsolute: [],
    };
  }

  // Row bands inside a vertical stack → horizontal wrapper frames per band.
  const rowBands = bandSplit(flow, "VERTICAL");
  if (rowBands.length >= 2 && rowBands.some((b) => b.length >= 2)) {
    const wrappers: WrapperSpec[] = [];
    const direct: ChildGeom[] = [];
    const pseudoForParent: ChildGeom[] = [];

    for (const band of rowBands) {
      if (band.length >= 2) {
        const w = buildWrapper(band, "HORIZONTAL", parentRect);
        wrappers.push(w);
        pseudoForParent.push({
          node: band[0].node,
          index: band[0].index,
          rect: w.bounds,
          layoutW: w.bounds.width,
          layoutH: w.bounds.height,
          layoutX: w.bounds.x,
          layoutY: w.bounds.y,
        });
      } else {
        direct.push(band[0]);
        pseudoForParent.push(band[0]);
      }
    }

    if (isCleanStack(pseudoForParent, "VERTICAL") || rowBands.length >= 2) {
      const metrics = inferPrimaryMetrics(
        pseudoForParent,
        parentRect,
        "VERTICAL",
      );
      const { parent: counter, perChild } = inferCounterAlign(
        direct.length === pseudoForParent.length ? direct : pseudoForParent,
        metrics.contentBox,
        "VERTICAL",
      );
      const childSizing = direct.map((item) => {
        const s = childSizingFor(item, metrics.contentBox, "VERTICAL");
        const align = perChild.get(item.node.id);
        if (align) s.layoutAlign = align;
        return s;
      });
      return {
        layout: makeLayout("VERTICAL", metrics, counter),
        wrappers,
        childSizing,
        fallbackAbsolute: [],
      };
    }
  }

  // Column bands inside a horizontal stack → vertical wrapper frames per band.
  const colBands = bandSplit(flow, "HORIZONTAL");
  if (colBands.length >= 2 && colBands.some((b) => b.length >= 2)) {
    const wrappers: WrapperSpec[] = [];
    const direct: ChildGeom[] = [];
    const pseudoForParent: ChildGeom[] = [];

    for (const band of colBands) {
      if (band.length >= 2) {
        const w = buildWrapper(band, "VERTICAL", parentRect);
        wrappers.push(w);
        pseudoForParent.push({
          node: band[0].node,
          index: band[0].index,
          rect: w.bounds,
          layoutW: w.bounds.width,
          layoutH: w.bounds.height,
          layoutX: w.bounds.x,
          layoutY: w.bounds.y,
        });
      } else {
        direct.push(band[0]);
        pseudoForParent.push(band[0]);
      }
    }

    const metrics = inferPrimaryMetrics(
      pseudoForParent,
      parentRect,
      "HORIZONTAL",
    );
    const { parent: counter, perChild } = inferCounterAlign(
      direct.length ? direct : pseudoForParent,
      metrics.contentBox,
      "HORIZONTAL",
    );
    const childSizing = direct.map((item) => {
      const s = childSizingFor(item, metrics.contentBox, "HORIZONTAL");
      const align = perChild.get(item.node.id);
      if (align) s.layoutAlign = align;
      return s;
    });
    return {
      layout: makeLayout("HORIZONTAL", metrics, counter),
      wrappers,
      childSizing,
      fallbackAbsolute: [],
    };
  }

  // Uniform-height grid or ragged wrap as a last resort before falling back to absolute.
  const grid = tryInferGridOrWrap(flow, parentRect);
  if (grid) return { ...grid, fallbackAbsolute: [] };

  tidyWarn(`Could not infer Auto Layout for frame — keeping absolute children`);
  return {
    layout: null,
    wrappers: [],
    childSizing: [],
    fallbackAbsolute: flow,
  };
}

function tryInferGridOrWrap(
  items: ChildGeom[],
  parentRect: Rect,
): {
  layout: AutoLayoutSpec;
  wrappers: WrapperSpec[];
  childSizing: ChildSizingSpec[];
} | null {
  if (items.length < 4) return null;
  const heights = items.map((i) => i.layoutH);
  const widths = items.map((i) => i.layoutW);
  if (stddev(heights) > ALIGN_EPS * 3) return null;

  const rowBands = bandSplit(items, "VERTICAL");
  if (rowBands.length < 2) return null;

  const rowLens = rowBands.map((b) => b.length);
  const lensVary = new Set(rowLens).size > 1;
  const firstRow = rowBands[0];
  const colsAlign =
    !lensVary &&
    rowBands.every(
      (band) =>
        band.length === firstRow.length &&
        band.every((item, idx) =>
          nearlyEqual(item.rect.x, firstRow[idx].rect.x, ALIGN_EPS * 2),
        ),
    );

  if (colsAlign) {
    const wrappers = rowBands.map((band) =>
      buildWrapper(band, "HORIZONTAL", parentRect),
    );
    const pseudo = wrappers.map((w, i) => ({
      node: rowBands[i][0].node,
      index: rowBands[i][0].index,
      rect: w.bounds,
      layoutW: w.bounds.width,
      layoutH: w.bounds.height,
      layoutX: w.bounds.x,
      layoutY: w.bounds.y,
    }));
    const metrics = inferPrimaryMetrics(pseudo, parentRect, "VERTICAL");
    return {
      layout: makeLayout("VERTICAL", metrics, "MIN"),
      wrappers,
      childSizing: [],
    };
  }

  if (
    lensVary &&
    stddev(widths) <= Math.max(ALIGN_EPS * 4, median(widths) * 0.2)
  ) {
    const metrics = inferPrimaryMetrics(items, parentRect, "HORIZONTAL");
    const { parent: counter, perChild } = inferCounterAlign(
      items,
      metrics.contentBox,
      "HORIZONTAL",
    );
    const rowYs = rowBands.map((b) => Math.min(...b.map((i) => i.rect.y)));
    const rowGaps: number[] = [];
    for (let i = 1; i < rowYs.length; i++) {
      const prevBottom = Math.max(
        ...rowBands[i - 1].map((c) => rectBottom(c.rect)),
      );
      rowGaps.push(rowYs[i] - prevBottom);
    }
    const layout: AutoLayoutSpec = {
      ...makeLayout("HORIZONTAL", metrics, counter, "WRAP"),
      counterAxisSpacing: roundPx(Math.max(0, median(rowGaps))),
    };
    const childSizing = items.map((item) => {
      const s = childSizingFor(item, metrics.contentBox, "HORIZONTAL");
      const align = perChild.get(item.node.id);
      if (align) s.layoutAlign = align;
      s.horizontal = "FIXED";
      s.vertical = "FIXED";
      return s;
    });
    return { layout, wrappers: [], childSizing };
  }

  return null;
}

function inferFrame(
  node: SceneNode & ChildrenMixin & BaseFrameMixin,
): FrameTidySpec {
  const parentRect = parentLocalRect(node);
  const all = collectChildrenGeom(node);
  const classified = classifyChildren(all, parentRect);

  const absoluteChildren: FrameTidySpec["absoluteChildren"] = [];
  for (const item of [...classified.overlays, ...classified.absolute]) {
    absoluteChildren.push({
      nodeId: item.node.id,
      x: item.layoutX,
      y: item.layoutY,
    });
  }

  let foldBackgroundId: string | undefined;
  let stretchBackgroundId: string | undefined;
  if (classified.backgrounds.length > 0) {
    const bg = classified.backgrounds[0];
    if (isPlainFillShape(bg.node) && !parentHasFills(node)) {
      foldBackgroundId = bg.node.id;
    } else {
      stretchBackgroundId = bg.node.id;
      absoluteChildren.push({
        nodeId: bg.node.id,
        x: bg.layoutX,
        y: bg.layoutY,
      });
      tidyWarn(`Background "${bg.node.name}" kept as absolute stretch`);
    }
  }

  if (classified.overlays.length > 0) {
    tidyWarn(
      `${classified.overlays.length} overlay layer(s) in "${node.name}" set to absolute`,
    );
  }

  const structure = inferStructure(classified.flow, parentRect);
  for (const item of structure.fallbackAbsolute) {
    absoluteChildren.push({
      nodeId: item.node.id,
      x: item.layoutX,
      y: item.layoutY,
    });
  }

  return {
    nodeId: node.id,
    skipLayout: false,
    layout: structure.layout ?? undefined,
    absoluteChildren,
    childSizing: structure.childSizing,
    wrappers: structure.wrappers,
    foldBackgroundId,
    stretchBackgroundId,
  };
}

function walkForPlan(node: SceneNode, plan: TidyPlan): void {
  if (node.type === "INSTANCE") {
    tidyWarn(`Instance "${node.name}" kept linked (leaf)`);
    return;
  }

  if (node.type === "GROUP") {
    const group = node as GroupNode;
    const effects =
      "effects" in group ? ((group as BlendMixin).effects as Effect[]) : [];
    if (group.children.length === 1 && effects.length === 0) {
      plan.groupsToUnwrap.push(group.id);
      walkForPlan(group.children[0], plan);
      return;
    }
    plan.groupsToFrame.push(group.id);
    // Group nodes become frames in apply — infer layout here using remapped ids later.
    if (group.children.length > 0) {
      plan.frames.push(
        inferFrame(
          group as unknown as SceneNode & ChildrenMixin & BaseFrameMixin,
        ),
      );
    }
    for (const child of group.children) {
      walkForPlan(child, plan);
    }
    return;
  }

  if (!canHaveChildren(node)) return;
  if (isLeafType(node.type)) return;

  if (node.type === "SECTION") {
    for (const child of node.children) {
      walkForPlan(child, plan);
    }
    return;
  }

  if (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "COMPONENT_SET"
  ) {
    const frame = node as FrameNode | ComponentNode | ComponentSetNode;

    if (isAutoLayoutFrame(frame)) {
      // Existing Auto Layout is left intact at this frame; only freeform descendants are inferred.
      tidyWarn(
        `Skipped Auto Layout frame "${frame.name}" (descendants may still tidy)`,
      );
      for (const child of frame.children) {
        if (
          child.type === "FRAME" ||
          child.type === "GROUP" ||
          child.type === "COMPONENT" ||
          child.type === "SECTION"
        ) {
          if (!isAutoLayoutFrame(child)) {
            walkForPlan(child, plan);
          } else {
            walkForPlan(child, plan);
          }
        }
      }
      return;
    }

    // Freeform frame — candidate for Auto Layout inference.
    if (frame.children.length === 0) return;

    const spec = inferFrame(
      frame as SceneNode & ChildrenMixin & BaseFrameMixin,
    );
    plan.frames.push(spec);

    for (const child of frame.children) {
      if (
        child.type === "FRAME" ||
        child.type === "GROUP" ||
        child.type === "COMPONENT" ||
        child.type === "SECTION" ||
        child.type === "COMPONENT_SET"
      ) {
        walkForPlan(child, plan);
      }
    }
  }
}

export function buildTidyPlan(root: SceneNode): TidyPlan {
  wrapperKeyCounter = 0;
  const plan: TidyPlan = {
    frames: [],
    groupsToFrame: [],
    groupsToUnwrap: [],
    warnings: [],
  };
  walkForPlan(root, plan);
  // Deepest groups convert first so parent ids remain valid during apply.
  plan.groupsToFrame.reverse();
  plan.groupsToUnwrap.reverse();
  return plan;
}
