import {
  retrieveGenericLinearGradients,
  retrieveGenericSolidUIColors,
} from "./colors";
import { clearWarnings, warnings } from "./warnings";
import {
  postConversionComplete,
  postConversionStart,
  postEmptyMessage,
  postError,
  postBackendMessage,
} from "../messaging";
import { PluginSettings } from "types";
import { oldConvertNodesToAltNodes } from "./nodes/legacy";
import {
  clearVariableCache,
  getNodeByIdAsyncCalls,
  getNodeByIdAsyncTime,
  getStyledTextSegmentsCalls,
  getStyledTextSegmentsTime,
  nodesToJSON,
  processColorVariablesCalls,
  processColorVariablesTime,
  resetPerformanceCounters,
} from "./nodes/toJson";
import { exportZipAssets, planAssetTargets } from "../export/zip";
import { clearAssetCache } from "../export/cache";
import { applyAssetFlagsToTree } from "../export/flags";
import { buildZipIndexHtml } from "../export/html";
import { lockedHtmlSettings } from "./settings";
import { utf8Encode } from "../shared/utf8";

const PREVIEW_LINES = 25;

let lastPreview: { rootId: string; html: string } | null = null;

function snippetFromHtml(html: string) {
  const lines = html.split("\n");
  const lineCount = lines.length;
  const codeBytes = utf8Encode(html).length;
  const codePreview =
    lineCount <= PREVIEW_LINES
      ? html
      : `${lines.slice(0, PREVIEW_LINES).join("\n")}\n...`;
  return { codePreview, lineCount, codeBytes };
}

export function getLastPreviewHtml(): string | null {
  return lastPreview?.html ?? null;
}

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

/** Selection change: plan asset paths and build HTML. No exportAsync for assets. */
export const run = async (settings: PluginSettings) => {
  resetPerformanceCounters();
  clearVariableCache();
  clearWarnings();
  lastPreview = null;
  postConversionStart();

  try {
    const { useOldPluginVersion2025 } = settings;
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      clearAssetCache();
      postEmptyMessage();
      return;
    }

    const effectiveSettings = lockedHtmlSettings(settings);
    const nodeToJSONStart = Date.now();

    planAssetTargets(selection);

    const converted = await convertSelection(
      effectiveSettings,
      useOldPluginVersion2025,
    );
    if (!converted) {
      clearAssetCache();
      postEmptyMessage();
      return;
    }

    const convertToCodeStart = Date.now();
    const code = await buildZipIndexHtml(
      converted.convertedSelection,
      effectiveSettings,
      selection[0]?.name || "export",
    );
    lastPreview = { rootId: selection[0].id, html: code };
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
      ...snippetFromHtml(code),
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
    lastPreview = null;
    postError(message);
  }
};

/** On-demand ZIP: export bytes, stream files, reuse last preview HTML when possible. */
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
  const effectiveSettings = lockedHtmlSettings(settings);

  try {
    const exported = await exportZipAssets(selection);

    postBackendMessage({
      type: "progress",
      message: "Building index.html…",
      percent: 88,
    });

    let html =
      lastPreview && lastPreview.rootId === rootId && !exported.formatDrift
        ? lastPreview.html
        : null;

    if (!html) {
      const converted = await convertSelection(
        effectiveSettings,
        settings.useOldPluginVersion2025,
      );
      if (converted) {
        html = await buildZipIndexHtml(
          converted.convertedSelection,
          effectiveSettings,
          selection[0]?.name || "export",
        );
        lastPreview = { rootId, html };
      }
    }

    if (html) {
      postBackendMessage({
        type: "zipFile",
        path: "index.html",
        bytes: utf8Encode(html),
      });
    }

    postBackendMessage({
      type: "zipFile",
      path: "figma_raw.json",
      bytes: utf8Encode(JSON.stringify(exported.rawDocument) + "\n"),
    });
    postBackendMessage({
      type: "zipFile",
      path: "assets_map.json",
      bytes: utf8Encode(JSON.stringify(exported.assetsMap) + "\n"),
    });

    clearAssetCache();

    postBackendMessage({
      type: "zipDone",
      folder: exported.folder,
      assetCount: exported.assetCount,
      failedCount: exported.failedCount,
    });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "ZIP export failed");
    console.error("[exportZipPackage]", err);
    clearAssetCache();
    postBackendMessage({ type: "zipError", error: message });
  }
};
