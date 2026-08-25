import { FontWeightNumber } from "types";

// Map Figma font style names to numeric weights for CSS output.
export const convertFontWeight = (weight: string): FontWeightNumber | null => {
  weight = weight.replaceAll(" ", "").replaceAll("-", "").toLowerCase();
  switch (weight) {
    case "thin":
      return "100";
    case "extralight":
      return "200";
    case "light":
      return "300";
    case "regular":
      return "400";
    case "medium":
      return "500";
    case "semibold":
      return "600";
    case "bold":
      return "700";
    case "extrabold":
      return "800";
    case "heavy":
      return "800";
    case "black":
      return "900";
    default:
      return "400";
  }
};
