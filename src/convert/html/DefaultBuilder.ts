import { formatWithJSX } from "../css/format";
import { htmlShadow } from "./shadow";
import {
  htmlVisibility,
  htmlRotation,
  htmlOpacity,
  htmlBlendMode,
} from "./blend";
import { buildBackgroundValues, htmlColorFromFills } from "./color";
import { htmlPadding } from "./padding";
import { htmlSizePartial } from "./size";
import { htmlBorderRadius } from "./borderRadius";
import {
  commonIsAbsolutePosition,
  getCommonPositionValue,
} from "../layout/position";
import { numberToFixedString, stringToClassName } from "../css/numbers";
import { commonStroke } from "../layout/stroke";
import {
  formatClassAttribute,
  formatDataAttribute,
  formatStyleAttribute,
} from "../css/attributes";
import { HTMLSettings } from "types";

export class HtmlDefaultBuilder {
  styles: Array<string>;
  data: Array<string>;
  node: SceneNode;
  settings: HTMLSettings;

  get name() {
    return this.settings.showLayerNames ? this.node.name : "";
  }

  get visible() {
    return this.node.visible;
  }

  get isJSX() {
    return false;
  }

  get htmlElement(): string {
    if (this.node.type === "TEXT") return "p";
    return "div";
  }

  constructor(node: SceneNode, settings: HTMLSettings) {
    this.node = node;
    this.settings = settings;
    this.styles = [];
    this.data = [];
  }

  commonPositionStyles(): this {
    this.size();
    this.autoLayoutPadding();
    this.position();
    this.blend();
    return this;
  }

  commonShapeStyles(): this {
    if ("fills" in this.node) {
      this.applyFillsToStyle(
        this.node.fills,
        this.node.type === "TEXT" ? "text" : "background",
      );
    }
    this.shadow();
    this.border(this.settings);
    this.blur();
    return this;
  }

  addStyles = (...newStyles: string[]) => {
    this.styles.push(...newStyles.filter((style) => style));
  };

  blend(): this {
    const { node, isJSX } = this;
    this.addStyles(
      htmlVisibility(node, isJSX),
      ...htmlRotation(node as LayoutMixin, isJSX),
      htmlOpacity(node as MinimalBlendMixin, isJSX),
      htmlBlendMode(node as MinimalBlendMixin, isJSX),
    );
    return this;
  }

  border(settings: HTMLSettings): this {
    const { node } = this;
    this.addStyles(...htmlBorderRadius(node, this.isJSX));

    const commonBorder = commonStroke(node);
    if (!commonBorder) {
      return this;
    }

    const strokes = ("strokes" in node && node.strokes) || undefined;
    const color = htmlColorFromFills(strokes as any);
    if (!color) {
      return this;
    }
    const borderStyle =
      "dashPattern" in node && node.dashPattern.length > 0 ? "dotted" : "solid";

    const strokeAlign = "strokeAlign" in node ? node.strokeAlign : "INSIDE";

    // Function to create border value string
    const consolidateBorders = (border: number): string =>
      [`${numberToFixedString(border)}px`, color, borderStyle]
        .filter((d) => d)
        .join(" ");

    if ("all" in commonBorder) {
      if (commonBorder.all === 0) {
        return this;
      }
      const weight = commonBorder.all;

      if (
        strokeAlign === "CENTER" ||
        strokeAlign === "OUTSIDE" ||
        node.type === "FRAME" ||
        node.type === "INSTANCE" ||
        node.type === "COMPONENT"
      ) {
        this.addStyles(
          formatWithJSX("outline", this.isJSX, consolidateBorders(weight)),
        );
        if (strokeAlign === "CENTER") {
          this.addStyles(
            formatWithJSX(
              "outline-offset",
              this.isJSX,
              `${numberToFixedString(-weight / 2)}px`,
            ),
          );
        } else if (strokeAlign === "INSIDE") {
          this.addStyles(
            formatWithJSX(
              "outline-offset",
              this.isJSX,
              `${numberToFixedString(-weight)}px`,
            ),
          );
        }
      } else {
        // Default: use regular border on autolayout + strokeAlign: inside
        this.addStyles(
          formatWithJSX("border", this.isJSX, consolidateBorders(weight)),
        );
      }
    } else {
      // For non-uniform borders, always use individual border properties
      if (commonBorder.left !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-left",
            this.isJSX,
            consolidateBorders(commonBorder.left),
          ),
        );
      }
      if (commonBorder.top !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-top",
            this.isJSX,
            consolidateBorders(commonBorder.top),
          ),
        );
      }
      if (commonBorder.right !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-right",
            this.isJSX,
            consolidateBorders(commonBorder.right),
          ),
        );
      }
      if (commonBorder.bottom !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-bottom",
            this.isJSX,
            consolidateBorders(commonBorder.bottom),
          ),
        );
      }
    }
    return this;
  }

  position(): this {
    const { node, isJSX } = this;
    const isAbsolutePosition = commonIsAbsolutePosition(node);
    if (isAbsolutePosition) {
      const { x, y } = getCommonPositionValue(node, this.settings);

      this.addStyles(
        formatWithJSX("left", isJSX, x),
        formatWithJSX("top", isJSX, y),
        formatWithJSX("position", isJSX, "absolute"),
      );
    } else {
      if (node.type === "GROUP" || (node as any).isRelative) {
        this.addStyles(formatWithJSX("position", isJSX, "relative"));
      }
    }

    return this;
  }

  applyFillsToStyle(
    paintArray: ReadonlyArray<Paint> | PluginAPI["mixed"],
    property: "text" | "background",
  ): this {
    if (property === "text") {
      this.addStyles(
        formatWithJSX(
          "text",
          this.isJSX,
          htmlColorFromFills(paintArray as any),
        ),
      );
      return this;
    }

    const backgroundValues = buildBackgroundValues(paintArray as any);
    if (backgroundValues) {
      this.addStyles(formatWithJSX("background", this.isJSX, backgroundValues));

      // Add blend mode property if multiple fills exist with different blend modes
      if (paintArray !== figma.mixed) {
        const blendModes = this.buildBackgroundBlendModes(paintArray);
        if (blendModes) {
          this.addStyles(
            formatWithJSX("background-blend-mode", this.isJSX, blendModes),
          );
        }
      }
    }

    return this;
  }

  buildBackgroundBlendModes(paintArray: ReadonlyArray<Paint>): string {
    if (
      paintArray.length === 0 ||
      paintArray.every(
        (d) => d.blendMode === "NORMAL" || d.blendMode === "PASS_THROUGH",
      )
    ) {
      return "";
    }

    // Reverse the array to match the background order
    const blendModes = [...paintArray].reverse().map((paint) => {
      if (paint.blendMode === "PASS_THROUGH") {
        return "normal";
      }

      return paint.blendMode?.toLowerCase();
    });

    return blendModes.join(", ");
  }

  shadow(): this {
    const { node, isJSX } = this;
    if ("effects" in node) {
      const shadow = htmlShadow(node);
      if (shadow) {
        this.addStyles(formatWithJSX("box-shadow", isJSX, htmlShadow(node)));
      }
    }
    return this;
  }

  size(): this {
    const { node } = this;
    const { width, height, constraints } = htmlSizePartial(node, false);

    if (node.type === "TEXT") {
      switch (node.textAutoResize) {
        case "WIDTH_AND_HEIGHT":
          break;
        case "HEIGHT":
          this.addStyles(width);
          break;
        case "NONE":
        case "TRUNCATE":
          this.addStyles(width, height);
          break;
      }
    } else {
      this.addStyles(width, height);
    }

    // Add constraints as separate styles
    if (constraints.length > 0) {
      this.addStyles(...constraints);
    }

    return this;
  }

  autoLayoutPadding(): this {
    const { node, isJSX } = this;
    if ("paddingLeft" in node) {
      this.addStyles(...htmlPadding(node, isJSX));
    }
    return this;
  }

  blur() {
    const { node } = this;
    if ("effects" in node && node.effects.length > 0) {
      const blur = node.effects.find(
        (e) => e.type === "LAYER_BLUR" && e.visible,
      );
      if (blur) {
        this.addStyles(
          formatWithJSX(
            "filter",
            this.isJSX,
            `blur(${numberToFixedString(blur.radius / 2)}px)`,
          ),
        );
      }

      const backgroundBlur = node.effects.find(
        (e) => e.type === "BACKGROUND_BLUR" && e.visible,
      );
      if (backgroundBlur) {
        this.addStyles(
          formatWithJSX(
            "backdrop-filter",
            this.isJSX,
            `blur(${numberToFixedString(backgroundBlur.radius / 2)}px)`,
          ),
        );
      }
    }
  }

  addData(label: string, value?: string): this {
    const attribute = formatDataAttribute(label, value);
    this.data.push(attribute);
    return this;
  }

  build(additionalStyle: Array<string> = []): string {
    this.addStyles(...additionalStyle);

    const classNames: string[] = [];
    if (this.name) {
      this.addData("layer", this.name.trim());

      const layerNameClass = stringToClassName(this.name.trim());
      if (layerNameClass !== "") {
        classNames.push(layerNameClass);
      }
    }

    if ("componentProperties" in this.node && this.node.componentProperties) {
      Object.entries(this.node.componentProperties)
        ?.map((prop) => {
          if (prop[1].type === "VARIANT" || prop[1].type === "BOOLEAN") {
            const cleanName = prop[0]
              .split("#")[0]
              .replace(/\s+/g, "-")
              .toLowerCase();

            return formatDataAttribute(cleanName, String(prop[1].value));
          }
          return "";
        })
        .filter(Boolean)
        .sort()
        .forEach((d) => this.data.push(d));
    }

    const dataAttributes = this.data.join("");
    const classAttribute = formatClassAttribute(classNames, false);
    const styleAttribute = formatStyleAttribute(this.styles, false);

    return `${dataAttributes}${classAttribute}${styleAttribute}`;
  }
}
