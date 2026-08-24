import { indentString } from "../css/indent";
import { HtmlTextBuilder } from "./TextBuilder";
import { HtmlDefaultBuilder } from "./DefaultBuilder";
import { htmlAutoLayoutProps } from "./autoLayout";
import { formatWithJSX } from "../css/format";
import {
  PluginSettings,
  HTMLPreview,
  PluginAltNode,
  HTMLSettings,
  ExportableNode,
} from "types";
import { renderAndAttachSVG } from "../nodes/svg";
import { getVisibleNodes } from "../layout/visibility";
import {
  exportNodeAsBase64PNG,
  getPlaceholderImage,
  nodeHasImageFill,
} from "../media/images";
import { addWarning } from "../warnings";
import { getCachedAsset } from "../../export/cache";
import { framedImageTransformCss } from "../../export/flags";

const selfClosingTags = ["img"];

export let isPreviewGlobal = false;

let previousExecutionCache: { style: string; text: string }[] = [];

export interface HtmlOutput {
  html: string;
  css?: string;
}

export const htmlMain = async (
  sceneNode: Array<SceneNode>,
  settings: PluginSettings,
  isPreview: boolean = false,
): Promise<HtmlOutput> => {
  isPreviewGlobal = isPreview;
  previousExecutionCache = [];

  let htmlContent = await htmlWidgetGenerator(sceneNode, settings);

  // remove the initial \n that is made in Container.
  if (htmlContent.length > 0 && htmlContent.startsWith("\n")) {
    htmlContent = htmlContent.slice(1, htmlContent.length);
  }

  return { html: htmlContent };
};

export const generateHTMLPreview = async (
  nodes: SceneNode[],
  settings: PluginSettings,
): Promise<HTMLPreview> => {
  let result = await htmlMain(nodes, settings, nodes.length > 1 ? false : true);

  if (nodes.length > 1) {
    result.html = `<div style="width: 100%; height: 100%">${result.html}</div>`;
  }

  return {
    size: {
      width: Math.max(...nodes.map((node) => node.width)),
      height: nodes.reduce((sum, node) => sum + node.height, 0),
    },
    content: result.html,
  };
};

const htmlWidgetGenerator = async (
  sceneNode: ReadonlyArray<SceneNode>,
  settings: HTMLSettings,
): Promise<string> => {
  // filter non visible nodes. This is necessary at this step because conversion already happened.
  const promiseOfConvertedCode = getVisibleNodes(sceneNode).map(
    convertNode(settings),
  );
  const code = (await Promise.all(promiseOfConvertedCode)).join("");
  return code;
};

const convertNode = (settings: HTMLSettings) => async (node: SceneNode) => {
  // Prefer SVG from ZIP asset cache (vectors, icon instances, gradient text)
  const cachedSvg = node.id ? getCachedAsset(node.id) : undefined;
  if (
    settings.embedVectors &&
    cachedSvg?.format === "SVG" &&
    ((node as any).canBeFlattened ||
      node.type === "VECTOR" ||
      node.type === "BOOLEAN_OPERATION" ||
      node.type === "STAR" ||
      node.type === "LINE" ||
      node.type === "POLYGON" ||
      node.type === "REGULAR_POLYGON" ||
      node.type === "INSTANCE" ||
      node.type === "COMPONENT" ||
      node.type === "TEXT")
  ) {
    (node as any).canBeFlattened = true;
    // ZIP static HTML: reference assets/*.svg instead of inlining
    if (settings.relativeAssetPaths && cachedSvg.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    const altNode = await renderAndAttachSVG(node);
    if (altNode.svg) {
      return htmlWrapSVG(altNode, settings);
    }
  }

  if (settings.embedVectors && (node as any).canBeFlattened) {
    if (settings.relativeAssetPaths && cachedSvg?.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    const altNode = await renderAndAttachSVG(node);
    if (altNode.svg) {
      return htmlWrapSVG(altNode, settings);
    }
  }

  switch ((node as any).type) {
    case "RECTANGLE":
    case "ELLIPSE":
      return await htmlContainer(node, "", [], settings);
    case "GROUP":
      return await htmlGroup(node, settings);
    case "FRAME":
    case "COMPONENT":
    case "INSTANCE":
    case "COMPONENT_SET":
    case "SLOT":
      return await htmlFrame(node, settings);
    case "SECTION":
      return await htmlSection(node, settings);
    case "TEXT":
      return htmlText(node, settings);
    case "LINE":
      return htmlLine(node, settings);
    case "VECTOR":
    case "STAR":
    case "POLYGON":
    case "REGULAR_POLYGON":
    case "BOOLEAN_OPERATION":
      if (!settings.embedVectors && !isPreviewGlobal) {
        addWarning(`${node.type} is not supported without Embed Vectors`);
      }
      return await htmlContainer(
        { ...node, type: "RECTANGLE" } as any,
        "",
        [],
        settings,
      );
    default:
      addWarning(`${node.type} node is not supported`);
      return "";
  }
};

const htmlWrapSVG = (
  node: PluginAltNode<SceneNode>,
  settings: HTMLSettings,
): string => {
  if (node.svg === "") return "";

  const builder = new HtmlDefaultBuilder(node, settings)
    .addData("svg-wrapper")
    .position();

  // The SVG content already has the var() references, so we don't need
  // to add inline CSS variables in most cases. The browser will use the fallbacks
  // if the variables aren't defined in the CSS.

  return `\n<div${builder.build()}>\n${indentString(node.svg ?? "")}</div>`;
};

/** Reference a baked SVG file from the ZIP assets folder (static index.html). */
const htmlWrapSVGFile = (
  node: SceneNode,
  settings: HTMLSettings,
  assetPath: string,
): string => {
  const builder = new HtmlDefaultBuilder(node, settings)
    .addData("svg-wrapper")
    .commonPositionStyles();

  const tx = framedImageTransformCss(node);
  const extra: string[] = [];
  if (tx) {
    extra.push(formatWithJSX("transform", false, tx));
  }
  extra.push(formatWithJSX("display", false, "block"));

  return `\n<img${builder.build(extra)} src="${assetPath}" alt="" />`;
};

const htmlGroup = async (
  node: GroupNode,
  settings: HTMLSettings,
): Promise<string> => {
  // ignore the view when size is zero or less
  // while technically it shouldn't get less than 0, due to rounding errors,
  // it can get to values like: -0.000004196293048153166
  // also ignore if there are no children inside, which makes no sense
  if (node.width < 0 || node.height <= 0 || node.children.length === 0) {
    return "";
  }

  // this needs to be called after CustomNode because widthHeight depends on it
  const builder = new HtmlDefaultBuilder(node, settings).commonPositionStyles();

  if (builder.styles) {
    const attr = builder.build();
    const generator = await htmlWidgetGenerator(node.children, settings);
    return `\n<div${attr}>${indentString(generator)}\n</div>`;
  }
  return await htmlWidgetGenerator(node.children, settings);
};

const htmlText = (node: TextNode, settings: HTMLSettings): string => {
  const layoutBuilder = new HtmlTextBuilder(node, settings)
    .commonPositionStyles()
    .textTrim()
    .textAlignHorizontal()
    .textAlignVertical();

  const styledHtml = layoutBuilder.getTextSegments(node);
  previousExecutionCache.push(...styledHtml);

  let content = "";
  if (styledHtml.length === 1) {
    layoutBuilder.addStyles(styledHtml[0].style);
    content = styledHtml[0].text;

    const additionalTag =
      styledHtml[0].openTypeFeatures.SUBS === true
        ? "sub"
        : styledHtml[0].openTypeFeatures.SUPS === true
          ? "sup"
          : "";

    if (additionalTag) {
      content = `<${additionalTag}>${content}</${additionalTag}>`;
    }
  } else {
    content = styledHtml
      .map((style) => {
        const tag =
          style.openTypeFeatures.SUBS === true
            ? "sub"
            : style.openTypeFeatures.SUPS === true
              ? "sup"
              : "span";

        return `<${tag} style="${style.style}">${style.text}</${tag}>`;
      })
      .join("");
  }

  return `\n<div${layoutBuilder.build()}>${content}</div>`;
};

const htmlFrame = async (
  node: SceneNode & BaseFrameMixin,
  settings: HTMLSettings,
): Promise<string> => {
  const childrenStr = await htmlWidgetGenerator(node.children, settings);

  if (node.layoutMode !== "NONE") {
    const rowColumn = htmlAutoLayoutProps(node);
    return await htmlContainer(node, childrenStr, rowColumn, settings);
  }

  // node.layoutMode === "NONE" && node.children.length > 1
  // children needs to be absolute
  return await htmlContainer(node, childrenStr, [], settings);
};

// properties named propSomething always take care of ","
// sometimes a property might not exist, so it doesn't add ","
const htmlContainer = async (
  node: SceneNode &
    SceneNodeMixin &
    BlendMixin &
    LayoutMixin &
    GeometryMixin &
    MinimalBlendMixin,
  children: string,
  additionalStyles: string[] = [],
  settings: HTMLSettings,
): Promise<string> => {
  // ignore the view when size is zero or less
  if (node.width <= 0 || node.height <= 0) {
    return children;
  }

  const builder = new HtmlDefaultBuilder(node, settings)
    .commonPositionStyles()
    .commonShapeStyles();

  if (builder.styles || additionalStyles) {
    let tag = "div";
    let src = "";

    if (nodeHasImageFill(node)) {
      const altNode = node as PluginAltNode<ExportableNode>;
      const hasChildren = "children" in node && node.children.length > 0;
      let imgUrl = "";

      if (settings.embedImages) {
        imgUrl =
          (await exportNodeAsBase64PNG(altNode, hasChildren, {
            relativeAssetPaths: settings.relativeAssetPaths,
          })) ?? "";
      } else {
        imgUrl = getPlaceholderImage(node.width, node.height);
      }

      if (hasChildren) {
        builder.addStyles(
          formatWithJSX("background-image", false, `url(${imgUrl})`),
        );
      } else {
        tag = "img";
        src = ` src="${imgUrl}"`;
        if (
          (node as any).imageAssetFramed ||
          getCachedAsset(node.id)?.imageAssetFramed
        ) {
          const tx = framedImageTransformCss(node);
          if (tx) {
            builder.addStyles(formatWithJSX("transform", false, tx));
          }
        }
      }
    }

    const build = builder.build(additionalStyles);

    if (children) {
      return `\n<${tag}${build}${src}>${indentString(children)}\n</${tag}>`;
    } else if (selfClosingTags.includes(tag)) {
      return `\n<${tag}${build}${src} />`;
    } else {
      return `\n<${tag}${build}${src}></${tag}>`;
    }
  }

  return children;
};

const htmlSection = async (
  node: SectionNode,
  settings: HTMLSettings,
): Promise<string> => {
  const childrenStr = await htmlWidgetGenerator(node.children, settings);
  const builder = new HtmlDefaultBuilder(node, settings)
    .size()
    .position()
    .applyFillsToStyle(node.fills, "background");

  if (childrenStr) {
    return `\n<div${builder.build()}>${indentString(childrenStr)}\n</div>`;
  } else {
    return `\n<div${builder.build()}></div>`;
  }
};

const htmlLine = (node: LineNode, settings: HTMLSettings): string => {
  const builder = new HtmlDefaultBuilder(node, settings)
    .commonPositionStyles()
    .commonShapeStyles();

  return `\n<div${builder.build()}></div>`;
};

export const htmlCodeGenTextStyles = (_settings?: HTMLSettings) => {
  const result = previousExecutionCache
    .map((style) => `// ${style.text}\n${style.style.split(";").join(";\n")}`)
    .join("\n---\n");

  if (!result) {
    return "// No text styles in this selection";
  }
  return result;
};
