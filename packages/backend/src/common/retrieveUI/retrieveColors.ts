import { rgbTo6hex } from "../color";
import {
  htmlColorFromFill,
  htmlGradientFromFills,
} from "../../html/builderImpl/htmlColor";
import { calculateContrastRatio } from "./commonUI";
import { LinearGradientConversion, SolidColorConversion } from "types";
import { processColorVariables } from "../../altNodes/jsonNodeConversion";

export const retrieveGenericSolidUIColors = async (): Promise<
  Array<SolidColorConversion>
> => {
  const selectionColors = figma.getSelectionColors();
  if (!selectionColors || selectionColors.paints.length === 0) return [];

  const colors: Array<SolidColorConversion> = [];

  await Promise.all(
    selectionColors.paints.map(async (d) => {
      const paint = { ...d } as Paint;
      await processColorVariables(paint as any);

      const fill = convertSolidColor(paint);
      if (fill) {
        const exists = colors.find(
          (col) => col.exportValue === fill.exportValue,
        );
        if (!exists) {
          colors.push(fill);
        }
      }
    }),
  );

  return colors.sort((a, b) => a.hex.localeCompare(b.hex));
};

const convertSolidColor = (fill: Paint): SolidColorConversion | null => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 1, g: 1, b: 1 };

  if (fill.type !== "SOLID") return null;

  return {
    hex: rgbTo6hex(fill.color).toUpperCase(),
    colorName: "",
    exportValue: htmlColorFromFill(fill as any),
    contrastBlack: calculateContrastRatio(fill.color, black),
    contrastWhite: calculateContrastRatio(fill.color, white),
  };
};

export const retrieveGenericLinearGradients = async (): Promise<
  Array<LinearGradientConversion>
> => {
  const selectionColors = figma.getSelectionColors();
  const colorStr: Array<LinearGradientConversion> = [];

  if (!selectionColors || selectionColors.paints.length === 0) return [];

  await Promise.all(
    selectionColors.paints.map(async (paint) => {
      if (paint.type !== "GRADIENT_LINEAR") return;

      const fill = { ...paint };
      const t = fill.gradientTransform;
      fill.gradientHandlePositions = [
        { x: t[0][2], y: t[1][2] },
        { x: t[0][0] + t[0][2], y: t[1][0] + t[1][2] },
      ];

      if (fill.gradientStops) {
        for (const stop of fill.gradientStops) {
          if (stop.boundVariables?.color) {
            try {
              const variableId = stop.boundVariables.color.id;
              const variable = figma.variables.getVariableById(variableId);
              if (variable) {
                (stop as any).variableColorName = variable.name
                  .replace(/\s+/g, "-")
                  .toLowerCase();
              }
            } catch (e) {
              console.error("Error retrieving variable for gradient stop:", e);
            }
          }
        }
      }

      const exportValue = htmlGradientFromFills(fill);
      colorStr.push({
        cssPreview: exportValue,
        exportValue,
      });
    }),
  );

  return colorStr;
};
