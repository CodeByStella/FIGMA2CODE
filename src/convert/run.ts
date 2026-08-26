/**
 * Conversion orchestration: selection → enriched nodes → HTML preview snippet.
 * ZIP asset export is a separate path (`exportZipPackage`); preview avoids exportAsync.
 */
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
import { clearVariableCache, nodesToJSON } from "./nodes/toJson";
import { exportZipAssets, planAssetTargets } from "../export/zip";
import { clearAssetCache } from "../export/cache";
import { applyAssetFlagsToTree } from "../export/flags";
import { buildZipIndexHtml } from "../export/html";
import { lockedHtmlSettings } from "./settings";
import { utf8Encode } from "../shared/utf8";
import { logError } from "../shared/log";

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
    convertedSelection = await nodesToJSON(selection, settings);
  }

  if (!convertedSelection || convertedSelection.length === 0) {
    return null;
  }

  applyAssetFlagsToTree(convertedSelection);
  return { selection, convertedSelection };
}

// Preview path: JSON enrich → HTML snippet for the UI. Asset bytes are planned but not exported here.
export const run = async (settings: PluginSettings) => {
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

    const code = await buildZipIndexHtml(
      converted.convertedSelection,
      effectiveSettings,
      selection[0]?.name || "export",
    );
    lastPreview = { rootId: selection[0].id, html: code };

    const colors = await retrieveGenericSolidUIColors();
    const gradients = await retrieveGenericLinearGradients();

    postConversionComplete({
      ...snippetFromHtml(code),
      colors,
      gradients,
      settings: effectiveSettings,
      warnings: [...warnings],
    });
  } catch (err) {
    logError("code generation failed", err);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "Code generation failed");
    lastPreview = null;
    postError(message);
  }
};

// ZIP path: exportAsync for assets, stream files to UI; reuse cached preview HTML when selection unchanged.
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
    logError("ZIP export failed", err);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "ZIP export failed");
    clearAssetCache();
    postBackendMessage({ type: "zipError", error: message });
  }
};
