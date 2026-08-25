/** Applies AI section bands and semantic renames to the clone before Auto Layout inference. */

import type { AiVisionResult } from "./openrouter";
import { listRootDirectChildren } from "./inventory";
import { aiLog, aiWarn } from "./log";

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
    aiLog("coord scale", {
      imageHeight: imageHeightPx,
      rootHeight,
      scale: Number(scale.toFixed(6)),
      maxY,
    });
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

function buildBands(
  splitLinesY: number[],
  sections: AiVisionResult["sections"],
  rootHeight: number,
): Array<{ name: string; yStart: number; yEnd: number }> {
  if (sections.length > 0) {
    return sections
      .map((s) => ({
        name: s.name || "Section",
        yStart: Math.max(0, s.yStart),
        yEnd: Math.min(rootHeight, Math.max(s.yStart + 1, s.yEnd)),
      }))
      .sort((a, b) => a.yStart - b.yStart);
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
  return bands;
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
    aiWarn("root cannot hold sections", root.type);
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
    aiWarn("fewer than 2 sections — skip AI wrappers", { bands });
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

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const members = assignments.get(i) || [];
    if (members.length === 0) {
      aiLog("section empty (skipped)", {
        name: band.name,
        yStart: band.yStart,
        yEnd: band.yEnd,
      });
      continue;
    }

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

    const movedNames: string[] = [];
    for (const child of members) {
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
      const w = "width" in child ? (child as LayoutMixin).width : 1;
      const h = "height" in child ? (child as LayoutMixin).height : 1;

      section.appendChild(child);
      if ("x" in child) {
        (child as LayoutMixin).x = lx;
        (child as LayoutMixin).y = ly;
      }
      movedNames.push(child.name);
      assignedCount += 1;
      void w;
      void h;
    }

    aiLog("section assign", {
      name: band.name,
      range: [band.yStart, band.yEnd],
      count: members.length,
      children: movedNames.slice(0, 20),
    });
  }

  if (unassigned.length > 0) {
    aiLog("unassigned / absolute leftovers", {
      count: unassigned.length,
      names: unassigned.map((n) => n.name).slice(0, 20),
    });
  }

  const renameStats = await applyRenamesAsync(result.renames);
  const elapsedMs = Date.now() - t0;

  aiLog("AI sections applied", {
    sectionCount: bands.length,
    assignedCount,
    unassignedCount: unassigned.length,
    ...renameStats,
    scaleApplied: scale,
    elapsedMs,
  });

  return {
    sectionCount: bands.length,
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
  const applied: string[] = [];

  for (const [id, name] of Object.entries(renames)) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
      renameSkipped += 1;
      continue;
    }
    try {
      const old = node.name;
      node.name = name;
      applied.push(`${old} → ${name}`);
      renameApplied += 1;
    } catch {
      renameSkipped += 1;
    }
  }

  if (applied.length > 0) {
    aiLog("renames applied", applied.slice(0, 40));
  }
  if (renameSkipped > 0) {
    aiLog("renames skipped", renameSkipped);
  }

  return { renameApplied, renameSkipped };
}
