import { run, exportZipPackage, htmlMain, postSettingsChanged } from "backend";
import { nodesToJSON } from "backend/src/altNodes/jsonNodeConversion";
import { htmlCodeGenTextStyles } from "backend/src/html/htmlMain";
import { PluginSettings, SettingWillChangeMessage } from "types";

let userPluginSettings: PluginSettings;

export const defaultPluginSettings: PluginSettings = {
  showLayerNames: true,
  useOldPluginVersion2025: false,
  responsiveRoot: false,
  useColorVariables: true,
  embedImages: true,
  embedVectors: true,
};

function isKeyOfPluginSettings(key: string): key is keyof PluginSettings {
  return key in defaultPluginSettings;
}

const getUserSettings = async () => {
  console.log("[DEBUG] getUserSettings - Starting to fetch user settings");
  const possiblePluginSrcSettings =
    (await figma.clientStorage.getAsync("userPluginSettings")) ?? {};
  console.log(
    "[DEBUG] getUserSettings - Raw settings from storage:",
    possiblePluginSrcSettings,
  );

  const updatedPluginSrcSettings = {
    ...defaultPluginSettings,
    ...Object.keys(defaultPluginSettings).reduce((validSettings, key) => {
      if (
        isKeyOfPluginSettings(key) &&
        key in possiblePluginSrcSettings &&
        typeof possiblePluginSrcSettings[key] ===
          typeof defaultPluginSettings[key]
      ) {
        validSettings[key] = possiblePluginSrcSettings[key] as any;
      }
      return validSettings;
    }, {} as Partial<PluginSettings>),
  };

  userPluginSettings = {
    ...updatedPluginSrcSettings,
    showLayerNames: true,
    useColorVariables: true,
    embedImages: true,
    embedVectors: true,
  };
  console.log("[DEBUG] getUserSettings - Final settings:", userPluginSettings);
  return userPluginSettings;
};

const initSettings = async () => {
  console.log("[DEBUG] initSettings - Initializing plugin settings");
  await getUserSettings();
  postSettingsChanged(userPluginSettings);
  console.log("[DEBUG] initSettings - Calling safeRun with settings");
  safeRun(userPluginSettings);
};

// Used to prevent overlapping preview / ZIP work (also blocks documentchange loops).
let isBusy = false;
const safeRun = async (settings: PluginSettings) => {
  console.log(
    "[DEBUG] safeRun - Called with isBusy =",
    isBusy,
    "selectionCount =",
    figma.currentPage.selection.length,
  );
  if (isBusy) {
    console.log("[DEBUG] safeRun - Skipping because isBusy");
    return;
  }
  try {
    isBusy = true;
    console.log("[DEBUG] safeRun - Starting run execution");
    const watchdog = setTimeout(() => {
      if (!isBusy) return;
      console.error("[DEBUG] safeRun - watchdog: conversion still running");
      isBusy = false;
      figma.ui.postMessage({
        type: "error",
        error:
          "Code generation timed out. A layer may have failed to export (empty or invisible vector).",
      });
    }, 60000);
    try {
      await run(settings);
    } finally {
      clearTimeout(watchdog);
    }
    console.log("[DEBUG] safeRun - Run execution completed");
  } catch (e) {
    console.log("[DEBUG] safeRun - Error caught in execution");
    if (e && typeof e === "object" && "message" in e) {
      const error = e as Error;
      console.log("error: ", error.stack);
      figma.ui.postMessage({ type: "error", error: error.message });
    } else {
      const errorMessage = String(e);
      console.log("Unknown error: ", errorMessage);
      figma.ui.postMessage({
        type: "error",
        error: errorMessage || "Unknown error occurred",
      });
    }
    figma.ui.postMessage({ type: "conversion-complete", success: false });
  } finally {
    // Next frame so temporary visibility toggles during export don't re-enter.
    setTimeout(() => {
      isBusy = false;
    }, 1);
  }
};

const safeExportZip = async (settings: PluginSettings) => {
  if (isBusy) {
    figma.ui.postMessage({
      type: "zipError",
      error: "Busy generating code — try Download ZIP again in a moment",
    });
    return;
  }
  try {
    isBusy = true;
    await exportZipPackage(settings);
  } catch (e) {
    const errorMessage =
      e && typeof e === "object" && "message" in e
        ? String((e as Error).message)
        : String(e || "ZIP export failed");
    console.error("[safeExportZip]", e);
    figma.ui.postMessage({ type: "zipError", error: errorMessage });
  } finally {
    setTimeout(() => {
      isBusy = false;
    }, 1);
  }
};

const exportSelectionJson = async (nodes: readonly SceneNode[]) => {
  if (nodes.length === 0) {
    return { message: "No nodes selected" as const };
  }

  const result: {
    json?: SceneNode[];
    oldConversion?: any;
    newConversion?: any;
  } = {};

  try {
    result.json = (await Promise.all(
      nodes.map(
        async (node) =>
          (
            (await node.exportAsync({
              format: "JSON_REST_V1",
            })) as any
          ).document,
      ),
    )) as SceneNode[];
  } catch (error) {
    console.error("Error exporting JSON:", error);
  }

  try {
    const newNodes = await nodesToJSON(nodes, userPluginSettings);
    const removeParent = (node: any) => {
      if (node.parent) {
        delete node.parent;
      }
      if (node.children) {
        node.children.forEach(removeParent);
      }
    };
    newNodes.forEach(removeParent);
    result.newConversion = newNodes;
  } catch (error) {
    console.error("Error in new conversion:", error);
  }

  return result;
};

const logSelectionJson = async () => {
  const nodes = figma.currentPage.selection;
  console.log("[DEBUG] selection JSON export - selection count:", nodes.length);
  const data = await exportSelectionJson(nodes);
  console.log("[selection-json]", JSON.stringify(data, null, 2));
  return data;
};

const standardMode = async () => {
  console.log("[DEBUG] standardMode - Starting standard mode initialization");
  figma.showUI(__html__, { width: 450, height: 700, themeColors: true });
  let initialized = false;
  const initializeOnce = async () => {
    if (initialized) {
      return;
    }
    initialized = true;
    await initSettings();
  };

  figma.on("selectionchange", () => {
    console.log(
      "[DEBUG] selectionchange event - New selection count:",
      figma.currentPage.selection.length,
    );
    void logSelectionJson();
    safeRun(userPluginSettings);
  });

  figma.loadAllPagesAsync();
  figma.on("documentchange", () => {
    console.log("[DEBUG] documentchange event triggered");
    safeRun(userPluginSettings);
  });

  figma.ui.onmessage = async (msg) => {
    console.log(
      "[DEBUG] figma.ui.onmessage",
      msg?.type ? `type=${msg.type}` : "unknown type",
    );

    if (msg.type === "ui-ready") {
      await initializeOnce();
    } else if (msg.type === "pluginSettingWillChange") {
      const { key, value } = msg as SettingWillChangeMessage<unknown>;
      console.log(`[DEBUG] Setting changed: ${key} = ${value}`);
      (userPluginSettings as any)[key] = value;
      figma.clientStorage.setAsync("userPluginSettings", userPluginSettings);
      safeRun(userPluginSettings);
    } else if (msg.type === "exportZip") {
      await safeExportZip(userPluginSettings);
    } else if (msg.type === "get-selection-json") {
      console.log("[DEBUG] get-selection-json message received");

      const nodeJson = await exportSelectionJson(figma.currentPage.selection);

      console.log(
        "[DEBUG] Exported node JSON:",
        "message" in nodeJson
          ? nodeJson.message
          : `jsonCount=${nodeJson.json?.length ?? 0}, newConversionCount=${nodeJson.newConversion?.length ?? 0}`,
      );
      console.log("[selection-json]", JSON.stringify(nodeJson, null, 2));

      figma.ui.postMessage({
        type: "selection-json",
        data: nodeJson,
      });
    }
  };
};

const codegenMode = async () => {
  console.log("[DEBUG] codegenMode - Starting codegen mode initialization");
  await getUserSettings();

  figma.codegen.on(
    "generate",
    async ({ node }: CodegenEvent): Promise<CodegenResult[]> => {
      console.log(
        `[DEBUG] codegen.generate - Node: id=${node.id}, type=${node.type}`,
      );

      const convertedSelection = (await nodesToJSON(
        [node],
        userPluginSettings,
      )) as unknown as SceneNode[];
      console.log(
        "[DEBUG] codegen.generate - Converted selection count:",
        convertedSelection.length,
      );

      return [
        {
          title: "Code",
          code: (await htmlMain(convertedSelection, userPluginSettings, true))
            .html,
          language: "HTML",
        },
        {
          title: "Text Styles",
          code: htmlCodeGenTextStyles(userPluginSettings),
          language: "HTML",
        },
      ];
    },
  );
};

switch (figma.mode) {
  case "default":
  case "inspect":
    console.log("[DEBUG] Starting plugin in", figma.mode, "mode");
    standardMode();
    break;
  case "codegen":
    console.log("[DEBUG] Starting plugin in codegen mode");
    codegenMode();
    break;
  default:
    console.log("[DEBUG] Unknown plugin mode:", figma.mode);
    break;
}
