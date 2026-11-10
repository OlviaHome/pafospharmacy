import "server-only";

import { openAiKey } from "./config";
import { estimateCostUsd, type UsageNumbers } from "./pricing";

export interface ResponsesCallOptions {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Enables the hosted web_search tool with this many calls at most. 0 disables search. */
  maxSearches: number;
  maxOutputTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  timeoutMs: number;
}

export interface ResponsesCallResult<T> {
  data: T;
  usage: UsageNumbers;
  costUsd: number;
  /** URLs the model actually cited or opened through web search. */
  citedUrls: string[];
}

export class OpenAiError extends Error {
  constructor(
    message: string,
    readonly usage?: UsageNumbers,
  ) {
    super(message);
  }
}

interface ResponsesOutputItem {
  type: string;
  status?: string;
  action?: { sources?: { url?: string }[]; url?: string };
  content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[];
}

interface ResponsesBody {
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

function readUsage(body: ResponsesBody): UsageNumbers {
  const output = body.output ?? [];
  return {
    inputTokens: body.usage?.input_tokens ?? 0,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    webSearchCalls: output.filter((item) => item.type === "web_search_call").length,
  };
}

function readCitedUrls(body: ResponsesBody): string[] {
  const urls = new Set<string>();
  for (const item of body.output ?? []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources ?? []) if (source.url) urls.add(source.url);
      if (item.action?.url) urls.add(item.action.url);
    }
    for (const part of item.content ?? []) {
      for (const note of part.annotations ?? []) if (note.type === "url_citation" && note.url) urls.add(note.url);
    }
  }
  return [...urls];
}

function readText(body: ResponsesBody): string {
  return (body.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

/** One Responses API call with strict JSON output. Usage is reported even when parsing fails. */
export async function callResponses<T>(options: ResponsesCallOptions): Promise<ResponsesCallResult<T>> {
  const body: Record<string, unknown> = {
    model: options.model,
    instructions: options.instructions,
    input: options.input,
    max_output_tokens: options.maxOutputTokens,
    reasoning: { effort: options.reasoningEffort },
    store: false,
    text: {
      format: { type: "json_schema", name: options.schemaName, schema: options.schema, strict: true },
    },
  };
  if (options.maxSearches > 0) {
    body.tools = [{ type: "web_search" }];
    body.max_tool_calls = options.maxSearches;
    body.include = ["web_search_call.action.sources"];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const json = (await response.json().catch(() => ({}))) as ResponsesBody;
  const usage = readUsage(json);

  if (!response.ok) {
    throw new OpenAiError(`OpenAI ${response.status}: ${json.error?.message ?? "request failed"}`, usage);
  }
  if (json.status && json.status !== "completed") {
    throw new OpenAiError(
      `OpenAI response ${json.status}${json.incomplete_details?.reason ? ` (${json.incomplete_details.reason})` : ""}`,
      usage,
    );
  }
  const text = readText(json);
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new OpenAiError("OpenAI returned text that is not valid JSON", usage);
  }
  return { data, usage, costUsd: estimateCostUsd(options.model, usage), citedUrls: readCitedUrls(json) };
}
