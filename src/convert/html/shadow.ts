import { htmlColor } from "./color";
import { getCachedAsset } from "../../export/cache";

/**
 * Skip box-shadow when ZIP already baked effects into the raster/SVG asset.
 */
export const htmlShadow = (node: BlendMixin): string => {
  const id = (node as SceneNode).id;
  const cached = id ? getCachedAsset(id) : undefined;
  if (cached?.effectsBaked || (node as any).effectsBaked) {
    return "";
  }
  if (node.effects && node.effects.length > 0) {
    const shadowEffects = node.effects.filter(
      (d) =>
        (d.type === "DROP_SHADOW" ||
          d.type === "INNER_SHADOW" ||
          d.type === "LAYER_BLUR") &&
        d.visible,
    );
    if (shadowEffects.length > 0) {
      const shadows: string[] = [];

      shadowEffects.forEach((shadow) => {
        let x = 0;
        let y = 0;
        let blur = 0;
        let spread = "";
        let inner = "";
        let color = "";

        if (shadow.type === "DROP_SHADOW" || shadow.type === "INNER_SHADOW") {
          x = shadow.offset.x;
          y = shadow.offset.y;
          blur = shadow.radius;
          spread = shadow.spread ? `${shadow.spread}px ` : "";
          inner = shadow.type === "INNER_SHADOW" ? " inset" : "";
          color = htmlColor(shadow.color, shadow.color.a);
        } else if (shadow.type === "LAYER_BLUR") {
          x = shadow.radius;
          y = shadow.radius;
          blur = shadow.radius;
        }

        shadows.push(`${x}px ${y}px ${blur}px ${spread}${color}${inner}`);
      });

      return shadows.join(", ");
    }
  }
  return "";
};
