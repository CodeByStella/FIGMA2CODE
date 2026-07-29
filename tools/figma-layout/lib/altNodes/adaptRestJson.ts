import { PluginSettings } from "types";
import { calculateRectangleFromBoundingBox } from "../common/commonPosition";

type AnyNode = Record<string, any>;

const nodeNameCounters = new Map<string, number>();

/**
 * Offline adaptation of Figma REST / JSON_REST_V1 document nodes into the
 * AltNode-like shape that htmlMain / builders expect.
 *
 * Mirrors the JSON-side of processNodePair without live SceneNode APIs.
 * Text runs without embedVectors / embedImages / useColorVariables.
 */
export function adaptRestJsonToAltNodes(
  root: AnyNode | AnyNode[],
  settings: Pick<PluginSettings, "embedVectors" | "useColorVariables"> = {
    embedVectors: false,
    useColorVariables: false,
  },
): AnyNode[] {
  nodeNameCounters.clear();
  const roots = Array.isArray(root) ? root : [root];
  const out: AnyNode[] = [];

  for (const node of roots) {
    const cloned = structuredClone(node);
    const processed = processJsonNode(cloned, settings, undefined, 0);
    if (processed == null) continue;
    if (Array.isArray(processed)) out.push(...processed);
    else out.push(processed);
  }

  return out;
}

function processJsonNode(
  jsonNode: AnyNode,
  settings: Pick<PluginSettings, "embedVectors" | "useColorVariables">,
  parentNode: AnyNode | undefined,
  parentCumulativeRotation: number,
): AnyNode | AnyNode[] | null {
  if (!jsonNode?.id) return null;
  if (jsonNode.visible === false) return null;

  let nodeType = jsonNode.type as string;

  if (parentNode) {
    jsonNode.cumulativeRotation = parentCumulativeRotation;
  }

  // Empty frames → rectangle (same as processNodePair)
  if (
    (nodeType === "FRAME" ||
      nodeType === "INSTANCE" ||
      nodeType === "COMPONENT" ||
      nodeType === "COMPONENT_SET") &&
    (!jsonNode.children || jsonNode.children.length === 0)
  ) {
    jsonNode.type = "RECTANGLE";
    nodeType = "RECTANGLE";
  }

  if ("rotation" in jsonNode && jsonNode.rotation) {
    jsonNode.rotation = -jsonNode.rotation * (180 / Math.PI);
  }

  // Inline GROUP children into parent
  if (nodeType === "GROUP" && Array.isArray(jsonNode.children)) {
    const processedChildren: AnyNode[] = [];
    const visibleChildren = jsonNode.children.filter(
      (child: AnyNode) => child.visible !== false,
    );
    for (const child of visibleChildren) {
      const processedChild = processJsonNode(
        child,
        settings,
        parentNode,
        parentCumulativeRotation + (jsonNode.rotation || 0),
      );
      if (processedChild == null) continue;
      if (Array.isArray(processedChild))
        processedChildren.push(...processedChild);
      else processedChildren.push(processedChild);
    }
    return processedChildren;
  }

  if (nodeType === "SLICE") return null;

  if (parentNode) {
    jsonNode.parent = parentNode;
  }

  const cleanName = String(jsonNode.name ?? "node").trim() || "node";
  const count = nodeNameCounters.get(cleanName) || 0;
  nodeNameCounters.set(cleanName, count + 1);
  jsonNode.uniqueName =
    count === 0
      ? cleanName
      : `${cleanName}_${count.toString().padStart(2, "0")}`;

  if (nodeType === "TEXT") {
    applyTextFromRestStyle(jsonNode);
  }

  if (jsonNode.absoluteBoundingBox) {
    if (jsonNode.parent?.absoluteBoundingBox) {
      const rect = calculateRectangleFromBoundingBox(
        {
          width: jsonNode.absoluteBoundingBox.width,
          height: jsonNode.absoluteBoundingBox.height,
          x:
            jsonNode.absoluteBoundingBox.x -
            (jsonNode.parent.absoluteBoundingBox.x || 0),
          y:
            jsonNode.absoluteBoundingBox.y -
            (jsonNode.parent.absoluteBoundingBox.y || 0),
        },
        -((jsonNode.rotation || 0) + (jsonNode.cumulativeRotation || 0)),
      );
      jsonNode.width = rect.width;
      jsonNode.height = rect.height;
      jsonNode.x = rect.left;
      jsonNode.y = rect.top;
    } else {
      jsonNode.width = jsonNode.absoluteBoundingBox.width;
      jsonNode.height = jsonNode.absoluteBoundingBox.height;
      jsonNode.x = 0;
      jsonNode.y = 0;
    }
  }

  jsonNode.canBeFlattened = false;

  if (jsonNode.individualStrokeWeights) {
    jsonNode.strokeTopWeight = jsonNode.individualStrokeWeights.top;
    jsonNode.strokeBottomWeight = jsonNode.individualStrokeWeights.bottom;
    jsonNode.strokeLeftWeight = jsonNode.individualStrokeWeights.left;
    jsonNode.strokeRightWeight = jsonNode.individualStrokeWeights.right;
  }

  if (jsonNode.layoutMode) {
    jsonNode.paddingLeft ??= 0;
    jsonNode.paddingRight ??= 0;
    jsonNode.paddingTop ??= 0;
    jsonNode.paddingBottom ??= 0;
  }

  if (!jsonNode.layoutMode) jsonNode.layoutMode = "NONE";
  if (jsonNode.layoutGrow == null) jsonNode.layoutGrow = 0;
  if (!jsonNode.layoutSizingHorizontal)
    jsonNode.layoutSizingHorizontal = "FIXED";
  if (!jsonNode.layoutSizingVertical) jsonNode.layoutSizingVertical = "FIXED";
  if (!jsonNode.primaryAxisAlignItems) jsonNode.primaryAxisAlignItems = "MIN";
  if (!jsonNode.counterAxisAlignItems) jsonNode.counterAxisAlignItems = "MIN";

  const hasChildren =
    Array.isArray(jsonNode.children) && jsonNode.children.length > 0;
  if (jsonNode.layoutSizingHorizontal === "HUG" && !hasChildren) {
    jsonNode.layoutSizingHorizontal = "FIXED";
  }
  if (jsonNode.layoutSizingVertical === "HUG" && !hasChildren) {
    jsonNode.layoutSizingVertical = "FIXED";
  }

  if (hasChildren) {
    const visibleChildren = jsonNode.children.filter(
      (child: AnyNode) => child.visible !== false,
    );
    const cumulative =
      parentCumulativeRotation +
      (jsonNode.type === "GROUP" ? jsonNode.rotation || 0 : 0);
    const processedChildren: AnyNode[] = [];
    for (const child of visibleChildren) {
      const processedChild = processJsonNode(
        child,
        settings,
        jsonNode,
        cumulative,
      );
      if (processedChild == null) continue;
      if (Array.isArray(processedChild))
        processedChildren.push(...processedChild);
      else processedChildren.push(processedChild);
    }
    jsonNode.children = processedChildren;

    if (
      jsonNode.layoutMode === "NONE" ||
      jsonNode.children.some((d: AnyNode) => d.layoutPositioning === "ABSOLUTE")
    ) {
      jsonNode.isRelative = true;
    }

    adjustChildrenOrder(jsonNode);
  }

  // Offline: never call live variable / export APIs
  void settings;

  return jsonNode;
}

function applyTextFromRestStyle(jsonNode: AnyNode) {
  if (jsonNode.style && typeof jsonNode.style === "object") {
    Object.assign(jsonNode, jsonNode.style);
  }
  if (!jsonNode.textAutoResize) {
    jsonNode.textAutoResize = "NONE";
  }

  const style = jsonNode.style || {};
  const fontSize = style.fontSize ?? jsonNode.fontSize ?? 16;
  const fontFamily = style.fontFamily ?? jsonNode.fontFamily ?? "Inter";
  const fontStyle =
    style.fontPostScriptName?.includes("Italic") ||
    String(style.fontStyle || "")
      .toLowerCase()
      .includes("italic")
      ? "Italic"
      : style.fontStyle?.includes?.("Bold")
        ? "Bold"
        : "Regular";
  const fontWeight = style.fontWeight ?? jsonNode.fontWeight ?? 400;

  let letterSpacing = jsonNode.letterSpacing;
  if (typeof letterSpacing === "number") {
    letterSpacing = { unit: "PIXELS", value: letterSpacing };
  } else if (!letterSpacing || typeof letterSpacing !== "object") {
    letterSpacing = { unit: "PIXELS", value: 0 };
  }

  let lineHeight = jsonNode.lineHeight;
  if (!lineHeight || typeof lineHeight !== "object") {
    if (typeof style.lineHeightPx === "number") {
      lineHeight = { unit: "PIXELS", value: style.lineHeightPx };
    } else if (
      style.lineHeightUnit === "FONT_SIZE_%" &&
      typeof style.lineHeightPercentFontSize === "number"
    ) {
      lineHeight = {
        unit: "PERCENT",
        value: style.lineHeightPercentFontSize,
      };
    } else {
      lineHeight = { unit: "AUTO" };
    }
  }

  const fills =
    (Array.isArray(jsonNode.fills) && jsonNode.fills.length > 0
      ? jsonNode.fills
      : style.fills) || [];

  const baseSegmentName = String(jsonNode.uniqueName || jsonNode.name || "text")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toLowerCase();

  jsonNode.styledTextSegments = [
    {
      characters: jsonNode.characters ?? "",
      start: 0,
      end: String(jsonNode.characters ?? "").length,
      fontSize,
      fontName: { family: fontFamily, style: fontStyle },
      fontWeight,
      textDecoration: jsonNode.textDecoration || "NONE",
      textCase: jsonNode.textCase || "ORIGINAL",
      lineHeight,
      letterSpacing,
      fills,
      textStyleId: "",
      fillStyleId: "",
      listOptions: { type: "NONE" },
      indentation: 0,
      openTypeFeatures: {},
      uniqueId: `${baseSegmentName}_span`,
    },
  ];
}

function adjustChildrenOrder(node: AnyNode) {
  if (!node.itemReverseZIndex || !node.children || node.layoutMode === "NONE") {
    return;
  }

  const children = node.children;
  const absoluteChildren = [];
  const fixedChildren = [];

  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.layoutPositioning === "ABSOLUTE") {
      absoluteChildren.push(child);
    } else {
      fixedChildren.unshift(child);
    }
  }

  node.children = [...absoluteChildren, ...fixedChildren];
}
