/**
 * Plugin UI root: listens for main-thread postMessage events, assembles ZIP
 * downloads from streamed files, and forwards user actions (settings, export,
 * tidy, OpenRouter key) back to plugin.ts.
 */
import { useEffect, useRef, useState } from "react";
import { PluginUI } from "./PluginUI";
import { coerceIncomingBytes, downloadZipFromFiles } from "./zip";
import {
  PluginSettings,
  ConversionMessage,
  Message,
  LinearGradientConversion,
  SolidColorConversion,
  ErrorMessage,
  SettingsChangedMessage,
  Warning,
  ProgressMessage,
  ZipDoneMessage,
  ZipFileMessage,
  ZipErrorMessage,
  FullCodeMessage,
  OpenRouterKeyStatusMessage,
  SelectionJsonMessage,
} from "types";
import { postUISettingsChangingMessage } from "./messaging";
import copy from "copy-to-clipboard";
import { logError } from "../shared/log";
import type { PreviewMode } from "./components/CodePanel";

interface AppState {
  codePreview: string;
  lineCount: number;
  codeBytes: number;
  displayedCode: string;
  showingFullCode: boolean;
  isLoading: boolean;
  isZipExporting: boolean;
  isTidying: boolean;
  hasOpenRouterKey: boolean;
  settings: PluginSettings | null;
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  warnings: Warning[];
  statusMessage: string;
  progressPercent: number | null;
  previewMode: PreviewMode;
  figmaJson: string;
  jsonLineCount: number;
  showingFullJson: boolean;
  figmaJsonLoading: boolean;
}

const isDarkFigmaBackground = (background: string) => {
  const value = background.trim().toLowerCase();

  return Boolean(
    value &&
    value !== "#fff" &&
    value !== "#ffffff" &&
    value !== "rgb(255, 255, 255)" &&
    value !== "rgba(255, 255, 255, 1)",
  );
};

export default function App() {
  const zipFilesRef = useRef<Map<string, Uint8Array>>(new Map());
  const previewModeRef = useRef<PreviewMode>("code");
  const [state, setState] = useState<AppState>({
    codePreview: "",
    lineCount: 0,
    codeBytes: 0,
    displayedCode: "",
    showingFullCode: false,
    isLoading: false,
    isZipExporting: false,
    isTidying: false,
    hasOpenRouterKey: false,
    settings: null,
    colors: [],
    gradients: [],
    warnings: [],
    statusMessage: "Select a frame to generate code",
    progressPercent: null,
    previewMode: "code",
    figmaJson: "",
    jsonLineCount: 0,
    showingFullJson: false,
    figmaJsonLoading: false,
  });

  const rootStyles = getComputedStyle(document.documentElement);
  const figmaColorBgValue = rootStyles
    .getPropertyValue("--figma-color-bg")
    .trim();

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const untypedMessage = event.data.pluginMessage as Message;
      if (!untypedMessage?.type) return;

      switch (untypedMessage.type) {
        case "conversionStart":
          zipFilesRef.current.clear();
          setState((prevState) => ({
            ...prevState,
            codePreview: "",
            displayedCode: "",
            lineCount: 0,
            codeBytes: 0,
            showingFullCode: false,
            statusMessage: "Generating code…",
            progressPercent: null,
            isLoading: true,
            isZipExporting: false,
            isTidying: false,
            figmaJson: "",
            jsonLineCount: 0,
            showingFullJson: false,
            figmaJsonLoading: previewModeRef.current === "json",
          }));
          break;

        case "progress": {
          const progress = untypedMessage as ProgressMessage;
          const tidying = /tidy/i.test(progress.message || "");
          setState((prevState) => ({
            ...prevState,
            statusMessage: progress.message || prevState.statusMessage,
            progressPercent:
              typeof progress.percent === "number"
                ? progress.percent
                : prevState.progressPercent,
            isLoading: prevState.isZipExporting ? prevState.isLoading : true,
            isTidying: tidying || prevState.isTidying,
          }));
          break;
        }

        case "code": {
          const conversionMessage = untypedMessage as ConversionMessage;
          setState((prevState) => ({
            ...prevState,
            ...conversionMessage,
            displayedCode: conversionMessage.codePreview,
            showingFullCode: false,
            statusMessage: "Download ZIP for index.html + assets",
            progressPercent: null,
            isLoading: false,
            isZipExporting: false,
            isTidying: false,
            figmaJson: "",
            jsonLineCount: 0,
            showingFullJson: false,
            figmaJsonLoading: previewModeRef.current === "json",
          }));
          if (previewModeRef.current === "json") {
            parent.postMessage(
              {
                pluginMessage: {
                  type: "get-selection-json",
                  purpose: "display",
                  source: "panel",
                },
              },
              "*",
            );
          }
          break;
        }

        case "zipStart":
          zipFilesRef.current.clear();
          setState((prevState) => ({
            ...prevState,
            statusMessage: "Exporting ZIP assets…",
            progressPercent: 0,
            isZipExporting: true,
          }));
          break;

        case "zipFile": {
          const file = untypedMessage as ZipFileMessage;
          const bytes = coerceIncomingBytes(file.bytes);
          if (file.path && bytes) {
            zipFilesRef.current.set(file.path, bytes);
          }
          break;
        }

        case "zipDone": {
          const done = untypedMessage as ZipDoneMessage;
          const files = zipFilesRef.current;
          setState((prevState) => ({
            ...prevState,
            statusMessage: `Downloaded — index.html + ${done.assetCount} assets`,
            progressPercent: 100,
            isZipExporting: false,
          }));
          try {
            downloadZipFromFiles(done.folder, files);
          } catch (e) {
            logError("ZIP browser download failed", e);
            setState((prevState) => ({
              ...prevState,
              statusMessage: "ZIP built but browser download failed",
            }));
          }
          zipFilesRef.current = new Map();
          break;
        }

        case "zipError": {
          const zipErr = untypedMessage as ZipErrorMessage;
          zipFilesRef.current.clear();
          setState((prevState) => ({
            ...prevState,
            isZipExporting: false,
            progressPercent: null,
            statusMessage: zipErr.error || "ZIP export failed",
          }));
          break;
        }

        case "fullCode": {
          const full = untypedMessage as FullCodeMessage;
          if (full.purpose === "copy") {
            copy(full.code);
            break;
          }
          setState((prevState) => ({
            ...prevState,
            displayedCode: full.code,
            showingFullCode: true,
          }));
          break;
        }

        case "pluginSettingsChanged":
          const settingsMessage = untypedMessage as SettingsChangedMessage;
          setState((prevState) => ({
            ...prevState,
            settings: settingsMessage.settings,
          }));
          break;

        case "empty":
          zipFilesRef.current.clear();
          setState((prevState) => ({
            ...prevState,
            codePreview: "",
            displayedCode: "",
            lineCount: 0,
            codeBytes: 0,
            showingFullCode: false,
            warnings: [],
            colors: [],
            gradients: [],
            statusMessage: "Select a frame to generate code",
            progressPercent: null,
            isLoading: false,
            isZipExporting: false,
            isTidying: false,
            figmaJson: "",
            jsonLineCount: 0,
            showingFullJson: false,
            figmaJsonLoading: false,
          }));
          break;

        case "error":
          const errorMessage = untypedMessage as ErrorMessage;
          zipFilesRef.current.clear();
          setState((prevState) => ({
            ...prevState,
            colors: [],
            gradients: [],
            codePreview: `Error :(\n// ${errorMessage.error}`,
            displayedCode: `Error :(\n// ${errorMessage.error}`,
            lineCount: 2,
            codeBytes: 0,
            showingFullCode: false,
            statusMessage: errorMessage.error,
            progressPercent: null,
            isLoading: false,
            isZipExporting: false,
            isTidying: false,
            figmaJson: "",
            jsonLineCount: 0,
            showingFullJson: false,
            figmaJsonLoading: false,
          }));
          break;

        case "conversion-complete":
          setState((prevState) => ({
            ...prevState,
            isLoading: false,
            isZipExporting: false,
            isTidying: false,
            statusMessage: prevState.statusMessage || "Conversion finished",
          }));
          break;

        case "selection-json": {
          const jsonMsg = untypedMessage as SelectionJsonMessage;
          if (jsonMsg.purpose !== "display") {
            const text =
              typeof jsonMsg.jsonText === "string"
                ? jsonMsg.jsonText
                : JSON.stringify(jsonMsg.data, null, 2);
            copy(text);
            break;
          }
          setState((prevState) => ({
            ...prevState,
            figmaJson: jsonMsg.showingFull
              ? (jsonMsg.jsonText ?? "")
              : (jsonMsg.jsonPreview ?? jsonMsg.jsonText ?? ""),
            jsonLineCount: jsonMsg.jsonLineCount ?? 0,
            showingFullJson: Boolean(jsonMsg.showingFull),
            figmaJsonLoading: false,
          }));
          break;
        }

        case "openRouterKeyStatus": {
          const status = untypedMessage as OpenRouterKeyStatusMessage;
          setState((prevState) => ({
            ...prevState,
            hasOpenRouterKey: Boolean(status.hasKey),
          }));
          break;
        }

        default:
          break;
      }
    };

    return () => {
      window.onmessage = null;
    };
  }, []);

  useEffect(() => {
    parent.postMessage({ pluginMessage: { type: "ui-ready" } }, "*");
  }, []);

  const handlePreferencesChange = (
    key: keyof PluginSettings,
    value: PluginSettings[keyof PluginSettings],
  ) => {
    if (state.settings && state.settings[key] === value) {
    } else {
      postUISettingsChangingMessage(key, value, { targetOrigin: "*" });
    }
  };

  const handleDownloadZip = () => {
    if (state.isLoading || state.isZipExporting || state.isTidying) return;
    parent.postMessage({ pluginMessage: { type: "exportZip" } }, "*");
  };

  const handleTidyAndConvert = () => {
    if (
      state.isLoading ||
      state.isZipExporting ||
      state.isTidying ||
      !state.hasOpenRouterKey
    ) {
      return;
    }
    setState((prev) => ({
      ...prev,
      isTidying: true,
      isLoading: true,
      statusMessage: "Tidying layout…",
    }));
    parent.postMessage({ pluginMessage: { type: "tidyAndConvert" } }, "*");
  };

  const handleSaveOpenRouterKey = (key: string) => {
    parent.postMessage(
      { pluginMessage: { type: "setOpenRouterKey", key } },
      "*",
    );
  };

  const requestFullCode = (purpose: "copy" | "display") => {
    parent.postMessage(
      { pluginMessage: { type: "requestFullCode", purpose } },
      "*",
    );
  };

  const requestPanelJson = (opts: {
    purpose: "copy" | "display";
    full?: boolean;
  }) => {
    parent.postMessage(
      {
        pluginMessage: {
          type: "get-selection-json",
          purpose: opts.purpose,
          source: "panel",
          full: opts.full,
        },
      },
      "*",
    );
  };

  const handlePreviewModeChange = (mode: PreviewMode) => {
    previewModeRef.current = mode;
    const needsFetch =
      mode === "json" && !state.figmaJson && !state.figmaJsonLoading;
    setState((prev) => ({
      ...prev,
      previewMode: mode,
      figmaJsonLoading: needsFetch ? true : prev.figmaJsonLoading,
    }));
    if (needsFetch) {
      requestPanelJson({ purpose: "display" });
    }
  };

  const handleCopy = () => {
    if (state.previewMode === "json") {
      requestPanelJson({ purpose: "copy" });
      return;
    }
    requestFullCode("copy");
  };

  const handleShowMore = () => {
    if (state.previewMode === "json") {
      if (state.showingFullJson) return;
      setState((prev) => ({ ...prev, figmaJsonLoading: true }));
      requestPanelJson({ purpose: "display", full: true });
      return;
    }
    requestFullCode("display");
  };

  const darkMode = isDarkFigmaBackground(figmaColorBgValue);

  return (
    <div
      className={`${darkMode ? "dark" : ""} h-full bg-background text-foreground`}
    >
      <PluginUI
        isLoading={state.isLoading}
        isZipExporting={state.isZipExporting}
        isTidying={state.isTidying}
        hasOpenRouterKey={state.hasOpenRouterKey}
        code={state.displayedCode}
        lineCount={state.lineCount}
        showingFullCode={state.showingFullCode}
        warnings={state.warnings}
        onPreferenceChanged={handlePreferencesChange}
        settings={state.settings}
        colors={state.colors}
        gradients={state.gradients}
        statusMessage={state.statusMessage}
        progressPercent={state.progressPercent}
        onDownloadZip={handleDownloadZip}
        onTidyAndConvert={handleTidyAndConvert}
        onSaveOpenRouterKey={handleSaveOpenRouterKey}
        previewMode={state.previewMode}
        figmaJson={state.figmaJson}
        jsonLineCount={state.jsonLineCount}
        showingFullJson={state.showingFullJson}
        figmaJsonLoading={state.figmaJsonLoading}
        onPreviewModeChange={handlePreviewModeChange}
        onCopy={handleCopy}
        onShowMore={handleShowMore}
      />
    </div>
  );
}
