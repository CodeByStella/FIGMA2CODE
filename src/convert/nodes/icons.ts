// Heuristic for SVG flatten candidates: sets canBeFlattened during nodes/toJson enrichment.

const ICON_PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  "ELLIPSE",
  "RECTANGLE",
  "STAR",
  "POLYGON",
  "REGULAR_POLYGON",
  "LINE",
]); // Plugin API: POLYGON; REST JSON: REGULAR_POLYGON

const ICON_COMPLEX_VECTOR_TYPES: ReadonlySet<string> = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
]);

// Vector types export as SVG even above the size cap — they are never layout containers.
const ICON_TYPES_IGNORE_SIZE: ReadonlySet<string> = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "POLYGON",
  "REGULAR_POLYGON",
  "STAR",
]);

const ICON_CONTAINER_TYPES: ReadonlySet<NodeType> = new Set([
  "FRAME",
  "GROUP",
  "COMPONENT",
  "INSTANCE",
]);

const DISALLOWED_ICON_TYPES: ReadonlySet<NodeType> = new Set([
  "SLICE",
  "CONNECTOR",
  "STICKY",
  "SHAPE_WITH_TEXT",
  "CODE_BLOCK",
  "WIDGET",
  "TEXT",
  "COMPONENT_SET",
]);

const DISALLOWED_CHILD_TYPES: ReadonlySet<NodeType> = new Set([
  "FRAME",
  "COMPONENT",
  "INSTANCE",
  "TEXT",
  "SLICE",
  "CONNECTOR",
  "STICKY",
  "SHAPE_WITH_TEXT",
  "CODE_BLOCK",
  "WIDGET",
  "COMPONENT_SET",
]);

function isTypicalIconSize(node: SceneNode, maxSize = 64): boolean {
  if (
    !("width" in node && "height" in node && node.width > 0 && node.height > 0)
  ) {
    return false;
  }
  return node.width <= maxSize && node.height <= maxSize;
}

function hasSvgExportSettings(node: SceneNode): boolean {
  const settingsToCheck: ReadonlyArray<ExportSettings> =
    node.exportSettings || [];
  return settingsToCheck.some((setting) => setting.format === "SVG");
}

function checkChildrenRecursively(children: ReadonlyArray<SceneNode>): {
  hasDisallowedChild: boolean;
  hasValidContent: boolean;
} {
  let hasDisallowedChild = false;
  let hasValidContent = false;

  for (const child of children) {
    if (child.visible === false) {
      continue;
    }

    if (DISALLOWED_CHILD_TYPES.has(child.type)) {
      hasDisallowedChild = true;
      break;
    }

    if (
      ICON_COMPLEX_VECTOR_TYPES.has(child.type) ||
      ICON_PRIMITIVE_TYPES.has(child.type)
    ) {
      hasValidContent = true;
    } else if (child.type === "GROUP" && "children" in child) {
      const groupResult = checkChildrenRecursively(child.children);
      if (groupResult.hasDisallowedChild) {
        hasDisallowedChild = true;
        break;
      }
      if (groupResult.hasValidContent) {
        hasValidContent = true;
      }
    }
  }

  return { hasDisallowedChild, hasValidContent };
}

/**
 * Decide whether a node should be flattened to SVG instead of div/CSS shapes.
 * Used by nodes/toJson when embedVectors is on.
 */
export function isLikelyIcon(node: SceneNode): boolean {
  if (DISALLOWED_ICON_TYPES.has(node.type)) {
    return false;
  }
  if (hasSvgExportSettings(node)) {
    return true;
  }
  if (
    !("width" in node && "height" in node && node.width > 0 && node.height > 0)
  ) {
    return ICON_TYPES_IGNORE_SIZE.has(node.type);
  }

  if (ICON_TYPES_IGNORE_SIZE.has(node.type)) {
    return true;
  }
  if (ICON_PRIMITIVE_TYPES.has(node.type)) {
    return isTypicalIconSize(node);
  }
  if (ICON_CONTAINER_TYPES.has(node.type) && "children" in node) {
    if (!isTypicalIconSize(node)) {
      return false;
    }
    const visibleChildren = node.children.filter(
      (child) => child.visible !== false,
    );

    if (visibleChildren.length === 0) {
      const hasVisibleFill =
        "fills" in node &&
        Array.isArray(node.fills) &&
        node.fills.some(
          (f) =>
            typeof f === "object" &&
            f !== null &&
            f.visible !== false &&
            ("opacity" in f ? (f.opacity ?? 1) : 1) > 0,
        );
      const hasVisibleStroke =
        "strokes" in node &&
        Array.isArray(node.strokes) &&
        node.strokes.some((s) => s.visible !== false);

      return hasVisibleFill || hasVisibleStroke;
    }

    const checkResult = checkChildrenRecursively(visibleChildren);

    if (checkResult.hasDisallowedChild) {
      return false;
    }
    if (!checkResult.hasValidContent) {
      return false;
    }
    return true;
  }

  return false;
}
