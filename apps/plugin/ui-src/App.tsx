import { useEffect, useState } from "react";
import { PluginUI, downloadZipFromPayload } from "plugin-ui";
import {
  PluginSettings,
  ConversionMessage,
  Message,
  LinearGradientConversion,
  SolidColorConversion,
  ErrorMessage,
  SettingsChangedMessage,
  Warning,
  ZipExportPayload,
  ProgressMessage,
  ZipReadyMessage,
  ZipErrorMessage,
} from "types";
import { postUISettingsChangingMessage } from "./messaging";
import copy from "copy-to-clipboard";

interface AppState {
  code: string;
  isLoading: boolean;
  isZipExporting: boolean;
  settings: PluginSettings | null;
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  warnings: Warning[];
  zipExport: ZipExportPayload | null;
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
  const [state, setState] = useState<AppState>({
    code: "",
    isLoading: true,
    isZipExporting: false,
    settings: null,
    colors: [],
    gradients: [],
    warnings: [],
    zipExport: null,
    statusMessage: "",
    progressPercent: null,
  });

  const rootStyles = getComputedStyle(document.documentElement);
  const figmaColorBgValue = rootStyles
    .getPropertyValue("--figma-color-bg")
    .trim();

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const untypedMessage = event.data.pluginMessage as Message;
      console.log("[ui] message received:", untypedMessage);

      switch (untypedMessage.type) {
        case "conversionStart":
          setState((prevState) => ({
            ...prevState,
            code: "",
            zipExport: null,
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
            // Progress during ZIP export should not flip the code-loading view
            isLoading: prevState.isZipExporting ? prevState.isLoading : true,
          }));
          break;
        }

        case "code": {
          const conversionMessage = untypedMessage as ConversionMessage;
          setState((prevState) => ({
            ...prevState,
            ...conversionMessage,
            zipExport: null,
            statusMessage: "Download ZIP for index.html + assets",
            progressPercent: null,
            isLoading: false,
            isZipExporting: false,
          }));
          break;
        }

        case "zipStart":
          setState((prevState) => ({
            ...prevState,
            statusMessage: "Exporting ZIP assets…",
            progressPercent: 0,
            isZipExporting: true,
          }));
          break;

        case "zipReady": {
          const ready = untypedMessage as ZipReadyMessage;
          const zipExport = ready.zipExport;
          setState((prevState) => ({
            ...prevState,
            zipExport,
            statusMessage: `Downloaded — index.html + ${zipExport.assetCount} assets`,
            progressPercent: 100,
            isZipExporting: false,
          }));
          try {
            downloadZipFromPayload(zipExport);
          } catch (err) {
            console.error("[ui] ZIP download failed", err);
            setState((prevState) => ({
              ...prevState,
              statusMessage: "ZIP built but browser download failed",
            }));
          }
          break;
        }

        case "zipError": {
          const zipErr = untypedMessage as ZipErrorMessage;
          setState((prevState) => ({
            ...prevState,
            isZipExporting: false,
            progressPercent: null,
            statusMessage: zipErr.error || "ZIP export failed",
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
          setState((prevState) => ({
            ...prevState,
            code: "",
            warnings: [],
            colors: [],
            gradients: [],
            zipExport: null,
            statusMessage: "Select a frame to generate code",
            progressPercent: null,
            isLoading: false,
            isZipExporting: false,
          }));
          break;

        case "error":
          const errorMessage = untypedMessage as ErrorMessage;

          setState((prevState) => ({
            ...prevState,
            colors: [],
            gradients: [],
            zipExport: null,
            code: `Error :(\n// ${errorMessage.error}`,
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
          const json = event.data.pluginMessage.data;
          copy(JSON.stringify(json, null, 2));
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

  const darkMode = isDarkFigmaBackground(figmaColorBgValue);

  return (
    <div
      className={`${darkMode ? "dark" : ""} h-full bg-background text-foreground`}
    >
      <PluginUI
        isLoading={state.isLoading}
        isZipExporting={state.isZipExporting}
        code={state.code}
        warnings={state.warnings}
        onPreferenceChanged={handlePreferencesChange}
        settings={state.settings}
        colors={state.colors}
        gradients={state.gradients}
        statusMessage={state.statusMessage}
        progressPercent={state.progressPercent}
        onDownloadZip={handleDownloadZip}
      />
    </div>
  );
}
