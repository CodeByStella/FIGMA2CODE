/**
 * In-memory asset entries. Preview stores path + flags only.
 * ZIP export adds bytes long enough to stream one file, then drops them.
 */

export type CachedAsset = {
  path: string;
  mime: string;
  /** Present only while exporting / streaming a file */
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
