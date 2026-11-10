/**
 * Estimated OpenAI prices in USD per 1M tokens (standard tier), checked 2026-11-10 on
 * developers.openai.com model pages. Used only for the bot's own spending limits; the OpenAI
 * dashboard limit stays the real ceiling. Unknown models are priced at the most expensive
 * listed rate so a misconfiguration can only make the limit stricter.
 */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

const FALLBACK_PRICE: ModelPrice = { input: 10, cachedInput: 1, output: 50 };

/** Web search tool calls: $10 per 1,000 calls; their content tokens are billed as input. */
export const WEB_SEARCH_CALL_USD = 0.01;

export function modelPrice(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

export interface UsageNumbers {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
}

export function estimateCostUsd(model: string, usage: UsageNumbers): number {
  const price = modelPrice(model);
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cost =
    (uncached * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) /
      1_000_000 +
    usage.webSearchCalls * WEB_SEARCH_CALL_USD;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Conservative upfront reservation per job kind, checked against the monthly budget
 * before a job starts, so the last job of the month cannot overshoot by much.
 */
export function reservedCostUsd(model: string, kind: "write" | "edit" | "translate"): number {
  const tokens = {
    write: { inputTokens: 80_000, cachedInputTokens: 0, outputTokens: 20_000, webSearchCalls: 8 },
    edit: { inputTokens: 30_000, cachedInputTokens: 0, outputTokens: 16_000, webSearchCalls: 4 },
    translate: { inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 12_000, webSearchCalls: 0 },
  }[kind];
  return estimateCostUsd(model, tokens);
}
