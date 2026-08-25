import { Warning } from "types";

// Conversion warnings accumulate here and ship to the UI with the preview — not console.log.
export const warnings = new Set<Warning>();
export const addWarning = (warning: Warning) => {
  warnings.add(warning);
};
export const clearWarnings = () => warnings.clear();
