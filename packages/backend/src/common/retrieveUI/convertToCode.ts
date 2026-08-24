import { PluginSettings } from "types";
import { htmlMain } from "../../html/htmlMain";
import { lockedHtmlSettings } from "../lockedHtmlSettings";

export const convertToCode = async (
  nodes: SceneNode[],
  settings: PluginSettings,
) => {
  return (await htmlMain(nodes, lockedHtmlSettings(settings))).html;
};
