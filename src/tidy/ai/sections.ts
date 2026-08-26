/** Applies AI section bands and semantic renames to the clone before Auto Layout inference. */

import type { AiVisionResult } from "./openrouter";
import { listRootDirectChildren } from "./inventory";
import { logError } from "../../shared/log";

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
  if (
    "absoluteBoundingBox" in child &&
    child.absoluteBoundingBox &&
    "absoluteBoundingBox" in root &&
    root.absoluteBoundingBox
  ) {
    const c = child.absoluteBoundingBox;
    const r = root.absoluteBoundingBox;
    return c.y + c.height / 2 - r.y;
  }
  if ("y" in child && "height" in child) {
    return (child as LayoutMixin).y + (child as LayoutMixin).height / 2;
  }
  return 0;
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
    const cy = childCenterY(child, root);
    let idx = bands.findIndex((b) => cy >= b.yStart && cy < b.yEnd);
    if (idx < 0) {
      // Bottom band is inclusive so edge-aligned children are not dropped.
      idx = bands.findIndex(
        (b, i) =>
          i === bands.length - 1 && cy >= b.yStart && cy <= b.yEnd + 0.5,
      );
    }
    if (idx < 0) {
      unassigned.push(child);
      continue;
    }
    assignments.get(idx)!.push(child);
  }

  // Section frames are appended now; infer/apply will establish vertical Auto Layout order.
  const rootAbs = frame.absoluteBoundingBox;
  let assignedCount = 0;

  const filledBands = collapseEmptyBands(bands, assignments);

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
      const childAbs =
        "absoluteBoundingBox" in child ? child.absoluteBoundingBox : null;
      const lx =
        childAbs && rootAbs
          ? childAbs.x - rootAbs.x
          : "x" in child
            ? (child as LayoutMixin).x
            : 0;
      const ly =
        childAbs && rootAbs
          ? childAbs.y - rootAbs.y - band.yStart
          : "y" in child
            ? (child as LayoutMixin).y - band.yStart
            : 0;

      section.appendChild(child);
      if ("x" in child) {
        (child as LayoutMixin).x = lx;
        (child as LayoutMixin).y = ly;
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
