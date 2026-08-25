/** Creates an off-source clone for tidy; source selection stays untouched for convert rollback. */

import type { ResolvedTarget } from "./target";
import { Rect, parentAbsRect, unionRect } from "./geometry";
import { PLUGIN_DATA_CLONE, PLUGIN_DATA_SOURCE, TIDY_GAP } from "./types";
import { tidyWarn } from "./warnings";

export type CloneResult = {
  root: SceneNode;
  sources: SceneNode[];
};

function cloneSceneNode(node: SceneNode): SceneNode {
  if (
    !("clone" in node) ||
    typeof (node as SceneNode & { clone?: unknown }).clone !== "function"
  ) {
    throw new Error(`Cannot clone node type ${node.type}`);
  }
  return (node as SceneNode & { clone: () => SceneNode }).clone();
}

function sceneChildrenOfPage(page: PageNode): SceneNode[] {
  return page.children.filter(
    (n) => n.type !== "SLICE" && n.visible !== false,
  ) as SceneNode[];
}

function absBox(node: SceneNode): Rect | null {
  return parentAbsRect(node);
}

async function removePreviousClone(source: SceneNode): Promise<void> {
  const cloneId = source.getPluginData(PLUGIN_DATA_CLONE);
  if (!cloneId) return;
  const existing = await figma.getNodeByIdAsync(cloneId);
  if (existing) {
    try {
      if (existing.parent) existing.remove();
    } catch {
      // Prior clone may already be missing from the document.
    }
  }
  source.setPluginData(PLUGIN_DATA_CLONE, "");
}

async function linkClone(source: SceneNode, clone: SceneNode): Promise<void> {
  await removePreviousClone(source);
  clone.setPluginData(PLUGIN_DATA_SOURCE, source.id);
  source.setPluginData(PLUGIN_DATA_CLONE, clone.id);
}

function placeOnPage(node: SceneNode, origin: Rect): void {
  figma.currentPage.appendChild(node);
  node.x = origin.x + origin.width + TIDY_GAP;
  node.y = origin.y;
}

/**
 * Duplicate a component main as a plain frame so tidy can restructure without
 * creating a second component definition.
 */
function cloneComponentAsFrame(component: ComponentNode): FrameNode {
  const frame = figma.createFrame();
  frame.name = `${component.name} / tidied`;
  frame.resizeWithoutConstraints(
    Math.max(1, component.width),
    Math.max(1, component.height),
  );
  frame.fills = JSON.parse(JSON.stringify(component.fills));
  frame.strokes = JSON.parse(JSON.stringify(component.strokes));
  frame.effects = JSON.parse(JSON.stringify(component.effects));
  frame.clipsContent = component.clipsContent;
  frame.opacity = component.opacity;
  if (
    "cornerRadius" in component &&
    typeof component.cornerRadius === "number"
  ) {
    frame.cornerRadius = component.cornerRadius;
  }
  if ("layoutMode" in component && component.layoutMode !== "NONE") {
    frame.layoutMode = component.layoutMode;
    frame.primaryAxisAlignItems = component.primaryAxisAlignItems;
    frame.counterAxisAlignItems = component.counterAxisAlignItems;
    frame.paddingLeft = component.paddingLeft;
    frame.paddingRight = component.paddingRight;
    frame.paddingTop = component.paddingTop;
    frame.paddingBottom = component.paddingBottom;
    frame.itemSpacing = component.itemSpacing;
    frame.primaryAxisSizingMode = component.primaryAxisSizingMode;
    frame.counterAxisSizingMode = component.counterAxisSizingMode;
  }

  for (const child of component.children) {
    const c = cloneSceneNode(child);
    frame.appendChild(c);
    c.x = child.x;
    c.y = child.y;
  }
  return frame;
}

function wrapNodesInFrame(
  nodes: SceneNode[],
  name: string,
): { frame: FrameNode; origin: Rect } {
  const boxes = nodes
    .map((n) => absBox(n))
    .filter((b): b is Rect => b !== null);
  const union = unionRect(boxes);
  if (!union) {
    throw new Error("Selected nodes have no bounding boxes");
  }

  const frame = figma.createFrame();
  frame.name = name;
  frame.fills = [];
  frame.clipsContent = false;
  frame.resizeWithoutConstraints(
    Math.max(1, union.width),
    Math.max(1, union.height),
  );

  for (const node of nodes) {
    const box = absBox(node);
    const clone = cloneSceneNode(node);
    frame.appendChild(clone);
    if (box) {
      clone.x = box.x - union.x;
      clone.y = box.y - union.y;
    }
  }

  return { frame, origin: union };
}

/**
 * Place the tidied clone beside the source via pluginData links so repeat runs replace the old clone.
 */
export async function createTidyClone(
  target: ResolvedTarget,
): Promise<CloneResult> {
  const page = figma.currentPage;

  if (target.kind === "single") {
    const source = target.nodes[0];
    await removePreviousClone(source);

    let clone: SceneNode;
    if (source.type === "COMPONENT") {
      clone = cloneComponentAsFrame(source as ComponentNode);
    } else {
      clone = cloneSceneNode(source);
      clone.name = `${source.name} / tidied`;
    }

    const origin = absBox(source) ?? {
      x: source.x,
      y: source.y,
      width: "width" in source ? source.width : 100,
      height: "height" in source ? source.height : 100,
    };

    placeOnPage(clone, origin);
    await linkClone(source, clone);

    if (source.type === "INSTANCE") {
      tidyWarn(
        `Instance "${source.name}" cloned as linked instance (no inner tidy)`,
      );
    }

    return { root: clone, sources: [source] };
  }

  if (target.kind === "page") {
    const nodes = sceneChildrenOfPage(page);
    if (nodes.length === 0) {
      throw new Error("Current page has no visible layers to tidy");
    }
    const primary =
      nodes.find(
        (n) =>
          n.type === "FRAME" ||
          n.type === "SECTION" ||
          n.type === "COMPONENT" ||
          n.type === "COMPONENT_SET",
      ) ?? nodes[0];

    await removePreviousClone(primary);
    const { frame, origin } = wrapNodesInFrame(
      nodes,
      `${page.name || "Page"} / tidied`,
    );
    placeOnPage(frame, origin);
    await linkClone(primary, frame);
    tidyWarn("Page-level tidy wrapped visible top-level layers");
    return { root: frame, sources: [primary] };
  }

  const nodes = target.nodes;
  const primary = nodes[0];
  await removePreviousClone(primary);
  const { frame, origin } = wrapNodesInFrame(nodes, `${target.label} / tidied`);
  placeOnPage(frame, origin);
  await linkClone(primary, frame);
  return { root: frame, sources: nodes };
}
