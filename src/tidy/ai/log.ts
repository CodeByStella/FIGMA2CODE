/** Console logging for the AI vision stage — prefix `[tidy:ai]` in Plugins → Development → Open Console. */

const PREFIX = "[tidy:ai]";

export function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatArgs(label: string, data?: unknown): unknown[] {
  if (data === undefined) return [`${PREFIX} ${label}`];
  if (typeof data === "string") {
    return [`${PREFIX} ${label}\n${prettyJson(data)}`];
  }
  return [`${PREFIX} ${label}`, data];
}

export const aiLog = (label: string, data?: unknown) => {
  console.log(...formatArgs(label, data));
};

export const aiWarn = (label: string, data?: unknown) => {
  console.warn(...formatArgs(label, data));
};

export const aiError = (label: string, data?: unknown) => {
  console.error(...formatArgs(label, data));
};

/** Pretty-print prompts and model JSON in the Figma plugin console. */
export const aiLogBlock = (label: string, body: unknown) => {
  console.log(`${PREFIX} ${label}\n${prettyJson(body)}`);
};

/** Mask API key tail in logs — never log the full secret on the main thread. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return "****";
  return `${k.slice(0, 6)}****${k.slice(-4)}`;
}

/** Token costs are sub-cent — keep enough precision for dev console summaries. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.000000";
  if (amount < 0.000001) return `$${amount.toExponential(2)}`;
  return `$${amount.toFixed(6)}`;
}
