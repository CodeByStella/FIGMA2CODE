/** Resolves what the user selected (or the whole page) into a tidy target. */

export type TargetKind = "single" | "multi" | "page";

export type ResolvedTarget = {
  kind: TargetKind;
  nodes: SceneNode[];
  label: string;
};

const UNSUPPORTED = new Set(["SLICE", "DOCUMENT", "PAGE"]);

function isSceneNode(n: BaseNode): n is SceneNode {
  return n.type !== "DOCUMENT" && n.type !== "PAGE" && !UNSUPPORTED.has(n.type);
}

/**
 * Empty selection tidies all visible top-level page children — common when the user
 * wants a full-page export without manually selecting every frame.
 */
export function resolveTidyTarget(): ResolvedTarget {
  const selection = figma.currentPage.selection.filter(isSceneNode);

  if (selection.length === 0) {
    return {
      kind: "page",
      nodes: [],
      label: figma.currentPage.name || "Page",
    };
  }

  if (selection.length === 1) {
    const node = selection[0];
    if (node.type === "SLICE") {
      throw new Error("SLICE nodes cannot be tidied");
    }
    return {
      kind: "single",
      nodes: [node],
      label: node.name || node.type,
    };
  }

  return {
    kind: "multi",
    nodes: selection,
    label: selection[0].name || "Selection",
  };
}
