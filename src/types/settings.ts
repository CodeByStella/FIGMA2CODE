/** User-facing conversion toggles persisted in Figma clientStorage. */
export interface HTMLSettings {
  showLayerNames: boolean;
  embedImages: boolean;
  embedVectors: boolean;
  useColorVariables: boolean;
  /**
   * When true, image and SVG URLs use assets/* paths from the export cache
   * instead of data URLs. Required for standalone index.html inside the ZIP.
   */
  relativeAssetPaths?: boolean;
}

export interface PluginSettings extends HTMLSettings {
  useOldPluginVersion2025: boolean;
  responsiveRoot: boolean;
}
