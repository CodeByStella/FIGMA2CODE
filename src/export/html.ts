import { PluginSettings } from "types";
import { lockedHtmlSettings } from "../convert/settings";
import { htmlMain } from "../convert/html/generate";

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Preview already emits assets/* paths; leftover data URLs are not stored. */
export function rewriteDataUrlsToRelativePaths(html: string): string {
  return html;
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
