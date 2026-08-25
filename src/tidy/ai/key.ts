/** OpenRouter key in figma.clientStorage — kept out of PluginSettings so it never ships in exports. */

export const OPENROUTER_KEY_STORAGE = "openRouterApiKey";

export async function getOpenRouterApiKey(): Promise<string | null> {
  const key = await figma.clientStorage.getAsync(OPENROUTER_KEY_STORAGE);
  if (typeof key !== "string" || key.trim().length === 0) return null;
  return key.trim();
}

export async function setOpenRouterApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await figma.clientStorage.setAsync(OPENROUTER_KEY_STORAGE, "");
    return;
  }
  await figma.clientStorage.setAsync(OPENROUTER_KEY_STORAGE, trimmed);
}

export async function hasOpenRouterApiKey(): Promise<boolean> {
  return (await getOpenRouterApiKey()) !== null;
}
