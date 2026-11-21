import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsEvent, TopicEntry, TopicPost } from "./scout-store";

vi.mock("server-only", () => ({}));

/*
 * The Scout's control panel: the history of found topics (statuses come from the article's real
 * record) and the pause switch. In-memory fakes of the database whose updates are conditional,
 * like the real ones.
 */

type Keyboard = { text: string; callback_data?: string; url?: string }[][];
const sent: { text: string; keyboard?: Keyboard }[] = [];
const edited: { text: string; keyboard?: Keyboard }[] = [];
const answered: (string | undefined)[] = [];
vi.mock("@/lib/editorial/telegram", () => ({
  escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  sendMessage: vi.fn(async (_chat: number, text: string, options: { keyboard?: Keyboard } = {}) => {
    sent.push({ text, ...options });
    return { message_id: 1 };
  }),
  editMessage: vi.fn(async (_chat: number, _id: number, text: string, keyboard?: Keyboard) => {
    edited.push({ text, keyboard });
  }),
  answerCallback: vi.fn(async (_id: string, text?: string) => {
    answered.push(text);
  }),
}));

const startScoutJob = vi.fn<(...args: unknown[]) => Promise<{ ok: true; jobId: number } | { ok: false; reason: "done" | "running" | "paused" }>>(async () => ({ ok: true, jobId: 1 }));
vi.mock("@/lib/editorial/pipeline", () => ({ startScoutJob: (...args: unknown[]) => startScoutJob(...args) }));
vi.mock("@/lib/editorial/scout-sources", () => ({ checkSource: vi.fn() }));

/* ---- fake database ---- */

const events = new Map<number, NewsEvent>();
const articles = new Map<string, TopicPost>();
const settings = { paused: false, pausedAt: null as string | null, resumedAt: null as string | null };
const discardPendingItems = vi.fn(async () => undefined);

const makeEvent = (number: number, patch: Partial<NewsEvent> = {}): NewsEvent => ({
  id: `e${number}`,
  number,
  titleRu: `Тема ${number}`,
  gist: "Министерство объявило об изменениях.",
  why: "Касается пациентов.",
  score: 4,
  scoreReason: "важно",
  status: "shown",
  links: [{ title: "Cyprus Mail", url: "https://cyprus-mail.com/a" }],
  // The higher the number, the later it was found.
  firstSeenAt: new Date(Date.UTC(2026, 10, 1, 7, number)).toISOString(),
  shownAt: null,
  postId: null,
  ...patch,
});
const addArticle = (id: string, number: number, status: TopicPost["status"], slug = `article-${number}`) => articles.set(id, { id, number, slug, status });
const entryOf = (event: NewsEvent): TopicEntry => ({ event, post: (event.postId && articles.get(event.postId)) || null });

vi.mock("@/lib/editorial/scout-store", () => ({
  SKIPPED_DAYS: 30,
  TOPICS_PAGE: 10,
  listSources: vi.fn(async () => [
    { id: "a", number: 1, enabled: true },
    { id: "b", number: 2, enabled: false },
  ]),
  setSourceEnabled: vi.fn(),
  recordSourceCheck: vi.fn(),
  scoutSpentSince: vi.fn(async () => 0.5),
  lastRealRun: vi.fn(async () => ({ runDate: "2026-11-20", status: "done", errorCode: null })),
  loadScoutSettings: vi.fn(async () => ({ ...settings })),
  setScoutPaused: vi.fn(async (paused: boolean) => {
    if (settings.paused === paused) return false;
    settings.paused = paused;
    if (paused) settings.pausedAt = "2026-11-21T13:00:00Z";
    else settings.resumedAt = "2026-11-21T14:00:00Z";
    return true;
  }),
  discardPendingItems: () => discardPendingItems(),
  listTopicsPage: vi.fn(async (page: number, size: number) => {
    const all = [...events.values()].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || b.number - a.number);
    return { rows: all.slice((page - 1) * size, page * size).map(entryOf), total: all.length };
  }),
  loadTopic: vi.fn(async (number: number) => (events.has(number) ? entryOf(events.get(number)!) : null)),
  loadEvent: vi.fn(async (number: number) => events.get(number) ?? null),
  claimForWork: vi.fn(async (number: number, postId: string) => {
    const event = events.get(number);
    if (!event || !(["new", "shown", "skipped"].includes(event.status) || (event.status === "in_work" && !event.postId))) return null;
    Object.assign(event, { status: "in_work", postId });
    return event;
  }),
  skipEvent: vi.fn(async (number: number) => {
    const event = events.get(number);
    if (!event || !["new", "shown"].includes(event.status)) return null;
    event.status = "skipped";
    return event;
  }),
  restoreEvent: vi.fn(async (number: number) => {
    const event = events.get(number);
    if (!event || event.status !== "skipped") return null;
    event.status = "new";
    return event;
  }),
  listSkipped: vi.fn(async () => [...events.values()].filter((event) => event.status === "skipped")),
}));

const created: string[] = [];
vi.mock("@/lib/editorial/store", () => ({
  createPost: vi.fn(async () => {
    const id = `p${created.length + 1}`;
    created.push(id);
    addArticle(id, 100 + created.length - 1, "generating");
    return { id, number: 100 + created.length - 1 };
  }),
  createStartedImport: vi.fn(async () => "i1"),
  deletePost: vi.fn(async (id: string) => {
    articles.delete(id);
    // The foreign key: the topic loses its link when the draft is deleted.
    for (const event of events.values()) if (event.postId === id) event.postId = null;
  }),
}));

const { handleScoutCallback, handleScoutCommand, renderScoutMenu, renderTopicCard, renderTopics, scoutUsageLines } = await import("./scout-bot");
const { MAIN_MENU } = await import("./schedule-bot");
const { topicState } = await import("./scout-render");

const query = (data: string) => ({ id: "q", from: { id: 1, is_bot: false, first_name: "O" }, data, message: { message_id: 5, chat: { id: 42 } } }) as never;
const press = (data: string, deps = {}) => handleScoutCallback(query(data), data.split(":")[0], data.split(":")[1] ?? "", deps);
const startRewrite = vi.fn<(postId: string, importId: string) => Promise<string | null>>(async () => null);
const openDraft = vi.fn<(chat: number, postId: string) => Promise<void>>(async () => undefined);
const deps = { startRewrite, openDraft };
const buttons = (keyboard: Keyboard | undefined) => (keyboard ?? []).flat();
const callbacks = (keyboard: Keyboard | undefined) => buttons(keyboard).map((button) => button.callback_data ?? button.url);

beforeEach(() => {
  sent.length = 0;
  edited.length = 0;
  answered.length = 0;
  events.clear();
  articles.clear();
  created.length = 0;
  Object.assign(settings, { paused: false, pausedAt: null, resumedAt: null });
  discardPendingItems.mockClear();
  startScoutJob.mockClear();
  startScoutJob.mockResolvedValue({ ok: true, jobId: 1 });
  startRewrite.mockClear();
  openDraft.mockClear();
});

describe("🗂 Найденные темы: статус по фактической записи статьи", () => {
  it("topic found → draft created → article published: the history shows «Опубликовано» only when the article really is", async () => {
    events.set(7, makeEvent(7));
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("🆕 Не начата");

    await press("scw:7", deps); // «Написать статью»
    expect(events.get(7)).toMatchObject({ status: "in_work", postId: "p1" });
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("📝 Черновик #100");
    expect(sent.at(-1)!.text).not.toContain("Опубликовано");

    // Every state of an unpublished article stays a draft in the history.
    for (const status of ["generating", "review", "paused", "scheduled"] as const) {
      articles.set("p1", { ...articles.get("p1")!, status });
      await press("sct:1");
      expect(sent.at(-1)!.text).toContain("📝 Черновик #100");
      expect(sent.at(-1)!.text).not.toContain("Опубликовано");
    }

    articles.set("p1", { ...articles.get("p1")!, status: "published" });
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("✅ Опубликовано #100");
  });

  it("an article with an error or in the archive is never shown as published; a deleted draft makes the topic writable again", async () => {
    events.set(1, makeEvent(1, { status: "in_work", postId: "pf" }));
    addArticle("pf", 41, "failed");
    events.set(2, makeEvent(2, { status: "in_work", postId: "pa" }));
    addArticle("pa", 42, "archived");
    events.set(3, makeEvent(3, { status: "in_work", postId: "pd" }));
    addArticle("pd", 43, "review");
    await press("sct:1");
    const text = sent.at(-1)!.text;
    expect(text).toContain("⚠️ Ошибка в черновике #41");
    expect(text).toContain("🗄 Статья в архиве #42");
    expect(text).not.toContain("Опубликовано");

    const { deletePost } = await import("@/lib/editorial/store");
    await deletePost("pd");
    expect(events.get(3)!.status).toBe("in_work");
    expect(events.get(3)!.postId).toBeNull();
    await press("sct:1");
    expect(sent.at(-1)!.text).toMatch(/Тема 3\n\s+\d\d\.\d\d\.\d{4} · 🆕 Не начата/);

    await press("sctc:3:1");
    expect(callbacks(edited.at(-1)!.keyboard)).toContain("scw:3");
    await press("scw:3", deps);
    expect(events.get(3)).toMatchObject({ status: "in_work", postId: "p1" });
  });

  it("a skipped topic shows as skipped and is returned by the existing mechanism", async () => {
    events.set(5, makeEvent(5));
    await press("scs:5");
    expect(events.get(5)!.status).toBe("skipped");
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("⏭ Пропущена");
    await press("sctc:5:1");
    expect(callbacks(edited.at(-1)!.keyboard)).toContain("scr:5");
    expect(callbacks(edited.at(-1)!.keyboard)).not.toContain("scw:5");
    await press("scr:5");
    expect(events.get(5)!.status).toBe("new");
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("🆕 Не начата");
  });

  it("10 per page, newest first, with paging; a page beyond the end shows the last one", async () => {
    for (let n = 1; n <= 25; n++) events.set(n, makeEvent(n));
    await press("sct:1");
    const first = sent.at(-1)!;
    expect(first.text).toContain("Найденные темы (25)</b> · страница 1 из 3");
    expect([...first.text.matchAll(/<b>(\d+)\.<\/b>/g)].map((match) => Number(match[1]))).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    expect(callbacks(first.keyboard).filter((data) => data?.startsWith("sctc:"))).toHaveLength(10);
    expect(callbacks(first.keyboard)).toContain("sct:2:e");
    expect(callbacks(first.keyboard)).not.toContain("sct:0:e");

    await press("sct:3:e");
    const last = edited.at(-1)!;
    expect([...last.text.matchAll(/<b>(\d+)\.<\/b>/g)].map((match) => Number(match[1]))).toEqual([5, 4, 3, 2, 1]);
    expect(callbacks(last.keyboard)).toContain("sct:2:e");
    expect(callbacks(last.keyboard)).not.toContain("sct:4:e");

    await press("sct:99:e");
    expect(edited.at(-1)!.text).toContain("страница 3 из 3");
  });

  it("shows title, date and status for each topic; an empty history says so", async () => {
    await press("sct:1");
    expect(sent.at(-1)!.text).toBe("Scout пока не предлагал тем.");
    events.set(9, makeEvent(9, { titleRu: "Новые правила <ГеСИ>" }));
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("<b>9.</b> Новые правила &lt;ГеСИ&gt;");
    expect(sent.at(-1)!.text).toMatch(/01\.11\.2026 · 🆕 Не начата/);
  });

  it("the card gives description, sources and the actions of its state", () => {
    const base = makeEvent(7, { status: "in_work", postId: "p" });
    const draft = renderTopicCard({ event: base, post: { id: "p", number: 50, slug: "s", status: "review" } }, "https://healthguide.cy", 2);
    expect(draft.text).toContain("Министерство объявило об изменениях.");
    expect(draft.text).toContain("cyprus-mail.com");
    expect(draft.text).toContain("Статус:</b> 📝 Черновик #50 (👀 на проверке)");
    expect(callbacks(draft.keyboard)).toEqual(["open:50", "sco:7", "sct:2:e"]);

    const published = renderTopicCard({ event: base, post: { id: "p", number: 50, slug: "my-article", status: "published" } }, "https://healthguide.cy", 1);
    expect(callbacks(published.keyboard)).toEqual(["https://healthguide.cy/ru/blog/my-article", "open:50", "sco:7", "sct:1:e"]);

    const fresh = renderTopicCard({ event: makeEvent(8), post: null }, "https://healthguide.cy", 1);
    expect(callbacks(fresh.keyboard)).toEqual(["scw:8", "sco:8", "scs:8", "sct:1:e"]);
  });

  it("a repeated «Написать статью» from the card never creates a second draft", async () => {
    events.set(7, makeEvent(7));
    await press("sctc:7:1");
    await press("scw:7", deps);
    await press("scw:7", deps);
    await press("scw:7", deps);
    expect(created).toHaveLength(1);
    expect(startRewrite).toHaveBeenCalledTimes(1);
    expect(openDraft).toHaveBeenCalledTimes(2);
  });

  it("an unknown topic changes nothing; every new button fits Telegram's 64 bytes", async () => {
    await press("sctc:404:1");
    expect(answered.at(-1)).toBe("Тема не найдена");
    expect(edited).toHaveLength(0);
    const huge = makeEvent(2_000_000_000, { status: "in_work", postId: "p" });
    const rows: TopicEntry[] = [{ event: huge, post: { id: "p", number: 2_000_000_000, slug: "s", status: "published" } }];
    const all = [
      ...buttons(renderTopics(rows, 90_000, 9_000).keyboard),
      ...buttons(renderTopicCard(rows[0], "https://healthguide.cy", 9_000).keyboard).filter((button) => button.callback_data),
      ...buttons(renderScoutMenu({ settings, lastRun: null, enabledSources: 1, totalSources: 1, spentLine: "" }).keyboard),
    ];
    for (const button of all) expect(Buffer.byteLength(button.callback_data!)).toBeLessThanOrEqual(64);
  });

  it("topicState decides only by the article's record", () => {
    expect(topicState({ status: "in_work" }, null)).toBe("not_started");
    expect(topicState({ status: "in_work" }, { status: "published" })).toBe("published");
    expect(topicState({ status: "skipped" }, null)).toBe("skipped");
    expect(topicState({ status: "shown" }, { status: "failed" })).toBe("failed");
  });
});

describe("⏸ Приостановить Scout / ▶️ Возобновить Scout", () => {
  it("the menu shows the state and the matching button", async () => {
    await handleScoutCommand(42, "menu");
    expect(sent.at(-1)!.text).toContain("✅ <b>работает</b>");
    expect(sent.at(-1)!.text).toContain("Утверждённых источников: 1 из 2");
    expect(callbacks(sent.at(-1)!.keyboard)).toEqual(["sct:1", "scpause"]);
    expect(buttons(sent.at(-1)!.keyboard).map((button) => button.text)).toEqual(["🗂 Найденные темы", "⏸ Приостановить Scout"]);

    settings.paused = true;
    settings.pausedAt = "2026-11-21T13:00:00Z";
    await handleScoutCommand(42, "menu");
    expect(sent.at(-1)!.text).toContain("⏸ <b>приостановлен</b> с 21.11.2026 15:00");
    expect(sent.at(-1)!.text).toContain("расходов OpenAI нет");
    expect(sent.at(-1)!.text).toContain("/scout test");
    expect(buttons(sent.at(-1)!.keyboard).map((button) => button.text)).toEqual(["🗂 Найденные темы", "▶️ Возобновить Scout"]);
  });

  it("the main menu opens the Scout panel", async () => {
    expect(callbacks(MAIN_MENU)).toContain("scm");
    await press("scm");
    expect(sent.at(-1)!.text).toContain("Мониторинг новостей (Scout)");
  });

  it("pausing confirms and shows the state; the schedule is not touched and nothing is started", async () => {
    await press("scpause");
    expect(settings.paused).toBe(true);
    expect(answered.at(-1)).toBe("Мониторинг приостановлен");
    expect(edited.at(-1)!.text).toContain("Scout приостановлен");
    expect(edited.at(-1)!.text).toContain("⏸ <b>приостановлен</b>");
    expect(callbacks(edited.at(-1)!.keyboard)).toContain("scresume");
    expect(startScoutJob).not.toHaveBeenCalled();
    expect(discardPendingItems).not.toHaveBeenCalled();
  });

  it("a repeated tap changes nothing, in either direction", async () => {
    await press("scpause");
    await press("scpause");
    expect(settings.paused).toBe(true);
    expect(answered.at(-1)).toBe("Уже приостановлен");
    expect(edited.at(-1)!.text).not.toContain("Scout приостановлен");

    await press("scresume");
    await press("scresume");
    await press("scresume");
    expect(settings.paused).toBe(false);
    expect(answered.slice(-2)).toEqual(["Уже работает", "Уже работает"]);
    expect(discardPendingItems).toHaveBeenCalledTimes(1);
  });

  it("resuming starts no search, says the pause's news are not collected, and drops what was fetched before the pause", async () => {
    await press("scpause");
    await press("scresume");
    expect(settings.paused).toBe(false);
    expect(settings.resumedAt).not.toBeNull();
    expect(startScoutJob).not.toHaveBeenCalled();
    expect(discardPendingItems).toHaveBeenCalledTimes(1);
    expect(answered.at(-1)).toBe("Мониторинг возобновлён");
    const text = edited.at(-1)!.text;
    expect(text).toContain("Scout возобновлён");
    expect(text).toContain("Поиск сейчас не запускается");
    expect(text).toContain("ближайшему срабатыванию расписания (09:00 или резервное 11:00 по Кипру)");
    expect(text).toContain("не собираются");
    expect(callbacks(edited.at(-1)!.keyboard)).toContain("scpause");
  });

  it("the pause does not hide anything: topics and the card stay available", async () => {
    events.set(7, makeEvent(7));
    await press("scpause");
    await press("sct:1");
    expect(sent.at(-1)!.text).toContain("Тема 7");
    await press("sctc:7:1");
    expect(callbacks(edited.at(-1)!.keyboard)).toContain("scw:7");
  });

  it("a manual /scout while paused starts nothing and points to resume and to the paid test; /scout test stays available and says it is paid", async () => {
    startScoutJob.mockResolvedValueOnce({ ok: false, reason: "paused" });
    await handleScoutCommand(42, "");
    expect(startScoutJob).toHaveBeenCalledWith({ kind: "real", trigger: "manual" });
    expect(sent.at(-1)!.text).toContain("приостановлен");
    expect(sent.at(-1)!.text).toContain("/scout menu");
    expect(sent.at(-1)!.text).toContain("/scout test");

    await handleScoutCommand(42, "test");
    expect(startScoutJob).toHaveBeenLastCalledWith({ kind: "test", trigger: "manual" });
    expect(sent.at(-1)!.text).toContain("платный запуск");
  });

  it("the help of /scout names the menu; the /usage line is unchanged", async () => {
    await handleScoutCommand(42, "now");
    expect(sent.at(-1)!.text).toContain("/scout menu");
    expect((await scoutUsageLines())[0]).toContain("Мониторинг новостей в этом месяце");
  });
});
