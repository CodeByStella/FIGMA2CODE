/** Applies AI section bands and semantic renames to the clone before Auto Layout inference. */

import type { AiVisionResult } from "./openrouter";
import { listRootDirectChildren } from "./inventory";
import { logError } from "../../shared/log";
import {
  OVERLAP_AREA_RATIO,
  containsPoint,
  intervalOverlap,
  overlapArea,
  overlapRatioOfMin,
  rectArea,
  type Rect,
} from "../geometry";

export type AppliedAiSectionsStats = {
  sectionCount: number;
  assignedCount: number;
  unassignedCount: number;
  renameApplied: number;
  renameSkipped: number;
  scaleApplied: number | null;
  elapsedMs: number;
};

function uniqueSorted(nums: number[]): number[] {
  return [...new Set(nums.map((n) => Math.round(n * 100) / 100))].sort(
    (a, b) => a - b,
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Force section bands to abut: band[i].yEnd === band[i+1].yStart, covering [0, rootHeight].
 * AI often returns slight gaps/overlaps; those become visible holes between section frames.
 */
function normalizeContiguousBands(
  bands: Array<{ name: string; yStart: number; yEnd: number }>,
  rootHeight: number,
): Array<{ name: string; yStart: number; yEnd: number }> {
  if (bands.length === 0) return [];
  if (rootHeight <= 0) return bands;

  const sorted = [...bands].sort(
    (a, b) => a.yStart - b.yStart || a.yEnd - b.yEnd,
  );
  const n = sorted.length;
  if (n === 1) {
    return [{ name: sorted[0].name, yStart: 0, yEnd: rootHeight }];
  }

  // Cuts between consecutive sections: midpoint of proposed shared edge / gap / overlap.
  const cuts: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const cut = (sorted[i].yEnd + sorted[i + 1].yStart) / 2;
    cuts.push(cut);
  }

  const edges: number[] = [0];
  for (let i = 0; i < cuts.length; i++) {
    const remainingCuts = cuts.length - i;
    const minEdge = edges[edges.length - 1] + 1;
    const maxEdge = rootHeight - remainingCuts;
    edges.push(clamp(cuts[i], minEdge, Math.max(minEdge, maxEdge)));
  }
  edges.push(rootHeight);

  // Ensure strictly increasing (degenerate AI ranges).
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] <= edges[i - 1]) {
      edges[i] = Math.min(rootHeight, edges[i - 1] + 1);
    }
  }
  edges[edges.length - 1] = rootHeight;

  return sorted.map((s, i) => ({
    name: s.name,
    yStart: Math.round(edges[i] * 100) / 100,
    yEnd: Math.round(edges[i + 1] * 100) / 100,
  }));
}

function buildBands(
  splitLinesY: number[],
  sections: AiVisionResult["sections"],
  rootHeight: number,
): Array<{ name: string; yStart: number; yEnd: number }> {
  if (sections.length > 0) {
    const raw = sections
      .map((s) => ({
        name: s.name || "Section",
        yStart: Math.max(0, s.yStart),
        yEnd: Math.min(rootHeight, Math.max(s.yStart + 1, s.yEnd)),
      }))
      .sort((a, b) => a.yStart - b.yStart);
    return normalizeContiguousBands(raw, rootHeight);
  }

  const cuts = uniqueSorted(
    splitLinesY.filter((y) => y > 1 && y < rootHeight - 1),
  );
  const edges = [0, ...cuts, rootHeight];
  const bands: Array<{ name: string; yStart: number; yEnd: number }> = [];
  for (let i = 0; i < edges.length - 1; i++) {
    bands.push({
      name: `Section ${i + 1}`,
      yStart: edges[i],
      yEnd: edges[i + 1],
    });
  }
  return normalizeContiguousBands(bands, rootHeight);
}

type BandMembers = {
  name: string;
  yStart: number;
  yEnd: number;
  members: SceneNode[];
};

/**
 * Drop empty bands but keep a continuous Y cover by absorbing their range into neighbors.
 */
function collapseEmptyBands(
  bands: Array<{ name: string; yStart: number; yEnd: number }>,
  assignments: Map<number, SceneNode[]>,
): BandMembers[] {
  const raw: BandMembers[] = bands.map((b, i) => ({
    ...b,
    members: assignments.get(i) || [],
  }));

  const out: BandMembers[] = [];
  for (const band of raw) {
    if (band.members.length === 0) {
      if (out.length > 0) {
        out[out.length - 1].yEnd = band.yEnd;
      } else {
        out.push({ ...band, members: [] });
      }
      continue;
    }
    if (out.length > 0 && out[out.length - 1].members.length === 0) {
      const leading = out.pop()!;
      out.push({
        name: band.name,
        yStart: leading.yStart,
        yEnd: band.yEnd,
        members: band.members,
      });
    } else {
      out.push({ ...band });
    }
  }

  return out.filter((b) => b.members.length > 0);
}

/**
 * Vision models sometimes return Y in screenshot pixels — rescale into root layout coords
 * when values clearly exceed the frame height.
 */
export function maybeScaleAiCoords(
  result: AiVisionResult,
  rootHeight: number,
  imageHeightPx: number,
): { result: AiVisionResult; scale: number | null } {
  const ys = [
    ...result.splitLinesY,
    ...result.sections.flatMap((s) => [s.yStart, s.yEnd]),
  ].filter((n) => Number.isFinite(n));
  if (ys.length === 0) return { result, scale: null };

  const maxY = Math.max(...ys);
  // Values well above layout height indicate screenshot-space coordinates.
  if (maxY > rootHeight * 1.35 && imageHeightPx > 0) {
    const scale = rootHeight / imageHeightPx;
    return {
      scale,
      result: {
        ...result,
        splitLinesY: result.splitLinesY.map((y) => y * scale),
        sections: result.sections.map((s) => ({
          ...s,
          yStart: s.yStart * scale,
          yEnd: s.yEnd * scale,
        })),
      },
    };
  }
  return { result, scale: null };
}

function childCenterY(child: SceneNode, root: SceneNode): number {
  const rect = childRootRect(child, root);
  if (rect) return rect.y + rect.height / 2;
  return 0;
}

function childRootRect(child: SceneNode, root: SceneNode): Rect | null {
  if (
    "absoluteBoundingBox" in child &&
    child.absoluteBoundingBox &&
    "absoluteBoundingBox" in root &&
    root.absoluteBoundingBox
  ) {
    const c = child.absoluteBoundingBox;
    const r = root.absoluteBoundingBox;
    return {
      x: c.x - r.x,
      y: c.y - r.y,
      width: c.width,
      height: c.height,
    };
  }
  if ("x" in child && "width" in child) {
    const lm = child as LayoutMixin;
    return { x: lm.x, y: lm.y, width: lm.width, height: lm.height };
  }
  return null;
}

function bandClipRect(
  band: { yStart: number; yEnd: number },
  rootWidth: number,
): Rect {
  return {
    x: 0,
    y: band.yStart,
    width: rootWidth,
    height: Math.max(0, band.yEnd - band.yStart),
  };
}

/** Fraction of the band rectangle covered by `rects` (overlaps can sum above 1). */
function coverageInBand(
  rects: Array<Rect | null>,
  band: { yStart: number; yEnd: number },
  rootWidth: number,
): number {
  const clip = bandClipRect(band, rootWidth);
  const area = rectArea(clip);
  if (area <= 0) return 0;
  let sum = 0;
  for (const r of rects) {
    if (r) sum += overlapArea(r, clip);
  }
  return sum / area;
}

function hasFullBleedStrip(
  rects: Array<Rect | null>,
  band: { yStart: number; yEnd: number },
  rootWidth: number,
): boolean {
  const bandH = band.yEnd - band.yStart;
  if (bandH <= 0) return false;
  return rects.some((r) => {
    if (!r) return false;
    const yOv = intervalOverlap(r.y, r.y + r.height, band.yStart, band.yEnd);
    return r.width >= rootWidth * 0.9 && yOv >= bandH * 0.6;
  });
}

/** Full-width canvas that sits behind multiple sections — not a card or photo. */
function isPageBackground(
  rect: Rect,
  rootWidth: number,
  rootHeight: number,
): boolean {
  return rect.width >= rootWidth * 0.9 && rect.height >= rootHeight * 0.08;
}

function hasSolidFill(node: SceneNode): boolean {
  if (!("fills" in node)) return false;
  const fills = (node as MinimalFillsMixin).fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return false;
  return fills.some(
    (f) => f && f.visible !== false && f.type === "SOLID" && "color" in f,
  );
}

/**
 * Full-width solid fill that paints this section's canvas. Top aligns with the
 * band; a leftover below the fill is a different section (color change).
 */
function findSectionBackground(
  band: BandMembers,
  root: SceneNode,
  rootWidth: number,
): { node: SceneNode; rect: Rect } | null {
  let best: { node: SceneNode; rect: Rect } | null = null;
  let bestCover = 0;

  for (const m of band.members) {
    if (!hasSolidFill(m)) continue;
    const r = childRootRect(m, root);
    if (!r || r.width < rootWidth * 0.9 || r.height < 80) continue;
    if (r.y > band.yStart + 64) continue;

    let cover = 0;
    for (const o of band.members) {
      if (o === m) continue;
      const box = childRootRect(o, root);
      if (!box) continue;
      if (containsPoint(r, box.x + box.width / 2, box.y + box.height / 2)) {
        cover += 1;
      }
    }
    if (cover > bestCover) {
      bestCover = cover;
      best = { node: m, rect: r };
    }
  }

  return bestCover > 0 ? best : null;
}

function compositionOverlap(
  a: SceneNode,
  b: SceneNode,
  root: SceneNode,
): boolean {
  const ar = childRootRect(a, root);
  const br = childRootRect(b, root);
  return !!(ar && br && overlapRatioOfMin(ar, br) >= OVERLAP_AREA_RATIO);
}

/** True when a layer crosses `cut` by at least 20% of its own height (not a sliver). */
function isSignificantStraddle(rect: Rect, cut: number): boolean {
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (top >= cut || bottom <= cut) return false;
  const minority = Math.min(cut - top, bottom - cut);
  return minority >= rect.height * 0.2;
}

/** Text, cards, CTAs — moving the split is justified. */
function isSectionContent(
  node: SceneNode,
  root: SceneNode,
  rootWidth: number,
  rootHeight: number,
): boolean {
  if (node.type === "TEXT") return true;
  if (node.type === "INSTANCE" || node.type === "COMPONENT") return true;
  const r = childRootRect(node, root);
  if (!r || isPageBackground(r, rootWidth, rootHeight)) return false;
  if (node.type !== "RECTANGLE" && node.type !== "FRAME") return false;
  const wr = r.width / rootWidth;
  return wr >= 0.25 && wr <= 0.72 && r.height >= 48 && r.height <= 420;
}

/** Large image/shape that a content layer sits on — include in the cut, not overflow. */
function isContentSurface(
  node: SceneNode,
  content: SceneNode[],
  root: SceneNode,
  rootWidth: number,
  rootHeight: number,
): boolean {
  const r = childRootRect(node, root);
  if (!r || isPageBackground(r, rootWidth, rootHeight)) return false;
  if (r.width < rootWidth * 0.35) return false;
  return content.some((c) => {
    const cr = childRootRect(c, root);
    if (!cr) return false;
    return containsPoint(r, cr.x + cr.width / 2, cr.y + cr.height / 2);
  });
}

function clusterContentMembers(
  cluster: SceneNode[],
  root: SceneNode,
  rootWidth: number,
  rootHeight: number,
): SceneNode[] {
  return cluster.filter((m) =>
    isSectionContent(m, root, rootWidth, rootHeight),
  );
}

function clusterCutMembers(
  cluster: SceneNode[],
  root: SceneNode,
  rootWidth: number,
  rootHeight: number,
): SceneNode[] {
  const content = clusterContentMembers(cluster, root, rootWidth, rootHeight);
  const surfaces = cluster.filter((m) =>
    isContentSurface(m, content, root, rootWidth, rootHeight),
  );
  return [...new Set([...content, ...surfaces])];
}

/**
 * Expand a seed set through overlapping siblings, skipping page backgrounds so a
 * section canvas does not glue unrelated chrome into the composition.
 */
function growOverlapCluster(
  seeds: SceneNode[],
  candidates: SceneNode[],
  root: SceneNode,
  rootWidth: number,
  rootHeight: number,
): SceneNode[] {
  const cluster = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of candidates) {
      if (cluster.has(c)) continue;
      const cr = childRootRect(c, root);
      if (!cr || isPageBackground(cr, rootWidth, rootHeight)) continue;
      for (const s of cluster) {
        if (compositionOverlap(s, c, root)) {
          cluster.add(c);
          changed = true;
          break;
        }
      }
    }
  }
  return [...cluster];
}

function clusterBottom(members: SceneNode[], root: SceneNode): number | null {
  let max = -Infinity;
  for (const m of members) {
    const r = childRootRect(m, root);
    if (!r) continue;
    max = Math.max(max, r.y + r.height);
  }
  return max === -Infinity ? null : max;
}

function clusterTop(members: SceneNode[], root: SceneNode): number | null {
  let min = Infinity;
  for (const m of members) {
    const r = childRootRect(m, root);
    if (!r) continue;
    min = Math.min(min, r.y);
  }
  return min === Infinity ? null : min;
}

/** Prefer the band the layer occupies most; center Y breaks ties and empty overlap. */
function pickBandIndex(
  rect: Rect | null,
  cy: number,
  bands: Array<{ yStart: number; yEnd: number }>,
): number {
  if (rect && bands.length > 0) {
    let bestIdx = -1;
    let bestOv = 0;
    for (let i = 0; i < bands.length; i++) {
      const ov = intervalOverlap(
        rect.y,
        rect.y + rect.height,
        bands[i].yStart,
        bands[i].yEnd,
      );
      if (ov > bestOv + 0.5) {
        bestOv = ov;
        bestIdx = i;
      } else if (bestIdx >= 0 && Math.abs(ov - bestOv) <= 0.5 && ov > 0) {
        const b = bands[i];
        const inBand =
          i === bands.length - 1
            ? cy >= b.yStart && cy <= b.yEnd + 0.5
            : cy >= b.yStart && cy < b.yEnd;
        if (inBand) bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestOv > 0) return bestIdx;
  }

  let idx = bands.findIndex((b) => cy >= b.yStart && cy < b.yEnd);
  if (idx < 0) {
    idx = bands.findIndex(
      (b, i) => i === bands.length - 1 && cy >= b.yStart && cy <= b.yEnd + 0.5,
    );
  }
  return idx;
}

function roundEdge(n: number): number {
  return Math.round(n * 100) / 100;
}

function isSparseBand(
  band: BandMembers,
  prev: BandMembers | undefined,
  next: BandMembers | undefined,
  root: SceneNode,
  rootWidth: number,
): boolean {
  const rectsOf = (members: SceneNode[]) =>
    members.map((m) => childRootRect(m, root));
  if (hasFullBleedStrip(rectsOf(band.members), band, rootWidth)) return false;
  const own = coverageInBand(rectsOf(band.members), band, rootWidth);
  const prevC = prev
    ? coverageInBand(rectsOf(prev.members), band, rootWidth)
    : 0;
  const nextC = next
    ? coverageInBand(rectsOf(next.members), band, rootWidth)
    : 0;
  return prevC + nextC >= 0.4 && own < 0.2;
}

/**
 * Decide per overlapping group: move the split only for real section content.
 * Boundary decorations stay in one section (majority overlap) and overflow;
 * they must not drag the cut.
 */
function healBoundaryCompositions(
  bands: BandMembers[],
  root: SceneNode,
  rootWidth: number,
  rootHeight: number,
  childOrder: Map<SceneNode, number>,
): BandMembers[] {
  const out: BandMembers[] = bands.map((b) => ({
    ...b,
    members: [...b.members],
  }));

  const sortMembers = (members: SceneNode[]) =>
    [...members].sort(
      (a, b) => (childOrder.get(a) ?? 0) - (childOrder.get(b) ?? 0),
    );

  const isBgNode = (m: SceneNode) => {
    const r = childRootRect(m, root);
    return !!r && isPageBackground(r, rootWidth, rootHeight);
  };

  for (let i = 0; i < out.length - 1; i++) {
    const upper = out[i];
    const lower = out[i + 1];
    let cut = upper.yEnd;
    const pool = [...upper.members, ...lower.members];

    const straddleSeeds = pool.filter((m) => {
      const r = childRootRect(m, root);
      return (
        r &&
        !isPageBackground(r, rootWidth, rootHeight) &&
        isSignificantStraddle(r, cut)
      );
    });

    const leftover =
      straddleSeeds.length === 0 &&
      isSparseBand(upper, out[i - 1], lower, root, rootWidth);
    const leftoverSeeds = leftover
      ? upper.members.filter((m) =>
          lower.members.some((n) => compositionOverlap(m, n, root)),
        )
      : [];

    const seeds = straddleSeeds.length > 0 ? straddleSeeds : leftoverSeeds;
    if (seeds.length === 0) continue;

    const seen = new Set<SceneNode>();
    const groups: SceneNode[][] = [];
    for (const seed of seeds) {
      if (seen.has(seed)) continue;
      const group = growOverlapCluster(
        [seed],
        pool,
        root,
        rootWidth,
        rootHeight,
      );
      for (const m of group) seen.add(m);
      groups.push(group);
    }

    for (const cluster of groups) {
      const fromUpper = cluster.filter((m) => upper.members.includes(m));
      const fromLower = cluster.filter((m) => lower.members.includes(m));
      if (fromUpper.length === 0 || fromLower.length === 0) continue;

      const content = clusterContentMembers(
        cluster,
        root,
        rootWidth,
        rootHeight,
      );

      // Decoration / intersection ornament: keep the cut, contain each layer
      // in the section it occupies more, let clipsContent=false overflow.
      if (content.length === 0) {
        for (const m of cluster) {
          const r = childRootRect(m, root);
          if (!r) continue;
          const upperOv = intervalOverlap(
            r.y,
            r.y + r.height,
            upper.yStart,
            upper.yEnd,
          );
          const lowerOv = intervalOverlap(
            r.y,
            r.y + r.height,
            lower.yStart,
            lower.yEnd,
          );
          const dest = upperOv >= lowerOv ? upper : lower;
          const src = dest === upper ? lower : upper;
          if (src.members.includes(m)) {
            src.members = src.members.filter((x) => x !== m);
            dest.members.push(m);
          }
        }
        upper.members = sortMembers(upper.members);
        lower.members = sortMembers(lower.members);
        continue;
      }

      const cutGroup = clusterCutMembers(cluster, root, rootWidth, rootHeight);
      const top = clusterTop(cutGroup, root);
      if (top == null) continue;
      const ownerIsUpper = top < cut;

      const owner = ownerIsUpper ? upper : lower;
      const donor = ownerIsUpper ? lower : upper;
      const exclusive = donor.members.filter(
        (m) => !cluster.includes(m) && !isBgNode(m),
      );

      const bleeds = donor.members.filter((m) => {
        if (cluster.includes(m) || !isBgNode(m)) return false;
        return cluster.some((s) => {
          const a = childRootRect(s, root);
          const b = childRootRect(m, root);
          return !!(a && b && overlapArea(a, b) > 0);
        });
      });

      const taken = new Set([
        ...cluster.filter((m) => donor.members.includes(m)),
        ...bleeds,
      ]);
      if (taken.size === 0) continue;

      donor.members = donor.members.filter((m) => !taken.has(m));
      owner.members = sortMembers([...owner.members, ...taken]);

      if (ownerIsUpper) {
        const bottom = clusterBottom(cutGroup, root);
        if (bottom != null) {
          const maxEnd = donor.members.length > 0 ? lower.yEnd - 1 : lower.yEnd;
          upper.yEnd = roundEdge(
            Math.max(upper.yEnd, Math.min(bottom, maxEnd)),
          );
        }
        lower.yStart = upper.yEnd;
      } else {
        const clusterT = clusterTop(cutGroup, root);
        if (clusterT != null) {
          const minStart =
            donor.members.length > 0 ? upper.yStart + 1 : upper.yStart;
          lower.yStart = roundEdge(
            Math.min(lower.yStart, Math.max(clusterT, minStart)),
          );
        }
        upper.yEnd = lower.yStart;
      }

      cut = upper.yEnd;

      if (exclusive.length === 0 && donor.members.length === 0) {
        if (ownerIsUpper) upper.yEnd = lower.yEnd;
        else lower.yStart = upper.yStart;
        out.splice(ownerIsUpper ? i + 1 : i, 1);
        if (!ownerIsUpper) i -= 1;
        break;
      }
    }
  }

  return out.filter((b) => b.members.length > 0);
}

function remainderSectionName(members: SceneNode[], root: SceneNode): string {
  const texts = members
    .filter((m) => m.type === "TEXT" && "characters" in m)
    .map((m) => ({ m, r: childRootRect(m, root) }))
    .filter((t) => t.r)
    .sort((a, b) => a.r!.y - b.r!.y || b.r!.width - a.r!.width);
  const raw = texts[0]?.m as TextNode | undefined;
  if (raw && typeof raw.characters === "string") {
    const line = raw.characters.split("\n")[0].trim();
    if (line.length > 0 && line.length <= 40) return line;
  }
  return "Section";
}

function sortByChildOrder(
  members: SceneNode[],
  childOrder: Map<SceneNode, number>,
): SceneNode[] {
  return [...members].sort(
    (a, b) => (childOrder.get(a) ?? 0) - (childOrder.get(b) ?? 0),
  );
}

/**
 * If a band's full-width solid fill ends while more content continues below
 * on a different canvas color, split there — that fill edge is the section.
 */
function splitBandsAtSectionBackgrounds(
  bands: BandMembers[],
  root: SceneNode,
  rootWidth: number,
  childOrder: Map<SceneNode, number>,
): BandMembers[] {
  const out: BandMembers[] = [];

  for (const band of bands) {
    const bg = findSectionBackground(band, root, rootWidth);
    if (!bg) {
      out.push(band);
      continue;
    }

    const bgBottom = bg.rect.y + bg.rect.height;
    if (bgBottom >= band.yEnd - 48) {
      out.push(band);
      continue;
    }

    const below: SceneNode[] = [];
    const above: SceneNode[] = [];
    for (const m of band.members) {
      if (m === bg.node) {
        above.push(m);
        continue;
      }
      const r = childRootRect(m, root);
      const cy = r ? r.y + r.height / 2 : 0;
      if (r && cy >= bgBottom) below.push(m);
      else above.push(m);
    }

    const belowHasBlock =
      below.some((m) => m.type === "TEXT") || below.length >= 3;
    if (!belowHasBlock) {
      out.push(band);
      continue;
    }

    out.push({
      name: band.name,
      yStart: band.yStart,
      yEnd: roundEdge(bgBottom),
      members: sortByChildOrder(above, childOrder),
    });
    out.push({
      name: remainderSectionName(below, root),
      yStart: roundEdge(bgBottom),
      yEnd: band.yEnd,
      members: sortByChildOrder(below, childOrder),
    });
  }

  return out;
}

/**
 * Shrink a section that still includes whitespace below its solid canvas so the
 * next section owns that gap. Does not move the cut when content sits on the fill.
 */
function snapCutsToBackgrounds(
  bands: BandMembers[],
  root: SceneNode,
  rootWidth: number,
  childOrder: Map<SceneNode, number>,
): BandMembers[] {
  const out: BandMembers[] = bands.map((b) => ({
    ...b,
    members: [...b.members],
  }));

  for (let i = 0; i < out.length - 1; i++) {
    const upper = out[i];
    const lower = out[i + 1];
    const bg = findSectionBackground(upper, root, rootWidth);
    if (!bg) continue;

    const bgBottom = roundEdge(bg.rect.y + bg.rect.height);
    if (bgBottom >= upper.yEnd - 4) continue;
    if (bgBottom <= upper.yStart + 48) continue;

    let lowerTop = Infinity;
    for (const m of lower.members) {
      const r = childRootRect(m, root);
      if (r) lowerTop = Math.min(lowerTop, r.y);
    }
    if (lowerTop < bgBottom - 8) continue;

    for (const m of [...upper.members]) {
      if (m === bg.node) continue;
      const r = childRootRect(m, root);
      if (!r) continue;
      if (r.y + r.height / 2 >= bgBottom) {
        upper.members = upper.members.filter((x) => x !== m);
        lower.members.push(m);
      }
    }

    upper.yEnd = bgBottom;
    lower.yStart = bgBottom;
    upper.members = sortByChildOrder(upper.members, childOrder);
    lower.members = sortByChildOrder(lower.members, childOrder);
  }

  return out.filter((b) => b.members.length > 0);
}

/**
 * Wrap direct children into named section frames by vertical band; renames use
 * getNodeByIdAsync for dynamic-page document access.
 */
export async function applyAiSections(
  root: SceneNode,
  vision: AiVisionResult,
  imageHeightPx: number,
): Promise<AppliedAiSectionsStats> {
  const t0 = Date.now();
  if (!("children" in root) || !("width" in root)) {
    return {
      sectionCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      renameApplied: 0,
      renameSkipped: 0,
      scaleApplied: null,
      elapsedMs: Date.now() - t0,
    };
  }

  const frame = root as FrameNode;
  const rootHeight = frame.height;
  const { result, scale } = maybeScaleAiCoords(
    vision,
    rootHeight,
    imageHeightPx,
  );

  const bands = buildBands(result.splitLinesY, result.sections, rootHeight);
  if (bands.length < 2) {
    const renameStats = await applyRenamesAsync(result.renames);
    return {
      sectionCount: 0,
      assignedCount: 0,
      unassignedCount: listRootDirectChildren(root).length,
      ...renameStats,
      scaleApplied: scale,
      elapsedMs: Date.now() - t0,
    };
  }

  const children = listRootDirectChildren(root);
  const childOrder = new Map<SceneNode, number>();
  children.forEach((c, i) => childOrder.set(c, i));

  const assignments = new Map<number, SceneNode[]>();
  for (let i = 0; i < bands.length; i++) assignments.set(i, []);

  const unassigned: SceneNode[] = [];

  for (const child of children) {
    // Already-absolute layers should not be pulled into vertical section flow.
    if (
      "layoutPositioning" in child &&
      (child as FrameNode).layoutPositioning === "ABSOLUTE"
    ) {
      unassigned.push(child);
      continue;
    }
    const rect = childRootRect(child, root);
    const cy = childCenterY(child, root);
    const idx = pickBandIndex(rect, cy, bands);
    if (idx < 0) {
      unassigned.push(child);
      continue;
    }
    assignments.get(idx)!.push(child);
  }

  // Section frames are appended now; infer/apply will establish vertical Auto Layout order.
  let assignedCount = 0;

  let filledBands = splitBandsAtSectionBackgrounds(
    collapseEmptyBands(bands, assignments),
    root,
    frame.width,
    childOrder,
  );
  filledBands = healBoundaryCompositions(
    filledBands,
    root,
    frame.width,
    rootHeight,
    childOrder,
  );
  filledBands = snapCutsToBackgrounds(
    filledBands,
    root,
    frame.width,
    childOrder,
  );

  for (const band of filledBands) {
    const section = figma.createFrame();
    section.name = band.name;
    section.fills = [];
    section.clipsContent = false;
    const bandH = Math.max(1, band.yEnd - band.yStart);
    section.resizeWithoutConstraints(Math.max(1, frame.width), bandH);
    section.x = 0;
    section.y = band.yStart;

    // Append now; vertical Auto Layout in infer/apply will stack sections by Y.
    frame.appendChild(section);

    for (const child of band.members) {
      // Keep transform-local x/y (not AABB). AABB left ≠ node.x when rotated.
      const prevX = "x" in child ? (child as LayoutMixin).x : 0;
      const prevY = "y" in child ? (child as LayoutMixin).y : 0;

      section.appendChild(child);
      if ("x" in child) {
        (child as LayoutMixin).x = prevX - section.x;
        (child as LayoutMixin).y = prevY - section.y;
      }
      assignedCount += 1;
    }
  }

  const renameStats = await applyRenamesAsync(result.renames);
  const elapsedMs = Date.now() - t0;

  return {
    sectionCount: filledBands.length,
    assignedCount,
    unassignedCount: unassigned.length,
    ...renameStats,
    scaleApplied: scale,
    elapsedMs,
  };
}

export async function applyRenamesAsync(
  renames: Record<string, string>,
): Promise<{ renameApplied: number; renameSkipped: number }> {
  let renameApplied = 0;
  let renameSkipped = 0;

  for (const [id, name] of Object.entries(renames)) {
    let node: BaseNode | null = null;
    try {
      node = await figma.getNodeByIdAsync(id);
    } catch (e) {
      logError(`getNodeByIdAsync failed for rename ${id}`, e);
      renameSkipped += 1;
      continue;
    }
    if (!node) {
      renameSkipped += 1;
      continue;
    }
    try {
      if (node.type === "DOCUMENT" || node.type === "PAGE") {
        renameSkipped += 1;
        continue;
      }
      node.name = name;
      renameApplied += 1;
    } catch (e) {
      logError(`rename failed for ${id}`, e);
      renameSkipped += 1;
    }
  }

  return { renameApplied, renameSkipped };
}
