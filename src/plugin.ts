/**
 * Figma plugin main thread: loads settings from clientStorage, converts the
 * current selection to HTML/CSS, streams ZIP exports to the UI, and runs
 * Tidy + Convert. Communicates with the iframe via postMessage; codegen mode
 * registers a separate handler when figma.mode is "codegen".
 */
import { run, exportZipPackage, getLastPreviewHtml } from "./convert/run";
import { htmlMain, htmlCodeGenTextStyles } from "./convert/html/generate";
import { nodesToJSON } from "./convert/nodes/toJson";
import { postBackendMessage, postSettingsChanged } from "./messaging";
import { logError } from "./shared/log";
import { isTidying, tidySelection } from "./tidy";
import { hasOpenRouterApiKey, setOpenRouterApiKey } from "./tidy/ai/key";
import {
  PluginSettings,
  RequestFullCodeMessage,
  SetOpenRouterKeyMessage,
  SettingWillChangeMessage,
  GetSelectionJsonMessage,
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
  const possiblePluginSrcSettings =
    (await figma.clientStorage.getAsync("userPluginSettings")) ?? {};

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
  return userPluginSettings;
};

const initSettings = async () => {
  await getUserSettings();
  postSettingsChanged(userPluginSettings);
  const hasKey = await hasOpenRouterApiKey();
  postBackendMessage({ type: "openRouterKeyStatus", hasKey });
  safeRun(userPluginSettings);
};

/** One conversion, ZIP, or tidy job at a time; queues reruns from selectionchange. */
let isBusy = false;
let pendingRun = false;

const finishBusy = () => {
  isBusy = false;
  if (!pendingRun || !userPluginSettings) return;
  pendingRun = false;
  void safeRun(userPluginSettings);
};

const safeRun = async (settings: PluginSettings) => {
  if (isBusy || isTidying()) {
    pendingRun = true;
    return;
  }
  let timedOut = false;
  try {
    isBusy = true;
    const watchdog = setTimeout(() => {
      if (!isBusy || timedOut) return;
      timedOut = true;
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
  } catch (e) {
    logError("code generation failed", e);
    if (e && typeof e === "object" && "message" in e) {
      const error = e as Error;
      figma.ui.postMessage({ type: "error", error: error.message });
    } else {
      const errorMessage = String(e);
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
  if (isBusy || isTidying()) {
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
    logError("ZIP export failed", e);
    const errorMessage =
      e && typeof e === "object" && "message" in e
        ? String((e as Error).message)
        : String(e || "ZIP export failed");
    figma.ui.postMessage({ type: "zipError", error: errorMessage });
  } finally {
    setTimeout(finishBusy, 100);
  }
};

const safeTidyAndConvert = async (settings: PluginSettings) => {
  if (isBusy || isTidying()) {
    figma.ui.postMessage({
      type: "error",
      error: "Busy — wait for the current job to finish before tidying",
    });
    return;
  }
  try {
    isBusy = true;
    const root = await tidySelection();
    if (!root) {
      return;
    }
    /** Tidy clones the selection; do not auto-convert again when that fires listeners. */
    pendingRun = false;
    await run(settings);
  } catch (e) {
    logError("Tidy + Convert failed", e);
    const errorMessage =
      e && typeof e === "object" && "message" in e
        ? String((e as Error).message)
        : String(e || "Tidy + Convert failed");
    figma.ui.postMessage({ type: "error", error: errorMessage });
    figma.ui.postMessage({ type: "conversion-complete", success: false });
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

  /** Best-effort REST + internal JSON for the About debug helper; partial results are OK. */
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
  } catch (e) {
    logError("REST JSON export failed", e);
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
  } catch (e) {
    logError("internal conversion JSON failed", e);
  }

  return result;
};

const JSON_PREVIEW_LINES = 25;
let lastFigmaJson: string | null = null;

function clearLastFigmaJson() {
  lastFigmaJson = null;
}

function snippetFromText(text: string) {
  const lines = text.split("\n");
  const lineCount = lines.length;
  const preview =
    lineCount <= JSON_PREVIEW_LINES
      ? text
      : `${lines.slice(0, JSON_PREVIEW_LINES).join("\n")}\n...`;
  return { preview, lineCount };
}

function figmaJsonTextFromExport(data: {
  json?: unknown;
  newConversion?: unknown;
  message?: string;
}): string {
  const payload = data.json ?? data.newConversion ?? data;
  try {
    return JSON.stringify(payload, null, 2);
  } catch (e) {
    logError("stringify Figma JSON failed", e);
    return String(payload);
  }
}

async function ensureLastFigmaJson(): Promise<string> {
  if (lastFigmaJson) return lastFigmaJson;
  const nodeJson = await exportSelectionJson(figma.currentPage.selection);
  lastFigmaJson = figmaJsonTextFromExport(nodeJson);
  return lastFigmaJson;
}

const DEBOUNCE_MS = 400;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleRun = () => {
  clearLastFigmaJson();
  if (!userPluginSettings) return;
  if (isBusy || isTidying()) {
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
    } else if (msg.type === "tidyAndConvert") {
      await safeTidyAndConvert(userPluginSettings);
    } else if (msg.type === "setOpenRouterKey") {
      const { key } = msg as SetOpenRouterKeyMessage;
      await setOpenRouterApiKey(typeof key === "string" ? key : "");
      const hasKey = await hasOpenRouterApiKey();
      postBackendMessage({ type: "openRouterKeyStatus", hasKey });
    } else if (msg.type === "requestFullCode") {
      const req = msg as RequestFullCodeMessage;
      postFullCode(req.purpose === "display" ? "display" : "copy");
    } else if (msg.type === "get-selection-json") {
      const req = msg as GetSelectionJsonMessage;
      if (req.source === "panel") {
        const text = await ensureLastFigmaJson();
        if (req.purpose === "copy") {
          figma.ui.postMessage({
            type: "selection-json",
            purpose: "copy",
            jsonText: text,
          });
          return;
        }
        const { preview, lineCount } = snippetFromText(text);
        const sendFull = Boolean(req.full) || lineCount <= JSON_PREVIEW_LINES;
        figma.ui.postMessage({
          type: "selection-json",
          purpose: "display",
          jsonPreview: sendFull ? undefined : preview,
          jsonText: sendFull ? text : undefined,
          jsonLineCount: lineCount,
          showingFull: sendFull,
        });
        return;
      }
      const nodeJson = await exportSelectionJson(figma.currentPage.selection);
      figma.ui.postMessage({
        type: "selection-json",
        data: nodeJson,
        purpose: req.purpose === "display" ? "display" : "copy",
      });
    }
  };

  figma.showUI(__html__, { width: 450, height: 700, themeColors: true });

  figma.on("selectionchange", () => {
    scheduleRun();
  });

  /*
   * Skip documentchange: with dynamic-page access it requires loadAllPagesAsync(),
   * which we avoid for memory. Selection changes, settings, and explicit tidy
   * are enough to refresh preview output.
   *
   * Also call initializeOnce immediately — ui-ready may arrive before onmessage
   * is attached.
   */
  void initializeOnce();
};

const codegenMode = async () => {
  await getUserSettings();

  figma.codegen.on(
    "generate",
    async ({ node }: CodegenEvent): Promise<CodegenResult[]> => {
      const convertedSelection = (await nodesToJSON(
        [node],
        userPluginSettings,
      )) as unknown as SceneNode[];

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
    standardMode();
    break;
  case "codegen":
    codegenMode();
    break;
  default:
    break;
}
