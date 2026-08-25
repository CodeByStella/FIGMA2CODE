/** Flat layer list sent to the vision model alongside the screenshot (root-local coords). */

import { parentAbsRect } from "../geometry";
import { aiLog } from "./log";

export type LayerInventoryItem = {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const TABLE_CAP = 80;

/**
 * Visible descendants with root-local bounding boxes for the vision prompt.
 * Skips instance innards — linked instances stay opaque to AI restructuring.
 */
export function buildLayerInventory(root: SceneNode): LayerInventoryItem[] {
  const rootAbs = parentAbsRect(root);
  const items: LayerInventoryItem[] = [];

  const visit = (node: SceneNode) => {
    if (node.type === "SLICE") return;
    if (node.visible === false) return;

    if (node.id !== root.id && "absoluteBoundingBox" in node) {
      const box = node.absoluteBoundingBox;
      if (box && rootAbs) {
        items.push({
          id: node.id,
          name: node.name || node.type,
          type: node.type,
          x: Math.round((box.x - rootAbs.x) * 100) / 100,
          y: Math.round((box.y - rootAbs.y) * 100) / 100,
          w: Math.round(box.width * 100) / 100,
          h: Math.round(box.height * 100) / 100,
        });
      } else if ("x" in node && "width" in node) {
        const lm = node as LayoutMixin;
        items.push({
          id: node.id,
          name: node.name || node.type,
          type: node.type,
          x: Math.round(lm.x * 100) / 100,
          y: Math.round(lm.y * 100) / 100,
          w: Math.round(lm.width * 100) / 100,
          h: Math.round(lm.height * 100) / 100,
        });
      }
    }

    // Do not traverse into instances — their children are not independently editable.
    if ("children" in node && node.type !== "INSTANCE") {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  };

  visit(root);
  items.sort((a, b) => a.y - b.y || a.x - b.x);

  aiLog("inventory", { count: items.length });
  if (items.length > TABLE_CAP) {
    aiLog(`inventory +${items.length - TABLE_CAP} more rows`);
  }

  return items;
}

/** Direct children eligible for vertical section assignment after vision returns. */
export function listRootDirectChildren(root: SceneNode): SceneNode[] {
  if (!("children" in root)) return [];
  return (root as ChildrenMixin).children.filter(
    (c) => c.type !== "SLICE" && c.visible !== false,
  ) as SceneNode[];
}
