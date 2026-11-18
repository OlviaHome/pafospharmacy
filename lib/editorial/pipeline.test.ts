import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorialPost } from "./store";

/*
 * Behaviour tests for the job runner: what writing an article stores and which follow-up job it
 * queues, and that a job is never run twice. OpenAI, Supabase and the runner route are fakes.
 */

vi.mock("server-only", () => ({}));

const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));

const callResponses = vi.fn();
vi.mock("@/lib/editorial/openai", () => ({
  callResponses: (...args: unknown[]) => callResponses(...args),
  OpenAiError: class OpenAiError extends Error {},
}));
vi.mock("@/lib/editorial/images", () => ({
  searchStock: vi.fn(async () => null),
  materializeStock: vi.fn(),
  removeStoredImage: vi.fn(),
}));
vi.mock("@/lib/editorial/links", () => ({
  checkSourceLinks: vi.fn(async (urls: string[]) =>
    urls.map((url) => ({ url, state: "ok", status: 200, checkedAt: "2026-11-18T00:00:00Z" })),
  ),
}));
vi.mock("@/lib/editorial/source-text", () => ({
  verifyClaims: vi.fn(async () => [{ id: "f1", kind: "claim", claim: "c", state: "quote_found" }]),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => Promise<any>;
const fake = (impl: AnyFn = async () => undefined) => vi.fn<AnyFn>(impl);
/* eslint-enable @typescript-eslint/no-explicit-any */

const store = {
  claimJob: fake(),
  enqueueJob: fake(async () => 42),
  failStaleJobs: fake(),
  finishJob: fake(),
  loadPost: fake(),
  recordUsage: fake(),
  saveTranslation: fake(),
  setTranslationStatus: fake(),
  updatePost: fake(),
  uniqueSlug: fake(async (base: string) => ({ slug: base, takenBy: null })),
  upsertImage: fake(),
  usageSnapshot: fake(async () => ({ activeJobs: 0, jobsToday: 0, articlesToday: 0, spentThisMonthUsd: 0 })),
};
vi.mock("@/lib/editorial/store", () => store);

const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));

const { runJob, dispatchJob, setNotifier } = await import("./pipeline");

function post(overrides: Partial<EditorialPost> = {}): EditorialPost {
  return {
    id: "post-1",
    number: 1,
    slug: "draft-1",
    topic: "Как найти дежурную аптеку",
    status: "generating",
    previewToken: "t",
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

const ARTICLE = {
  slug: "duty-pharmacy-cyprus",
  title: "Как найти дежурную аптеку",
  description: "D".repeat(140),
  body_md: "## Коротко\n\n- Пункт\n\n## Раздел\n\nТекст.",
  faq: [{ question: "Q?", answer: "A." }],
  sources: [{ title: "GeSY", url: "https://www.gesy.org.cy/en-us/" }],
  images: [{ slot: "cover", kind: "stock", search_query: "pharmacy", alt: "Аптека", note: "" }],
  claims: [{ claim: "c", importance: "critical", source_url: "https://www.gesy.org.cy/en-us/", quote: "quote text here" }],
  editor_notes: "Проверьте часы.",
};

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", "709466772");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret-test-secret");
  vi.stubEnv("SITE_URL", "https://healthguide.cy");
  vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "true");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubGlobal("fetch", fetchMock);
  for (const fn of Object.values(store)) fn.mockClear();
  fetchMock.mockClear();
  callResponses.mockReset();
  afterCallbacks.length = 0;
  store.loadPost.mockResolvedValue(post());
  setNotifier({ card: vi.fn(async () => undefined), translations: vi.fn(async () => undefined), failure: vi.fn(async () => undefined) });
});

describe("writing an article", () => {
  it("stores the Russian draft, checks, notes and queues the English translation", async () => {
    store.claimJob.mockResolvedValue({ id: 7, postId: "post-1", kind: "write", status: "running", payload: {} });
    callResponses.mockResolvedValue({
      data: ARTICLE,
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, webSearchCalls: 0 },
      costUsd: 0.1,
      citedUrls: ["https://www.gesy.org.cy/en-us/"],
    });

    await runJob(7);

    expect(callResponses).toHaveBeenCalledTimes(1);
    expect(callResponses.mock.calls[0][0]).toMatchObject({ input: "Тема статьи от редактора: «Как найти дежурную аптеку»" });
    expect(store.recordUsage).toHaveBeenCalledWith(7, expect.any(String), expect.any(Object), 0.1);
    expect(store.saveTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "post-1" }),
      "ru",
      expect.objectContaining({ title: ARTICLE.title, sources: ARTICLE.sources }),
      "review",
      expect.any(String),
      "generated",
    );
    const patches = store.updatePost.mock.calls.map((call) => call[1]);
    expect(patches).toContainEqual({ source_checks: [expect.objectContaining({ url: ARTICLE.sources[0].url, state: "ok" })] });
    expect(patches).toContainEqual({ fact_checks: [expect.objectContaining({ id: "f1" })] });
    expect(patches).toContainEqual({ slug: "duty-pharmacy-cyprus", last_error: null, editor_notes: "Проверьте часы." });

    // The English translation is queued and handed to the runner route with the same batch.
    const batchId = store.saveTranslation.mock.calls[0][4];
    expect(store.enqueueJob).toHaveBeenCalledWith("post-1", "translate", { locales: ["en"], batchId, notify: "card" });
    expect(fetchMock).toHaveBeenCalledWith("https://healthguide.cy/api/editorial/run", expect.objectContaining({ method: "POST" }));
    expect(store.finishJob).toHaveBeenCalledWith(7, "done");
  });

  it("marks the article failed when OpenAI fails before any text exists", async () => {
    store.claimJob.mockResolvedValue({ id: 8, postId: "post-1", kind: "write", status: "running", payload: {} });
    callResponses.mockRejectedValue(new Error("OpenAI 500"));
    await runJob(8);
    expect(store.finishJob).toHaveBeenCalledWith(8, "failed", "OpenAI 500");
    expect(store.updatePost).toHaveBeenCalledWith("post-1", { last_error: "OpenAI 500", status: "failed" });
    expect(store.enqueueJob).not.toHaveBeenCalled();
  });
});

describe("editing an article", () => {
  it("stores the revision, keeps existing images, marks EL/AR outdated and queues English", async () => {
    const image = { slot: "cover", url: "https://x/cover.jpg", alt: { ru: "Старая" }, triedPhotoIds: [] };
    store.loadPost.mockResolvedValue(
      post({
        status: "generating",
        images: [image as never],
        translations: ["ru", "en", "el"].map((locale) => ({
          locale,
          status: "review",
          title: "T",
          description: "D",
          bodyMd: "## Коротко\n\n- a",
          faq: [],
          sources: [],
          publishedAt: null,
          updatedAt: "",
        })) as never,
      }),
    );
    store.claimJob.mockResolvedValue({ id: 12, postId: "post-1", kind: "edit", status: "running", payload: { instruction: "Сократи" } });
    callResponses.mockResolvedValue({
      data: ARTICLE,
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, webSearchCalls: 0 },
      costUsd: 0.05,
      citedUrls: [],
    });

    await runJob(12);

    expect(store.saveTranslation.mock.calls[0][5]).toBe("edit: Сократи");
    expect(store.upsertImage).toHaveBeenCalledWith("post-1", "cover", { alt: { ru: "Аптека" } });
    expect(store.setTranslationStatus).toHaveBeenCalledWith("post-1", ["el"], "draft");
    const patches = store.updatePost.mock.calls.map((call) => call[1]);
    expect(patches).toContainEqual(expect.objectContaining({ status: "review", last_error: null }));
    expect(patches.some((patch) => patch && "slug" in patch)).toBe(false);
    const batchId = store.saveTranslation.mock.calls[0][4];
    expect(store.enqueueJob).toHaveBeenCalledWith("post-1", "translate", { locales: ["en"], batchId, notify: "card" });
    expect(store.finishJob).toHaveBeenCalledWith(12, "done");
  });
});

describe("running a job only once", () => {
  it("does nothing when the job was already claimed (retry after a timeout)", async () => {
    store.claimJob.mockResolvedValue(null);
    await runJob(9);
    expect(callResponses).not.toHaveBeenCalled();
    expect(store.saveTranslation).not.toHaveBeenCalled();
    expect(store.finishJob).not.toHaveBeenCalled();
  });

  it("falls back to running in this invocation when the runner route does not answer 202", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await dispatchJob(11);
    expect(afterCallbacks).toHaveLength(1);
  });
});
