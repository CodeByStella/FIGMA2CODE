import { addWarning } from "../warnings";
import { withTimeout } from "../media/exportAsync";
import { PluginSettings, RestAltNode } from "types";
import { variableToColorName } from "../color/variables";
import { Node, Paint } from "../../types/figma-rest";
import { calculateRectangleFromBoundingBox } from "../layout/position";
import { isLikelyIcon } from "./icons";

/**
 * Enrich JSON_REST_V1 export with plugin-API-only fields (text segments, variables, SVG flatten).
 * Called for every selection change before HTML emit.
 */
// Optional timing counters (not logged by default; keep for local profiling hooks).
export let getNodeByIdAsyncTime = 0;
export let getNodeByIdAsyncCalls = 0;
export let getStyledTextSegmentsTime = 0;
export let getStyledTextSegmentsCalls = 0;
export let processColorVariablesTime = 0;
export let processColorVariablesCalls = 0;

export const resetPerformanceCounters = () => {
  getNodeByIdAsyncTime = 0;
  getNodeByIdAsyncCalls = 0;
  getStyledTextSegmentsTime = 0;
  getStyledTextSegmentsCalls = 0;
  processColorVariablesTime = 0;
  processColorVariablesCalls = 0;
};

// Duplicate layer names get a numeric suffix so generated HTML ids stay unique.
const nodeNameCounters: Map<string, number> = new Map();

const variableCache = new Map<string, string>();

export const clearVariableCache = () => {
  variableCache.clear();
};

/** Resolve Figma variable id → CSS-safe name; cached per conversion run. */
const memoizedVariableToColorName = async (
  variableId: string,
): Promise<string> => {
  if (!variableCache.has(variableId)) {
    const colorName = (await variableToColorName(variableId)).replaceAll(
      ",",
      "",
    );
    variableCache.set(variableId, colorName);
    return colorName;
  }
  return variableCache.get(variableId)!;
};

/** Look up a bound variable name from a hex key in a node's SVG color map. */
export const getVariableNameFromColor = (
  hexColor: string,
  colorMappings?: Map<string, { variableId: string; variableName: string }>,
): string | undefined => {
  if (!colorMappings) return undefined;

  const normalizedColor = hexColor.toLowerCase();
  const mapping = colorMappings.get(normalizedColor);

  if (mapping) {
    return mapping.variableName;
  }

  return undefined;
};

/**
 * Build hex → variable map for a subtree. SVG export uses literal colors;
 * this map lets svg.ts rewrite them to var(--name, fallback).
 */
const collectNodeColorVariables = async (
  node: any,
): Promise<Map<string, { variableId: string; variableName: string }>> => {
  const colorMappings = new Map<
    string,
    { variableId: string; variableName: string }
  >();

  const addMappingFromPaint = (paint: any) => {
    if (
      paint.type === "SOLID" &&
      paint.variableColorName &&
      paint.color &&
      paint.boundVariables?.color
    ) {
      const variableName =
        paint.boundVariables.color.name || paint.variableColorName;

      if (variableName) {
        const sanitizedVarName = variableName.replace(/[^a-zA-Z0-9_-]/g, "-");

        const colorInfo = {
          variableId: paint.boundVariables.color.id,
          variableName: sanitizedVarName,
        };

        const r = Math.round(paint.color.r * 255);
        const g = Math.round(paint.color.g * 255);
        const b = Math.round(paint.color.b * 255);

        const hexColor =
          `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toLowerCase();
        colorMappings.set(hexColor, colorInfo);

        // htmlColor() emits named "white"/"black" for pure RGB; SVG strings may use those too.
        if (r === 255 && g === 255 && b === 255) {
          colorMappings.set("white", colorInfo);
          colorMappings.set("rgb(255,255,255)", colorInfo);
        } else if (r === 0 && g === 0 && b === 0) {
          colorMappings.set("black", colorInfo);
          colorMappings.set("rgb(0,0,0)", colorInfo);
        }
      }
    }
  };

  if (node.fills && Array.isArray(node.fills)) {
    node.fills.forEach(addMappingFromPaint);
  }

  if (node.strokes && Array.isArray(node.strokes)) {
    node.strokes.forEach(addMappingFromPaint);
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childMappings = await collectNodeColorVariables(child);
      childMappings.forEach((value, key) => {
        colorMappings.set(key, value);
      });
    }
  }

  return colorMappings;
};

/** Attach variableColorName to paints so html/color.ts can emit var(--token, fallback). */
export const processColorVariables = async (paint: Paint) => {
  const start = Date.now();
  processColorVariablesCalls++;

  if (
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND" ||
    paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL"
  ) {
    const stopsWithVariables = paint.gradientStops.filter(
      (stop) => stop.boundVariables?.color,
    );

    if (stopsWithVariables.length > 0) {
      await Promise.all(
        stopsWithVariables.map(async (stop) => {
          (stop as any).variableColorName = await memoizedVariableToColorName(
            stop.boundVariables!.color!.id,
          );
        }),
      );
    }
  } else if (paint.type === "SOLID" && paint.boundVariables?.color) {
    (paint as any).variableColorName = await memoizedVariableToColorName(
      paint.boundVariables.color.id,
    );
  }

  processColorVariablesTime += Date.now() - start;
};

const processEffectVariables = async (
  paint: DropShadowEffect | InnerShadowEffect,
) => {
  const start = Date.now();
  processColorVariablesCalls++;

  if (paint.boundVariables?.color) {
    (paint as any).variableColorName = await memoizedVariableToColorName(
      paint.boundVariables.color.id,
    );
  }

  processColorVariablesTime += Date.now() - start;
};

const getColorVariables = async (
  node: RestAltNode,
  settings: PluginSettings,
) => {
  if (settings.useColorVariables) {
    if ("fills" in node && Array.isArray(node.fills)) {
      await Promise.all(
        (node.fills as Paint[]).map((fill) => processColorVariables(fill)),
      );
    }
    if ("strokes" in node && Array.isArray(node.strokes)) {
      await Promise.all(
        (node.strokes as Paint[]).map((stroke) =>
          processColorVariables(stroke),
        ),
      );
    }
    if ("effects" in node && Array.isArray(node.effects)) {
      await Promise.all(
        node.effects
          .filter(
            (effect) =>
              effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW",
          )
          .map((effect) =>
            processEffectVariables(
              effect as DropShadowEffect | InnerShadowEffect,
            ),
          ),
      );
    }
  }
};

function adjustChildrenOrder(node: any) {
  if (!node.itemReverseZIndex || !node.children || node.layoutMode === "NONE") {
    return;
  }

  const children = node.children;
  const absoluteChildren = [];
  const fixedChildren = [];

  // Figma reverse-Z paint order: absolute children are painted above flow children.
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

/**
 * Walk REST JSON + live plugin node in parallel. Fills gaps JSON_REST_V1 omits
 * (size, text segments, variables, flatten flags) and inlines GROUP children.
 */
const processNodePair = async (
  jsonNode: RestAltNode,
  figmaNode: SceneNode,
  settings: PluginSettings,
  parentNode?: RestAltNode,
  parentCumulativeRotation: number = 0,
): Promise<RestAltNode | RestAltNode[] | null> => {
  if (!jsonNode.id) return null;
  if (jsonNode.visible === false) return null;

  const nodeType = jsonNode.type;

  // GROUP rotation is distributed to children; cumulativeRotation tracks inherited angle.
  if (parentNode) {
    jsonNode.cumulativeRotation = parentCumulativeRotation;
  }

  // Childless frames become rectangles so HTML emitters treat them as shapes.
  if (
    (nodeType === "FRAME" ||
      nodeType === "INSTANCE" ||
      nodeType === "COMPONENT" ||
      nodeType === "COMPONENT_SET") &&
    (!jsonNode.children || jsonNode.children.length === 0)
  ) {
    (jsonNode as any).type = "RECTANGLE";
    return processNodePair(
      jsonNode,
      figmaNode,
      settings,
      parentNode,
      parentCumulativeRotation,
    );
  }

  if ("rotation" in jsonNode && jsonNode.rotation) {
    jsonNode.rotation = -jsonNode.rotation * (180 / Math.PI);
  }

  // GROUPs are flattened: children are hoisted with inherited rotation, group node is dropped.
  if (nodeType === "GROUP" && jsonNode.children) {
    const processedChildren = [];

    if (
      Array.isArray(jsonNode.children) &&
      figmaNode &&
      "children" in figmaNode
    ) {
      const visibleJsonChildren = jsonNode.children.filter(
        (child) => child.visible !== false,
      ) as RestAltNode[];

      const figmaChildrenById = new Map();
      figmaNode.children.forEach((child) => {
        figmaChildrenById.set(child.id, child);
      });

      for (const child of visibleJsonChildren) {
        const figmaChild = figmaChildrenById.get(child.id);
        if (!figmaChild) continue;

        const processedChild = await processNodePair(
          child,
          figmaChild,
          settings,
          parentNode,
          parentCumulativeRotation + (jsonNode.rotation || 0),
        );

        if (processedChild !== null) {
          if (Array.isArray(processedChild)) {
            processedChildren.push(...processedChild);
          } else {
            processedChildren.push(processedChild);
          }
        }
      }
    }

    return processedChildren;
  }

  if (nodeType === "SLICE") {
    return null;
  }

  if (parentNode) {
    (jsonNode as any).parent = parentNode;
  }

  const cleanName = jsonNode.name.trim();

  const count = nodeNameCounters.get(cleanName) || 0;
  nodeNameCounters.set(cleanName, count + 1);

  jsonNode.uniqueName =
    count === 0
      ? cleanName
      : `${cleanName}_${count.toString().padStart(2, "0")}`;

  if (figmaNode.type === "TEXT") {
    const getSegmentsStart = Date.now();
    getStyledTextSegmentsCalls++;
    let styledTextSegments = figmaNode.getStyledTextSegments([
      "fontName",
      "fills",
      "fontSize",
      "fontWeight",
      "hyperlink",
      "indentation",
      "letterSpacing",
      "lineHeight",
      "listOptions",
      "textCase",
      "textDecoration",
      "textStyleId",
      "fillStyleId",
      "openTypeFeatures",
    ]);
    getStyledTextSegmentsTime += Date.now() - getSegmentsStart;

    if (styledTextSegments.length > 0) {
      const baseSegmentName = (jsonNode.uniqueName || jsonNode.name)
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .toLowerCase();

      styledTextSegments = await Promise.all(
        styledTextSegments.map(async (segment, index) => {
          const mutableSegment: any = Object.assign({}, segment);

          if (settings.useColorVariables && segment.fills) {
            mutableSegment.fills = await Promise.all(
              segment.fills.map(async (d) => {
                if (
                  d.blendMode !== "PASS_THROUGH" &&
                  d.blendMode !== "NORMAL"
                ) {
                  addWarning("BlendMode is not supported in Text colors");
                }
                const fill = { ...d } as Paint;
                await processColorVariables(fill);
                return fill;
              }),
            );
          }

          if (styledTextSegments.length === 1) {
            (mutableSegment as any).uniqueId = `${baseSegmentName}_span`;
          } else {
            (mutableSegment as any).uniqueId =
              `${baseSegmentName}_span_${(index + 1).toString().padStart(2, "0")}`;
          }
          return mutableSegment;
        }),
      );

      jsonNode.styledTextSegments = styledTextSegments;
    }

    // Flatten style object onto node so HTML builders read font props at top level.
    Object.assign(jsonNode, jsonNode.style);
    if (!jsonNode.textAutoResize) {
      jsonNode.textAutoResize = "NONE";
    }
  }

  if ("absoluteBoundingBox" in jsonNode && jsonNode.absoluteBoundingBox) {
    if (jsonNode.parent) {
      // JSON_REST_V1 lacks width/height; derive from bounding box and rotation.
      const rect = calculateRectangleFromBoundingBox(
        {
          width: jsonNode.absoluteBoundingBox.width,
          height: jsonNode.absoluteBoundingBox.height,
          x:
            jsonNode.absoluteBoundingBox.x -
            (jsonNode.parent?.absoluteBoundingBox?.x || 0),
          y:
            jsonNode.absoluteBoundingBox.y -
            (jsonNode.parent?.absoluteBoundingBox?.y || 0),
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

  if (settings.embedVectors && !parentNode?.canBeFlattened) {
    const isIcon = isLikelyIcon(jsonNode as any);
    (jsonNode as any).canBeFlattened = isIcon;

    if (isIcon && settings.useColorVariables) {
      (jsonNode as any)._collectColorMappings = true;
    }
  } else {
    (jsonNode as any).canBeFlattened = false;
  }

  if (
    "individualStrokeWeights" in jsonNode &&
    jsonNode.individualStrokeWeights
  ) {
    (jsonNode as any).strokeTopWeight = jsonNode.individualStrokeWeights.top;
    (jsonNode as any).strokeBottomWeight =
      jsonNode.individualStrokeWeights.bottom;
    (jsonNode as any).strokeLeftWeight = jsonNode.individualStrokeWeights.left;
    (jsonNode as any).strokeRightWeight =
      jsonNode.individualStrokeWeights.right;
  }

  await getColorVariables(jsonNode, settings);

  // Downstream padding helpers assume all four sides exist, even when zero.
  if ("layoutMode" in jsonNode && jsonNode.layoutMode) {
    if (jsonNode.paddingLeft === undefined) {
      jsonNode.paddingLeft = 0;
    }
    if (jsonNode.paddingRight === undefined) {
      jsonNode.paddingRight = 0;
    }
    if (jsonNode.paddingTop === undefined) {
      jsonNode.paddingTop = 0;
    }
    if (jsonNode.paddingBottom === undefined) {
      jsonNode.paddingBottom = 0;
    }
  }

  // REST JSON may omit layout defaults; normalize so HTML sizing logic does not branch on undefined.
  if (!jsonNode.layoutMode) jsonNode.layoutMode = "NONE";
  if (!jsonNode.layoutGrow) jsonNode.layoutGrow = 0;
  if (!jsonNode.layoutSizingHorizontal)
    jsonNode.layoutSizingHorizontal = "FIXED";
  if (!jsonNode.layoutSizingVertical) jsonNode.layoutSizingVertical = "FIXED";
  if (!jsonNode.primaryAxisAlignItems) {
    jsonNode.primaryAxisAlignItems = "MIN";
  }
  if (!jsonNode.counterAxisAlignItems) {
    jsonNode.counterAxisAlignItems = "MIN";
  }

  // HUG with no children would produce invalid flex sizing in CSS.
  const hasChildren =
    "children" in jsonNode &&
    jsonNode.children &&
    Array.isArray(jsonNode.children) &&
    jsonNode.children.length > 0;

  if (jsonNode.layoutSizingHorizontal === "HUG" && !hasChildren) {
    jsonNode.layoutSizingHorizontal = "FIXED";
  }
  if (jsonNode.layoutSizingVertical === "HUG" && !hasChildren) {
    jsonNode.layoutSizingVertical = "FIXED";
  }

  if (
    "children" in jsonNode &&
    jsonNode.children &&
    Array.isArray(jsonNode.children) &&
    "children" in figmaNode
  ) {
    const visibleJsonChildren = jsonNode.children.filter(
      (child) => child.visible !== false,
    ) as RestAltNode[];

    const figmaChildrenById = new Map();
    figmaNode.children.forEach((child) => {
      figmaChildrenById.set(child.id, child);
    });

    const cumulative =
      parentCumulativeRotation +
      (jsonNode.type === "GROUP" ? jsonNode.rotation || 0 : 0);

    const processedChildren: RestAltNode[] = [];

    for (const child of visibleJsonChildren) {
      const figmaChild = figmaChildrenById.get(child.id);
      if (!figmaChild) continue;

      const processedChild = await processNodePair(
        child,
        figmaChild,
        settings,
        jsonNode,
        cumulative,
      );

      if (processedChild !== null) {
        if (Array.isArray(processedChild)) {
          processedChildren.push(...processedChild);
        } else {
          processedChildren.push(processedChild);
        }
      }
    }

    (jsonNode as RestAltNode & { children: RestAltNode[] }).children =
      processedChildren;

    if (
      jsonNode.layoutMode === "NONE" ||
      jsonNode.children.some(
        (d: any) =>
          "layoutPositioning" in d && d.layoutPositioning === "ABSOLUTE",
      )
    ) {
      jsonNode.isRelative = true;
    }

    adjustChildrenOrder(jsonNode);
  }

  if ((jsonNode as any)._collectColorMappings) {
    (jsonNode as any).colorVariableMappings =
      await collectNodeColorVariables(jsonNode);
    delete (jsonNode as any)._collectColorMappings;
  }

  return jsonNode;
};

/** Export selection via JSON_REST_V1, then enrich each node through processNodePair. */
export const nodesToJSON = async (
  nodes: ReadonlyArray<SceneNode>,
  settings: PluginSettings,
): Promise<Node[]> => {
  nodeNameCounters.clear();
  const nodeResults = await Promise.all(
    nodes.map(async (node) => {
      const nodeDoc = (
        (await withTimeout(
          node.exportAsync({
            format: "JSON_REST_V1",
          }),
          20000,
          `${node.type}:${node.id} JSON_REST_V1`,
        )) as any
      ).document;

      let nodeCumulativeRotation = 0;

      // GROUP → FRAME at export; rotation moves to cumulativeRotation for children.
      if (node.type === "GROUP") {
        nodeDoc.type = "FRAME";

        if ("rotation" in nodeDoc && nodeDoc.rotation) {
          nodeCumulativeRotation = -nodeDoc.rotation * (180 / Math.PI);
          nodeDoc.rotation = 0;
        }
      }

      return {
        nodeDoc,
        nodeCumulativeRotation,
      };
    }),
  );

  const result: Node[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const processedNode = await processNodePair(
      nodeResults[i].nodeDoc,
      nodes[i],
      settings,
      undefined,
      nodeResults[i].nodeCumulativeRotation,
    );
    if (processedNode !== null) {
      if (Array.isArray(processedNode)) {
        result.push(...processedNode);
      } else {
        result.push(processedNode);
      }
    }
  }

  return result;
};
