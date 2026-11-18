import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsSource } from "./scout-store";

vi.mock("server-only", () => ({}));

const sent: { text: string; keyboard?: { text: string; callback_data?: string }[][] }[] = [];
const edited: { text: string }[] = [];
const answered: (string | undefined)[] = [];
vi.mock("@/lib/editorial/telegram", () => ({
  escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  sendMessage: vi.fn(async (_chat: number, text: string, options: { keyboard?: never } = {}) => {
    sent.push({ text, ...options });
    return { message_id: 1 };
  }),
  editMessage: vi.fn(async (_chat: number, _id: number, text: string) => {
    edited.push({ text });
  }),
  answerCallback: vi.fn(async (_id: string, text?: string) => {
    answered.push(text);
  }),
}));

const startScoutJob = vi.fn<(...args: unknown[]) => Promise<{ ok: true; jobId: number } | { ok: false; reason: "done" | "running" }>>(async () => ({ ok: true, jobId: 1 }));
vi.mock("@/lib/editorial/pipeline", () => ({ startScoutJob: (...args: unknown[]) => startScoutJob(...args) }));

const sources: NewsSource[] = [
  { id: "a", number: 1, name: "Cyprus Mail", kind: "rss", url: "https://cyprus-mail.com/feed/", language: "en", priority: 1, enabled: false, approvedAt: null, checkState: "ok", checkDetail: "публикаций в ленте: 12", checkedAt: null },
  { id: "b", number: 2, name: "Minister of Health", kind: "search", url: "moh.gov.cy", language: "en", priority: 1, enabled: true, approvedAt: "2026-11-18T00:00:00Z", checkState: null, checkDetail: null, checkedAt: null },
];
const setSourceEnabled = vi.fn(async (number: number, enabled: boolean) => {
  const source = sources.find((candidate) => candidate.number === number);
  if (!source) return null;
  source.enabled = enabled;
  source.approvedAt = enabled ? "2026-11-18T10:00:00Z" : source.approvedAt;
  return source;
});
const recordSourceCheck = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
vi.mock("@/lib/editorial/scout-store", () => ({
  listSources: vi.fn(async () => sources),
  setSourceEnabled: (number: number, enabled: boolean) => setSourceEnabled(number, enabled),
  recordSourceCheck: (...args: unknown[]) => recordSourceCheck(...args),
  scoutSpentSince: vi.fn(async () => 1.234),
}));

const { handleScoutCallback, handleScoutCommand, renderSources, scoutUsageLines, sendScoutOutcome } = await import("./scout-bot");

const query = (data: string) => ({ id: "q", from: { id: 1, is_bot: false, first_name: "O" }, data, message: { message_id: 5, chat: { id: 42 } } }) as never;

beforeEach(() => {
  sent.length = 0;
  edited.length = 0;
  answered.length = 0;
  startScoutJob.mockClear();
  startScoutJob.mockImplementation(async () => ({ ok: true as const, jobId: 1 }));
  setSourceEnabled.mockClear();
  recordSourceCheck.mockClear();
  sources[0].enabled = false;
  sources[0].approvedAt = null;
  sources[1].enabled = true;
});

describe("/scout", () => {
  it("starts a real run", async () => {
    await handleScoutCommand(42, "");
    expect(startScoutJob).toHaveBeenCalledWith({ kind: "real", trigger: "manual" });
    expect(sent.at(-1)!.text).toContain("утверждённым источникам");
  });

  it("/scout test starts a test run, optionally on another model for the comparison", async () => {
    await handleScoutCommand(42, "test");
    expect(startScoutJob).toHaveBeenLastCalledWith({ kind: "test", trigger: "manual" });
    await handleScoutCommand(42, "test luna");
    expect(startScoutJob).toHaveBeenLastCalledWith({ kind: "test", trigger: "manual", model: "gpt-5.6-luna" });
    expect(sent.at(-1)!.text).toContain("gpt-5.6-luna");
  });

  it("an unknown model or word never reaches OpenAI", async () => {
    await handleScoutCommand(42, "test gpt-nonexistent");
    await handleScoutCommand(42, "now");
    expect(startScoutJob).not.toHaveBeenCalled();
    expect(sent[0].text).toContain("Неизвестная модель");
    expect(sent[1].text).toContain("/scout test");
  });

  it("says so when today's run is done or one is going on, and queues nothing", async () => {
    startScoutJob.mockResolvedValueOnce({ ok: false, reason: "done" });
    await handleScoutCommand(42, "");
    expect(sent.at(-1)!.text).toContain("уже выполнен");
    startScoutJob.mockResolvedValueOnce({ ok: false, reason: "running" });
    await handleScoutCommand(42, "");
    expect(sent.at(-1)!.text).toContain("уже выполняется");
  });
});

describe("/sources", () => {
  it("lists every source with its state; a source is off until approved", () => {
    const view = renderSources(sources);
    expect(view.text).toContain("⏸ Cyprus Mail");
    expect(view.text).toContain("✅ Minister of Health");
    expect(view.text).toContain("публикаций в ленте: 12");
    expect(view.text).toContain("доступность ещё не проверялась");
    expect(JSON.stringify(view.keyboard)).toContain("srcon:1");
    expect(JSON.stringify(view.keyboard)).toContain("srcoff:2");
    expect(JSON.stringify(view.keyboard)).toContain("srcchk");
  });

  it("the button approves or switches off a source and refreshes the list", async () => {
    await handleScoutCallback(query("srcon:1"), "srcon", "1");
    expect(setSourceEnabled).toHaveBeenCalledWith(1, true);
    expect(answered.at(-1)).toBe("Источник утверждён");
    expect(edited.at(-1)!.text).toContain("✅ Cyprus Mail");
    await handleScoutCallback(query("srcoff:1"), "srcoff", "1");
    expect(edited.at(-1)!.text).toContain("⏸ Cyprus Mail");
  });

  it("an unknown source number changes nothing", async () => {
    await handleScoutCallback(query("srcon:99"), "srcon", "99");
    expect(answered.at(-1)).toBe("Источник не найден");
    expect(edited).toHaveLength(0);
  });

  it("checks every source from the server and stores the results", async () => {
    const fetcher = async (url: string) => (url.includes("cyprus-mail") ? new Response("<rss><channel><item><title>A</title><link>https://x.example/a</link></item></channel></rss>") : new Response("no", { status: 403 }));
    await handleScoutCallback(query("srcchk"), "srcchk", "", { fetcher });
    expect(recordSourceCheck).toHaveBeenCalledWith("a", "ok", "публикаций в ленте: 1");
    expect(recordSourceCheck).toHaveBeenCalledWith("b", "search", expect.stringContaining("HTTP 403"));
    expect(edited).toHaveLength(1);
  });
});

describe("the digest", () => {
  const topic = { number: 3, title: "Новые правила ГеСИ", gist: "Министерство объявило об изменениях.", why: "Касается пациентов.", score: 4, scoreReason: "затрагивает многих", links: [{ title: "Cyprus Mail", url: "https://cyprus-mail.com/a" }], firstSeenAt: "2026-11-18T07:00:00Z" };

  it("topics: a header and one message per topic, with headline, gist, why, score, date and links", async () => {
    await sendScoutOutcome(42, { kind: "topics", test: false, topics: [topic, { ...topic, title: "Вторая тема" }], unavailable: [{ name: "Источник 2", code: "http_403" }], collected: 14, model: "m" });
    expect(sent).toHaveLength(3);
    expect(sent[0].text).toContain("Тем для статей: 2");
    expect(sent[0].text).toContain("Недоступны источники (1): Источник 2 (http_403)");
    expect(sent[1].text).toContain("<b>1. Новые правила ГеСИ</b>");
    expect(sent[1].text).toContain("<b>Почему важно:</b> Касается пациентов.");
    expect(sent[1].text).toContain("Оценка: 4/5 — затрагивает многих");
    expect(sent[1].text).toContain("Найдено: 18.11.2026");
    expect(sent[1].text).toContain('<a href="https://cyprus-mail.com/a">cyprus-mail.com</a>');
    expect(sent[2].text).toContain("<b>2. Вторая тема</b>");
  });

  it("nothing found: its own message, not an error", async () => {
    await sendScoutOutcome(42, { kind: "empty", test: false, unavailable: [], collected: 9, model: "m" });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Сегодня значимых медицинских новостей для HealthGuide не найдено");
    expect(sent[0].text).not.toContain("не выполнен");
  });

  it("not carried out: the reason, and how to repeat", async () => {
    await sendScoutOutcome(42, { kind: "failed", test: false, code: "limit_scout", reason: "исчерпан лимит $5 на этот месяц", unavailable: [] });
    expect(sent[0].text).toContain("Мониторинг не выполнен: исчерпан лимит $5 на этот месяц");
    expect(sent[0].text).toContain("/scout");
  });

  it("a test run says that nothing was saved", async () => {
    await sendScoutOutcome(42, { kind: "empty", test: true, unavailable: [], collected: 1, model: "m" });
    expect(sent[0].text).toContain("Тестовый запуск");
  });

  it("text from a feed is escaped", async () => {
    await sendScoutOutcome(42, { kind: "topics", test: false, topics: [{ ...topic, title: "<b>x</b> & <script>", gist: "<a href=evil>", links: [] }], unavailable: [], collected: 1, model: "m" });
    expect(sent[1].text).not.toContain("<script>");
    expect(sent[1].text).toContain("&lt;script&gt;");
  });

  it("/usage shows the Scout's own spending", async () => {
    expect((await scoutUsageLines())[0]).toBe("Мониторинг новостей в этом месяце: ~$1.23 из $5.00 (входит в общий лимит)");
  });
});
