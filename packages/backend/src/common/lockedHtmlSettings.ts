import { PluginSettings } from "types";

/** Fixed HTML+CSS export settings. Preview and ZIP share this. */
export const lockedHtmlSettings = (
  settings: PluginSettings,
): PluginSettings => ({
  ...settings,
  showLayerNames: true,
  useColorVariables: true,
  embedImages: true,
  embedVectors: true,
  relativeAssetPaths: true,
});
