/** Vision model and pricing constants for the tidy AI stage. */

import type { LayerInventoryItem } from "./inventory";

export const OPENROUTER_MODEL = "xiaomi/mimo-v2.5";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** USD per 1M tokens for cost estimates logged after each vision call. */
export const MODEL_PRICE_INPUT_PER_1M_USD = 0.119;
export const MODEL_PRICE_OUTPUT_PER_1M_USD = 0.238;

export function buildVisionSystemPrompt(): string {
  return [
    "You analyze UI design screenshots and a layer inventory.",
    "Return ONLY valid JSON (no markdown) describing vertical section split lines and semantic names.",
    "Coordinates MUST use the same root-local Y axis as the inventory (not raw screenshot pixels).",
    "splitLinesY are horizontal cuts between major page sections, sorted ascending.",
    "sections MUST be contiguous: cover [0, rootHeight] with no gaps and no overlaps — each section's yEnd MUST equal the next section's yStart.",
    "renames map layer id → short semantic name (English); only rename clearly labeled UI.",
    "Do not invent CSS or Auto Layout props.",
  ].join(" ");
}

export function buildVisionUserPrompt(args: {
  rootWidth: number;
  rootHeight: number;
  inventory: LayerInventoryItem[];
}): string {
  const { rootWidth, rootHeight, inventory } = args;
  return [
    `Root size: width=${rootWidth}, height=${rootHeight}.`,
    "Layer inventory (root-local x,y,w,h):",
    JSON.stringify(inventory),
    "",
    "Respond with JSON shaped exactly like:",
    JSON.stringify({
      splitLinesY: [120, 480],
      sections: [
        { name: "Hero", yStart: 0, yEnd: 120 },
        { name: "Features", yStart: 120, yEnd: 480 },
      ],
      renames: { "1:23": "Hero title" },
    }),
  ].join("\n");
}
