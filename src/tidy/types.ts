/** Serializable plan produced by infer and consumed by apply on the clone tree. */

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
  /** Stable key before the wrapper frame exists; remapped to node id in apply. */
  key: string;
  name: string;
  childNodeIds: string[];
  layout: AutoLayoutSpec;
  childSizing: ChildSizingSpec[];
  /** Union bounds in parent space — wrapper frame is placed here before Auto Layout. */
  bounds: Rect;
};

export type FrameTidySpec = {
  nodeId: string;
  /** True when this frame already has Auto Layout and must not be re-inferred. */
  skipLayout: boolean;
  layout?: AutoLayoutSpec;
  /** Overlays, backgrounds, and rotated layers pinned absolute before flow layout runs. */
  absoluteChildren: Array<{ nodeId: string; x: number; y: number }>;
  childSizing: ChildSizingSpec[];
  wrappers: WrapperSpec[];
  /** Plain fill background merged into parent fills (apply pins complex backgrounds instead). */
  foldBackgroundId?: string;
  /** Full-bleed background kept as an absolute stretch layer. */
  stretchBackgroundId?: string;
};

export type TidyPlan = {
  frames: FrameTidySpec[];
  /** Groups converted to frames bottom-up during apply. */
  groupsToFrame: string[];
  /** Single-child pass-through groups removed before inference. */
  groupsToUnwrap: string[];
  warnings: string[];
};

/** PluginData keys linking source selection ↔ tidied clone; horizontal gap between them on canvas. */
export const PLUGIN_DATA_SOURCE = "tidySourceId";
export const PLUGIN_DATA_CLONE = "tidyCloneId";
export const TIDY_GAP = 80;
