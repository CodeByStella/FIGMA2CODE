/** OpenRouter vision call from the plugin main thread (fetch + JSON parse + cost logging). */

import type { LayerInventoryItem } from "./inventory";
import { aiError, aiLog, aiLogBlock, aiWarn, formatUsd, maskKey } from "./log";
import {
  MODEL_PRICE_INPUT_PER_1M_USD,
  MODEL_PRICE_OUTPUT_PER_1M_USD,
  OPENROUTER_MODEL,
  OPENROUTER_URL,
  buildVisionSystemPrompt,
  buildVisionUserPrompt,
} from "./prompt";

export class OpenRouterHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "OpenRouterHttpError";
  }
}

export class OpenRouterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterParseError";
  }
}
export type AiSectionSpec = {
  name: string;
  yStart: number;
  yEnd: number;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  raw: Record<string, unknown>;
};

export type TokenCost = {
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
  priceInputPer1M: number;
  priceOutputPer1M: number;
};

export type AiVisionResult = {
  splitLinesY: number[];
  sections: AiSectionSpec[];
  renames: Record<string, string>;
  rawContent: string;
  elapsedMs: number;
  httpStatus: number;
  usage: TokenUsage;
  cost: TokenCost;
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

function normalizeResult(
  raw: unknown,
): Omit<
  AiVisionResult,
  "rawContent" | "elapsedMs" | "httpStatus" | "usage" | "cost"
> {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const splitLinesY = Array.isArray(obj.splitLinesY)
    ? obj.splitLinesY.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];
  const sections: AiSectionSpec[] = Array.isArray(obj.sections)
    ? obj.sections
        .map((s) => {
          const sec = s as Record<string, unknown>;
          return {
            name: String(sec.name || "Section"),
            yStart: Number(sec.yStart),
            yEnd: Number(sec.yEnd),
          };
        })
        .filter((s) => Number.isFinite(s.yStart) && Number.isFinite(s.yEnd))
    : [];
  const renames: Record<string, string> = {};
  if (obj.renames && typeof obj.renames === "object") {
    for (const [id, name] of Object.entries(
      obj.renames as Record<string, unknown>,
    )) {
      if (typeof name === "string" && name.trim()) {
        renames[id] = name.trim();
      }
    }
  }
  return { splitLinesY, sections, renames };
}

function extractUsage(envelope: unknown): TokenUsage {
  const raw =
    envelope &&
    typeof envelope === "object" &&
    (envelope as { usage?: unknown }).usage &&
    typeof (envelope as { usage: unknown }).usage === "object"
      ? ({
          ...(envelope as { usage: Record<string, unknown> }).usage,
        } as Record<string, unknown>)
      : {};

  const promptTokens =
    Number(
      raw.prompt_tokens ??
        raw.input_tokens ??
        raw.promptTokens ??
        raw.native_tokens_prompt ??
        0,
    ) || 0;
  const completionTokens =
    Number(
      raw.completion_tokens ??
        raw.output_tokens ??
        raw.completionTokens ??
        raw.native_tokens_completion ??
        0,
    ) || 0;
  const totalTokens =
    Number(raw.total_tokens ?? raw.totalTokens ?? 0) ||
    promptTokens + completionTokens;

  return { promptTokens, completionTokens, totalTokens, raw };
}

function estimateCost(
  promptTokens: number,
  completionTokens: number,
): TokenCost {
  const inputUsd = (promptTokens / 1_000_000) * MODEL_PRICE_INPUT_PER_1M_USD;
  const outputUsd =
    (completionTokens / 1_000_000) * MODEL_PRICE_OUTPUT_PER_1M_USD;
  return {
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    priceInputPer1M: MODEL_PRICE_INPUT_PER_1M_USD,
    priceOutputPer1M: MODEL_PRICE_OUTPUT_PER_1M_USD,
  };
}

function summarizeDataUrl(dataUrl: string): {
  mime: string;
  base64Chars: number;
  preview: string;
} {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    return {
      mime: "unknown",
      base64Chars: dataUrl.length,
      preview: `${dataUrl.slice(0, 48)}…`,
    };
  }
  return {
    mime: match[1],
    base64Chars: match[2].length,
    preview: `data:${match[1]};base64,${match[2].slice(0, 24)}…`,
  };
}

export async function callOpenRouterVision(args: {
  apiKey: string;
  dataUrl: string;
  imageBytes: number;
  rootWidth: number;
  rootHeight: number;
  inventory: LayerInventoryItem[];
}): Promise<AiVisionResult> {
  const { apiKey, dataUrl, imageBytes, rootWidth, rootHeight, inventory } =
    args;

  const system = buildVisionSystemPrompt();
  const userText = buildVisionUserPrompt({
    rootWidth,
    rootHeight,
    inventory,
  });
  const imageMeta = summarizeDataUrl(dataUrl);

  aiLog("openrouter request meta", {
    model: OPENROUTER_MODEL,
    pricingPer1MUsd: {
      input: MODEL_PRICE_INPUT_PER_1M_USD,
      output: MODEL_PRICE_OUTPUT_PER_1M_USD,
      note: "$0.119 / $0.238 per 1M tokens",
    },
    inventoryCount: inventory.length,
    imageBytes,
    image: imageMeta,
    promptChars: {
      system: system.length,
      user: userText.length,
      total: system.length + userText.length,
    },
    key: maskKey(apiKey),
  });
  aiLogBlock("openrouter input · system prompt", system);
  aiLogBlock("openrouter input · user prompt", userText);

  const t0 = Date.now();
  let httpStatus = 0;
  let bodyText = "";

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/CodeByStella/FIGMA2CODE",
        "X-Title": "Figma to Code Tidy",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
      }),
    });

    httpStatus = res.status;
    bodyText = await res.text();
    const elapsedMs = Date.now() - t0;

    if (!res.ok) {
      const snippet = bodyText.slice(0, 500);
      aiError("openrouter HTTP error", { httpStatus, snippet, elapsedMs });
      throw new OpenRouterHttpError(
        httpStatus,
        `OpenRouter ${httpStatus}: ${snippet || res.statusText}`,
      );
    }

    let parsedOuter: any;
    try {
      parsedOuter = JSON.parse(bodyText);
    } catch {
      aiError("openrouter non-JSON envelope", {
        httpStatus,
        snippet: bodyText.slice(0, 500),
      });
      throw new Error("OpenRouter returned non-JSON envelope");
    }

    const usage = extractUsage(parsedOuter);
    const cost = estimateCost(usage.promptTokens, usage.completionTokens);

    const content =
      parsedOuter?.choices?.[0]?.message?.content ??
      parsedOuter?.choices?.[0]?.message?.reasoning ??
      "";
    const contentStr =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
              .join("")
          : JSON.stringify(content);

    aiLog("openrouter usage & cost", {
      model: OPENROUTER_MODEL,
      httpStatus,
      elapsedMs,
      tokens: {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens,
      },
      pricePer1MUsd: {
        input: MODEL_PRICE_INPUT_PER_1M_USD,
        output: MODEL_PRICE_OUTPUT_PER_1M_USD,
      },
      costUsd: {
        input: formatUsd(cost.inputUsd),
        output: formatUsd(cost.outputUsd),
        total: formatUsd(cost.totalUsd),
        inputRaw: cost.inputUsd,
        outputRaw: cost.outputUsd,
        totalRaw: cost.totalUsd,
      },
      usageRaw: usage.raw,
    });
    aiLogBlock("openrouter output · model content", contentStr);

    let normalized;
    try {
      const json = extractJsonObject(contentStr);
      normalized = normalizeResult(json);
    } catch (e) {
      aiWarn("invalid model JSON — will skip AI sections", e);
      throw new OpenRouterParseError(
        e && typeof e === "object" && "message" in e
          ? String((e as Error).message)
          : "Model response is not valid JSON",
      );
    }

    aiLogBlock("openrouter output · parsed JSON", {
      splitLinesY: normalized.splitLinesY,
      sections: normalized.sections,
      renames: normalized.renames,
    });

    return {
      ...normalized,
      rawContent: contentStr,
      elapsedMs,
      httpStatus,
      usage,
      cost,
    };
  } catch (e) {
    if (httpStatus && !String(e).includes("OpenRouter")) {
      aiError("openrouter fetch failed", e);
    }
    throw e;
  }
}
