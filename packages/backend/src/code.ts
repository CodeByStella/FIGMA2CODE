import {
  retrieveGenericLinearGradients,
  retrieveGenericSolidUIColors,
} from "./common/retrieveUI/retrieveColors";
import { clearWarnings, warnings } from "./common/commonConversionWarnings";
import {
  postConversionComplete,
  postConversionStart,
  postEmptyMessage,
  postError,
  postBackendMessage,
} from "./messaging";
import { PluginSettings, ZipExportPayload } from "types";
import { oldConvertNodesToAltNodes } from "./altNodes/oldAltConversion";
import {
  getNodeByIdAsyncCalls,
  getNodeByIdAsyncTime,
  getStyledTextSegmentsCalls,
  getStyledTextSegmentsTime,
  nodesToJSON,
  processColorVariablesCalls,
  processColorVariablesTime,
  resetPerformanceCounters,
} from "./altNodes/jsonNodeConversion";
import { exportZipAssets } from "./export/zipAssets";
import { clearAssetCache } from "./export/assetCache";
import { applyAssetFlagsToTree } from "./export/applyAssetFlags";
import {
  buildZipIndexHtml,
  indexHtmlToZipBase64,
} from "./export/buildStaticHtml";
import { lockedHtmlSettings } from "./common/lockedHtmlSettings";

let lastZipExport: { rootId: string; zipExport: ZipExportPayload } | null =
  null;

async function convertSelection(
  settings: PluginSettings,
  useOldPluginVersion2025: boolean,
) {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    return null;
  }

  let convertedSelection: any;
  if (useOldPluginVersion2025) {
    convertedSelection = oldConvertNodesToAltNodes(selection, null);
  } else {
    const start = Date.now();
    convertedSelection = await nodesToJSON(selection, settings);
    console.log(`[benchmark] nodesToJSON: ${Date.now() - start}ms`);
  }

  if (!convertedSelection || convertedSelection.length === 0) {
    return null;
  }

  applyAssetFlagsToTree(convertedSelection);
  return { selection, convertedSelection };
}

/** Selection change: export assets then build the same index.html the ZIP ships. */
export const run = async (settings: PluginSettings) => {
  resetPerformanceCounters();
  clearWarnings();
  clearAssetCache();
  postConversionStart();

  try {
    const { useOldPluginVersion2025 } = settings;
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      postEmptyMessage();
      return;
    }

    const effectiveSettings = lockedHtmlSettings(settings);
    const nodeToJSONStart = Date.now();

    lastZipExport = null;
    const { zipExport } = await exportZipAssets(selection);

    const converted = await convertSelection(
      effectiveSettings,
      useOldPluginVersion2025,
    );
    if (!converted) {
      postEmptyMessage();
      return;
    }

    const convertToCodeStart = Date.now();
    const code = await buildZipIndexHtml(
      converted.convertedSelection,
      effectiveSettings,
      selection[0]?.name || "export",
    );
    zipExport.files["index.html"] = indexHtmlToZipBase64(code);
    lastZipExport = { rootId: selection[0].id, zipExport };
    console.log(
      `[benchmark] convertToCode: ${Date.now() - convertToCodeStart}ms`,
    );

    const colors = await retrieveGenericSolidUIColors();
    const gradients = await retrieveGenericLinearGradients();
    console.log(
      `[benchmark] total generation time: ${Date.now() - nodeToJSONStart}ms`,
    );
    console.log(
      `[benchmark] getNodeByIdAsync: ${getNodeByIdAsyncTime}ms (${getNodeByIdAsyncCalls} calls)`,
    );
    console.log(
      `[benchmark] getStyledTextSegments: ${getStyledTextSegmentsTime}ms (${getStyledTextSegmentsCalls} calls)`,
    );
    console.log(
      `[benchmark] processColorVariables: ${processColorVariablesTime}ms (${processColorVariablesCalls} calls)`,
    );

    postConversionComplete({
      code,
      colors,
      gradients,
      settings: effectiveSettings,
      warnings: [...warnings],
    });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "Code generation failed");
    console.error("[run] conversion failed", err);
    postError(message);
  }
};

/** On-demand ZIP: reuse the last preview package when the selection is unchanged. */
export const exportZipPackage = async (settings: PluginSettings) => {
  postBackendMessage({ type: "zipStart" });

  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    postBackendMessage({
      type: "zipError",
      error: "Select a frame before downloading the ZIP",
    });
    return;
  }

  const rootId = selection[0].id;
  if (
    lastZipExport &&
    lastZipExport.rootId === rootId &&
    lastZipExport.zipExport.files["index.html"]
  ) {
    postBackendMessage({
      type: "zipReady",
      zipExport: lastZipExport.zipExport,
    } as { type: "zipReady"; zipExport: ZipExportPayload });
    return;
  }

  const effectiveSettings = lockedHtmlSettings(settings);

  try {
    const { zipExport } = await exportZipAssets(selection);

    postBackendMessage({
      type: "progress",
      message: "Building index.html…",
      percent: 88,
    });

    const converted = await convertSelection(
      effectiveSettings,
      settings.useOldPluginVersion2025,
    );
    if (converted) {
      try {
        const indexHtml = await buildZipIndexHtml(
          converted.convertedSelection,
          effectiveSettings,
          selection[0]?.name || "export",
        );
        zipExport.files["index.html"] = indexHtmlToZipBase64(indexHtml);
      } catch (err) {
        console.warn("[exportZipPackage] index.html failed", err);
      }
    }

    lastZipExport = { rootId, zipExport };
    postBackendMessage({
      type: "zipReady",
      zipExport,
    } as { type: "zipReady"; zipExport: ZipExportPayload });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "ZIP export failed");
    console.error("[exportZipPackage]", err);
    postBackendMessage({ type: "zipError", error: message });
  }
};
