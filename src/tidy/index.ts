import { PluginSettings } from "types";
import { postBackendMessage, postError } from "../messaging";
import { applyTidyPlan } from "./apply";
import { createTidyClone } from "./clone";
import { buildTidyPlan } from "./infer";
import { resolveTidyTarget } from "./target";
import { clearTidyWarnings, takeTidyWarnings, tidyWarn } from "./warnings";

let tidying = false;

export function isTidying(): boolean {
  return tidying;
}

/**
 * Clone selection (or page) → infer Auto Layout → apply on clone → select clone.
 * Caller should then run the normal converter on the new selection.
 */
export async function tidySelection(): Promise<SceneNode | null> {
  if (tidying) {
    postError("Already tidying layout — wait for the current pass to finish");
    return null;
  }

  tidying = true;
  clearTidyWarnings();

  try {
    postBackendMessage({
      type: "conversionStart",
    });
    postBackendMessage({
      type: "progress",
      message: "Tidying layout…",
      percent: 5,
    });

    const target = resolveTidyTarget();
    const { root } = await createTidyClone(target);

    postBackendMessage({
      type: "progress",
      message: "Inferring Auto Layout…",
      percent: 35,
    });

    // INSTANCE roots: no inner tidy
    if (root.type === "INSTANCE") {
      tidyWarn("Root is an instance — skipped Auto Layout inference");
    } else {
      const plan = buildTidyPlan(root);
      postBackendMessage({
        type: "progress",
        message: "Applying Auto Layout…",
        percent: 65,
      });
      await applyTidyPlan(plan, root);
    }

    try {
      figma.commitUndo();
    } catch {
      // commitUndo may be unavailable in some hosts
    }

    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);

    const notes = takeTidyWarnings();
    if (notes.length > 0) {
      console.log("[tidy] warnings:", notes);
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
    console.error("[tidy]", e);
    postError(message);
    return null;
  } finally {
    tidying = false;
  }
}

/** @deprecated settings unused for now — reserved for Phase 2 */
export async function tidyAndConvert(
  _settings: PluginSettings,
): Promise<SceneNode | null> {
  return tidySelection();
}
