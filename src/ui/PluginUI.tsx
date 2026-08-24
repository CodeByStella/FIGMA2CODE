import copy from "copy-to-clipboard";
import GradientsPanel from "./components/GradientsPanel";
import ColorsPanel from "./components/ColorsPanel";
import CodePanel from "./components/CodePanel";
import EmptyState from "./components/EmptyState";
import About from "./components/About";
import WarningsPanel from "./components/WarningsPanel";
import {
  PluginSettings,
  LinearGradientConversion,
  SolidColorConversion,
  Warning,
} from "types";
import Loading from "./components/Loading";
import { useEffect, useState } from "react";
import { InfoIcon } from "lucide-react";
import React from "react";
import { Button } from "./primitives/button";
import { ScrollArea } from "./primitives/scroll-area";
import { TooltipProvider } from "./primitives/tooltip";

type PluginUIProps = {
  code: string;
  warnings: Warning[];
  settings: PluginSettings | null;
  onPreferenceChanged: (
    key: keyof PluginSettings,
    value: PluginSettings[keyof PluginSettings],
  ) => void;
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  isLoading: boolean;
  isZipExporting?: boolean;
  statusMessage?: string;
  progressPercent?: number | null;
  onDownloadZip?: () => void;
};

const LOADING_INDICATOR_DELAY_MS = 250;

const ZipToolbar = ({
  statusMessage,
  progressPercent,
  isLoading,
  isZipExporting,
  canDownloadZip,
  onDownloadZip,
}: {
  statusMessage?: string;
  progressPercent?: number | null;
  isLoading: boolean;
  isZipExporting: boolean;
  canDownloadZip: boolean;
  onDownloadZip?: () => void;
}) => {
  const busy = isLoading || isZipExporting;
  const hasPercent =
    typeof progressPercent === "number" &&
    progressPercent >= 0 &&
    Number.isFinite(progressPercent);

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="w-full flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground min-w-0 break-words">
          {statusMessage ||
            (canDownloadZip
              ? "Download ZIP for index.html + assets"
              : "Select a frame to generate code")}
        </p>
        <Button
          size="sm"
          className="h-8 shrink-0"
          disabled={!canDownloadZip || busy || !onDownloadZip}
          onClick={() => onDownloadZip?.()}
        >
          {isZipExporting ? "Exporting…" : "Download ZIP"}
        </Button>
      </div>
      {isZipExporting && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full bg-primary transition-[width] duration-200 ease-out ${
              hasPercent ? "" : "w-1/3 animate-pulse"
            }`}
            style={
              hasPercent
                ? {
                    width: `${Math.max(0, Math.min(100, progressPercent!))}%`,
                  }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
};

export const PluginUI = (props: PluginUIProps) => {
  const [showAbout, setShowAbout] = useState(false);
  const [hasBeenIdle, setHasBeenIdle] = useState(!props.isLoading);
  const [delayElapsed, setDelayElapsed] = useState(false);

  if (!props.isLoading && !hasBeenIdle) {
    setHasBeenIdle(true);
  }
  if (!props.isLoading && delayElapsed) {
    setDelayElapsed(false);
  }

  useEffect(() => {
    if (!props.isLoading || hasBeenIdle) {
      return;
    }

    const timer = window.setTimeout(() => {
      setDelayElapsed(true);
    }, LOADING_INDICATOR_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [props.isLoading, hasBeenIdle]);

  const isEmpty = !props.isLoading && props.code === "";
  const warnings = props.warnings ?? [];
  const showBodyLoading = props.isLoading && (hasBeenIdle || delayElapsed);
  const canDownloadZip =
    props.code !== "" && !props.code.startsWith("Error :(");

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
        <div className="px-2 py-1.5 dark:bg-card">
          <div className="flex gap-1 bg-muted dark:bg-card rounded-lg p-0.5">
            <p className="flex grow items-center px-2 text-sm font-medium text-foreground">
              HTML
            </p>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 rounded-md ${
                showAbout
                  ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary hover:text-primary-foreground dark:hover:bg-primary"
                  : "bg-muted text-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90"
              }`}
              onClick={() => {
                setShowAbout(!showAbout);
              }}
              aria-label="About"
            >
              <InfoIcon size={16} />
            </Button>
          </div>
        </div>
        <div
          style={{
            height: 1,
            width: "100%",
            backgroundColor: "rgba(255,255,255,0.12)",
          }}
        ></div>
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          {showAbout ? (
            <About
              useOldPluginVersion={props.settings?.useOldPluginVersion2025}
              onPreferenceChanged={props.onPreferenceChanged}
            />
          ) : (
            <div className="flex flex-col items-center px-4 pt-3 pb-2 gap-2 dark:bg-transparent min-h-full">
              <ZipToolbar
                statusMessage={props.statusMessage}
                progressPercent={props.progressPercent}
                isLoading={props.isLoading}
                isZipExporting={Boolean(props.isZipExporting)}
                canDownloadZip={canDownloadZip}
                onDownloadZip={props.onDownloadZip}
              />

              {showBodyLoading ? (
                <div className="flex flex-1 w-full items-center justify-center py-6">
                  <Loading
                    statusMessage={props.statusMessage}
                    progressPercent={props.progressPercent}
                  />
                </div>
              ) : isEmpty ? (
                <div className="flex flex-1 w-full items-center justify-center">
                  <EmptyState />
                </div>
              ) : (
                <>
                  {warnings.length > 0 && <WarningsPanel warnings={warnings} />}

                  <CodePanel code={props.code} />

                  {props.colors.length > 0 && (
                    <div className="mt-3 w-full">
                      <ColorsPanel
                        colors={props.colors}
                        onColorClick={(value) => {
                          copy(value);
                        }}
                      />
                    </div>
                  )}

                  {props.gradients.length > 0 && (
                    <div className="mt-3 w-full">
                      <GradientsPanel
                        gradients={props.gradients}
                        onColorClick={(value) => {
                          copy(value);
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
};
