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
 * Resolve what to tidy from the current selection.
 * Empty selection → all visible top-level children of the current page.
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
