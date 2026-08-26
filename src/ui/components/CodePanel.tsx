/** Syntax-highlighted HTML or Figma JSON preview. */
import { useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coldarkDark as theme } from "react-syntax-highlighter/dist/esm/styles/prism";
import { CopyButton } from "./CopyButton";
import EmptyState from "./EmptyState";
import { cn } from "../lib/utils";

export type PreviewMode = "code" | "json";

interface CodePanelProps {
  code: string;
  lineCount: number;
  showingFullCode: boolean;
  previewMode: PreviewMode;
  figmaJson: string;
  jsonLineCount: number;
  showingFullJson: boolean;
  figmaJsonLoading: boolean;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  onCopy?: () => void;
  onShowMore?: () => void;
}

function ViewToggle({
  value,
  onChange,
}: {
  value: PreviewMode;
  onChange: (mode: PreviewMode) => void;
}) {
  const options: { id: PreviewMode; label: string }[] = [
    { id: "code", label: "Code" },
    { id: "json", label: "JSON" },
  ];

  return (
    <div
      className="inline-flex items-center rounded-md bg-muted p-0.5"
      role="tablist"
      aria-label="Preview mode"
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              "h-7 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const CodePanel = (props: CodePanelProps) => {
  const [syntaxHovered, setSyntaxHovered] = useState(false);
  const {
    code,
    lineCount,
    showingFullCode,
    previewMode,
    figmaJson,
    jsonLineCount,
    showingFullJson,
    figmaJsonLoading,
  } = props;
  const isCodeEmpty = code === "";
  const isJsonMode = previewMode === "json";
  const displayedLineCount = isJsonMode ? jsonLineCount : lineCount;
  const showingFull = isJsonMode ? showingFullJson : showingFullCode;

  const showMoreButton = displayedLineCount > 25;
  const showCopyButton = displayedLineCount > 5;

  const handleButtonHover = () => setSyntaxHovered(true);
  const handleButtonLeave = () => setSyntaxHovered(false);

  const sizeHint = useMemo(() => {
    if (isJsonMode) {
      if (figmaJsonLoading) return "Loading Figma JSON…";
      if (jsonLineCount <= 25) return null;
      return showingFullJson
        ? `${jsonLineCount} lines`
        : `${jsonLineCount} lines — showing first 25`;
    }
    if (lineCount <= 25) return null;
    return showingFullCode
      ? `${lineCount} lines`
      : `${lineCount} lines — showing first 25`;
  }, [
    isJsonMode,
    figmaJsonLoading,
    jsonLineCount,
    showingFullJson,
    lineCount,
    showingFullCode,
  ]);

  const displayed = isJsonMode ? figmaJson : code;
  const isEmpty = isJsonMode
    ? !figmaJsonLoading && figmaJson === ""
    : isCodeEmpty;

  return (
    <div className="w-full flex flex-col gap-2 mt-2">
      <div className="flex items-center justify-between w-full">
        <p className="text-lg font-medium text-center text-foreground rounded-lg">
          {isJsonMode ? "Figma JSON" : "Code"}
        </p>
        {!isCodeEmpty && (
          <ViewToggle
            value={previewMode}
            onChange={(mode) => props.onPreviewModeChange?.(mode)}
          />
        )}
      </div>
      {sizeHint && <p className="text-xs text-muted-foreground">{sizeHint}</p>}

      <div
        className={`relative rounded-lg ring-green-600 transition-all duration-200 ${
          syntaxHovered ? "ring-2" : "ring-0"
        }`}
      >
        {figmaJsonLoading && isJsonMode ? (
          <div className="flex min-h-32 items-center justify-center rounded-lg bg-[#1B1B1B] px-4 py-8 text-sm text-neutral-400">
            Loading Figma JSON…
          </div>
        ) : isEmpty ? (
          isJsonMode ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg bg-[#1B1B1B] px-4 py-8 text-sm text-neutral-400">
              No Figma JSON for this selection
            </div>
          ) : (
            <EmptyState />
          )
        ) : (
          <>
            {showCopyButton && (
              <div className="pointer-events-none sticky top-3 z-10 h-0">
                <CopyButton
                  showLabel={false}
                  onCopy={props.onCopy}
                  onMouseEnter={handleButtonHover}
                  onMouseLeave={handleButtonLeave}
                  className="pointer-events-auto absolute right-2 top-2 h-7 w-7 rounded-md bg-neutral-800/90 p-0 text-neutral-200 shadow-sm ring-1 ring-white/10 backdrop-blur-sm hover:bg-neutral-600 hover:text-white hover:ring-white/20 dark:bg-neutral-800/90 dark:hover:bg-neutral-600"
                />
              </div>
            )}
            <SyntaxHighlighter
              language={isJsonMode ? "json" : "html"}
              style={theme}
              customStyle={{
                fontSize: 12,
                borderRadius: 8,
                marginTop: 0,
                marginBottom: 0,
                backgroundColor: syntaxHovered ? "#1E2B1A" : "#1B1B1B",
                transitionProperty: "all",
                transitionTimingFunction: "ease",
                transitionDuration: "0.2s",
                userSelect: "text",
                cursor: "text",
              }}
            >
              {displayed}
            </SyntaxHighlighter>
            {showMoreButton && (
              <div className="flex justify-center dark:bg-[#1B1B1B] border-t dark:border-gray-700">
                <button
                  onClick={() => {
                    if (showingFull) return;
                    props.onShowMore?.();
                  }}
                  className="text-xs w-full flex justify-center py-3 text-blue-500 hover:text-blue-400 transition-colors"
                  aria-label="Show more. This could be slow or freeze Figma for a few seconds."
                  title="Show more. This could be slow or freeze Figma for a few seconds."
                >
                  {showingFull ? "Showing full document" : "Show More"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CodePanel;
