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
} from "types";
import { postUISettingsChangingMessage } from "./messaging";
import copy from "copy-to-clipboard";

interface AppState {
  codePreview: string;
  lineCount: number;
  codeBytes: number;
  displayedCode: string;
  showingFullCode: boolean;
  isLoading: boolean;
  isZipExporting: boolean;
  settings: PluginSettings | null;
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  warnings: Warning[];
  statusMessage: string;
  progressPercent: number | null;
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
  const [state, setState] = useState<AppState>({
    codePreview: "",
    lineCount: 0,
    codeBytes: 0,
    displayedCode: "",
    showingFullCode: false,
    isLoading: false,
    isZipExporting: false,
    settings: null,
    colors: [],
    gradients: [],
    warnings: [],
    statusMessage: "Select a frame to generate code",
    progressPercent: null,
  });

  const rootStyles = getComputedStyle(document.documentElement);
  const figmaColorBgValue = rootStyles
    .getPropertyValue("--figma-color-bg")
    .trim();

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const untypedMessage = event.data.pluginMessage as Message;
      if (!untypedMessage?.type) return;

      if (untypedMessage.type !== "zipFile" && untypedMessage.type !== "code") {
        console.log("[ui] message:", untypedMessage.type);
      }

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
          }));
          break;

        case "progress": {
          const progress = untypedMessage as ProgressMessage;
          setState((prevState) => ({
            ...prevState,
            statusMessage: progress.message || prevState.statusMessage,
            progressPercent:
              typeof progress.percent === "number"
                ? progress.percent
                : prevState.progressPercent,
            isLoading: prevState.isZipExporting ? prevState.isLoading : true,
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
          }));
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
          } catch (err) {
            console.error("[ui] ZIP download failed", err);
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
          }));
          break;

        case "conversion-complete":
          setState((prevState) => ({
            ...prevState,
            isLoading: false,
            isZipExporting: false,
            statusMessage: prevState.statusMessage || "Conversion finished",
          }));
          break;

        case "selection-json":
          copy(JSON.stringify(event.data.pluginMessage.data, null, 2));
          break;

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
      // do nothing
    } else {
      postUISettingsChangingMessage(key, value, { targetOrigin: "*" });
    }
  };

  const handleDownloadZip = () => {
    if (state.isLoading || state.isZipExporting) return;
    parent.postMessage({ pluginMessage: { type: "exportZip" } }, "*");
  };

  const requestFullCode = (purpose: "copy" | "display") => {
    parent.postMessage(
      { pluginMessage: { type: "requestFullCode", purpose } },
      "*",
    );
  };

  const darkMode = isDarkFigmaBackground(figmaColorBgValue);

  return (
    <div
      className={`${darkMode ? "dark" : ""} h-full bg-background text-foreground`}
    >
      <PluginUI
        isLoading={state.isLoading}
        isZipExporting={state.isZipExporting}
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
        onCopyFullCode={() => requestFullCode("copy")}
        onShowFullCode={() => requestFullCode("display")}
      />
    </div>
  );
}
