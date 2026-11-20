import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factId, type FactEntry } from "./facts";
import { slotInstant, localSlotOf } from "./schedule";
import type { ScheduleEntry, ScheduleMode, ScheduleStatus } from "./schedule-store";
import type { EditorialPost, MessagePurpose } from "./store";

/*
 * The editorial calendar end to end: card buttons, the queue, settings, the published history and
 * the scheduler's run, through the real bot and the real scheduling code. Supabase, Telegram and
 * OpenAI are in-memory fakes that keep the database rules that matter here (one article per slot,
 * one active entry per article, conditional updates); nothing talks to a network or a database,
 * and no real message is ever sent.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/blog/repository", () => ({ BLOG_CACHE_TAG: "blog" }));

const sent: { chatId: number; text: string; keyboard?: unknown; forceReply?: boolean }[] = [];
const edited: { messageId: number; text: string; keyboard?: unknown }[] = [];
const answered: { id: string; text?: string }[] = [];
/** Every sent and edited message, in order. */
const log: { text: string; keyboard?: unknown }[] = [];
let nextMessageId = 1000;
let telegramDown = false;

vi.mock("@/lib/editorial/telegram", () => ({
  escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  sendMessage: vi.fn(async (chatId: number, text: string, options: { keyboard?: unknown; forceReply?: boolean } = {}) => {
    if (telegramDown) throw new Error("Telegram sendMessage: Bad Gateway");
    sent.push({ chatId, text, ...options });
    log.push({ text, keyboard: options.keyboard });
    return { message_id: nextMessageId++ };
  }),
  editMessage: vi.fn(async (_chatId: number, messageId: number, text: string, keyboard?: unknown) => {
    edited.push({ messageId, text, keyboard });
    log.push({ text, keyboard });
  }),
  answerCallback: vi.fn(async (id: string, text?: string) => {
    answered.push({ id, text });
  }),
  sendTyping: vi.fn(async () => undefined),
  sendDocument: vi.fn(async () => ({ message_id: nextMessageId++ })),
  downloadFile: vi.fn(async () => ({ bytes: new Uint8Array(), path: "file.txt" })),
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const startJob = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, jobId: 1 }));
vi.mock("@/lib/editorial/pipeline", () => ({
  startJob: (...args: unknown[]) => startJob(...args),
  setNotifier: vi.fn(),
  nextStockImage: vi.fn(async () => true),
  refreshSourceChecks: vi.fn(async () => []),
}));
vi.mock("@/lib/editorial/source-text", () => ({
  verifyClaims: vi.fn(async (_claims: unknown, previous: FactEntry[]) => previous),
  fetchSourceText: vi.fn(async () => ({ state: "ok", kind: "html", text: "" })),
}));
vi.mock("@/lib/editorial/images", () => ({
  removeStoredImage: vi.fn(async () => undefined),
  storeImageBytes: vi.fn(async () => ({ url: "https://x/y.jpg", width: 1, height: 1, storagePath: "p" })),
}));

/* ---------- in-memory posts ---------- */

const posts = new Map<string, EditorialPost>();
const messages = new Map<string, { postId: string | null; purpose: MessagePurpose; slot: string | null; payload: string | null }>();
let nextNumber = 1;
let failNextTranslationUpdate = false;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const clone = <T,>(value: T): T => structuredClone(value);

vi.mock("@/lib/editorial/store", () => ({
  loadPost: vi.fn(async (ref: { id: string } | { number: number }) => {
    await tick();
    const post = "id" in ref ? posts.get(ref.id) : [...posts.values()].find((p) => p.number === ref.number);
    return post ? clone(post) : null;
  }),
  updatePost: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    await tick();
    const post = posts.get(id);
    if (!post) return;
    if (patch.status) post.status = patch.status as EditorialPost["status"];
    if ("last_error" in patch) post.lastError = patch.last_error as string | null;
    if ("fact_checks" in patch) post.factChecks = patch.fact_checks as FactEntry[];
    if ("source_checks" in patch) post.sourceChecks = patch.source_checks as EditorialPost["sourceChecks"];
  }),
  transitionPost: vi.fn(async (id: string, from: string[], patch: Record<string, unknown>) => {
    await tick();
    const post = posts.get(id);
    if (!post || !from.includes(post.status)) return false;
    if (patch.status) post.status = patch.status as EditorialPost["status"];
    if ("last_error" in patch) post.lastError = patch.last_error as string | null;
    if ("published_at" in patch) post.publishedAt = patch.published_at as string | null;
    return true;
  }),
  setTranslationStatus: vi.fn(async (postId: string, locales: string[], status: string) => {
    if (failNextTranslationUpdate) {
      failNextTranslationUpdate = false;
      throw new Error("publish translations: connection reset");
    }
    await tick();
    for (const t of posts.get(postId)?.translations ?? []) if (locales.includes(t.locale)) t.status = status as never;
  }),
  findMessage: vi.fn(async (chatId: number, messageId: number) => {
    await tick();
    const found = messages.get(`${chatId}:${messageId}`);
    return found ? { ...found } : null;
  }),
  rememberMessage: vi.fn(
    async (chatId: number, messageId: number, purpose: MessagePurpose, postId: string | null, extra: { slot?: string; payload?: string } = {}) => {
      messages.set(`${chatId}:${messageId}`, { postId, purpose, slot: extra.slot ?? null, payload: extra.payload ?? null });
    },
  ),
  hasActiveJob: vi.fn(async () => false),
  listTopics: vi.fn(async () => []),
  listPosts: vi.fn(async (statuses: string[]) => [...posts.values()].filter((post) => statuses.includes(post.status)).map(clone)),
  postCostUsd: vi.fn(async () => 0),
  hasUndo: vi.fn(async () => true),
  undoLastChange: vi.fn(async () => ["ru"]),
  upsertImage: vi.fn(async () => undefined),
  usageSnapshot: vi.fn(async () => ({ activeJobs: 0, jobsToday: 0, articlesToday: 0, spentThisMonthUsd: 0 })),
}));

/* ---------- in-memory calendar (the rules of 20261120120000_add_blog_publish_schedule) ---------- */

interface FakeEntry {
  id: string;
  postId: string;
  at: Date;
  mode: ScheduleMode;
  status: ScheduleStatus;
  approvedHash: string;
  approvedWarnings: string[];
  claimedAt: Date | null;
  error: string | null;
}
const entries: FakeEntry[] = [];
let slotTimes = ["10:00", "17:00"];
let nextEntry = 1;
const ACTIVE = ["scheduled", "publishing"];
const isActive = (entry: FakeEntry) => ACTIVE.includes(entry.status);

function asEntry(entry: FakeEntry): ScheduleEntry {
  const post = posts.get(entry.postId);
  return {
    ...entry,
    at: new Date(entry.at),
    postNumber: post?.number ?? 0,
    title: post?.translations.find((t) => t.locale === "ru")?.title ?? post?.topic ?? "",
  };
}

vi.mock("@/lib/editorial/schedule-store", () => ({
  ACTIVE_STATUSES: ["scheduled", "publishing"],
  loadSlotTimes: vi.fn(async () => [...slotTimes]),
  saveSlotTimes: vi.fn(async (times: string[]) => {
    slotTimes = [...times];
  }),
  listActiveEntries: vi.fn(async () => {
    await tick();
    return entries.filter(isActive).sort((a, b) => a.at.getTime() - b.at.getTime()).map(asEntry);
  }),
  activeEntryForPost: vi.fn(async (postId: string) => {
    const entry = entries.find((candidate) => candidate.postId === postId && isActive(candidate));
    return entry ? asEntry(entry) : null;
  }),
  schedulePost: vi.fn(async (input: { postId: string; at: Date; mode: ScheduleMode; hash: string; warnings: string[]; from: string[] }) => {
    await tick();
    if (input.at.getTime() <= Date.now()) return "past";
    const post = posts.get(input.postId);
    if (!post || !input.from.includes(post.status)) return "status";
    if (entries.some((entry) => isActive(entry) && entry.postId === input.postId)) return "post_taken";
    if (entries.some((entry) => isActive(entry) && entry.at.getTime() === input.at.getTime())) return "slot_taken";
    post.status = "scheduled";
    post.lastError = null;
    entries.push({ id: `e${nextEntry++}`, postId: input.postId, at: input.at, mode: input.mode, status: "scheduled", approvedHash: input.hash, approvedWarnings: [...input.warnings], claimedAt: null, error: null });
    return "ok";
  }),
  releaseEntry: vi.fn(async (id: string, from: string[], status: ScheduleStatus, options: { error?: string | null; revertPost?: boolean; postError?: string | null } = {}) => {
    await tick();
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || !from.includes(entry.status)) return false;
    entry.status = status;
    entry.error = options.error ?? null;
    const post = posts.get(entry.postId);
    if (options.revertPost && post?.status === "scheduled") {
      post.status = "review";
      if (options.postError) post.lastError = options.postError;
    }
    return true;
  }),
  moveEntries: vi.fn(async (moves: { id: string; to: Date }[]) => {
    await tick();
    const moving = moves.map((move) => entries.find((entry) => entry.id === move.id));
    if (moving.some((entry) => !entry || entry.status !== "scheduled")) return "changed";
    const others = entries.filter((entry) => isActive(entry) && !moves.some((move) => move.id === entry.id));
    const targets = moves.map((move) => move.to.getTime());
    if (new Set(targets).size !== targets.length || others.some((entry) => targets.includes(entry.at.getTime()))) return "slot_taken";
    moves.forEach((move, index) => {
      moving[index]!.at = move.to;
    });
    return "ok";
  }),
  setEntryMode: vi.fn(async (id: string, mode: ScheduleMode) => {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry?.status === "scheduled") entry.mode = mode;
  }),
  claimEntry: vi.fn(async (id: string, now: Date) => {
    await tick();
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || entry.status !== "scheduled" || entry.at.getTime() > now.getTime()) return false;
    entry.status = "publishing";
    entry.claimedAt = now;
    return true;
  }),
  markPostPublished: vi.fn(async (postId: string, note: string | null = null) => {
    for (const entry of entries) {
      if (entry.postId === postId && isActive(entry)) {
        entry.status = "published";
        entry.error = note;
      }
    }
  }),
  listPublishedPage: vi.fn(async (page: number, size: number) => {
    const published = [...posts.values()]
      .filter((post) => post.status === "published")
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || b.number - a.number);
    return {
      total: published.length,
      rows: published.slice((page - 1) * size, page * size).map((post) => ({
        number: post.number,
        slug: post.slug,
        title: post.translations.find((t) => t.locale === "ru")?.title ?? post.topic,
        publishedAt: post.publishedAt,
      })),
    };
  }),
}));

/* ---------- fixtures ---------- */

const ADMIN = 709466772;
const OFFICIAL = "https://www.gesy.org.cy/en-us/";

function translation(locale: "ru" | "en", title: string) {
  return {
    locale,
    status: "review" as const,
    title,
    description: "D".repeat(140),
    bodyMd: `## ${locale === "ru" ? "Коротко" : "In short"}\n\n${(locale === "ru" ? "слово " : "word ").repeat(500)}`,
    faq: [{ question: "Q?", answer: "A." }],
    sources: [{ title: "GeSY", url: OFFICIAL }],
    publishedAt: null,
    updatedAt: "2026-11-18T00:00:00Z",
  };
}

function confirmedFact(): FactEntry {
  const claim = "Аптеки работают по графику.";
  const quote = "Pharmacies work according to the schedule.";
  return {
    id: factId("claim", claim, quote, OFFICIAL),
    kind: "claim",
    claim,
    importance: "critical",
    sourceUrl: OFFICIAL,
    quote,
    state: "quote_found",
    detail: null,
    checkedAt: "2026-11-18T00:00:00Z",
    manual: null,
  };
}

function reviewPost(overrides: Partial<EditorialPost> = {}): EditorialPost {
  const number = nextNumber++;
  const post: EditorialPost = {
    id: `post-${number}`,
    number,
    slug: `article-${number}`,
    topic: `Тема ${number}`,
    status: "review",
    previewToken: "token",
    lastError: null,
    editorNotes: null,
    sourceChecks: [{ url: OFFICIAL, state: "ok", status: 200, checkedAt: "2026-11-18T00:00:00Z" }],
    factChecks: [confirmedFact()],
    viewCount: 0,
    publishedAt: null,
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    translations: [translation("ru", `Статья номер ${number}`), translation("en", `Article number ${number}`)],
    images: [],
    importInfo: null,
    suggestions: [],
    ...overrides,
  };
  posts.set(post.id, post);
  return post;
}

let updateId = 1;
function textUpdate(text: string, replyTo?: number) {
  return {
    update_id: updateId++,
    message: {
      message_id: nextMessageId++,
      from: { id: ADMIN, is_bot: false },
      chat: { id: ADMIN, type: "private" },
      text,
      ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
    },
  };
}
function callbackUpdate(data: string, messageId = 500) {
  return {
    update_id: updateId++,
    callback_query: { id: `cb-${updateId}`, from: { id: ADMIN, is_bot: false }, data, message: { message_id: messageId, chat: { id: ADMIN, type: "private" } } },
  };
}

const { handleUpdate, runScheduledPublications } = await import("./bot");

const texts = () => sent.map((m) => m.text);
const allButtons = (keyboard: unknown) => (keyboard as { text: string; callback_data?: string }[][] | undefined)?.flat() ?? [];
/** callback_data of the first button with this text in the last sent or edited message that has it. */
function button(label: string): string {
  for (const { keyboard } of [...log].reverse()) {
    const found = allButtons(keyboard).find((b) => b.text.includes(label));
    if (found?.callback_data) return found.callback_data;
  }
  throw new Error(`no button «${label}»`);
}
const lastText = () => log.map((m) => m.text);
const at = (date: string, time: string) => slotInstant({ date, time })!;

/** «📅 Запланировать» → «➕ Добавить в очередь» → «✅ Подтвердить». */
async function queue(post: EditorialPost) {
  await handleUpdate(callbackUpdate(`pls:${post.number}`));
  await handleUpdate(callbackUpdate(button("Добавить в очередь")));
  await handleUpdate(callbackUpdate(button("Подтвердить")));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T06:00:00Z")); // 08:00 in Cyprus
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", String(ADMIN));
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret-test-secret");
  vi.stubEnv("SITE_URL", "https://healthguide.cy");
  posts.clear();
  messages.clear();
  entries.length = 0;
  slotTimes = ["10:00", "17:00"];
  sent.length = 0;
  edited.length = 0;
  log.length = 0;
  nextNumber = 1;
  answered.length = 0;
  failNextTranslationUpdate = false;
  telegramDown = false;
  startJob.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduling from the card", () => {
  it("adds an article to the queue: it gets the next slot and the scheduled status, nothing is published", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${post.number}`));
    expect(texts().at(-1)).toContain("Когда опубликовать");
    await handleUpdate(callbackUpdate(button("Добавить в очередь")));
    expect(edited.at(-1)!.text).toContain("20 ноября (пт), 10:00");
    expect(posts.get(post.id)!.status).toBe("review");
    await handleUpdate(callbackUpdate(button("Подтвердить")));

    const after = posts.get(post.id)!;
    expect(after.status).toBe("scheduled");
    expect(after.translations.every((t) => t.status === "review")).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ mode: "queue", status: "scheduled" });
    expect(entries[0].at.toISOString()).toBe(at("2026-11-20", "10:00").toISOString());
    expect(lastText().some((text) => text.includes(`📅 Статья #${post.number} запланирована на 20 ноября, 10:00`))).toBe(true);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("spreads ten queued articles over five days, two a day, never two in one slot", async () => {
    const drafts = Array.from({ length: 10 }, () => reviewPost());
    for (const post of drafts) await queue(post);
    const local = entries.map((entry) => localSlotOf(entry.at)).map((slot) => `${slot.date} ${slot.time}`);
    expect(local).toEqual([
      "2026-11-20 10:00", "2026-11-20 17:00",
      "2026-11-21 10:00", "2026-11-21 17:00",
      "2026-11-22 10:00", "2026-11-22 17:00",
      "2026-11-23 10:00", "2026-11-23 17:00",
      "2026-11-24 10:00", "2026-11-24 17:00",
    ]);
    expect(drafts.every((post) => posts.get(post.id)!.status === "scheduled")).toBe(true);

    await handleUpdate(textUpdate("/queue"));
    const view = texts().at(-1)!;
    expect(view).toContain("Режим: 2 статьи в день (10:00, 17:00)");
    expect(view).toContain("Europe/Nicosia");
    expect(view).toContain("<b>21 ноября, суббота</b>");
    expect(view).toContain(`• 10:00 — #${drafts[2].number} Статья номер ${drafts[2].number}`);
    expect(view).toContain("В очереди: 10 статей.");
  });

  it("skips a slot that another article already holds", async () => {
    const first = reviewPost();
    const second = reviewPost();
    // Both editors' screens offered the same 10:00 slot; the second confirmation is moved on.
    await handleUpdate(callbackUpdate(`pls:${first.number}`));
    await handleUpdate(callbackUpdate(button("Добавить в очередь")));
    const firstConfirm = button("Подтвердить");
    await handleUpdate(callbackUpdate(`pls:${second.number}`));
    await handleUpdate(callbackUpdate(button("Добавить в очередь")));
    const secondConfirm = button("Подтвердить");
    expect(secondConfirm.slice(0, -8).endsWith(firstConfirm.slice(-20, -8))).toBe(true);
    await handleUpdate(callbackUpdate(firstConfirm));
    await handleUpdate(callbackUpdate(secondConfirm));
    expect(entries).toHaveLength(1);
    expect(edited.at(-1)!.text).toContain("только что заняла другая статья");
    expect(edited.at(-1)!.text).toContain("20 ноября (пт), 17:00");
    await handleUpdate(callbackUpdate(button("Подтвердить")));
    expect(entries.map((entry) => localSlotOf(entry.at).time)).toEqual(["10:00", "17:00"]);
  });

  it("schedules a date and time chosen by hand, and a typed one", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${post.number}`));
    await handleUpdate(callbackUpdate(button("Выбрать дату и время")));
    await handleUpdate(callbackUpdate(button("Пн 23.11")));
    await handleUpdate(callbackUpdate(button("14:00")));
    expect(edited.at(-1)!.text).toContain("23 ноября (пн), 14:00");
    await handleUpdate(callbackUpdate(button("Подтвердить")));
    expect(entries[0]).toMatchObject({ mode: "manual", status: "scheduled" });
    expect(entries[0].at.toISOString()).toBe(at("2026-11-23", "14:00").toISOString());

    const typed = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${typed.number}`));
    await handleUpdate(callbackUpdate(button("Выбрать дату и время")));
    await handleUpdate(callbackUpdate(button("Ввести вручную")));
    const prompt = sent.at(-1)!;
    expect(prompt.forceReply).toBe(true);
    const promptId = nextMessageId - 1;
    await handleUpdate(textUpdate("25.11 10:20", promptId));
    expect(texts().at(-1)).toContain("00, 15, 30 или 45");
    await handleUpdate(textUpdate("25.11 10:30", nextMessageId - 1));
    expect(texts().at(-1)).toContain("25 ноября (ср), 10:30");
    await handleUpdate(callbackUpdate(button("Подтвердить")));
    expect(entries.find((entry) => entry.postId === typed.id)!.at.toISOString()).toBe(at("2026-11-25", "10:30").toISOString());
  });

  it("refuses a time held by another article and a time already passed", async () => {
    const first = reviewPost();
    await queue(first); // 20.11 10:00
    const second = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${second.number}`));
    await handleUpdate(callbackUpdate(button("Выбрать дату и время")));
    await handleUpdate(callbackUpdate(button("Пт 20.11")));
    expect(allButtons(edited.at(-1)!.keyboard).map((b) => b.text)).toContain("🔒 10:00");
    expect(allButtons(edited.at(-1)!.keyboard).map((b) => b.text)).not.toContain("08:00");
    await handleUpdate(callbackUpdate(button("🔒 10:00")));
    expect(edited.at(-1)!.text).toContain(`уже занято статьёй #${first.number}`);
    expect(entries).toHaveLength(1);
  });

  it("«Отмена» changes nothing", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${post.number}`));
    await handleUpdate(callbackUpdate(button("Отмена")));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(entries).toHaveLength(0);
    expect(edited.at(-1)!.text).toContain("без изменений");
  });

  it("does not schedule over blocking facts", async () => {
    const post = reviewPost({ factChecks: [] });
    await handleUpdate(callbackUpdate(`pls:${post.number}`));
    expect(texts().at(-1)).toContain("заблокирована");
    expect(entries).toHaveLength(0);
    expect(posts.get(post.id)!.status).toBe("review");
  });

  it("shows warnings first and asks before scheduling over them", async () => {
    const post = reviewPost({ sourceChecks: [{ url: OFFICIAL, state: "unverified", status: 403, checkedAt: "2026-11-18T00:00:00Z" }] });
    await handleUpdate(callbackUpdate(`pls:${post.number}`));
    expect(texts().at(-1)).toContain("обратите внимание");
    expect(texts().at(-1)).toContain("сайт не дал проверить");
    await handleUpdate(callbackUpdate(button("Да, запланировать")));
    await handleUpdate(callbackUpdate(button("Добавить в очередь")));
    await handleUpdate(callbackUpdate(button("Подтвердить")));
    expect(entries[0].approvedWarnings).toEqual(["links"]);
  });

  it("refuses a confirmation when the text changed after the check", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${post.number}`));
    await handleUpdate(callbackUpdate(button("Добавить в очередь")));
    posts.get(post.id)!.translations[0].bodyMd += "\n\nНовый абзац.";
    await handleUpdate(callbackUpdate(button("Подтвердить")));
    expect(entries).toHaveLength(0);
    expect(edited.at(-1)!.text).toContain("изменились после проверки");
  });

  it("the card of a draft shows «Запланировать» next to «Опубликовать»", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`open:${post.number}`));
    const row = (sent.at(-1)!.keyboard as { text: string }[][])[0].map((b) => b.text);
    expect(row).toEqual(["✅ Опубликовать RU + EN", "📅 Запланировать"]);
  });
});

describe("managing the queue", () => {
  it("a scheduled card shows the time and the queue actions, and its text is locked", async () => {
    const post = reviewPost();
    await queue(post);
    await handleUpdate(callbackUpdate(`open:${post.number}`));
    const card = sent.at(-1)!;
    expect(card.text).toContain("📅 запланирована");
    expect(card.text).toContain("Выйдет: <b>20 ноября (пт), 10:00</b>");
    expect(allButtons(card.keyboard).map((b) => b.text)).toEqual(
      expect.arrayContaining(["✅ Опубликовать сейчас", "🗓 Изменить дату/время", "⬆️ Раньше", "⬇️ Позже", "❌ Убрать из очереди"]),
    );
    expect(allButtons(card.keyboard).map((b) => b.text)).not.toContain("✏️ Правки через ИИ");

    await handleUpdate(callbackUpdate(`edit:${post.number}`));
    expect(texts().at(-1)).toContain("текст заблокирован");
    await handleUpdate(callbackUpdate(`med:${post.number}`));
    expect(texts().at(-1)).toContain("текст заблокирован");
    await handleUpdate(callbackUpdate(`pause:${post.number}`));
    expect(answered.at(-1)!.text).toContain("сначала уберите");
    expect(posts.get(post.id)!.status).toBe("scheduled");
    await handleUpdate(callbackUpdate(`undo:${post.number}`));
    expect(answered.at(-1)!.text).toBe("Сейчас откатить нельзя");
  });

  it("moves an article to another date and time; it then counts as chosen by hand", async () => {
    const post = reviewPost();
    await queue(post);
    await handleUpdate(callbackUpdate(`plm:${post.number}:r`));
    await handleUpdate(callbackUpdate(button("Чт 26.11")));
    await handleUpdate(callbackUpdate(button("12:00")));
    expect(edited.at(-1)!.text).toContain("Перенести");
    await handleUpdate(callbackUpdate(button("Подтвердить")));
    expect(entries[0].at.toISOString()).toBe(at("2026-11-26", "12:00").toISOString());
    expect(entries[0]).toMatchObject({ mode: "manual", status: "scheduled" });
    expect(entries).toHaveLength(1);
  });

  it("⬆️ / ⬇️ swap an article with its neighbour without any slot conflict", async () => {
    const [a, b, c] = [reviewPost(), reviewPost(), reviewPost()];
    for (const post of [a, b, c]) await queue(post);
    const timeOf = (post: EditorialPost) => entries.find((entry) => entry.postId === post.id && entry.status === "scheduled")!.at.toISOString();
    const [ta, tb, tc] = [timeOf(a), timeOf(b), timeOf(c)];
    await handleUpdate(callbackUpdate(`plup:${c.number}`));
    expect([timeOf(a), timeOf(b), timeOf(c)]).toEqual([ta, tc, tb]);
    await handleUpdate(callbackUpdate(`plup:${a.number}`));
    expect(answered.at(-1)!.text).toBe("Уже первая в очереди");
    await handleUpdate(callbackUpdate(`pldn:${a.number}`));
    expect([timeOf(a), timeOf(c)]).toEqual([tb, ta]);
    expect(new Set(entries.map((entry) => entry.at.getTime())).size).toBe(3);
  });

  it("removing from the queue keeps the article and its translations; it is editable again", async () => {
    const post = reviewPost();
    await queue(post);
    await handleUpdate(callbackUpdate(`plrm:${post.number}`));
    const after = posts.get(post.id)!;
    expect(after.status).toBe("review");
    expect(after.translations).toHaveLength(2);
    expect(entries[0]).toMatchObject({ status: "cancelled" });
    expect(texts().some((text) => text.includes("убрана из очереди") && text.includes("сохранены"))).toBe(true);
    // The freed slot goes to the next article.
    const next = reviewPost();
    await queue(next);
    expect(entries.find((entry) => entry.postId === next.id)!.at.toISOString()).toBe(at("2026-11-20", "10:00").toISOString());
  });

  it("«Отложить» on a draft keeps working as before and gives no publication date", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`pause:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("paused");
    expect(entries).toHaveLength(0);
    await handleUpdate(callbackUpdate(`resume:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
  });
});

describe("settings", () => {
  it("shows the settings and changes the number per day without moving queued articles", async () => {
    const post = reviewPost();
    await queue(post);
    await handleUpdate(textUpdate("/settings"));
    expect(texts().at(-1)).toContain("Публикаций в день: <b>2</b>");
    expect(texts().at(-1)).toContain("10:00, 17:00");
    await handleUpdate(callbackUpdate("pln:3"));
    expect(slotTimes).toEqual(["09:00", "13:00", "18:00"]);
    expect(edited.at(-1)!.text).toContain("остались на своих датах");
    expect(entries[0].at.toISOString()).toBe(at("2026-11-20", "10:00").toISOString());
  });

  it("takes typed times and refuses times off the grid", async () => {
    await handleUpdate(callbackUpdate("pltm:0"));
    const promptId = nextMessageId - 1;
    await handleUpdate(textUpdate("09:10", promptId));
    expect(texts().at(-1)).toContain("00, 15, 30 или 45");
    await handleUpdate(textUpdate("18:30, 09:30", nextMessageId - 1));
    expect(slotTimes).toEqual(["09:30", "18:30"]);
  });

  it("redistributes only queue entries, after a confirmation", async () => {
    const [a, b] = [reviewPost(), reviewPost()];
    await queue(a); // 20.11 10:00
    await queue(b); // 20.11 17:00
    const manual = reviewPost();
    await handleUpdate(callbackUpdate(`pls:${manual.number}`));
    await handleUpdate(callbackUpdate(button("Выбрать дату и время")));
    await handleUpdate(callbackUpdate(button("Сб 21.11")));
    await handleUpdate(callbackUpdate(button("09:00")));
    await handleUpdate(callbackUpdate(button("Подтвердить")));

    await handleUpdate(callbackUpdate("pln:1")); // 10:00 only
    await handleUpdate(callbackUpdate("plrd:0"));
    expect(edited.at(-1)!.text).toContain("Перераспределить");
    expect(entries.find((entry) => entry.postId === b.id)!.at.toISOString()).toBe(at("2026-11-20", "17:00").toISOString());
    await handleUpdate(callbackUpdate(button("Перенести")));
    const timeOf = (post: EditorialPost) => entries.find((entry) => entry.postId === post.id)!.at.toISOString();
    expect(timeOf(a)).toBe(at("2026-11-20", "10:00").toISOString());
    expect(timeOf(b)).toBe(at("2026-11-21", "10:00").toISOString());
    expect(timeOf(manual)).toBe(at("2026-11-21", "09:00").toISOString());
  });
});

describe("the scheduled run", () => {
  it("publishes nothing before the time: the article stays hidden", async () => {
    const post = reviewPost();
    await queue(post);
    vi.setSystemTime(at("2026-11-20", "09:59"));
    const summary = await runScheduledPublications();
    expect(summary.published).toEqual([]);
    expect(posts.get(post.id)!.status).toBe("scheduled");
    expect(posts.get(post.id)!.translations.every((t) => t.status === "review")).toBe(true);
  });

  it("publishes an approved article at its time, reports the link and starts EL/AR as usual", async () => {
    const post = reviewPost();
    await queue(post);
    vi.setSystemTime(at("2026-11-20", "10:07"));
    const summary = await runScheduledPublications();
    expect(summary.published).toEqual([post.number]);
    const after = posts.get(post.id)!;
    expect(after.status).toBe("published");
    expect(after.publishedAt).toBe(at("2026-11-20", "10:07").toISOString());
    expect(after.translations.every((t) => t.status === "published")).toBe(true);
    expect(entries[0].status).toBe("published");
    const notice = texts().find((text) => text.startsWith(`✅ Статья #${post.number} опубликована`))!;
    expect(notice).toContain(`https://healthguide.cy/ru/blog/${post.slug}`);
    const translate = startJob.mock.calls.filter((call) => call[1] === "translate");
    expect(translate).toHaveLength(1);
    expect(translate[0][2]).toEqual({ locales: ["el", "ar"], notify: "translations" });
  });

  it("a repeated or simultaneous run never publishes twice", async () => {
    const post = reviewPost();
    await queue(post);
    vi.setSystemTime(at("2026-11-20", "10:05"));
    const [one, two] = await Promise.all([runScheduledPublications(), runScheduledPublications()]);
    await runScheduledPublications();
    expect([...one.published, ...two.published]).toEqual([post.number]);
    expect(texts().filter((text) => text.includes("опубликована по расписанию"))).toHaveLength(1);
    expect(startJob.mock.calls.filter((call) => call[1] === "translate")).toHaveLength(1);
  });

  it("publishes one article per run, the earliest first", async () => {
    slotTimes = ["10:00", "10:15"];
    const [a, b] = [reviewPost(), reviewPost()];
    await queue(a);
    await queue(b);
    vi.setSystemTime(at("2026-11-20", "10:20"));
    expect((await runScheduledPublications()).published).toEqual([a.number]);
    expect((await runScheduledPublications()).published).toEqual([b.number]);
  });

  it("blocks an article that no longer passes the blocking checks, tells why, and takes it out of the queue", async () => {
    const post = reviewPost();
    await queue(post);
    posts.get(post.id)!.factChecks = [];
    vi.setSystemTime(at("2026-11-20", "10:05"));
    const summary = await runScheduledPublications();
    expect(summary.failed).toEqual([post.number]);
    const after = posts.get(post.id)!;
    expect(after.status).toBe("review");
    expect(after.translations.every((t) => t.status === "review")).toBe(true);
    expect(entries[0].status).toBe("failed");
    expect(entries[0].error).toContain("блокирующие");
    const notice = texts().at(-1)!;
    expect(notice).toContain(`⚠️ Не удалось опубликовать статью #${post.number}`);
    expect(notice).toContain("Причина:");
    expect(allButtons(sent.at(-1)!.keyboard).map((b) => b.callback_data)).toContain(`open:${post.number}`);
    // Fixed afterwards: still not published without a new approval.
    posts.get(post.id)!.factChecks = [confirmedFact()];
    vi.setSystemTime(at("2026-11-20", "10:20"));
    expect((await runScheduledPublications()).published).toEqual([]);
    expect(posts.get(post.id)!.status).toBe("review");
  });

  it("never publishes a text that changed after the approval", async () => {
    const post = reviewPost();
    await queue(post);
    posts.get(post.id)!.translations[1].bodyMd = "Changed behind the editor's back.";
    vi.setSystemTime(at("2026-11-20", "10:05"));
    const summary = await runScheduledPublications();
    expect(summary.failed).toEqual([post.number]);
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("изменился после одобрения");
  });

  it("stops on a warning that was not there at the approval", async () => {
    const post = reviewPost();
    await queue(post);
    posts.get(post.id)!.sourceChecks = [{ url: OFFICIAL, state: "broken", status: 404, checkedAt: "2026-11-20T07:00:00Z" }];
    vi.setSystemTime(at("2026-11-20", "10:05"));
    expect((await runScheduledPublications()).failed).toEqual([post.number]);
    expect(texts().at(-1)).toContain("новые предупреждения");
    expect(posts.get(post.id)!.status).toBe("review");
  });

  it("a failed publication loses no data and does not hold up the rest of the queue", async () => {
    slotTimes = ["10:00", "10:15"];
    const [a, b] = [reviewPost(), reviewPost()];
    await queue(a);
    await queue(b);
    failNextTranslationUpdate = true;
    vi.setSystemTime(at("2026-11-20", "10:20"));
    expect((await runScheduledPublications()).failed).toEqual([a.number]);
    const failed = posts.get(a.id)!;
    expect(failed.status).toBe("review");
    expect(failed.publishedAt).toBeNull();
    expect(failed.translations).toHaveLength(2);
    expect(entries.find((entry) => entry.postId === a.id)!.error).toContain("connection reset");
    expect((await runScheduledPublications()).published).toEqual([b.number]);
  });

  it("a Telegram outage does not change the outcome", async () => {
    const post = reviewPost();
    await queue(post);
    telegramDown = true;
    vi.setSystemTime(at("2026-11-20", "10:05"));
    expect((await runScheduledPublications()).published).toEqual([post.number]);
    expect(posts.get(post.id)!.status).toBe("published");
    expect(entries[0].status).toBe("published");
  });

  it("does not publish slots missed long ago on its own: they go back to the editor in one message", async () => {
    const drafts = [reviewPost(), reviewPost(), reviewPost()];
    for (const post of drafts) await queue(post); // 20.11 10:00, 17:00, 21.11 10:00
    vi.setSystemTime(at("2026-11-21", "10:10")); // the scheduler was down for a day
    const summary = await runScheduledPublications();
    expect(summary.missed).toEqual([drafts[0].number, drafts[1].number]);
    expect(summary.published).toEqual([drafts[2].number]);
    expect(posts.get(drafts[0].id)!.status).toBe("review");
    expect(posts.get(drafts[1].id)!.status).toBe("review");
    expect(texts().filter((text) => text.startsWith("⏰ Пропущены"))).toHaveLength(1);
  });

  it("finishes a publication interrupted by a crash without publishing it twice", async () => {
    const [done, lost] = [reviewPost(), reviewPost()];
    await queue(done);
    await queue(lost);
    // Both were claimed at 17:00 by a run that was killed; one of them had already gone live.
    for (const entry of entries) {
      entry.status = "publishing";
      entry.claimedAt = at("2026-11-20", "17:00");
    }
    posts.get(done.id)!.status = "published";
    vi.setSystemTime(at("2026-11-20", "17:30"));
    const summary = await runScheduledPublications();
    expect(summary.recovered).toEqual([done.number]);
    expect(summary.failed).toEqual([lost.number]);
    expect(posts.get(lost.id)!.status).toBe("review");
    expect(entries.map((entry) => entry.status)).toEqual(["published", "failed"]);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("«Опубликовать сейчас» publishes a queued article once and closes its entry", async () => {
    const post = reviewPost();
    await queue(post);
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("published");
    expect(entries[0].status).toBe("published");
    vi.setSystemTime(at("2026-11-20", "10:05"));
    expect((await runScheduledPublications()).published).toEqual([]);
    expect(startJob.mock.calls.filter((call) => call[1] === "translate")).toHaveLength(1);
  });
});

describe("published history and the menu", () => {
  it("/published pages through the whole history, newest first, with dates and links", async () => {
    for (let i = 0; i < 25; i += 1) {
      reviewPost({ status: "published", publishedAt: new Date(Date.UTC(2026, 10, 1 + i, 8)).toISOString() });
    }
    await handleUpdate(textUpdate("/published"));
    const first = sent.at(-1)!;
    expect(first.text).toContain("Опубликовано (25)");
    expect(first.text).toContain("страница 1 из 3");
    expect(first.text).toMatch(/#25 · 25\.11\.2026 · <a href="https:\/\/healthguide\.cy\/ru\/blog\/article-25">Статья номер 25<\/a>/);
    expect(first.text.indexOf("#25 ·")).toBeLessThan(first.text.indexOf("#24 ·"));
    expect(allButtons(first.keyboard).map((b) => b.callback_data)).toContain("open:25");
    await handleUpdate(callbackUpdate(button("Старше")));
    await handleUpdate(callbackUpdate(button("Старше")));
    const last = edited.at(-1)!;
    expect(last.text).toContain("страница 3 из 3");
    expect(last.text).toContain("#1 · 01.11.2026");
    expect(last.text).not.toContain("#6 ·");
  });

  it("/start shows the main menu with «Опубликовано», and the menu buttons work", async () => {
    await handleUpdate(textUpdate("/start"));
    const labels = allButtons(sent.at(-1)!.keyboard).map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["✅ Опубликовано", "📅 Расписание", "⚙️ Настройки публикаций", "📝 Черновики"]));
    await handleUpdate(callbackUpdate("plh:1"));
    expect(texts().at(-1)).toBe("Опубликованных статей пока нет.");
    await handleUpdate(callbackUpdate("plv:1"));
    expect(texts().at(-1)).toContain("Очередь пуста");
  });
});
