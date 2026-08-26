/**
 * postMessage payload types between the Figma main thread and the UI iframe
 * (conversion results, ZIP streaming, settings, OpenRouter key status).
 */
import { LinearGradientConversion, SolidColorConversion } from "./color";
import { PluginSettings } from "./settings";

export interface HTMLPreview {
  size: { width: number; height: number };
  content: string;
}

export interface ConversionData {
  /** Head preview only; full HTML stays on the main thread until copy/display */
  codePreview: string;
  lineCount: number;
  codeBytes: number;
  settings: PluginSettings;
  /** Legacy iframe preview payload; optional for backward-compatible messages */
  htmlPreview?: HTMLPreview;
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  warnings: Warning[];
}

export interface ZipExportPayload {
  folder: string;
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
export type ZipFileMessage = Message & {
  type: "zipFile";
  path: string;
  bytes: Uint8Array;
};
export type ZipDoneMessage = Message & {
  type: "zipDone";
  folder: string;
  assetCount: number;
  failedCount: number;
};
export type ZipErrorMessage = Message & {
  type: "zipError";
  error: string;
};
export type ExportZipMessage = Message & { type: "exportZip" };
export type TidyAndConvertMessage = Message & { type: "tidyAndConvert" };
export type SetOpenRouterKeyMessage = Message & {
  type: "setOpenRouterKey";
  key: string;
};
export type OpenRouterKeyStatusMessage = Message & {
  type: "openRouterKeyStatus";
  hasKey: boolean;
};
export type RequestFullCodeMessage = Message & {
  type: "requestFullCode";
  purpose: "copy" | "display";
};
export type FullCodeMessage = Message & {
  type: "fullCode";
  code: string;
  purpose: "copy" | "display";
};
export type GetSelectionJsonMessage = Message & {
  type: "get-selection-json";
  purpose?: "copy" | "display";
  /** panel: REST JSON for the preview pane; omit for About debug copy */
  source?: "panel";
  /** panel display: send the full JSON string instead of the 25-line preview */
  full?: boolean;
};
export type SelectionJsonMessage = Message & {
  type: "selection-json";
  data?: unknown;
  purpose?: "copy" | "display";
  jsonPreview?: string;
  jsonText?: string;
  jsonLineCount?: number;
  showingFull?: boolean;
};
