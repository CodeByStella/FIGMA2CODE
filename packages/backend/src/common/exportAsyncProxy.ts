/*
 * This is a wrapper for exportAsync() so callers share one place for
 * getNodeByIdAsync + format typing. Loading / progress is owned by run()
 * and zipAssets (conversionStart + progress messages).
 */
export const exportAsyncProxy = async <
  T extends string | Uint8Array = Uint8Array /* | Object */,
>(
  node: SceneNode,
  settings: ExportSettings | ExportSettingsSVGString /*| ExportSettingsREST*/,
): Promise<T> => {
  const figmaNode = (await figma.getNodeByIdAsync(node.id)) as ExportMixin;

  if (figmaNode.exportAsync === undefined) {
    throw new TypeError(
      "Something went wrong. This node doesn't have an exportAsync() function. Maybe check the type before calling this function.",
    );
  }

  // The following is necessary for typescript to not lose its mind.
  let result;
  if (settings.format === "SVG_STRING") {
    result = await figmaNode.exportAsync(settings as ExportSettingsSVGString);
    // } else if (settings.format === "JSON_REST_V1") {
    //   result = await node.exportAsync(settings as ExportSettingsREST);
  } else {
    result = await figmaNode.exportAsync(settings as ExportSettings);
  }

  return result as T;
};
