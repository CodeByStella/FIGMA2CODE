/** PNG export of the clone root for OpenRouter vision; long edge capped to control token cost. */

import { bytesToDataUrl } from "../../export/cache";

const MAX_LONG_EDGE = 2048;

export type ScreenshotResult = {
  bytes: Uint8Array;
  dataUrl: string;
  scale: number;
  width: number;
  height: number;
  elapsedMs: number;
};

/**
 * Scale down large frames before export — vision does not need full-resolution pixels
 * and smaller images reduce OpenRouter prompt cost.
 */
export async function captureRootScreenshot(
  root: SceneNode,
): Promise<ScreenshotResult> {
  const t0 = Date.now();
  const w = "width" in root ? root.width : 1;
  const h = "height" in root ? root.height : 1;
  const longEdge = Math.max(w, h);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;

  const exportable = root as SceneNode & ExportMixin;
  if (typeof exportable.exportAsync !== "function") {
    throw new Error(`Cannot export screenshot for node type ${root.type}`);
  }

  const bytes = await exportable.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale },
  });

  const dataUrl = bytesToDataUrl(bytes, "image/png");
  const elapsedMs = Date.now() - t0;

  return {
    bytes,
    dataUrl,
    scale,
    width: w,
    height: h,
    elapsedMs,
  };
}
