import { type Node } from "./figma-rest";

/** REST JSON_REST_V1 node after nodesToJSON normalization for HTML output. */
export type RestAltNode = Node & {
  styledTextSegments: Array<
    Pick<StyledTextSegment, any | "characters" | "start" | "end">
  >;
  cumulativeRotation: number;
  uniqueName: string;
  canBeFlattened: boolean;
  isRelative: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  /** Layout fields nodesToJSON fills in for HTML even when REST omits them */
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  layoutGrow?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  parent?: RestAltNode | null;
  style?: Record<string, unknown>;
  absoluteBoundingBox?: Rect | null;
};
