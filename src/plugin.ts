import { run, exportZipPackage, getLastPreviewHtml } from "./convert/run";
import { htmlMain, htmlCodeGenTextStyles } from "./convert/html/generate";
import { nodesToJSON } from "./convert/nodes/toJson";
import { postSettingsChanged } from "./messaging";
import {
  PluginSettings,
  RequestFullCodeMessage,
  SettingWillChangeMessage,
} from "types";

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
let pendingRun = false;

const finishBusy = () => {
  isBusy = false;
  if (!pendingRun || !userPluginSettings) return;
  pendingRun = false;
  void safeRun(userPluginSettings);
};

const safeRun = async (settings: PluginSettings) => {
  console.log(
    "[DEBUG] safeRun - Called with isBusy =",
    isBusy,
    "selectionCount =",
    figma.currentPage.selection.length,
  );
  if (isBusy) {
    pendingRun = true;
    console.log("[DEBUG] safeRun - Busy; will rerun after current job");
    return;
  }
  let timedOut = false;
  try {
    isBusy = true;
    console.log("[DEBUG] safeRun - Starting run execution");
    const watchdog = setTimeout(() => {
      if (!isBusy || timedOut) return;
      timedOut = true;
      console.error("[DEBUG] safeRun - watchdog: conversion still running");
      figma.ui.postMessage({
        type: "error",
        error:
          "Code generation timed out. A layer may have failed to export (empty or invisible vector).",
      });
      finishBusy();
    }, 60000);
    try {
      await run(settings);
    } finally {
      clearTimeout(watchdog);
    }
    if (timedOut) return;
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
    if (!timedOut) {
      setTimeout(finishBusy, 100);
    }
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
    setTimeout(finishBusy, 100);
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

const DEBOUNCE_MS = 400;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleRun = () => {
  if (!userPluginSettings) return;
  if (isBusy) {
    pendingRun = true;
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (userPluginSettings) safeRun(userPluginSettings);
  }, DEBOUNCE_MS);
};

const postFullCode = (purpose: "copy" | "display") => {
  const html = getLastPreviewHtml();
  if (!html) {
    figma.ui.postMessage({
      type: "error",
      error: "No generated HTML to copy. Select a frame first.",
    });
    return;
  }
  figma.ui.postMessage({ type: "fullCode", code: html, purpose });
};

const standardMode = async () => {
  console.log("[DEBUG] standardMode - Starting standard mode initialization");
  let initialized = false;
  const initializeOnce = async () => {
    if (initialized) {
      return;
    }
    initialized = true;
    await initSettings();
  };

  figma.ui.onmessage = async (msg) => {
    if (msg.type === "ui-ready") {
      await initializeOnce();
    } else if (msg.type === "pluginSettingWillChange") {
      const { key, value } = msg as SettingWillChangeMessage<unknown>;
      (userPluginSettings as any)[key] = value;
      figma.clientStorage.setAsync("userPluginSettings", userPluginSettings);
      scheduleRun();
    } else if (msg.type === "exportZip") {
      await safeExportZip(userPluginSettings);
    } else if (msg.type === "requestFullCode") {
      const req = msg as RequestFullCodeMessage;
      postFullCode(req.purpose === "display" ? "display" : "copy");
    } else if (msg.type === "get-selection-json") {
      const nodeJson = await exportSelectionJson(figma.currentPage.selection);
      console.log(
        "[DEBUG] Exported node JSON:",
        "message" in nodeJson
          ? nodeJson.message
          : `jsonCount=${nodeJson.json?.length ?? 0}, newConversionCount=${nodeJson.newConversion?.length ?? 0}`,
      );
      figma.ui.postMessage({
        type: "selection-json",
        data: nodeJson,
      });
    }
  };

  figma.showUI(__html__, { width: 450, height: 700, themeColors: true });

  figma.on("selectionchange", () => {
    scheduleRun();
  });

  figma.on("documentchange", () => {
    scheduleRun();
  });

  // Do not wait for ui-ready — the iframe can post it before onmessage is bound.
  void initializeOnce();
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
