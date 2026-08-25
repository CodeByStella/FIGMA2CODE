import { PluginAltNode } from "types";
import { curry } from "../../shared/curry";
import { exportAsyncProxy } from "../media/exportAsync";
import { addWarning } from "../warnings";
import { getVariableNameFromColor } from "./toJson";
import { htmlColor } from "../html/color";
import { getCachedAsset } from "../../export/cache";
import { utf8Decode } from "../../shared/utf8";

// SVG flatten: exportAsync or ZIP cache, then rewrite literal colors to CSS variables.
export const overrideReadonlyProperty = curry(
  <T, K extends keyof T>(prop: K, value: any, obj: T): T =>
    Object.defineProperty(obj, prop, {
      value: value,
      writable: true,
      configurable: true,
    }),
);

export const assignParent = overrideReadonlyProperty("parent");
export const assignChildren = overrideReadonlyProperty("children");
export const assignType = overrideReadonlyProperty("type");
export const assignRectangleType = assignType("RECTANGLE");

export function isNotEmpty<TValue>(
  value: TValue | null | undefined,
): value is TValue {
  return value !== null && value !== undefined;
}

export const isTypeOrGroupOfTypes = curry(
  (matchTypes: NodeType[], node: SceneNode): boolean => {
    if (matchTypes.includes(node.type)) return true;

    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) {
        const childNode = node.children[i];
        const result = isTypeOrGroupOfTypes(matchTypes, childNode);
        if (!result) {
          return false;
        }
      }
      return node.children.length > 0;
    }

    return false;
  },
);

export const isSVGNode = (node: SceneNode) => {
  const altNode = node as PluginAltNode<typeof node>;
  return altNode.canBeFlattened;
};

export const renderAndAttachSVG = async (node: any) => {
  if (node.canBeFlattened) {
    if (node.svg) {
      return node;
    }

    // ZIP export may have already baked effects into assets/*.svg.
    const cached = node.id ? getCachedAsset(node.id) : undefined;
    if (cached && cached.format === "SVG" && cached.bytes) {
      try {
        node.svg = utf8Decode(cached.bytes);
        return node;
      } catch {
        /* fall through to exportAsync */
      }
    }

    const w = typeof node.width === "number" ? node.width : 0;
    const h = typeof node.height === "number" ? node.height : 0;
    if (node.visible === false || w < 0.5 || h < 0.5) {
      addWarning(`Skipped empty SVG for ${node.name || node.id}`);
      return node;
    }

    try {
      const svg = (await exportAsyncProxy<string>(node, {
        format: "SVG_STRING",
      })) as string;

      if (node.colorVariableMappings && node.colorVariableMappings.size > 0) {
        let processedSvg = svg;

        const colorAttributeRegex = /(fill|stroke)="([^"]*)"/g;

        processedSvg = processedSvg.replace(
          colorAttributeRegex,
          (match, attribute, colorValue) => {
            const normalizedColor = colorValue.toLowerCase().trim();

            const mapping = node.colorVariableMappings.get(normalizedColor);
            if (mapping) {
              return `${attribute}="var(--${mapping.variableName}, ${colorValue})"`;
            }

            return match;
          },
        );

        const styleRegex =
          /style="([^"]*)(?:(fill|stroke):\s*([^;"]*))(;|\s|")([^"]*)"/g;

        processedSvg = processedSvg.replace(
          styleRegex,
          (match, prefix, property, colorValue, separator, suffix) => {
            const normalizedColor = colorValue.toLowerCase().trim();

            const mapping = node.colorVariableMappings.get(normalizedColor);
            if (mapping) {
              return `style="${prefix}${property}: var(--${mapping.variableName}, ${colorValue})${separator}${suffix}"`;
            }

            return match;
          },
        );

        node.svg = processedSvg;
      } else {
        node.svg = svg;
      }
    } catch (error) {
      addWarning(`Failed rendering SVG for ${node.name}`);
    }
  }
  return node;
};
