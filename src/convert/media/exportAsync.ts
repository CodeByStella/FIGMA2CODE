/*
 * This is a wrapper for exportAsync() so callers share one place for
 * getNodeByIdAsync + format typing. Loading / progress is owned by run()
 * and zipAssets (conversionStart + progress messages).
 */

/** Figma can throw or hang on empty / invisible vectors. Never wait forever. */
export const EXPORT_TIMEOUT_MS = 8000;

export const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`exportAsync timed out after ${ms}ms (${label})`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

const isExportableLiveNode = (figmaNode: BaseNode): boolean => {
  if ("visible" in figmaNode && figmaNode.visible === false) {
    return false;
  }
  if ("width" in figmaNode && "height" in figmaNode) {
    const w = (figmaNode as LayoutMixin).width;
    const h = (figmaNode as LayoutMixin).height;
    if (!(w > 0.5 && h > 0.5)) {
      return false;
    }
  }
  return true;
};

export const exportAsyncProxy = async <
  T extends string | Uint8Array = Uint8Array /* | Object */,
>(
  node: SceneNode,
  settings: ExportSettings | ExportSettingsSVGString /*| ExportSettingsREST*/,
): Promise<T> => {
  const figmaNode = (await figma.getNodeByIdAsync(node.id)) as
    | (ExportMixin & BaseNode)
    | null;

  if (!figmaNode || figmaNode.exportAsync === undefined) {
    throw new TypeError(
      "Something went wrong. This node doesn't have an exportAsync() function. Maybe check the type before calling this function.",
    );
  }

  if (!isExportableLiveNode(figmaNode)) {
    throw new Error(
      `Node ${figmaNode.type}:${figmaNode.id} has no visible layers to export`,
    );
  }

  const label = `${figmaNode.type}:${figmaNode.id} ${settings.format}`;

  // The following is necessary for typescript to not lose its mind.
  let result;
  if (settings.format === "SVG_STRING") {
    result = await withTimeout(
      figmaNode.exportAsync(settings as ExportSettingsSVGString),
      EXPORT_TIMEOUT_MS,
      label,
    );
  } else {
    result = await withTimeout(
      figmaNode.exportAsync(settings as ExportSettings),
      EXPORT_TIMEOUT_MS,
      label,
    );
  }

  return result as T;
};
