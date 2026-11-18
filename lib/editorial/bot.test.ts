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

let downloadedText = "";
const sent: { chatId: number; text: string; keyboard?: unknown; forceReply?: boolean }[] = [];
const edited: { messageId: number; text: string; keyboard?: unknown }[] = [];
const answered: { id: string; text?: string }[] = [];
let nextMessageId = 1000;

vi.mock("@/lib/editorial/telegram", () => ({
  escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  sendMessage: vi.fn(async (chatId: number, text: string, options: { keyboard?: unknown; forceReply?: boolean } = {}) => {
    sent.push({ chatId, text, ...options });
    return { message_id: nextMessageId++ };
  }),
  editMessage: vi.fn(async (_chatId: number, messageId: number, text: string, keyboard?: unknown) => {
    edited.push({ messageId, text, keyboard });
  }),
  answerCallback: vi.fn(async (id: string, text?: string) => {
    answered.push({ id, text });
  }),
  sendTyping: vi.fn(async () => undefined),
  sendDocument: vi.fn(async () => ({ message_id: nextMessageId++ })),
  downloadFile: vi.fn(async () => ({ bytes: new TextEncoder().encode(downloadedText), path: "file.txt" })),
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
  fetchSourceText: vi.fn(async (url: string) =>
    url.includes("gov.cy")
      ? { state: "unreachable", detail: "сайт не пускает автоматическую проверку (HTTP 403)" }
      : { state: "ok", kind: "html", text: `Текст страницы ${url}: скорая помощь будет реорганизована.` },
  ),
}));
vi.mock("@/lib/editorial/images", () => ({
  removeStoredImage: vi.fn(async () => undefined),
  storeImageBytes: vi.fn(async () => ({ url: "https://x/y.jpg", width: 1, height: 1, storagePath: "p" })),
}));

/* ---------- in-memory store ---------- */

const posts = new Map<string, EditorialPost>();

interface FakeImport {
  id: string;
  chatId: number;
  status: "collecting" | "ready" | "started" | "cancelled";
  postId: string | null;
  sourceText: string | null;
  language: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  sourceTextRu: string | null;
  mode?: "rewrite" | "prepare";
  prepared?: { pairs: { o: string; t: string }[]; text: string } | null;
  acceptedHash?: string | null;
  rightsConfirmedAt?: string | null;
  createdAt: string;
  lastPartAt: string | null;
  updatedAt: number;
  parts: { messageId: number; kind: string; body: string; sourceUrl: string | null; sourceLabel: string | null }[];
}
const imports = new Map<string, FakeImport>();
let nextImport = 1;

function importRecord(row: FakeImport) {
  const { parts, ...rest } = row;
  return { ...rest, parts: parts.length, chars: parts.reduce((sum, part) => sum + part.body.length, 0) };
}

function withImport(post: EditorialPost): EditorialPost {
  const row = [...imports.values()].find((candidate) => candidate.postId === post.id);
  return {
    ...post,
    importInfo: row
      ? { id: row.id, mode: row.mode ?? "rewrite", language: row.language, sourceUrl: row.sourceUrl, sourceLabel: row.sourceLabel, sourceText: row.sourceText, sourceTextRu: row.sourceTextRu, prepared: row.prepared ?? null, acceptedHash: row.acceptedHash ?? null }
      : post.importInfo,
  };
}
const messages = new Map<string, { postId: string | null; purpose: MessagePurpose; slot: string | null; payload: string | null }>();
const activeJobs: { postId: string; kind: string }[] = [];
let nextNumber = 1;
const updatedFactChecks: FactEntry[][] = [];
let failNextTranslationUpdate = false;

/** Lets two "simultaneous" requests interleave at every store call, like two webhook invocations. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function clone<T>(value: T): T {
  return structuredClone(value);
}

vi.mock("@/lib/editorial/store", () => ({
  loadPost: vi.fn(async (ref: { id: string } | { number: number }) => {
    await tick();
    const post = "id" in ref ? posts.get(ref.id) : [...posts.values()].find((p) => p.number === ref.number);
    return post ? withImport(clone(post)) : null;
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
    if ("fact_checks" in patch) {
      post.factChecks = patch.fact_checks as FactEntry[];
      updatedFactChecks.push(post.factChecks);
    }
    if ("suggestions" in patch) post.suggestions = patch.suggestions as EditorialPost["suggestions"];
  }),
  saveTranslation: vi.fn(async (post: EditorialPost, locale: string, fields: { bodyMd: string }) => {
    await tick();
    const target = posts.get(post.id)?.translations.find((t) => t.locale === locale);
    if (target) target.bodyMd = fields.bodyMd;
  }),
  setImportAcceptedHash: vi.fn(async (id: string, hash: string | null) => {
    await tick();
    const row = imports.get(id);
    if (row) row.acceptedHash = hash;
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
    if (failNextTranslationUpdate) {
      failNextTranslationUpdate = false;
      throw new Error("publish translations: connection reset");
    }
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
    if (!found || found.purpose !== "topic_confirm" || found.payload === null) return { status: "missing" };
    if (found.payload === "") return { status: "busy" };
    const topic = found.payload;
    found.payload = "";
    return { status: "taken", topic };
  }),
  loadImport: vi.fn(async (id: string) => {
    await tick();
    const row = imports.get(id);
    return row ? importRecord(row) : null;
  }),
  expireImports: vi.fn(async (chatId: number) => {
    for (const [id, row] of imports) {
      if (row.chatId === chatId && row.status !== "started" && row.updatedAt < Date.now() - 24 * 60 * 60 * 1000) imports.delete(id);
    }
  }),
  openImport: vi.fn(async (chatId: number) => {
    await tick();
    const row = [...imports.values()].reverse().find((r) => r.chatId === chatId && (r.status === "collecting" || r.status === "ready"));
    return row ? importRecord(row) : null;
  }),
  createImport: vi.fn(async (chatId: number) => {
    await tick();
    const id = `00000000-0000-4000-8000-${String(nextImport++).padStart(12, "0")}`;
    imports.set(id, {
      id, chatId, status: "collecting", postId: null, sourceText: null, language: null, sourceUrl: null, sourceLabel: null,
      sourceTextRu: null, createdAt: new Date().toISOString(), lastPartAt: null, updatedAt: Date.now(), parts: [],
    });
    return id;
  }),
  addImportPart: vi.fn(async (id: string, messageId: number, part: { kind: string; body: string; sourceUrl?: string; sourceLabel?: string }) => {
    await tick();
    const row = imports.get(id);
    if (!row || row.status !== "collecting") return { ok: false, reason: "closed" };
    const chars = row.parts.reduce((sum, p) => sum + p.body.length, 0);
    if (chars + part.body.length > 60_000) return { ok: false, reason: "too_long" };
    if (!row.parts.some((p) => p.messageId === messageId)) {
      row.parts.push({ messageId, kind: part.kind, body: part.body, sourceUrl: part.sourceUrl ?? null, sourceLabel: part.sourceLabel ?? null });
    }
    row.lastPartAt = new Date().toISOString();
    row.updatedAt = Date.now();
    return { ok: true, parts: row.parts.length, chars: row.parts.reduce((sum, p) => sum + p.body.length, 0) };
  }),
  importParts: vi.fn(async (id: string) => {
    await tick();
    return [...(imports.get(id)?.parts ?? [])].sort((a, b) => a.messageId - b.messageId);
  }),
  transitionImport: vi.fn(async (id: string, from: string[], patch: Record<string, unknown>) => {
    await tick();
    const row = imports.get(id);
    if (!row || !from.includes(row.status)) return false;
    if (patch.status) row.status = patch.status as FakeImport["status"];
    if ("post_id" in patch) row.postId = patch.post_id as string;
    if ("source_text" in patch) row.sourceText = patch.source_text as string;
    if ("language" in patch) row.language = patch.language as string;
    if ("mode" in patch) row.mode = patch.mode as "rewrite" | "prepare";
    if ("rights_confirmed_at" in patch) row.rightsConfirmedAt = patch.rights_confirmed_at as string;
    if ("source_url" in patch) row.sourceUrl = patch.source_url as string | null;
    if ("source_label" in patch) row.sourceLabel = patch.source_label as string;
    return true;
  }),
  deleteImport: vi.fn(async (id: string) => {
    await tick();
    const row = imports.get(id);
    if (!row || row.status === "started") return false;
    imports.delete(id);
    return true;
  }),
  listTopics: vi.fn(async () => []),
  listPosts: vi.fn(async () => []),
  postCostUsd: vi.fn(async () => 0),
  hasUndo: vi.fn(async () => false),
  undoLastChange: vi.fn(async () => []),
  deletePost: vi.fn(async (id: string) => {
    await tick();
    posts.delete(id);
  }),
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
    importInfo: null,
    suggestions: [],
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
  imports.clear();
  updatedFactChecks.length = 0;
  downloadedText = "";
  activeJobs.length = 0;
  failNextTranslationUpdate = false;
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
    // The second tap only answers the callback; the first tap's message is left alone.
    expect(answered.map((a) => a.text)).toContain("Уже обрабатывается");
    expect(edited.map((e) => e.text)).toEqual(["Тема: «Как найти дежурную аптеку на Кипре»"]);
  });

  it("a second tap after the draft was created answers «Уже обрабатывается» and edits nothing", async () => {
    await handleUpdate(textUpdate("Тема для повторного нажатия"));
    const confirmId = Number([...messages.keys()][0].split(":")[1]);
    await handleUpdate(callbackUpdate("newok", confirmId));
    const editsAfterFirst = edited.length;
    await handleUpdate(callbackUpdate("newok", confirmId));
    expect(posts.size).toBe(1);
    expect(edited).toHaveLength(editsAfterFirst);
    expect(answered.at(-1)?.text).toBe("Уже обрабатывается");
  });

  it("a tap on a confirmation that does not exist says the topic was not found", async () => {
    await handleUpdate(callbackUpdate("newok", 4242));
    expect(edited.map((e) => e.text)).toEqual(["Тема не найдена, напишите её ещё раз."]);
    expect(posts.size).toBe(0);
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

  it("two simultaneous taps on EL/AR start the job exclusively and report the duplicate", async () => {
    const post = reviewPost({ status: "published" });
    // The exclusive start (see pipeline.test.ts) lets the first request run and refuses the second.
    let started = 0;
    startJob.mockImplementation(async (...args: unknown[]) => {
      expect(args[3]).toEqual({ exclusive: true });
      started += 1;
      return started === 1
        ? { ok: true as const, jobId: 1 }
        : ({ ok: false, duplicate: true, reason: "Такое задание для этой статьи уже выполняется." } as never);
    });
    await Promise.all([handleUpdate(callbackUpdate(`tr:${post.number}`)), handleUpdate(callbackUpdate(`tr:${post.number}`))]);
    expect(jobsOfKind("translate")).toHaveLength(2);
    expect(texts().filter((t) => t.startsWith("🌍 Перевожу"))).toHaveLength(1);
    expect(texts().filter((t) => t.includes("уже идёт"))).toHaveLength(1);
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

  it("puts the post back when the texts cannot be published, and a retry then works", async () => {
    const post = reviewPost();
    failNextTranslationUpdate = true;
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    let after = posts.get(post.id)!;
    expect(after.status).toBe("review");
    expect(after.publishedAt).toBeNull();
    expect(after.lastError).toContain("connection reset");
    expect(texts().at(-1)).toContain("не опубликована");
    expect(startJob).not.toHaveBeenCalled();

    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    after = posts.get(post.id)!;
    expect(after.status).toBe("published");
    expect(after.translations.every((t) => t.status === "published")).toBe(true);
    expect(jobsOfKind("translate")).toHaveLength(1);
  });

  it("never publishes over blocking facts, even after «Да, публиковать»", async () => {
    const post = reviewPost({ factChecks: [] });
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("заблокирована");
    expect(startJob).not.toHaveBeenCalled();
  });
});

/* ---------- /import ---------- */

function forwardUpdate(text: string, channel = "Cyprus Health News") {
  const update = textUpdate(text);
  return { ...update, message: { ...update.message, forward_origin: { type: "channel", chat: { title: channel } } } };
}

function fileUpdate(name: string, replyTo: number) {
  const update = textUpdate("", replyTo);
  const message: Omit<typeof update.message, "text"> & { text?: string } = { ...update.message };
  delete message.text;
  return { ...update, message: { ...message, document: { file_id: "f1", file_name: name, mime_type: "text/plain", file_size: 100 } } };
}

/** The id of the last message the bot remembered for /import. */
function lastImportMessage(): number {
  const keys = [...messages.entries()].filter(([, value]) => value.purpose === "import").map(([key]) => Number(key.split(":")[1]));
  return keys.at(-1)!;
}

const onlyImport = () => [...imports.values()][0];

describe("/import: receiving material", () => {
  it("/import opens a collection and asks for the material", async () => {
    await handleUpdate(textUpdate("/import"));
    expect(imports.size).toBe(1);
    expect(sent[0].text).toContain("Импорт материала");
    expect(sent[0].forceReply).toBe(true);
  });

  it("takes text sent as a reply, then «Это весь текст» shows a summary", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Министерство объявило о реорганизации скорой помощи с 1 января 2027 года.", lastImportMessage()));
    expect(onlyImport().parts).toHaveLength(1);
    expect(texts().at(-1)).toContain("Часть 1 добавлена");
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain("impdone:");

    await handleUpdate(callbackUpdate(`impdone:${onlyImport().id}`, lastImportMessage()));
    expect(onlyImport().status).toBe("ready");
    expect(onlyImport().language).toBeNull();
    expect(texts().at(-1)).toContain("Материал собран");
    expect(texts().at(-1)).toContain("не указан");
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain("impru:");
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("imprw:");
  });

  it("joins a long text that Telegram split into several messages, in message order", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Первая часть длинного текста.", lastImportMessage()));
    await handleUpdate(textUpdate("Вторая часть, без ответа: Telegram разрезал сообщение."));
    expect(onlyImport().parts.map((p) => p.body)).toEqual(["Первая часть длинного текста.", "Вторая часть, без ответа: Telegram разрезал сообщение."]);
    await handleUpdate(callbackUpdate(`impdone:${onlyImport().id}`));
    expect(onlyImport().sourceText).toBe("Первая часть длинного текста.\n\nВторая часть, без ответа: Telegram разрезал сообщение.");
  });

  it("while collecting, every plain message goes into the import, however late", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Часть материала.", lastImportMessage()));
    onlyImport().lastPartAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await handleUpdate(textUpdate("Ещё кусок через десять минут."));
    expect(onlyImport().parts.map((p) => p.body)).toEqual(["Часть материала.", "Ещё кусок через десять минут."]);
    expect(texts().some((t) => t.startsWith("Написать статью на тему"))).toBe(false);
  });

  it("an import older than 24 hours does not take messages, even without a new /import", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Старый материал.", lastImportMessage()));
    onlyImport().updatedAt = Date.now() - 25 * 60 * 60 * 1000;
    await handleUpdate(textUpdate("Как найти дежурную аптеку"));
    expect(texts().at(-1)).toBe("Написать статью на тему «Как найти дежурную аптеку»?");
    expect(imports.size).toBe(0);
  });

  it("an import that is still fresh keeps taking messages", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Материал.", lastImportMessage()));
    onlyImport().updatedAt = Date.now() - 23 * 60 * 60 * 1000;
    await handleUpdate(textUpdate("Продолжение материала."));
    expect(onlyImport().parts).toHaveLength(2);
  });

  it("while collecting, commands and replies to other bot messages work as before", async () => {
    const post = reviewPost();
    messages.set(`${ADMIN}:900`, { postId: post.id, purpose: "edit_prompt", slot: null, payload: null });
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("/help"));
    expect(texts().at(-1)).toContain("Ничего не публикуется без вашей кнопки");
    await handleUpdate(textUpdate("Сократи вступление", 900));
    expect(jobsOfKind("edit")).toHaveLength(1);
    expect(onlyImport().parts).toHaveLength(0);
  });

  it("after «Это весь текст» or «Отменить» plain messages are topics again", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Материал.", lastImportMessage()));
    await handleUpdate(callbackUpdate(`impdone:${onlyImport().id}`));
    await handleUpdate(textUpdate("Как найти дежурную аптеку"));
    expect(onlyImport().parts).toHaveLength(1);
    expect(texts().at(-1)).toBe("Написать статью на тему «Как найти дежурную аптеку»?");

    await handleUpdate(callbackUpdate(`impcancel:${onlyImport().id}`));
    expect(imports.size).toBe(0);
    await handleUpdate(textUpdate("Что такое ГеСИ"));
    expect(texts().at(-1)).toBe("Написать статью на тему «Что такое ГеСИ»?");
  });

  it("takes a forwarded post while collecting, and leaves forwards alone otherwise", async () => {
    await handleUpdate(forwardUpdate("Пост из канала о скорой помощи."));
    expect(texts().at(-1)).toContain("Написать статью на тему");
    expect(imports.size).toBe(0);

    await handleUpdate(textUpdate("/import"));
    await handleUpdate(forwardUpdate("Пост из канала о скорой помощи."));
    expect(onlyImport().parts[0]).toMatchObject({ kind: "forward", sourceLabel: "пересланное сообщение из «Cyprus Health News»" });
  });

  it("reads a page behind a link, and explains when the site refuses", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("https://news.example.com/ambulance", lastImportMessage()));
    expect(onlyImport().parts[0]).toMatchObject({ kind: "url", sourceUrl: "https://news.example.com/ambulance" });

    await handleUpdate(textUpdate("https://www.gov.cy/moh/announcement", lastImportMessage()));
    expect(onlyImport().parts).toHaveLength(1);
    expect(texts().at(-1)).toContain("Не получилось прочитать страницу");
    expect(texts().at(-1)).toContain("Вставьте текст");
  });

  it("reads a .txt file sent as a reply", async () => {
    downloadedText = "Текст из файла о реорганизации.";
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(fileUpdate("news.txt", lastImportMessage()));
    expect(onlyImport().parts[0]).toMatchObject({ kind: "file", body: "Текст из файла о реорганизации." });
  });

  it("refuses a part that would make the material too long", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("а".repeat(59_990), lastImportMessage()));
    await handleUpdate(textUpdate("б".repeat(100), lastImportMessage()));
    expect(onlyImport().parts).toHaveLength(1);
    expect(texts().at(-1)).toContain("длиннее 60000 символов");
  });

  it("offers to continue, restart or cancel an unfinished import, and never mixes their parts", async () => {
    await handleUpdate(textUpdate("/import"));
    const firstPrompt = lastImportMessage();
    await handleUpdate(textUpdate("Материал А.", firstPrompt));
    const first = onlyImport().id;

    await handleUpdate(textUpdate("/import"));
    expect(texts().at(-1)).toContain("незавершённый импорт");
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain(`imprestart:${first}`);

    await handleUpdate(callbackUpdate(`imprestart:${first}`));
    expect(imports.has(first)).toBe(false);
    const second = onlyImport().id;
    // A late reply to the old import's prompt does not land in the new one.
    await handleUpdate(textUpdate("Ещё к материалу А.", firstPrompt));
    expect(imports.get(second)!.parts).toHaveLength(0);
    expect(texts().at(-1)).toContain("уже закрыт");

    await handleUpdate(callbackUpdate(`impcancel:${second}`));
    expect(imports.size).toBe(0);
  });
});

describe("/import: starting the article", () => {
  async function readyImport(text = "Министерство объявило о реорганизации скорой помощи с 1 января 2027 года.") {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate(text, lastImportMessage()));
    await handleUpdate(callbackUpdate(`impdone:${onlyImport().id}`));
    await handleUpdate(callbackUpdate(`impru:${onlyImport().id}`));
    return onlyImport().id;
  }

  it("does not start without a language: the start button is hidden and a tap is refused", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Материал.", lastImportMessage()));
    const id = onlyImport().id;
    await handleUpdate(callbackUpdate(`impdone:${id}`));
    await handleUpdate(callbackUpdate(`imprw:${id}`));
    expect(answered.at(-1)?.text).toBe("Сначала выберите язык оригинала");
    expect(posts.size).toBe(0);
    expect(jobsOfKind("rewrite")).toHaveLength(0);
    expect(onlyImport().status).toBe("ready");
  });

  it("the button sets the language, shows it in the summary, and it can be changed before the start", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Material in English.", lastImportMessage()));
    const id = onlyImport().id;
    await handleUpdate(callbackUpdate(`impdone:${id}`));
    await handleUpdate(callbackUpdate(`impen:${id}`, 700));
    expect(onlyImport().language).toBe("en");
    expect(edited.at(-1)).toMatchObject({ messageId: 700 });
    expect(edited.at(-1)!.text).toContain("язык оригинала: <b>English</b>");
    await handleUpdate(callbackUpdate(`impuk:${id}`, 700));
    expect(onlyImport().language).toBe("uk");
    expect(edited.at(-1)!.text).toContain("Українська");
    await handleUpdate(callbackUpdate(`imprw:${id}`));
    expect(jobsOfKind("rewrite")).toHaveLength(1);
    // After the start the choice is closed.
    await handleUpdate(callbackUpdate(`impru:${id}`));
    expect(onlyImport().language).toBe("uk");
  });

  it("«Другой язык» asks for a name; the reply is saved and shown", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Tekst po polsku.", lastImportMessage()));
    const id = onlyImport().id;
    await handleUpdate(callbackUpdate(`impdone:${id}`));
    await handleUpdate(callbackUpdate(`impother:${id}`));
    expect(sent.at(-1)!.forceReply).toBe(true);
    expect(texts().at(-1)).toContain("название языка");
    await handleUpdate(textUpdate("польский", lastImportMessage()));
    expect(onlyImport().language).toBe("other:польский");
    expect(texts().at(-1)).toContain("язык оригинала: <b>польский</b>");
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain("imprw:");
    expect(onlyImport().parts).toHaveLength(1);
  });

  it("«Рерайт + фактчек» creates one draft and queues a rewrite job for this material", async () => {
    const id = await readyImport();
    await handleUpdate(callbackUpdate(`imprw:${id}`));
    expect(posts.size).toBe(1);
    const post = [...posts.values()][0];
    expect(post.topic).toBe("Импорт: Министерство объявило о реорганизации скорой помощи с 1 января 2027 года.");
    expect(onlyImport()).toMatchObject({ status: "started", postId: post.id });
    expect(jobsOfKind("rewrite")).toEqual([[post.id, "rewrite", { importId: id }]]);
  });

  it("two simultaneous taps create one draft and one job", async () => {
    const id = await readyImport();
    await Promise.all([handleUpdate(callbackUpdate(`imprw:${id}`)), handleUpdate(callbackUpdate(`imprw:${id}`))]);
    expect(posts.size).toBe(1);
    expect(jobsOfKind("rewrite")).toHaveLength(1);
    expect(answered.map((a) => a.text)).toContain("Уже обрабатывается");
  });

  it("two simultaneous «Это весь текст» taps show one summary", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate("Материал.", lastImportMessage()));
    const id = onlyImport().id;
    await Promise.all([handleUpdate(callbackUpdate(`impdone:${id}`)), handleUpdate(callbackUpdate(`impdone:${id}`))]);
    expect(texts().filter((t) => t.includes("Материал собран"))).toHaveLength(1);
  });

  it("«Написать заново» on a failed imported draft rewrites from the same material", async () => {
    const id = await readyImport();
    startJob.mockImplementationOnce(async () => ({ ok: false, reason: "Дневной лимит новых статей (5) исчерпан." }) as never);
    await handleUpdate(callbackUpdate(`imprw:${id}`));
    const post = [...posts.values()][0];
    expect(post.status).toBe("failed");
    await handleUpdate(callbackUpdate(`retry:${post.number}`));
    expect(jobsOfKind("rewrite").at(-1)).toEqual([post.id, "rewrite", { importId: id }]);
    expect(jobsOfKind("write")).toHaveLength(0);
  });
});

describe("/import: checks of the imported draft", () => {
  const MATERIAL_URL = "https://news.example.com/ambulance";

  function importedPost(overrides: Partial<EditorialPost> = {}, sourceText = "Короткий материал о скорой помощи.") {
    const post = reviewPost(overrides);
    imports.set("imp-1", {
      id: "imp-1", chatId: ADMIN, status: "started", postId: post.id, sourceText, language: "ru", sourceUrl: MATERIAL_URL,
      sourceLabel: `ссылка ${MATERIAL_URL}`, sourceTextRu: null, createdAt: "", lastPartAt: null, updatedAt: 0, parts: [],
    });
    return post;
  }

  it("blocks publication when the article copies the material", async () => {
    const copied = "Министерство здравоохранения объявило о реорганизации службы скорой помощи с 1 января 2027 года, и все бригады перейдут под единое управление из одного центра.";
    const post = importedPost(
      { translations: [{ ...translation("ru"), bodyMd: `## Коротко\n\n- Пункт.\n\n${copied}\n\n${"слово ".repeat(300)}` }, translation("en")] },
      copied,
    );
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("слишком близок к исходному материалу");
  });

  it("does not count the material itself as a primary source for a critical fact", async () => {
    const fact = { ...confirmedFact(), sourceUrl: MATERIAL_URL, id: "from-material" };
    const post = importedPost({ factChecks: [fact] });
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("важных не подтверждены");
  });

  it("checks figures in the FAQ of an imported draft", async () => {
    const ru = { ...translation("ru"), faq: [{ question: "Когда?", answer: "С 1 января 2027 года, время прибытия 18 минут." }] };
    const post = importedPost({ translations: [ru, translation("en")] });
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
  });

  it("an ordinary draft keeps the old rules: FAQ figures are not checked", async () => {
    const ru = { ...translation("ru"), faq: [{ question: "Когда?", answer: "С 1 января 2027 года, время прибытия 18 минут." }] };
    const post = reviewPost({ translations: [ru, translation("en")] });
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("published");
  });
});

describe("/import: a fact that contradicts its source", () => {
  function conflictPost() {
    const fact: FactEntry = {
      ...confirmedFact(),
      id: "conflict-1",
      claim: "Реорганизация начнётся 1 января 2027 года.",
      conflict: "в материале 1 января 2027, на сайте министерства — 1 марта 2027",
      suggestedFix: "Реорганизация планируется с 1 марта 2027 года.",
    };
    return reviewPost({ factChecks: [fact] });
  }

  it("blocks publication even though its quote was found", async () => {
    const post = conflictPost();
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
  });

  it("✏️ applies the proposed correction as an ordinary AI edit", async () => {
    const post = conflictPost();
    await handleUpdate(callbackUpdate(`ffx:${post.number}:conflict-1`));
    expect(jobsOfKind("edit")).toHaveLength(1);
    expect(String((jobsOfKind("edit")[0][2] as { instruction: string }).instruction)).toContain("Реорганизация планируется с 1 марта 2027 года.");
  });

  it("✅ needs a link and a written reason; a link alone does not unblock", async () => {
    const post = conflictPost();
    await handleUpdate(callbackUpdate(`fok:${post.number}:conflict-1`));
    const prompt = Number([...messages.entries()].find(([, v]) => v.slot === "fact|conflict-1")![0].split(":")[1]);
    expect(texts().at(-1)).toContain("Противоречит источнику");

    await handleUpdate(textUpdate("https://www.gov.cy/moh/schedule", prompt));
    expect(posts.get(post.id)!.factChecks[0].manual).toBeNull();
    expect(texts().at(-1)).toContain("только с объяснением");

    await handleUpdate(textUpdate("https://www.gov.cy/moh/schedule на сайте обновили дату, материал устарел", prompt));
    expect(updatedFactChecks.at(-1)?.[0].manual).toMatchObject({
      sourceUrl: "https://www.gov.cy/moh/schedule",
      reason: "на сайте обновили дату, материал устарел",
    });
  });
});

describe("/import, mode B: «Без рерайта»", () => {
  const SOURCE = "Скорая помощь на Кипре работает круглосуточно. Вызов бесплатный.";

  async function summary(text: string, language: "impru" | "impen") {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate(text, lastImportMessage()));
    const id = onlyImport().id;
    await handleUpdate(callbackUpdate(`impdone:${id}`));
    await handleUpdate(callbackUpdate(`${language}:${id}`));
    return id;
  }

  it("shows the second button only after a language is chosen, and refuses a tap without one", async () => {
    await handleUpdate(textUpdate("/import"));
    await handleUpdate(textUpdate(SOURCE, lastImportMessage()));
    const id = onlyImport().id;
    await handleUpdate(callbackUpdate(`impdone:${id}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("impb:");
    await handleUpdate(callbackUpdate(`impb:${id}`));
    expect(answered.at(-1)?.text).toBe("Сначала выберите язык оригинала");
    await handleUpdate(callbackUpdate(`impru:${id}`, 700));
    expect(JSON.stringify(edited.at(-1)!.keyboard)).toContain(`impb:${id}`);
  });

  it("warns about the rights first and starts nothing until «Права есть» is pressed", async () => {
    const id = await summary(SOURCE, "impru");
    await handleUpdate(callbackUpdate(`impb:${id}`));
    expect(edited.at(-1)!.text).toContain("только материал, на который у редакции есть права");
    expect(JSON.stringify(edited.at(-1)!.keyboard)).toContain(`impbok:${id}`);
    expect(posts.size).toBe(0);
    expect(jobsOfKind("prepare")).toHaveLength(0);
    // «Назад» returns to the summary with both start buttons.
    await handleUpdate(callbackUpdate(`impbback:${id}`));
    expect(JSON.stringify(edited.at(-1)!.keyboard)).toContain(`impb:${id}`);
    expect(onlyImport().status).toBe("ready");
  });

  it("tells the editor that a foreign text will be translated exactly before the launch", async () => {
    const id = await summary("Calls to 112 are free.", "impen");
    await handleUpdate(callbackUpdate(`impb:${id}`));
    expect(edited.at(-1)!.text).toContain("переведёт его на русский точно по смыслу");
    expect(edited.at(-1)!.text).toContain("English");
  });

  it("«Права есть» creates one draft, stores the confirmation date and queues a prepare job", async () => {
    const id = await summary(SOURCE, "impru");
    await handleUpdate(callbackUpdate(`impbok:${id}`));
    expect(posts.size).toBe(1);
    const post = [...posts.values()][0];
    expect(onlyImport()).toMatchObject({ status: "started", mode: "prepare", postId: post.id });
    expect(Date.parse(onlyImport().rightsConfirmedAt!)).toBeGreaterThan(0);
    expect(jobsOfKind("prepare")).toEqual([[post.id, "prepare", { importId: id }]]);
    expect(jobsOfKind("rewrite")).toHaveLength(0);
  });

  it("two simultaneous confirmations create one draft and one job", async () => {
    const id = await summary(SOURCE, "impru");
    await Promise.all([handleUpdate(callbackUpdate(`impbok:${id}`)), handleUpdate(callbackUpdate(`impbok:${id}`))]);
    expect(posts.size).toBe(1);
    expect(jobsOfKind("prepare")).toHaveLength(1);
  });

  it("refuses a text longer than the mode's limit and suggests the alternatives", async () => {
    const id = await summary("а".repeat(25_100), "impru");
    await handleUpdate(callbackUpdate(`impb:${id}`));
    expect(texts().at(-1)).toContain("длиннее 25000 символов");
    expect(posts.size).toBe(0);
  });

  it("«Написать заново» on a failed mode B draft prepares it again, not rewrites it", async () => {
    const id = await summary(SOURCE, "impru");
    startJob.mockImplementationOnce(async () => ({ ok: false, reason: "Дневной лимит новых статей (5) исчерпан." }) as never);
    await handleUpdate(callbackUpdate(`impbok:${id}`));
    const post = [...posts.values()][0];
    expect(post.status).toBe("failed");
    await handleUpdate(callbackUpdate(`retry:${post.number}`));
    expect(jobsOfKind("prepare").at(-1)).toEqual([post.id, "prepare", { importId: id }]);
    expect(jobsOfKind("rewrite")).toHaveLength(0);
  });
});

describe("mode B: suggestions, comparison and confirmation", () => {
  const FILLER = "слово ".repeat(60);
  const BODY = `## Коротко\n\n- Вызов бесплатный.\n\nСкорая помощь работает в среднем за 18 минут. ${FILLER}\n\nДежурная аптека работает до 22:00.`;
  const SOURCE = BODY.replace("## Коротко\n\n- Вызов бесплатный.\n\n", "");

  function preparedPost(info: Partial<FakeImport> = {}, suggestions: EditorialPost["suggestions"] = []) {
    const post = reviewPost({ translations: [{ ...translation("ru"), bodyMd: BODY }, translation("en")], suggestions });
    imports.set("imp-b", {
      id: "imp-b", chatId: ADMIN, status: "started", postId: post.id, sourceText: SOURCE, language: "ru", sourceUrl: null,
      sourceLabel: "текст от редактора", sourceTextRu: null, mode: "prepare", createdAt: "", lastPartAt: null, updatedAt: 0, parts: [], ...info,
    });
    return post;
  }
  const suggestion = (overrides = {}) => ({ id: "s1", before: "в среднем за 18 минут", after: "примерно за 18 минут", reason: "точнее", status: "pending" as const, ...overrides });

  it("the card offers «Предложения» only while some are pending", async () => {
    const withPending = preparedPost({}, [suggestion()]);
    await handleUpdate(callbackUpdate(`open:${withPending.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain(`sug:${withPending.number}`);
    expect(sent.at(-1)!.text).toContain("без рерайта");
    const none = preparedPost({}, [suggestion({ status: "rejected" })]);
    await handleUpdate(callbackUpdate(`open:${none.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("sug:");
  });

  it("accepting a suggestion replaces exactly that fragment, marks English outdated and keeps the preservation check green", async () => {
    const post = preparedPost({}, [suggestion()]);
    await handleUpdate(callbackUpdate(`sugok:${post.number}:s1`));
    const saved = posts.get(post.id)!;
    expect(saved.translations[0].bodyMd).toContain("работает примерно за 18 минут.");
    expect(saved.translations[0].bodyMd).not.toContain("в среднем за 18 минут");
    expect(saved.suggestions[0].status).toBe("accepted");
    expect(saved.translations.find((t) => t.locale === "en")!.status).toBe("draft");
    // The confirmation of the card is not needed: the accepted suggestion explains the change.
    await handleUpdate(callbackUpdate(`open:${post.number}`));
    expect(sent.at(-1)!.text).toContain("Текст автора сохранён");
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("prv:");
  });

  it("a suggestion whose fragment has changed is not applied, and a repeated tap does nothing", async () => {
    const post = preparedPost({}, [suggestion({ before: "такого фрагмента нет" })]);
    await handleUpdate(callbackUpdate(`sugok:${post.number}:s1`));
    expect(answered.at(-1)?.text).toBe("Этот фрагмент уже изменился");
    expect(posts.get(post.id)!.suggestions[0].status).toBe("pending");
    const done = preparedPost({}, [suggestion({ status: "accepted" })]);
    await handleUpdate(callbackUpdate(`sugok:${done.number}:s1`));
    expect(answered.at(-1)?.text).toBe("Это предложение уже обработано");
  });

  it("rejecting leaves the text untouched", async () => {
    const post = preparedPost({}, [suggestion()]);
    await handleUpdate(callbackUpdate(`sugno:${post.number}:s1`));
    expect(posts.get(post.id)!.translations[0].bodyMd).toBe(BODY);
    expect(posts.get(post.id)!.suggestions[0].status).toBe("rejected");
  });

  it("a manual change of the author's text blocks publication until the editor confirms the places", async () => {
    const post = preparedPost();
    posts.get(post.id)!.translations[0].bodyMd = BODY.replace("до 22:00", "до 21:00");
    await handleUpdate(callbackUpdate(`pubok:${post.number}`));
    expect(posts.get(post.id)!.status).toBe("review");
    expect(texts().at(-1)).toContain("Текст автора изменён");
    await handleUpdate(callbackUpdate(`open:${post.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain(`prv:${post.number}`);
    await handleUpdate(callbackUpdate(`prv:${post.number}`));
    expect(imports.get("imp-b")!.acceptedHash).toBeTruthy();
    await handleUpdate(callbackUpdate(`open:${post.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("prv:");
    expect(sent.at(-1)!.text).toContain("расхождения с оригиналом проверены");
  });

  it("«Сравнить с оригиналом» sends the paragraph pairs of a translated text", async () => {
    const pairs = [{ o: "Calls to 112 are free.", t: "Звонки на 112 бесплатны." }];
    const post = preparedPost({ language: "en", prepared: { pairs, text: pairs[0].t } });
    await handleUpdate(callbackUpdate(`open:${post.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).toContain(`cmp:${post.number}`);
    await handleUpdate(callbackUpdate(`cmp:${post.number}`));
    expect(texts().at(-1)).toContain("ОРИГИНАЛ:\nCalls to 112 are free.");
    expect(texts().at(-1)).toContain("ПЕРЕВОД:\nЗвонки на 112 бесплатны.");
    const russian = preparedPost();
    await handleUpdate(callbackUpdate(`open:${russian.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("cmp:");
  });

  it("never offers or applies an automatic correction of the author's text for a fact conflict", async () => {
    const post = preparedPost();
    posts.get(post.id)!.factChecks = [{ ...confirmedFact(), id: "c1", state: "quote_not_found", conflict: "источник говорит 20 минут", suggestedFix: "за 20 минут" } as never];
    await handleUpdate(callbackUpdate(`facts:${post.number}`));
    expect(JSON.stringify(sent.at(-1)!.keyboard)).not.toContain("ffx:");
    await handleUpdate(callbackUpdate(`ffx:${post.number}:c1`));
    expect(texts().at(-1)).toContain("текст автора не правится автоматически");
    expect(jobsOfKind("edit")).toHaveLength(0);
  });
});
