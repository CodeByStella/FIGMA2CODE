import type { Rect } from "./geometry";

export type LayoutAxis = "HORIZONTAL" | "VERTICAL";

export type SizingMode = "FIXED" | "HUG" | "FILL";

export type AlignPrimary = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
export type AlignCounter = "MIN" | "CENTER" | "MAX" | "BASELINE";
export type ChildAlign = "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";

export type AutoLayoutSpec = {
  layoutMode: LayoutAxis;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  itemSpacing: number;
  primaryAxisAlignItems: AlignPrimary;
  counterAxisAlignItems: AlignCounter;
  layoutWrap?: "NO_WRAP" | "WRAP";
  counterAxisSpacing?: number;
  primaryAxisSizingMode: "FIXED" | "AUTO";
  counterAxisSizingMode: "FIXED" | "AUTO";
};

export type ChildSizingSpec = {
  nodeId: string;
  horizontal: SizingMode;
  vertical: SizingMode;
  layoutAlign: ChildAlign;
  absolute?: { x: number; y: number };
};

export type WrapperSpec = {
  /** Temporary id key used before the frame exists */
  key: string;
  name: string;
  childNodeIds: string[];
  layout: AutoLayoutSpec;
  childSizing: ChildSizingSpec[];
  /** Parent-relative position before Auto Layout (union of children) */
  bounds: Rect;
};

export type FrameTidySpec = {
  nodeId: string;
  /** Skip changing this frame's Auto Layout (already AL) */
  skipLayout: boolean;
  layout?: AutoLayoutSpec;
  /** Children to mark absolute before enabling layout */
  absoluteChildren: Array<{ nodeId: string; x: number; y: number }>;
  childSizing: ChildSizingSpec[];
  wrappers: WrapperSpec[];
  /** Fold background fills into parent and remove node */
  foldBackgroundId?: string;
  /** Keep as absolute stretch background */
  stretchBackgroundId?: string;
};

export type TidyPlan = {
  frames: FrameTidySpec[];
  /** Group node ids to convert to frames (bottom-up order) */
  groupsToFrame: string[];
  /** Single-child empty groups to unwrap */
  groupsToUnwrap: string[];
  warnings: string[];
};

export const PLUGIN_DATA_SOURCE = "tidySourceId";
export const PLUGIN_DATA_CLONE = "tidyCloneId";
export const TIDY_GAP = 80;
