import { PluginSettings } from "types";
import { lockedHtmlSettings } from "../convert/settings";
import { htmlMain } from "../convert/html/generate";
import { getAllCachedAssets } from "./cache";
import { utf8Encode } from "../shared/utf8";
import { uint8ToBase64 } from "./cache";

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replace any leftover data URLs with relative ZIP asset paths. */
export function rewriteDataUrlsToRelativePaths(html: string): string {
  let out = html;
  for (const asset of getAllCachedAssets().values()) {
    if (!asset.dataUrl || !asset.path) continue;
    if (out.includes(asset.dataUrl)) {
      out = out.split(asset.dataUrl).join(asset.path);
    }
  }
  return out;
}

/**
 * Build a standalone index.html that references assets/* via relative paths.
 * Open the extracted ZIP folder's index.html in a browser to preview the design.
 */
export async function buildZipIndexHtml(
  nodes: SceneNode[],
  settings: PluginSettings,
  title: string,
): Promise<string> {
  const output = await htmlMain(nodes, lockedHtmlSettings(settings), false);

  const body = rewriteDataUrlsToRelativePaths(output.html);
  const css = output.css ? `\n${output.css}\n` : "";
  const safeTitle = escapeHtml(title || "Figma export");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    html, body { margin: 0; padding: 0; }
    body { background: #fff; }
${css}  </style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function indexHtmlToZipBase64(html: string): string {
  return uint8ToBase64(utf8Encode(html));
}
