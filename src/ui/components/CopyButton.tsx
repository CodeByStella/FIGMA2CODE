/** Clipboard button; can copy inline text or delegate to main thread for full HTML. */
"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import copy from "copy-to-clipboard";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";

interface CopyButtonProps {
  value?: string;
  onCopy?: () => void;
  className?: string;
  showLabel?: boolean;
  successDuration?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function CopyButton({
  value,
  onCopy,
  className,
  showLabel = true,
  successDuration = 1500,
  onMouseEnter,
  onMouseLeave,
}: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), successDuration);
    return () => clearTimeout(timer);
  }, [isCopied, successDuration]);

  const handleCopy = useCallback(() => {
    try {
      if (onCopy) {
        onCopy();
      } else if (value) {
        copy(value);
      }
      setIsCopied(true);
    } catch {}
  }, [onCopy, value]);

  return (
    <Button
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      onClick={handleCopy}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "transition-colors duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)]",
        "bg-neutral-100 text-neutral-800 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800/90 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-neutral-600 dark:hover:text-white dark:hover:ring-white/20",
        className,
      )}
      aria-label={isCopied ? "Copied!" : "Copy to clipboard"}
    >
      <span className={cn("relative h-5 w-5 shrink-0")} aria-hidden="true">
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "transition-all duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)]",
            "motion-reduce:transition-none",
            isCopied ? "scale-50 opacity-0" : "scale-100 opacity-100",
          )}
        >
          <Copy className="h-4 w-4" />
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "transition-all duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)]",
            "motion-reduce:transition-none",
            isCopied ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        >
          <Check className="h-4 w-4" />
        </span>
      </span>

      {showLabel && <span className="inline-flex text-left">{"Copy"}</span>}
    </Button>
  );
}
