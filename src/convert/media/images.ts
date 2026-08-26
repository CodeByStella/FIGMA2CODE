import { PluginAltNode, ExportableNode } from "types";
import { btoa } from "js-base64";
import { addWarning } from "../warnings";
import { exportAsyncProxy } from "./exportAsync";
import { bytesToDataUrl, getCachedAsset } from "../../export/cache";
import { logError, safeNodeRef } from "../../shared/log";

// Image fills: ZIP cache → base64 data URL, or live exportAsync fallback for preview.
export const PLACEHOLDER_IMAGE_DOMAIN = "https://placehold.co";

const createCanvasImageUrl = (width: number, height: number): string => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return `${PLACEHOLDER_IMAGE_DOMAIN}/${width}x${height}`;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return `${PLACEHOLDER_IMAGE_DOMAIN}/${width}x${height}`;
  }

  const fontSize = Math.max(12, Math.floor(width * 0.15));
  ctx.font = `bold ${fontSize}px Inter, Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "#888888";

  const text = `${width} x ${height}`;
  const textWidth = ctx.measureText(text).width;
  const x = (width - textWidth) / 2;
  const y = (height + fontSize) / 2;

  ctx.fillText(text, x, y);

  const image = canvas.toDataURL();
  const base64 = image.substring(22);
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const file = new Blob([byteArray], {
    type: "image/png;base64",
  });
  return URL.createObjectURL(file);
};

export const getPlaceholderImage = (w: number, h = -1) => {
  const _w = w.toFixed(0);
  const _h = (h < 0 ? w : h).toFixed(0);

  return `${PLACEHOLDER_IMAGE_DOMAIN}/${_w}x${_h}`;
};

const fillIsImage = ({ type }: Paint) => type === "IMAGE";

export const getImageFills = (node: MinimalFillsMixin): ImagePaint[] => {
  try {
    return (node.fills as ImagePaint[]).filter(fillIsImage);
  } catch {
    return [];
  }
};

export const nodeHasImageFill = (node: MinimalFillsMixin): Boolean =>
  getImageFills(node).length > 0;

export const nodeHasMultipleFills = (node: MinimalFillsMixin) =>
  node.fills instanceof Array && node.fills.length > 1;

const imageBytesToBase64 = (bytes: Uint8Array): string => {
  const binaryString = bytes.reduce((data, byte) => {
    return data + String.fromCharCode(byte);
  }, "");

  const b64 = btoa(binaryString);

  return `data:image/png;base64,${b64}`;
};

export const exportNodeAsBase64PNG = async <T extends ExportableNode>(
  node: PluginAltNode<T>,
  excludeChildren: boolean,
  options?: { relativeAssetPaths?: boolean },
) => {
  // Prefer framed PNG bytes from ZIP export when available.
  const cached = node.id ? getCachedAsset(node.id) : undefined;
  if (cached && cached.format !== "SVG") {
    if (options?.relativeAssetPaths && cached.path) {
      return cached.path;
    }
    if (node.base64 !== undefined && node.base64 !== "") {
      return node.base64;
    }
    if (cached.bytes) {
      node.base64 = bytesToDataUrl(cached.bytes, cached.mime);
      return node.base64;
    }
  }

  if (node.base64 !== undefined && node.base64 !== "") {
    return node.base64;
  }

  const n: ExportableNode = node;

  const temporarilyHideChildren =
    excludeChildren && "children" in n && n.children.length > 0;
  const parent = n as ChildrenMixin;
  const originalVisibility = new Map<SceneNode, boolean>();

  if (temporarilyHideChildren) {
    parent.children.forEach((child: SceneNode) => {
      originalVisibility.set(child, child.visible);
      child.visible = false;
    });
  }

  const restoreChildren = () => {
    if (!temporarilyHideChildren) return;
    parent.children.forEach((child) => {
      child.visible = originalVisibility.get(child) ?? false;
    });
  };

  try {
    const exportSettings: ExportSettingsImage = {
      format: "PNG",
      constraint: { type: "SCALE", value: 1 },
    };
    const bytes = await exportAsyncProxy(n, exportSettings);

    addWarning("Some images exported as Base64 PNG");

    const base64 = imageBytesToBase64(bytes);
    node.base64 = base64;
    return base64;
  } catch (error) {
    logError(`Failed exporting image (${safeNodeRef(node)})`, error);
    addWarning(`Failed exporting image for ${safeNodeRef(node)}`);
    return getPlaceholderImage(node.width, node.height);
  } finally {
    restoreChildren();
  }
};
