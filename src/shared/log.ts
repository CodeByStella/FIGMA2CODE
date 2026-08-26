/** Console errors for catch blocks — prefix `[figma2code]` in Plugins → Development → Open Console. */

const PREFIX = "[figma2code]";

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as Error).message);
  }
  return String(error ?? "");
}

/** Figma throws these when a node was already removed or never loaded. */
export function isMissingNodeError(error: unknown): boolean {
  return /does not exist/i.test(errorMessage(error));
}

/** Empty/invisible export failures are expected during convert. */
export function isExpectedExportError(error: unknown): boolean {
  const msg = errorMessage(error);
  return /no visible layers/i.test(msg) || /Failed to export node/i.test(msg);
}

export function logError(context: string, error?: unknown): void {
  if (
    error !== undefined &&
    (isMissingNodeError(error) || isExpectedExportError(error))
  ) {
    return;
  }
  if (error === undefined) {
    console.error(`${PREFIX} ${context}`);
    return;
  }
  console.error(`${PREFIX} ${context}`, error);
}

/** Format a node id for logs without touching `.name` — removed nodes throw in get_name. */
export function safeNodeRef(node: unknown): string {
  if (!node || typeof node !== "object") return "unknown-node";
  try {
    const id = (node as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  } catch {
    /* Node was already removed from the document */
  }
  return "removed-node";
}
