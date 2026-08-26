/** AI tidy cost logging — prefix `[tidy:ai]` in Plugins → Development → Open Console. */

const PREFIX = "[tidy:ai]";

/** Token costs are sub-cent — keep enough precision for dev console summaries. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.000000";
  if (amount < 0.000001) return `$${amount.toExponential(2)}`;
  return `$${amount.toFixed(6)}`;
}

export function aiLogCost(data: {
  model: string;
  tokens: { prompt: number; completion: number; total: number };
  costUsd: { input: number; output: number; total: number };
}): void {
  console.log(`${PREFIX} cost`, {
    model: data.model,
    tokens: data.tokens,
    costUsd: {
      input: formatUsd(data.costUsd.input),
      output: formatUsd(data.costUsd.output),
      total: formatUsd(data.costUsd.total),
    },
  });
}
