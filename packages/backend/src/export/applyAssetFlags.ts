import { getCachedAsset } from "./assetCache";

/** Attach ZIP-export accuracy flags onto converted AltNodes (mutates tree). */
export function applyAssetFlagsToTree(nodes: readonly any[]): void {
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    const cached = n.id ? getCachedAsset(n.id) : undefined;
    if (cached) {
      n.effectsBaked = cached.effectsBaked;
      n.imageAssetFramed = cached.imageAssetFramed;
      n.exportAsAsset = true;
      if (cached.layoutWidth != null) n.layoutWidth = cached.layoutWidth;
      if (cached.layoutHeight != null) n.layoutHeight = cached.layoutHeight;
      if (cached.flipHorizontal != null)
        n.flipHorizontal = cached.flipHorizontal;
      if (cached.flipVertical != null) n.flipVertical = cached.flipVertical;
      if (cached.format === "SVG") n.assetOnly = true;
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  };
  for (const n of nodes) walk(n);
}

/** CSS transform bits for framed IMAGE assets (rotation cleared at export). */
export function framedImageTransformCss(node: any): string {
  const parts: string[] = [];
  const rot = typeof node.rotation === "number" ? node.rotation : 0;
  // AltNode rotation is typically degrees already after jsonNodeConversion
  if (Math.abs(rot) > 0.05) parts.push(`rotate(${rot}deg)`);
  const sx = node.flipHorizontal ? -1 : 1;
  const sy = node.flipVertical ? -1 : 1;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.length ? parts.join(" ") : "";
}
