import { LinearGradientConversion, SolidColorConversion } from "./color";
import { PluginSettings } from "./settings";

export interface HTMLPreview {
  size: { width: number; height: number };
  content: string;
}

export interface ConversionData {
  /** First lines of the generated document (full HTML stays in main) */
  codePreview: string;
  lineCount: number;
  codeBytes: number;
  settings: PluginSettings;
  /** @deprecated Preview removed — kept optional for message compat */
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
export type RequestFullCodeMessage = Message & {
  type: "requestFullCode";
  purpose: "copy" | "display";
};
export type FullCodeMessage = Message & {
  type: "fullCode";
  code: string;
  purpose: "copy" | "display";
};
