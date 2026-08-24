import "@figma/plugin-typings";
// Settings
export interface HTMLSettings {
  showLayerNames: boolean;
  embedImages: boolean;
  embedVectors: boolean;
  useColorVariables: boolean;
  /**
   * When true, image/SVG URLs use relative paths from the ZIP asset cache
   * (e.g. `assets/foo.png`) instead of data URLs. Used for `index.html` in the ZIP.
   */
  relativeAssetPaths?: boolean;
}
export interface PluginSettings extends HTMLSettings {
  useOldPluginVersion2025: boolean;
  responsiveRoot: boolean;
}
// Messaging
export interface ConversionData {
  code: string;
  settings: PluginSettings;
  /** @deprecated Preview removed — kept optional for message compat */
  htmlPreview?: HTMLPreview;
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  warnings: Warning[];
  /** Optional ZIP payload for UI download (base64 files) */
  zipExport?: ZipExportPayload;
}

export interface ZipExportPayload {
  folder: string;
  /** Relative path → base64 */
  files: Record<string, string>;
  assetCount: number;
  failedCount: number;
}

export type Warning = string;
export type Warnings = Set<Warning>;

export interface Message {
  type: string;
}
export interface UIMessage {
  pluginMessage: Message;
}
export type EmptyMessage = Message & { type: "empty" };
export type ConversionStartMessage = Message & { type: "conversionStart" };
export type ProgressMessage = Message & {
  type: "progress";
  message: string;
  percent?: number;
};
export type ConversionMessage = Message & {
  type: "code";
} & ConversionData;
export type SettingWillChangeMessage<T> = Message & {
  type: "pluginSettingWillChange";
  key: string;
  value: T;
};
export type SettingsChangedMessage = Message & {
  type: "pluginSettingsChanged";
  settings: PluginSettings;
};
export type ErrorMessage = Message & {
  type: "error";
  error: string;
};
export type ZipStartMessage = Message & { type: "zipStart" };
export type ZipReadyMessage = Message & {
  type: "zipReady";
  zipExport: ZipExportPayload;
};
export type ZipErrorMessage = Message & {
  type: "zipError";
  error: string;
};
/** UI → plugin: build and return ZIP payload */
export type ExportZipMessage = Message & { type: "exportZip" };

// Nodes
export type ParentNode = BaseNode & ChildrenMixin;

export type AltNodeMetadata<T extends BaseNode> = {
  originalNode: T;
  canBeFlattened: boolean;
  svg?: string;
  base64?: string;
};
export type AltNode<T extends BaseNode> = T & AltNodeMetadata<T>;

export type ExportableNode = SceneNode & ExportMixin & MinimalFillsMixin;

// Styles & Conversions

export type LayoutMode =
  | ""
  | "Absolute"
  | "TopStart"
  | "TopCenter"
  | "TopEnd"
  | "CenterStart"
  | "Center"
  | "CenterEnd"
  | "BottomStart"
  | "BottomCenter"
  | "BottomEnd";

export interface BoundingRect {
  x: number;
  y: number;
}

interface AllSides {
  all: number;
}
interface Sides {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface Corners {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}
interface HorizontalAndVertical {
  horizontal: number;
  vertical: number;
}

export type PaddingType = Sides | AllSides | HorizontalAndVertical;
export type BorderSide = AllSides | Sides;
export type CornerRadius = AllSides | Corners;

export type SizeValue = number | "fill" | null;
export interface Size {
  readonly width: SizeValue;
  readonly height: SizeValue;
}

export type StyledTextSegmentSubset = Omit<
  StyledTextSegment,
  "listSpacing" | "paragraphIndent" | "paragraphSpacing" | "textStyleOverrides"
>;

export type FontWeightNumber =
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type ColorSpec = {
  source: string;
  rgb: RGB;
};

export type SolidColorConversion = {
  hex: string;
  colorName: string;
  exportValue: string;
  contrastWhite: number;
  contrastBlack: number;
  meta?: string;
};
export type LinearGradientConversion = {
  cssPreview: string;
  exportValue: string;
};

export interface HTMLPreview {
  size: { width: number; height: number };
  content: string;
}
