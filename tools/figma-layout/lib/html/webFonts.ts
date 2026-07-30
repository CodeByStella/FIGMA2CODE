type AnyNode = Record<string, any>;

/** Families that browsers already resolve without a webfont load. */
const SYSTEM_FAMILIES = new Set(
  [
    "arial",
    "helvetica",
    "helvetica neue",
    "times",
    "times new roman",
    "courier",
    "courier new",
    "georgia",
    "verdana",
    "tahoma",
    "trebuchet ms",
    "comic sans ms",
    "impact",
    "system-ui",
    "sans-serif",
    "serif",
    "monospace",
    "cursive",
    "fantasy",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
  ].map((s) => s.toLowerCase()),
);

export type CollectedFont = {
  family: string;
  weights: Set<number>;
  italics: boolean;
};

/**
 * Walk adapted AltNode-like trees and collect font families / weights
 * from TEXT nodes (styledTextSegments or style).
 */
export function collectFontsFromNodes(
  nodes: AnyNode[],
): Map<string, CollectedFont> {
  const map = new Map<string, CollectedFont>();

  const add = (
    family: string | undefined,
    weight: unknown,
    italic: boolean,
  ) => {
    if (!family || typeof family !== "string") return;
    const trimmed = family.trim();
    if (!trimmed || SYSTEM_FAMILIES.has(trimmed.toLowerCase())) return;

    let entry = map.get(trimmed);
    if (!entry) {
      entry = { family: trimmed, weights: new Set(), italics: false };
      map.set(trimmed, entry);
    }
    const w = normalizeWeight(weight);
    entry.weights.add(w);
    if (italic) entry.italics = true;
  };

  const walk = (node: AnyNode) => {
    if (!node || typeof node !== "object") return;

    if (node.type === "TEXT") {
      const segments = Array.isArray(node.styledTextSegments)
        ? node.styledTextSegments
        : null;
      if (segments && segments.length > 0) {
        for (const seg of segments) {
          const family =
            seg.fontName?.family ?? node.fontFamily ?? node.style?.fontFamily;
          const styleName = String(seg.fontName?.style ?? "");
          const italic =
            /italic/i.test(styleName) ||
            String(seg.fontStyle ?? "")
              .toLowerCase()
              .includes("italic");
          add(family, seg.fontWeight ?? node.fontWeight, italic);
        }
      } else {
        const family = node.fontFamily ?? node.style?.fontFamily;
        const styleName = String(
          node.fontPostScriptName ?? node.style?.fontPostScriptName ?? "",
        );
        const italic = /italic/i.test(styleName);
        add(family, node.fontWeight ?? node.style?.fontWeight, italic);
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };

  for (const n of nodes) walk(n);
  return map;
}

function normalizeWeight(weight: unknown): number {
  const n = typeof weight === "number" ? weight : Number(weight);
  if (!Number.isFinite(n)) return 400;
  // Snap to common Google Fonts axis values
  const allowed = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  let best = 400;
  let bestDist = Infinity;
  for (const a of allowed) {
    const d = Math.abs(a - n);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Build <link> tags for Google Fonts CSS2 API covering collected families.
 */
export function buildGoogleFontsHeadTags(
  fonts: Map<string, CollectedFont>,
): string {
  if (fonts.size === 0) return "";

  const families: string[] = [];
  for (const { family, weights, italics } of fonts.values()) {
    const sortedWeights = [...weights].sort((a, b) => a - b);
    if (sortedWeights.length === 0) sortedWeights.push(400);

    const encodedFamily = encodeURIComponent(family).replace(/%20/g, "+");

    if (italics) {
      // ital,wght@0,400;0,700;1,400;1,700
      const pairs: string[] = [];
      for (const w of sortedWeights) {
        pairs.push(`0,${w}`);
        pairs.push(`1,${w}`);
      }
      families.push(`${encodedFamily}:ital,wght@${pairs.join(";")}`);
    } else {
      families.push(`${encodedFamily}:wght@${sortedWeights.join(";")}`);
    }
  }

  const href = `https://fonts.googleapis.com/css2?${families
    .map((f) => `family=${f}`)
    .join("&")}&display=swap`;

  return [
    `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
    `<link rel="stylesheet" href="${href}" />`,
  ].join("\n  ");
}

/**
 * CSS font-family value with a generic fallback for the web.
 * e.g. Inter → `Inter, sans-serif`
 */
export function cssFontFamilyStack(family: string | undefined): string {
  if (!family || !family.trim()) return "sans-serif";
  const trimmed = family.trim();
  if (trimmed.includes(",")) return trimmed;

  const needsQuotes = /[\s'"]/.test(trimmed) || /[^a-zA-Z0-9_-]/.test(trimmed);
  const named = needsQuotes
    ? `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : trimmed;

  const lower = trimmed.toLowerCase();
  if (
    /mono|courier|consolas|menlo|monaco|source code|fira code|roboto mono|jetbrains/.test(
      lower,
    )
  ) {
    return `${named}, monospace`;
  }
  if (
    /(?:^|[^a-z])serif|times|georgia|garamond|playfair|merriweather|libre baskerville/.test(
      lower,
    ) &&
    !/sans/.test(lower)
  ) {
    return `${named}, serif`;
  }
  return `${named}, sans-serif`;
}
