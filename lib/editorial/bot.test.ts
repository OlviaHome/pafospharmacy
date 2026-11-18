import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorialPost, MessagePurpose } from "./store";
import { factId, type FactEntry } from "./facts";

/*
 * Behaviour tests for the Telegram bot: message routing, commands and the buttons that create
 * drafts, start jobs or publish. Supabase, Telegram and OpenAI are replaced by in-memory fakes;
 * nothing here talks to a network or a real database.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/blog/repository", () => ({ BLOG_CACHE_TAG: "blog" }));

const sent: { chatId: number; text: string; keyboard?: unknown; forceReply?: boolean }[] = [];
const edited: { messageId: number; text: string }[] = [];
const answered: { id: string; text?: string }[] = [];
let nextMessageId = 1000;

vi.mock("@/lib/editorial/telegram", () => ({
  escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  sendMessage: vi.fn(async (chatId: number, text: string, options: { keyboard?: unknown; forceReply?: boolean } = {}) => {
    sent.push({ chatId, text, ...options });
    return { message_id: nextMessageId++ };
  }),
  editMessage: vi.fn(async (_chatId: number, messageId: number, text: string) => {
    edited.push({ messageId, text });
  }),
  answerCallback: vi.fn(async (id: string, text?: string) => {
    answered.push({ id, text });
  }),
  sendTyping: vi.fn(async () => undefined),
  sendDocument: vi.fn(async () => ({ message_id: nextMessageId++ })),
  downloadFile: vi.fn(async () => ({ bytes: new Uint8Array(), path: "x.jpg" })),
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
}));
vi.mock("@/lib/editorial/images", () => ({
  removeStoredImage: vi.fn(async () => undefined),
  storeImageBytes: vi.fn(async () => ({ url: "https://x/y.jpg", width: 1, height: 1, storagePath: "p" })),
}));

/* ---------- in-memory store ---------- */

const posts = new Map<string, EditorialPost>();
const messages = new Map<string, { postId: string | null; purpose: MessagePurpose; slot: string | null; payload: string | null }>();
const activeJobs: { postId: string; kind: string }[] = [];
let nextNumber = 1;

/** Lets two "simultaneous" requests interleave at every store call, like two webhook invocations. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function clone<T>(value: T): T {
  return structuredClone(value);
}

vi.mock("@/lib/editorial/store", () => ({
  loadPost: vi.fn(async (ref: { id: string } | { number: number }) => {
    await tick();
    const post = "id" in ref ? posts.get(ref.id) : [...posts.values()].find((p) => p.number === ref.number);
    return post ? clone(post) : null;
  }),
  createPost: vi.fn(async (topic: string) => {
    await tick();
    const post = makePost({ topic, status: "generating", translations: [] });
    posts.set(post.id, post);
    return clone(post);
  }),
  updatePost: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    await tick();
    const post = posts.get(id);
    if (!post) return;
    if (patch.status) post.status = patch.status as EditorialPost["status"];
    if ("last_error" in patch) post.lastError = patch.last_error as string | null;
    if ("published_at" in patch) post.publishedAt = patch.published_at as string | null;
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
  hasActiveJob: vi.fn(async (postId: string, kind: string) => {
    await tick();
    return activeJobs.some((job) => job.postId === postId && job.kind === kind);
  }),
  setTranslationStatus: vi.fn(async (postId: string, locales: string[], status: string) => {
    await tick();
    const post = posts.get(postId);
    for (const t of post?.translations ?? []) if (locales.includes(t.locale)) t.status = status as never;
  }),
  findMessage: vi.fn(async (chatId: number, messageId: number) => {
    await tick();
    const found = messages.get(`${chatId}:${messageId}`);
    return found ? { ...found } : null;
  }),
  rememberMessage: vi.fn(
    async (chatId: number, messageId: number, purpose: MessagePurpose, postId: string | null, extra: { slot?: string; payload?: string } = {}) => {
      await tick();
      messages.set(`${chatId}:${messageId}`, { postId, purpose, slot: extra.slot ?? null, payload: extra.payload ?? null });
    },
  ),
  takeTopic: vi.fn(async (chatId: number, messageId: number) => {
    await tick();
    const found = messages.get(`${chatId}:${messageId}`);
    if (!found || found.purpose !== "topic_confirm" || !found.payload) return null;
    const topic = found.payload;
    found.payload = "";
    return topic;
  }),
  listTopics: vi.fn(async () => []),
  listPosts: vi.fn(async () => []),
  postCostUsd: vi.fn(async () => 0),
  hasUndo: vi.fn(async () => false),
  undoLastChange: vi.fn(async () => []),
  deletePost: vi.fn(async () => undefined),
  upsertImage: vi.fn(async () => undefined),
  usageSnapshot: vi.fn(async () => ({ activeJobs: 0, jobsToday: 0, articlesToday: 0, spentThisMonthUsd: 0 })),
}));

const ADMIN = 709466772;

function makePost(overrides: Partial<EditorialPost> = {}): EditorialPost {
  const number = nextNumber++;
  return {
    id: `post-${number}`,
    number,
    slug: `post-${number}`,
    topic: "Тема",
    status: "review",
    previewToken: "token",
    lastError: null,
    editorNotes: null,
    sourceChecks: [],
    factChecks: [],
    viewCount: 0,
    publishedAt: null,
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    translations: [],
    images: [],
    ...overrides,
  };
}

const OFFICIAL = "https://www.gesy.org.cy/en-us/";

function translation(locale: "ru" | "en", status: "review" | "draft" | "published" = "review") {
  return {
    locale,
    status,
    title: locale === "ru" ? "Как найти дежурную аптеку" : "How to find a duty pharmacy",
    description: "D".repeat(140),
    bodyMd: `## ${locale === "ru" ? "Коротко" : "In short"}\n\n${"слово ".repeat(500)}`,
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
  const post = makePost({
    status: "review",
    translations: [translation("ru"), translation("en")],
    factChecks: [confirmedFact()],
    sourceChecks: [{ url: OFFICIAL, state: "ok", status: 200 } as never],
    ...overrides,
  });
  posts.set(post.id, post);
  return post;
}

let updateId = 1;

function textUpdate(text: string, replyTo?: number) {
  return {
    update_id: updateId++,
    message: {
      message_id: nextMessageId++,
      from: { id: ADMIN, is_bot: false, first_name: "Olga" },
      chat: { id: ADMIN, type: "private" },
      text,
      ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
    },
  };
}

function callbackUpdate(data: string, messageId = 500) {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: ADMIN, is_bot: false, first_name: "Olga" },
      data,
      message: { message_id: messageId, chat: { id: ADMIN, type: "private" } },
    },
  };
}

const { handleUpdate } = await import("./bot");

const jobsOfKind = (kind: string) => startJob.mock.calls.filter((call) => call[1] === kind);
const texts = () => sent.map((m) => m.text);

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", String(ADMIN));
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret-test-secret");
  vi.stubEnv("SITE_URL", "https://healthguide.cy");
  vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "true");
  posts.clear();
  messages.clear();
  activeJobs.length = 0;
  sent.length = 0;
  edited.length = 0;
  answered.length = 0;
  startJob.mockClear();
  startJob.mockImplementation(async () => ({ ok: true as const, jobId: 1 }));
});

describe("messages and commands", () => {
  it("treats plain text as a topic and asks for confirmation", async () => {
    await handleUpdate(textUpdate("Как найти дежурную аптеку на Кипре"));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("Написать статью на тему «Как найти дежурную аптеку на Кипре»?");
    expect(JSON.stringify(sent[0].keyboard)).toContain("newok");
    expect(startJob).not.toHaveBeenCalled();
  });

  it("treats a long message as a topic too, cut to 500 characters", async () => {
    await handleUpdate(textUpdate("а".repeat(900)));
    expect(sent[0].text).toBe(`Написать статью на тему «${"а".repeat(500)}»?`);
  });

  it("treats a reply to an unknown message as a new topic", async () => {
    await handleUpdate(textUpdate("Отредактируй статью #2", 99999));
    expect(sent[0].text).toContain("Написать статью на тему");
  });

  it("/new with a topic creates a draft and starts writing", async () => {
    await handleUpdate(textUpdate("/new Что такое ГеСИ и как зарегистрироваться"));
    expect(posts.size).toBe(1);
    expect(jobsOfKind("write")).toHaveLength(1);
    expect(texts().at(-1)).toContain("Начала статью");
  });

  it("/new without a topic asks for one with a forced reply", async () => {
    await handleUpdate(textUpdate("/new"));
    expect(sent[0].forceReply).toBe(true);
    const asked = [...messages.values()][0];
    expect(asked).toMatchObject({ purpose: "topic_confirm", payload: "ask" });
  });

  it("answers /help and rejects unknown commands", async () => {
    await handleUpdate(textUpdate("/help"));
    await handleUpdate(textUpdate("/whatever"));
    expect(sent[0].text).toContain("Ничего не публикуется без вашей кнопки");
    expect(sent[1].text).toBe("Не знаю такой команды. /help");
  });

  it("a reply to the edit prompt starts an AI edit of that article", async () => {
    const post = reviewPost();
    messages.set(`${ADMIN}:700`, { postId: post.id, purpose: "edit_prompt", slot: null, payload: null });
    await handleUpdate(textUpdate("Сократи раздел про часы", 700));
    expect(jobsOfKind("edit")).toHaveLength(1);
    expect(jobsOfKind("edit")[0][2]).toEqual({ instruction: "Сократи раздел про часы" });
    expect(posts.get(post.id)!.status).toBe("generating");
  });

  it("refuses an AI edit of a published article", async () => {
    const post = reviewPost({ status: "published" });
    messages.set(`${ADMIN}:701`, { postId: post.id, purpose: "edit_prompt", slot: null, payload: null });
    await handleUpdate(textUpdate("Поправь заголовок", 701));
    expect(startJob).not.toHaveBeenCalled();
    expect(texts().at(-1)).toContain("опубликована");
  });

  it("restores the status when the limits refuse an edit", async () => {
    const post = reviewPost();
    messages.set(`${ADMIN}:702`, { postId: post.id, purpose: "edit_prompt", slot: null, payload: null });
    startJob.mockImplementationOnce(async () => ({ ok: false, reason: "Дневной лимит задач (40) исчерпан." }) as never);
    await handleUpdate(textUpdate("Поправь заголовок", 702));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("Дневной лимит");
  });
});

describe("buttons that create drafts or start jobs", () => {
  it("«Да, писать» creates exactly one draft", async () => {
    await handleUpdate(textUpdate("Как найти дежурную аптеку на Кипре"));
    const confirmId = [...messages.keys()][0].split(":")[1];
    await handleUpdate(callbackUpdate("newok", Number(confirmId)));
    expect(posts.size).toBe(1);
    expect(jobsOfKind("write")).toHaveLength(1);
  });

  it("two simultaneous taps on «Да, писать» still create one draft", async () => {
    await handleUpdate(textUpdate("Как найти дежурную аптеку на Кипре"));
    const confirmId = Number([...messages.keys()][0].split(":")[1]);
    await Promise.all([handleUpdate(callbackUpdate("newok", confirmId)), handleUpdate(callbackUpdate("newok", confirmId))]);
    expect(posts.size).toBe(1);
    expect(jobsOfKind("write")).toHaveLength(1);
    expect(edited.map((e) => e.text)).toContain("Тема не найдена, напишите её ещё раз.");
  });

  it("a second tap after the draft was created does nothing", async () => {
    await handleUpdate(textUpdate("Тема для повторного нажатия"));
    const confirmId = Number([...messages.keys()][0].split(":")[1]);
    await handleUpdate(callbackUpdate("newok", confirmId));
    await handleUpdate(callbackUpdate("newok", confirmId));
    expect(posts.size).toBe(1);
  });

  it("two simultaneous AI edit replies start one job", async () => {
    const post = reviewPost();
    messages.set(`${ADMIN}:710`, { postId: post.id, purpose: "edit_prompt", slot: null, payload: null });
    await Promise.all([handleUpdate(textUpdate("Правка 1", 710)), handleUpdate(textUpdate("Правка 2", 710))]);
    expect(jobsOfKind("edit")).toHaveLength(1);
    expect(texts().some((t) => t.includes("обновляется") || t.includes("ещё пишется"))).toBe(true);
  });

  it("two simultaneous taps on «Написать заново» start one job", async () => {
    const post = reviewPost({ status: "failed", translations: [] });
    await Promise.all([
      handleUpdate(callbackUpdate(`retry:${post.number}`)),
      handleUpdate(callbackUpdate(`retry:${post.number}`)),
    ]);
    expect(jobsOfKind("write")).toHaveLength(1);
    expect(posts.get(post.id)!.status).toBe("generating");
  });

  it("two simultaneous taps on «Обновить EN» start one job", async () => {
    const post = reviewPost();
    await Promise.all([
      handleUpdate(callbackUpdate(`tren:${post.number}`)),
      handleUpdate(callbackUpdate(`tren:${post.number}`)),
    ]);
    expect(jobsOfKind("translate")).toHaveLength(1);
  });

  it("does not start EL/AR translations while one is already running", async () => {
    const post = reviewPost({ status: "published" });
    activeJobs.push({ postId: post.id, kind: "translate" });
    await handleUpdate(callbackUpdate(`tr:${post.number}`));
    expect(startJob).not.toHaveBeenCalled();
    expect(texts().at(-1)).toContain("уже");
  });
});

describe("publishing", () => {
  it("publishes RU + EN once and starts EL/AR translations once", async () => {
    const post = reviewPost();
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    const after = posts.get(post.id)!;
    expect(after.status).toBe("published");
    expect(after.translations.every((t) => t.status === "published")).toBe(true);
    expect(jobsOfKind("translate")).toHaveLength(1);
    expect(jobsOfKind("translate")[0][2]).toEqual({ locales: ["el", "ar"], notify: "translations" });
  });

  it("two simultaneous taps on «Да, публиковать» publish once", async () => {
    const post = reviewPost();
    await Promise.all([
      handleUpdate(callbackUpdate(`pubok:${post.number}`)),
      handleUpdate(callbackUpdate(`pubok:${post.number}`)),
    ]);
    expect(jobsOfKind("translate")).toHaveLength(1);
    expect(texts().filter((t) => t.includes("Опубликовано:"))).toHaveLength(1);
  });

  it("never publishes over blocking facts, even after «Да, публиковать»", async () => {
    const post = reviewPost({ factChecks: [] });
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("заблокирована");
    expect(startJob).not.toHaveBeenCalled();
  });
});
