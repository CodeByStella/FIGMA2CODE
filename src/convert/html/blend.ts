import { numberToFixedString } from "../css/numbers";
import { formatWithJSX } from "../css/format";
import { RestAltNode } from "types";

/** Node opacity [0,1] → CSS opacity when not fully opaque. */
export const htmlOpacity = (
  node: MinimalBlendMixin,
  isJsx: boolean,
): string => {
  if (node.opacity !== undefined && node.opacity !== 1) {
    if (isJsx) {
      return `opacity: ${numberToFixedString(node.opacity)}`;
    } else {
      return `opacity: ${numberToFixedString(node.opacity)}`;
    }
  }
  return "";
};

export const htmlBlendMode = (
  node: MinimalBlendMixin,
  isJsx: boolean,
): string => {
  if (node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
    let blendMode = "";
    switch (node.blendMode) {
      case "MULTIPLY":
        blendMode = "multiply";
        break;
      case "SCREEN":
        blendMode = "screen";
        break;
      case "OVERLAY":
        blendMode = "overlay";
        break;
      case "DARKEN":
        blendMode = "darken";
        break;
      case "LIGHTEN":
        blendMode = "lighten";
        break;
      case "COLOR_DODGE":
        blendMode = "color-dodge";
        break;
      case "COLOR_BURN":
        blendMode = "color-burn";
        break;
      case "HARD_LIGHT":
        blendMode = "hard-light";
        break;
      case "SOFT_LIGHT":
        blendMode = "soft-light";
        break;
      case "DIFFERENCE":
        blendMode = "difference";
        break;
      case "EXCLUSION":
        blendMode = "exclusion";
        break;
      case "HUE":
        blendMode = "hue";
        break;
      case "SATURATION":
        blendMode = "saturation";
        break;
      case "COLOR":
        blendMode = "color";
        break;
      case "LUMINOSITY":
        blendMode = "luminosity";
        break;
    }

    if (blendMode) {
      return formatWithJSX("mix-blend-mode", isJsx, blendMode);
    }
  }
  return "";
};

/**
 * Hidden Figma layers stay in the tree for group masks; emit visibility:hidden
 * rather than stripping fills (which breaks nested structure).
 */
export const htmlVisibility = (
  node: SceneNodeMixin,
  isJsx: boolean,
): string => {
  if (node.visible !== undefined && !node.visible) {
    return formatWithJSX("visibility", isJsx, "hidden");
  }
  return "";
};

/** Apply cumulativeRotation from GROUP inlining plus node rotation for CSS transform. */
export const htmlRotation = (node: RestAltNode, isJsx: boolean): string[] => {
  const rotation =
    -Math.round((node.rotation || 0) + (node.cumulativeRotation || 0)) || 0;

  if (rotation !== 0) {
    return [
      formatWithJSX(
        "transform",
        isJsx,
        `rotate(${numberToFixedString(rotation)}deg)`,
      ),
      formatWithJSX("transform-origin", isJsx, "top left"),
    ];
  }
  return [];
};
