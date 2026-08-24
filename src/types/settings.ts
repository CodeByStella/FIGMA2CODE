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
