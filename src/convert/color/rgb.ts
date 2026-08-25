import { GradientPaint } from "../../types/figma-rest";
import { numberToFixedString } from "../css/numbers";

// Shared RGB/gradient math for html/color.ts and the UI color swatch panel.
export const rgbTo6hex = (color: RGB | RGBA): string => {
  const hex =
    ((color.r * 255) | (1 << 8)).toString(16).slice(1) +
    ((color.g * 255) | (1 << 8)).toString(16).slice(1) +
    ((color.b * 255) | (1 << 8)).toString(16).slice(1);

  return hex;
};

export const rgbTo8hex = (color: RGB, alpha: number): string => {
  const hex =
    ((alpha * 255) | (1 << 8)).toString(16).slice(1) +
    ((color.r * 255) | (1 << 8)).toString(16).slice(1) +
    ((color.g * 255) | (1 << 8)).toString(16).slice(1) +
    ((color.b * 255) | (1 << 8)).toString(16).slice(1);

  return hex;
};

/** RGB → CSS color; prefers hex, falls back to rgba when alpha < 1. */
export const rgbToCssColor = (color: RGB | RGBA, alpha: number = 1): string => {
  if (color.r === 1 && color.g === 1 && color.b === 1 && alpha === 1) {
    return "white";
  }

  if (color.r === 0 && color.g === 0 && color.b === 0 && alpha === 1) {
    return "black";
  }

  if (alpha === 1) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);

    const toHex = (num: number): string => num.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  const r = numberToFixedString(color.r * 255);
  const g = numberToFixedString(color.g * 255);
  const b = numberToFixedString(color.b * 255);
  const a = numberToFixedString(alpha);

  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export const gradientAngle = (fill: GradientPaint): number => {
  const [start, end] = fill.gradientHandlePositions;
  return calculateAngle(start, end);
};

/** Angle between normalized Figma gradient handle positions. */
export const calculateAngle = (
  start: { x: number; y: number },
  end: { x: number; y: number },
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return (angle + 360) % 360;
};

export const decomposeRelativeTransform = (
  t1: [number, number, number],
  t2: [number, number, number],
): {
  translation: [number, number];
  rotation: number;
  scale: [number, number];
  skew: [number, number];
} => {
  const a: number = t1[0];
  const b: number = t1[1];
  const c: number = t1[2];
  const d: number = t2[0];
  const e: number = t2[1];
  const f: number = t2[2];

  const delta = a * d - b * c;

  const result: {
    translation: [number, number];
    rotation: number;
    scale: [number, number];
    skew: [number, number];
  } = {
    translation: [e, f],
    rotation: 0,
    scale: [0, 0],
    skew: [0, 0],
  };

  if (a !== 0 || b !== 0) {
    const r = Math.sqrt(a * a + b * b);
    result.rotation = b > 0 ? Math.acos(a / r) : -Math.acos(a / r);
    result.scale = [r, delta / r];
    result.skew = [Math.atan((a * c + b * d) / (r * r)), 0];
  }

  return result;
};

export const isBlack = (color: RGB, opacity: number = 1): boolean =>
  color.r === 0 && color.g === 0 && color.b === 0 && opacity === 1;

export const isWhite = (color: RGB, opacity: number = 1): boolean =>
  color.r === 1 && color.g === 1 && color.b === 1 && opacity === 1;

/** Format gradient stops with a pluggable color formatter (shared by export paths). */
export const processGradientStops = (
  stops: ReadonlyArray<ColorStop>,
  opacity: number = 1,
  colorFormatter: (color: RGB | RGBA, alpha: number) => string,
): string => {
  return stops
    .map((stop) => {
      const color = colorFormatter(stop.color, stop.color.a * opacity);
      const position = `${(stop.position * 100).toFixed(0)}%`;
      return `${color} ${position}`;
    })
    .join(", ");
};
