import { PluginSettings } from "types";
import { htmlMain, HtmlOutput } from "../html/htmlMain";
import { adaptRestJsonToAltNodes } from "../altNodes/adaptRestJson";
import { inferSemanticLayout } from "../layout/inferSemanticLayout";
import { DEFAULT_THRESHOLD_PX } from "../layout/geometry";
import { buildGoogleFontsHeadTags, collectFontsFromNodes } from "./webFonts";

export type HtmlFromRestOptions = Partial<PluginSettings> & {
  /** Wrap output in a full HTML document (default true) */
  fullDocument?: boolean;
  /** Document title when fullDocument is true */
  title?: string;
  /**
   * Infer flex Auto Layout from absolute positions (default true).
   * Set false to keep freeform absolute positioning.
   */
  inferLayout?: boolean;
  /** Pixel slop for alignment / gap matching (default 4). */
  layoutThresholdPx?: number;
  /** Inject Google Fonts links for families used in the dump (default true). */
  loadWebFonts?: boolean;
};

const defaultSettings: PluginSettings = {
  framework: "HTML",
  showLayerNames: false,
  useOldPluginVersion2025: false,
  responsiveRoot: false,
  flutterGenerationMode: "snippet",
  swiftUIGenerationMode: "snippet",
  composeGenerationMode: "snippet",
  roundTailwindValues: true,
  roundTailwindColors: true,
  useColorVariables: false,
  customTailwindPrefix: "",
  embedImages: false,
  embedVectors: false,
  htmlGenerationMode: "html",
  tailwindGenerationMode: "jsx",
  baseFontSize: 16,
  useTailwind4: true,
  thresholdPercent: 15,
  baseFontFamily: "",
  fontFamilyCustomConfig: {},
};

/** Minimal stub so builders can compare against figma.mixed offline. */
export function ensureFigmaOfflineStub() {
  const g = globalThis as any;
  if (g.figma?.mixed != null) return;
  g.figma = {
    mixed: Symbol.for("figma.mixed"),
    ui: { postMessage() {} },
    getNodeByIdAsync: async () => null,
    variables: {
      getVariableByIdAsync: async () => null,
      getVariableById: () => null,
    },
    getSelectionColors: () => null,
    currentPage: { selection: [] },
  };
}

/**
 * Convert a Figma REST / JSON_REST_V1 node (or tree root) to HTML
 * by adapting JSON, optionally inferring semantic layout, then htmlMain.
 */
export async function htmlFromRestJson(
  root: unknown,
  options: HtmlFromRestOptions = {},
): Promise<HtmlOutput & { document?: string }> {
  ensureFigmaOfflineStub();

  const {
    fullDocument = true,
    title = "Figma export",
    inferLayout = true,
    layoutThresholdPx = DEFAULT_THRESHOLD_PX,
    loadWebFonts = true,
    ...settingsOverrides
  } = options;

  const settings: PluginSettings = {
    ...defaultSettings,
    ...settingsOverrides,
    // Offline-safe defaults (override caller if they accidentally enable)
    embedImages: false,
    embedVectors: false,
    useColorVariables: false,
    framework: "HTML",
  };

  let adapted = adaptRestJsonToAltNodes(root as any, settings);
  if (adapted.length === 0) {
    return {
      html: "",
      document: fullDocument ? emptyDocument(title) : undefined,
    };
  }

  adapted = inferSemanticLayout(adapted, {
    enabled: inferLayout,
    thresholdPx: layoutThresholdPx,
  });

  const result = await htmlMain(adapted as any, settings, false);

  if (!fullDocument) {
    return result;
  }

  const fontLinks = loadWebFonts
    ? buildGoogleFontsHeadTags(collectFontsFromNodes(adapted))
    : "";
  const css = result.css ? `<style>\n${result.css}\n</style>` : "";
  const document = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  ${fontLinks}
  <style>body { margin: 0; }</style>
  ${css}
</head>
<body>
${result.html}
</body>
</html>
`;

  return { ...result, document };
}

function emptyDocument(title: string) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${escapeHtml(title)}</title></head><body></body></html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
