import { PluginSettings } from "types";

// Preview and ZIP share the same HTML/CSS export flags (embed assets, variables, layer names).
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
