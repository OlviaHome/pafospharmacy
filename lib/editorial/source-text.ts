import "server-only";

import { evaluateClaims, type Claim, type FactEntry } from "./facts";
import { sourceKind } from "./prompts";

/** Limits for reading a source while checking quotes. */
export const SOURCE_LIMITS = {
  timeoutMs: 15_000,
  maxHtmlBytes: 3 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 80,
  pdfParseTimeoutMs: 15_000,
};

const USER_AGENT = "Mozilla/5.0 (compatible; HealthGuideCyprusFactCheck/1.0; +https://healthguide.cy)";

export type SourceTextResult =
  | { state: "ok"; kind: "html" | "pdf"; text: string }
  | { state: "unreachable" | "no_text" | "not_allowed"; detail: string };

/** Only public https hosts; no IP literals or local names (the model chooses these URLs). */
export function isFetchableSourceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host);
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  shy: "",
  middot: "·",
};

/** Visible text of an HTML page, without scripts, styles and tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const parse = (async () => {
    const document = await getDocumentProxy(bytes);
    if (document.numPages > SOURCE_LIMITS.maxPdfPages) throw new Error("too many pages");
    const { text } = await extractText(document, { mergePages: true });
    return text;
  })();
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("pdf parse timeout")), SOURCE_LIMITS.pdfParseTimeoutMs),
  );
  return Promise.race([parse, timeout]);
}

/**
 * Downloads a source and returns its readable text. PDFs are read only from official or trusted
 * sites, without OCR: a scanned PDF or a page rendered by JavaScript gives "no_text", which
 * leaves the fact to the editor's manual check.
 */
export async function fetchSourceText(url: string): Promise<SourceTextResult> {
  if (!isFetchableSourceUrl(url)) return { state: "not_allowed", detail: "адрес не разрешён для проверки" };
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(SOURCE_LIMITS.timeoutMs),
    });
  } catch {
    return { state: "unreachable", detail: "страница не открылась" };
  }
  if (response.url && !isFetchableSourceUrl(response.url)) {
    await response.body?.cancel().catch(() => undefined);
    return { state: "not_allowed", detail: "перенаправление на неразрешённый адрес" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { state: "unreachable", detail: `HTTP ${response.status}` };
  }

  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  const isPdf = type.includes("application/pdf") || /\.pdf($|\?)/i.test(new URL(response.url || url).pathname);
  if (isPdf) {
    if (sourceKind(url) === "other") {
      await response.body?.cancel().catch(() => undefined);
      return { state: "no_text", detail: "PDF читается только с официальных сайтов" };
    }
    const bytes = await readLimited(response, SOURCE_LIMITS.maxPdfBytes).catch(() => null);
    if (!bytes) return { state: "no_text", detail: "PDF больше 10 МБ" };
    try {
      const text = (await pdfText(bytes)).replace(/\s+/g, " ").trim();
      return text.length >= 50 ? { state: "ok", kind: "pdf", text } : { state: "no_text", detail: "в PDF нет текста (скан?)" };
    } catch {
      return { state: "no_text", detail: "PDF не удалось прочитать" };
    }
  }

  if (!type.includes("html") && !type.includes("text/plain")) {
    await response.body?.cancel().catch(() => undefined);
    return { state: "no_text", detail: `тип ${type || "неизвестен"} не читается` };
  }
  const bytes = await readLimited(response, SOURCE_LIMITS.maxHtmlBytes).catch(() => null);
  if (!bytes) return { state: "no_text", detail: "страница больше 3 МБ" };
  const raw = new TextDecoder("utf-8").decode(bytes);
  const text = type.includes("html") ? htmlToText(raw) : raw;
  return text.length >= 50 ? { state: "ok", kind: "html", text } : { state: "no_text", detail: "на странице нет текста без JavaScript" };
}

const MAX_SOURCES_PER_CHECK = 12;

/** Reads each claim's source once and evaluates the quotes. No OpenAI call. */
export async function verifyClaims(claims: Claim[], previous: FactEntry[]): Promise<FactEntry[]> {
  const urls = [...new Set(claims.map((claim) => claim.source_url).filter(Boolean))].slice(0, MAX_SOURCES_PER_CHECK);
  const texts = new Map<
    string,
    { ok: true; text: string } | { ok: false; state: "source_unavailable" | "no_text"; detail: string }
  >();
  await Promise.all(
    urls.map(async (url) => {
      const result = await fetchSourceText(url);
      texts.set(
        url,
        result.state === "ok"
          ? { ok: true, text: result.text }
          : { ok: false, state: result.state === "no_text" ? "no_text" : "source_unavailable", detail: result.detail },
      );
    }),
  );
  return evaluateClaims(claims, texts, previous);
}
