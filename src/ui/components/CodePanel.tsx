/** Syntax-highlighted HTML preview; full document is fetched from main on demand. */
import { useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coldarkDark as theme } from "react-syntax-highlighter/dist/esm/styles/prism";
import { CopyButton } from "./CopyButton";
import EmptyState from "./EmptyState";

interface CodePanelProps {
  code: string;
  lineCount: number;
  showingFullCode: boolean;
  onCopyFullCode?: () => void;
  onShowFullCode?: () => void;
}

const CodePanel = (props: CodePanelProps) => {
  const [syntaxHovered, setSyntaxHovered] = useState(false);
  const { code, lineCount, showingFullCode } = props;
  const isCodeEmpty = code === "";

  const showMoreButton = lineCount > 25;
  const showCodeCopyButton = lineCount > 5;

  const handleButtonHover = () => setSyntaxHovered(true);
  const handleButtonLeave = () => setSyntaxHovered(false);

  const sizeHint = useMemo(() => {
    if (lineCount <= 25) return null;
    return showingFullCode
      ? `${lineCount} lines`
      : `${lineCount} lines — showing first 25`;
  }, [lineCount, showingFullCode]);

  return (
    <div className="w-full flex flex-col gap-2 mt-2">
      <div className="flex items-center justify-between w-full">
        <p className="text-lg font-medium text-center text-foreground rounded-lg">
          Code
        </p>
        {!isCodeEmpty && (
          <CopyButton
            onCopy={props.onCopyFullCode}
            onMouseEnter={handleButtonHover}
            onMouseLeave={handleButtonLeave}
          />
        )}
      </div>
      {sizeHint && <p className="text-xs text-muted-foreground">{sizeHint}</p>}

      <div
        className={`relative rounded-lg ring-green-600 transition-all duration-200 ${
          syntaxHovered ? "ring-2" : "ring-0"
        }`}
      >
        {isCodeEmpty ? (
          <EmptyState />
        ) : (
          <>
            {showCodeCopyButton && (
              <div className="pointer-events-none sticky top-3 z-10 h-0">
                <CopyButton
                  showLabel={false}
                  onCopy={props.onCopyFullCode}
                  onMouseEnter={handleButtonHover}
                  onMouseLeave={handleButtonLeave}
                  className="pointer-events-auto absolute right-2 top-2 h-7 w-7 rounded-md bg-neutral-800/90 p-0 text-neutral-200 shadow-sm ring-1 ring-white/10 backdrop-blur-sm hover:bg-neutral-600 hover:text-white hover:ring-white/20 dark:bg-neutral-800/90 dark:hover:bg-neutral-600"
                />
              </div>
            )}
            <SyntaxHighlighter
              language="html"
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
              }}
            >
              {code}
            </SyntaxHighlighter>
            {showMoreButton && (
              <div className="flex justify-center dark:bg-[#1B1B1B] border-t dark:border-gray-700">
                <button
                  onClick={() => {
                    if (showingFullCode) return;
                    props.onShowFullCode?.();
                  }}
                  className="text-xs w-full flex justify-center py-3 text-blue-500 hover:text-blue-400 transition-colors"
                  aria-label="Show more code. This could be slow or freeze Figma for a few seconds."
                  title="Show more code. This could be slow or freeze Figma for a few seconds."
                >
                  {showingFullCode ? "Showing full document" : "Show More"}
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
