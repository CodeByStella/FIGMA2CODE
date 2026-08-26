/** Tidy pipeline entry: clone → AI vision → infer Auto Layout → apply → select for convert. */

import { PluginSettings } from "types";
import { postBackendMessage, postError } from "../messaging";
import { logError } from "../shared/log";
import { applyTidyPlan } from "./apply";
import { createTidyClone } from "./clone";
import { buildTidyPlan } from "./infer";
import { resolveTidyTarget } from "./target";
import { clearTidyWarnings, takeTidyWarnings, tidyWarn } from "./warnings";
import { buildLayerInventory } from "./ai/inventory";
import { getOpenRouterApiKey } from "./ai/key";
import { callOpenRouterVision, OpenRouterHttpError } from "./ai/openrouter";
import { captureRootScreenshot } from "./ai/screenshot";
import { applyAiSections, ensurePageVerticalFlow } from "./ai/sections";

let tidying = false;

export function isTidying(): boolean {
  return tidying;
}

/** Orchestrates the full tidy pass on the plugin main thread; returns the clone root for convert. */
export async function tidySelection(): Promise<SceneNode | null> {
  if (tidying) {
    postError("Already tidying layout — wait for the current pass to finish");
    return null;
  }

  tidying = true;
  clearTidyWarnings();
  let root: SceneNode | null = null;
  let vision: Awaited<ReturnType<typeof callOpenRouterVision>> | null = null;

  try {
    const apiKey = await getOpenRouterApiKey();
    if (!apiKey) {
      postError(
        "Add your OpenRouter API key in About before using Tidy + Convert",
      );
      return null;
    }

    postBackendMessage({ type: "conversionStart" });
    postBackendMessage({
      type: "progress",
      message: "Tidying layout…",
      percent: 5,
    });

    const target = resolveTidyTarget();
    const cloned = await createTidyClone(target);
    root = cloned.root;

    const rw = "width" in root ? root.width : 0;
    const rh = "height" in root ? root.height : 0;

    // Linked instances cannot be restructured internally — skip AI and Auto Layout inference.
    if (root.type === "INSTANCE") {
      tidyWarn("Root is an instance — skipped Auto Layout inference");
    } else {
      postBackendMessage({
        type: "progress",
        message: "Capturing screenshot…",
        percent: 20,
      });
      const shot = await captureRootScreenshot(root);

      const inventory = buildLayerInventory(root);

      postBackendMessage({
        type: "progress",
        message: "Asking vision model…",
        percent: 40,
      });

      try {
        vision = await callOpenRouterVision({
          apiKey,
          dataUrl: shot.dataUrl,
          imageBytes: shot.bytes.byteLength,
          rootWidth: rw,
          rootHeight: rh,
          inventory,
        });
      } catch (e) {
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as Error).message)
            : String(e || "OpenRouter failed");
        if (e instanceof OpenRouterHttpError) {
          logError("vision HTTP failed — aborting tidy", e);
          throw e;
        }
        logError("vision parse/other failed — geometry-only tidy", e);
        tidyWarn(`AI vision skipped: ${msg}`);
        vision = null;
      }

      if (vision) {
        postBackendMessage({
          type: "progress",
          message: "Building sections…",
          percent: 55,
        });
        const imageHeightPx = rh * shot.scale;
        await applyAiSections(root, vision, imageHeightPx);
      }

      postBackendMessage({
        type: "progress",
        message: "Applying Auto Layout…",
        percent: 65,
      });

      const plan = buildTidyPlan(root);
      await applyTidyPlan(plan, root);

      // Apply can roll back nested frames; re-assert page vertical flow last.
      if (root.type === "FRAME") {
        ensurePageVerticalFlow(root as FrameNode);
      }
    }

    try {
      figma.commitUndo();
    } catch (e) {
      logError("commitUndo failed", e);
    }

    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);

    takeTidyWarnings();

    postBackendMessage({
      type: "progress",
      message: "Generating code…",
      percent: 85,
    });

    return root;
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e
        ? String((e as Error).message)
        : String(e || "Tidy failed");
    logError("tidy failed", e);

    // Drop the partial clone so the source selection is left untouched after a hard failure.
    if (root) {
      try {
        if (root.parent) root.remove();
      } catch (cleanupErr) {
        logError("failed to remove partial tidy clone", cleanupErr);
      }
    }

    postError(message);
    return null;
  } finally {
    tidying = false;
  }
}

export async function tidyAndConvert(
  _settings: PluginSettings,
): Promise<SceneNode | null> {
  return tidySelection();
}
