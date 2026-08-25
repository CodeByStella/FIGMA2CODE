import { StyledTextSegmentSubset, ParentNode, PluginAltNode } from "types";
import {
  assignParent,
  isNotEmpty,
  assignRectangleType,
  assignChildren,
} from "./svg";
import { curry } from "../../shared/curry";

// Pre-2025 conversion path: clones plugin nodes in-process instead of JSON_REST_V1 + enrich.
export const isTypeOrGroupOfTypes = curry(
  (matchTypes: NodeType[], node: SceneNode): boolean => {
    if (node.visible === false || matchTypes.includes(node.type)) return true;

    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) {
        const childNode = node.children[i];
        const result = isTypeOrGroupOfTypes(matchTypes, childNode);
        if (result) continue;
        return false;
      }
      return true;
    }

    return false;
  },
);

export let globalTextStyleSegments: Record<string, StyledTextSegmentSubset[]> =
  {};

// Legacy flatten check: entire subtree must be vector primitives (icons.ts is used in the modern path).
const canBeFlattened = isTypeOrGroupOfTypes([
  "VECTOR",
  "STAR",
  "POLYGON",
  "BOOLEAN_OPERATION",
]);

export const convertNodeToAltNode =
  (parent: ParentNode | null) =>
  (node: SceneNode): SceneNode => {
    if ((node as any).type === "SLOT") {
      const slotNode = node as SceneNode & ChildrenMixin;
      const group = cloneNode(slotNode, parent);
      const groupChildren = oldConvertNodesToAltNodes(slotNode.children, group);
      return assignChildren(groupChildren, group);
    }

    const type = node.type;
    switch (type) {
      case "RECTANGLE":
      case "ELLIPSE":
      case "LINE":
      case "STAR":
      case "POLYGON":
      case "VECTOR":
      case "BOOLEAN_OPERATION":
        return cloneNode(node, parent);

      case "FRAME":
      case "INSTANCE":
      case "COMPONENT":
      case "COMPONENT_SET":
        if (node.children.length === 0)
          return cloneAsRectangleNode(node, parent);

      case "GROUP":
        if (type === "GROUP" && node.children.length === 1 && node.visible)
          return convertNodeToAltNode(parent)(node.children[0]);

      case "SECTION":
        const group = cloneNode(node, parent);
        const groupChildren = oldConvertNodesToAltNodes(node.children, group);
        return assignChildren(groupChildren, group);

      case "TEXT":
        globalTextStyleSegments[node.id] = extractStyledTextSegments(node);
        return cloneNode(node, parent);

      case "SLICE":
        throw new Error(
          `Sorry, Slices are not supported. Type:${node.type} id:${node.id}`,
        );
      default:
        throw new Error(
          `Sorry, an unsupported node type was selected. Type:${node.type} id:${node.id}`,
        );
    }
  };

export const oldConvertNodesToAltNodes = (
  sceneNode: ReadonlyArray<SceneNode>,
  parent: ParentNode | null,
): Array<SceneNode> =>
  sceneNode.map(convertNodeToAltNode(parent)).filter(isNotEmpty);

export const cloneNode = <T extends BaseNode>(
  node: T,
  parent: ParentNode | null,
): T => {
  const cloned = {} as T;
  // Shallow copy; parent/children are wired separately to preserve tree shape.
  for (const prop in node) {
    if (
      prop !== "parent" &&
      prop !== "children" &&
      prop !== "horizontalPadding" &&
      prop !== "verticalPadding" &&
      prop !== "mainComponent" &&
      prop !== "masterComponent" &&
      prop !== "variantProperties" &&
      prop !== "get_annotations" &&
      prop !== "componentPropertyDefinitions" &&
      prop !== "exposedInstances" &&
      prop !== "instances" &&
      prop !== "componentProperties" &&
      prop !== "componenPropertyReferences" &&
      prop !== "constrainProportions"
    ) {
      cloned[prop as keyof T] = node[prop as keyof T];
    }
  }

  assignParent(parent, cloned);

  const altNode = {
    ...cloned,
    parent: cloned.parent,
    originalNode: node,
    canBeFlattened: canBeFlattened(node),
  } as PluginAltNode<T>;

  if (globalTextStyleSegments[node.id]) {
    altNode.styledTextSegments = globalTextStyleSegments[node.id];
  }

  return altNode;
};

// Empty frame → rectangle so shape CSS applies without a wrapper div.
const cloneAsRectangleNode = <T extends BaseNode>(
  node: T,
  parent: ParentNode | null,
): RectangleNode => {
  const clonedNode = cloneNode(node, parent);

  assignRectangleType(clonedNode);

  return clonedNode as unknown as RectangleNode;
};

const extractStyledTextSegments = (node: TextNode) =>
  node.getStyledTextSegments([
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
