import { HTMLSettings } from "types";

export const getCommonPositionValue = (
  node: SceneNode,
  settings?: HTMLSettings,
): { x: number; y: number } => {
  if (node.parent && node.parent.absoluteBoundingBox) {
    if (settings?.embedVectors && node.svg) {
      // Inlined SVG is positioned from absoluteBoundingBox, not transformed x/y.
      return {
        x: node.absoluteBoundingBox.x - node.parent.absoluteBoundingBox.x,
        y: node.absoluteBoundingBox.y - node.parent.absoluteBoundingBox.y,
      };
    }

    return { x: node.x, y: node.y };
  }

  if (node.parent && node.parent.type === "GROUP") {
    return {
      x: node.x - node.parent.x,
      y: node.y - node.parent.y,
    };
  }

  return {
    x: node.x,
    y: node.y,
  };
};

interface BoundingBox {
  width: number;
  height: number;
  x: number;
  y: number;
}

interface RectangleStyle {
  width: number;
  height: number;
  left: number;
  top: number;
  rotation: number;
}

/**
 * Derive pre-rotation width/height and CSS position from JSON_REST_V1 bounding box.
 * Used in nodes/toJson when REST export omits explicit dimensions.
 */
export function calculateRectangleFromBoundingBox(
  boundingBox: BoundingBox,
  figmaRotationDegrees: number,
): RectangleStyle {
  const cssRotationDegrees = -figmaRotationDegrees;
  const theta = (cssRotationDegrees * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const absCosTheta = Math.abs(cosTheta);
  const absSinTheta = Math.abs(sinTheta);

  const { width: w_b, height: h_b, x: x_b, y: y_b } = boundingBox;

  const denominator = absCosTheta * absCosTheta - absSinTheta * absSinTheta;
  const h = (w_b * absSinTheta - h_b * absCosTheta) / -denominator;
  const w = (w_b - h * absSinTheta) / absCosTheta;

  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const rotatedCorners = corners.map(({ x, y }) => ({
    x: x * cosTheta + y * sinTheta,
    y: -x * sinTheta + y * cosTheta,
  }));

  const minX = Math.min(...rotatedCorners.map((c) => c.x));
  const minY = Math.min(...rotatedCorners.map((c) => c.y));

  const left = x_b - minX;
  const top = y_b - minY;

  return {
    width: parseFloat(w.toFixed(2)),
    height: parseFloat(h.toFixed(2)),
    left: parseFloat(left.toFixed(2)),
    top: parseFloat(top.toFixed(2)),
    rotation: cssRotationDegrees,
  };
}

export const commonIsAbsolutePosition = (node: SceneNode) => {
  if ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE") {
    return true;
  }

  if (!node.parent || node.parent === undefined) {
    return false;
  }

  if (
    ("layoutMode" in node.parent && node.parent.layoutMode === "NONE") ||
    !("layoutMode" in node.parent)
  ) {
    return true;
  }

  return false;
};
