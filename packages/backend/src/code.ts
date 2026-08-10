import {
  retrieveGenericLinearGradients,
  retrieveGenericSolidUIColors,
} from "./common/retrieveUI/retrieveColors";
import { clearWarnings, warnings } from "./common/commonConversionWarnings";
import { postConversionComplete, postEmptyMessage } from "./messaging";
import { PluginSettings } from "types";
import { convertToCode } from "./common/retrieveUI/convertToCode";
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

export const run = async (settings: PluginSettings) => {
  resetPerformanceCounters();
  clearWarnings();
  clearAssetCache();

  const { framework, useOldPluginVersion2025 } = settings;
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    postEmptyMessage();
    return;
  }

  // Always embed assets from the ZIP export pipeline for accuracy
  const effectiveSettings: PluginSettings = {
    ...settings,
    embedImages: true,
    embedVectors: true,
  };

  const nodeToJSONStart = Date.now();

  // 1) Export assets once (ZIP + conversion cache)
  const { zipExport } = await exportZipAssets(selection);

  let convertedSelection: any;
  if (useOldPluginVersion2025) {
    convertedSelection = oldConvertNodesToAltNodes(selection, null);
  } else {
    convertedSelection = await nodesToJSON(selection, effectiveSettings);
    console.log(`[benchmark] nodesToJSON: ${Date.now() - nodeToJSONStart}ms`);
  }

  if (convertedSelection.length === 0) {
    postEmptyMessage();
    return;
  }

  applyAssetFlagsToTree(convertedSelection);

  const convertToCodeStart = Date.now();
  const code = await convertToCode(convertedSelection, effectiveSettings);
  console.log(
    `[benchmark] convertToCode: ${Date.now() - convertToCodeStart}ms`,
  );

  const colors = await retrieveGenericSolidUIColors(framework);
  const gradients = await retrieveGenericLinearGradients(framework);
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
    zipExport,
  });
};
