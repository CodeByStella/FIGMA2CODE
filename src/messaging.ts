/**
 * Typed postMessage helpers from the plugin main thread to the UI iframe.
 * Safe when no UI is shown (codegen-only mode).
 */
import {
  ConversionMessage,
  ConversionStartMessage,
  EmptyMessage,
  ErrorMessage,
  PluginSettings,
  SettingsChangedMessage,
} from "types";

const safePostMessage = (message: unknown) => {
  try {
    figma.ui.postMessage(message);
  } catch {
    /* No UI surface — codegen and headless runs must not throw here */
  }
};

export const postBackendMessage = safePostMessage;

export const postEmptyMessage = () =>
  postBackendMessage({ type: "empty" } as EmptyMessage);

export const postConversionStart = () =>
  postBackendMessage({ type: "conversionStart" } as ConversionStartMessage);

export const postConversionComplete = (
  conversionData: ConversionMessage | Omit<ConversionMessage, "type">,
) => postBackendMessage({ ...conversionData, type: "code" });

export const postError = (error: string) =>
  postBackendMessage({ type: "error", error } as ErrorMessage);

export const postSettingsChanged = (settings: PluginSettings) =>
  postBackendMessage({
    type: "pluginSettingsChanged",
    settings,
  } as SettingsChangedMessage);
