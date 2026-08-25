/**
 * In-memory asset cache keyed by node id. Live preview keeps paths and export
 * flags only; ZIP export attaches bytes long enough to stream each file to the
 * UI, then drops them to limit main-thread memory.
 */

export type CachedAsset = {
  path: string;
  mime: string;
  /** Raw file bytes; present only while a ZIP chunk is being streamed */
  bytes?: Uint8Array;
  format: "SVG" | "PNG" | "JPG" | "GIF" | "WEBP";
  effectsBaked: boolean;
  imageAssetFramed: boolean;
  layoutWidth?: number;
  layoutHeight?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  rotationDeg?: number;
};

let cacheByNodeId: Map<string, CachedAsset> = new Map();

export function clearAssetCache(): void {
  cacheByNodeId = new Map();
}

export function setAssetCache(entries: Map<string, CachedAsset>): void {
  cacheByNodeId = entries;
}

export function getCachedAsset(nodeId: string): CachedAsset | undefined {
  return cacheByNodeId.get(nodeId);
}

export function getAllCachedAssets(): ReadonlyMap<string, CachedAsset> {
  return cacheByNodeId;
}

export function hasAssetCache(): boolean {
  return cacheByNodeId.size > 0;
}

function toBinaryString(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice) as any);
  }
  return binary;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${btoa(toBinaryString(bytes))}`;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  return btoa(toBinaryString(bytes));
}
