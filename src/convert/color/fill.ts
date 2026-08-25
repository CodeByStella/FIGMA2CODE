import { Paint } from "../../types/figma-rest";

/**
 * Figma stacks paints bottom-to-top; the visible color is the last visible entry.
 */
export const retrieveTopFill = (
  fills: ReadonlyArray<Paint> | undefined,
): Paint | undefined => {
  if (fills && Array.isArray(fills) && fills.length > 0) {
    return [...fills].reverse().find((d) => d.visible !== false);
  }

  return undefined;
};
