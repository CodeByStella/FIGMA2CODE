/**
 * In-memory asset bytes produced by ZIP export, reused by convertToCode
 * so we do not call exportAsync twice per node.
 */

export type CachedAsset = {
  path: string;
  mime: string;
  /** raw bytes */
  bytes: Uint8Array;
  /** data URL for codegen embed */
  dataUrl: string;
  format: "SVG" | "PNG" | "JPG" | "GIF" | "WEBP";
  effectsBaked: boolean;
  imageAssetFramed: boolean;
  /** Unrotated layout size for framed IMAGE PNG + CSS rotate */
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
