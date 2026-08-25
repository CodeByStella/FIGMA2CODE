/** Tidy pipeline entry: clone → AI vision → infer Auto Layout → apply → select for convert. */

import { PluginSettings } from "types";
import { postBackendMessage, postError } from "../messaging";
import { applyTidyPlan } from "./apply";
import { createTidyClone } from "./clone";
import { buildTidyPlan } from "./infer";
import { resolveTidyTarget } from "./target";
import { clearTidyWarnings, takeTidyWarnings, tidyWarn } from "./warnings";
import { buildLayerInventory } from "./ai/inventory";
import { getOpenRouterApiKey } from "./ai/key";
import { aiError, aiLog, aiWarn, formatUsd } from "./ai/log";
import { callOpenRouterVision, OpenRouterHttpError } from "./ai/openrouter";
import { OPENROUTER_MODEL } from "./ai/prompt";
import { captureRootScreenshot } from "./ai/screenshot";
import { applyAiSections } from "./ai/sections";

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
  const totalT0 = Date.now();
  let screenshotMs = 0;
  let openRouterMs = 0;
  let sectionsMs = 0;
  let inferApplyMs = 0;
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
      screenshotMs = shot.elapsedMs;

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
        openRouterMs = vision.elapsedMs;
      } catch (e) {
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as Error).message)
            : String(e || "OpenRouter failed");
        if (e instanceof OpenRouterHttpError) {
          aiError("vision HTTP failed — aborting tidy", msg);
          throw e;
        }
        aiWarn("vision parse/other failed — geometry-only tidy", msg);
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
        const sec = await applyAiSections(root, vision, imageHeightPx);
        sectionsMs = sec.elapsedMs;
      }

      postBackendMessage({
        type: "progress",
        message: "Applying Auto Layout…",
        percent: 65,
      });

      const inferT0 = Date.now();
      const plan = buildTidyPlan(root);
      await applyTidyPlan(plan, root);
      inferApplyMs = Date.now() - inferT0;
    }

    try {
      figma.commitUndo();
    } catch {
      // Undo registration is optional in some Figma host contexts.
    }

    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);

    takeTidyWarnings();

    const totalMs = Date.now() - totalT0;
    aiLog("timing summary", {
      screenshotMs,
      openRouterMs,
      sectionsMs,
      inferApplyMs,
      totalMs,
    });
    if (vision) {
      aiLog("AI run cost summary", {
        model: OPENROUTER_MODEL,
        tokens: {
          prompt: vision.usage.promptTokens,
          completion: vision.usage.completionTokens,
          total: vision.usage.totalTokens,
        },
        costUsd: {
          input: formatUsd(vision.cost.inputUsd),
          output: formatUsd(vision.cost.outputUsd),
          total: formatUsd(vision.cost.totalUsd),
        },
        pricePer1MUsd: "$0.119 / $0.238",
      });
    }

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
    aiError("tidy failed", message);

    // Drop the partial clone so the source selection is left untouched after a hard failure.
    if (root) {
      try {
        if (root.parent) root.remove();
      } catch {
        // Best-effort cleanup — clone removal can fail if the document changed.
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
