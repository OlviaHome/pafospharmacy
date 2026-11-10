import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setWebhookMock, webhookInfoMock } = vi.hoisted(() => ({
  setWebhookMock: vi.fn(),
  webhookInfoMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/editorial/telegram", () => ({ setWebhook: setWebhookMock, webhookInfo: webhookInfoMock }));
vi.mock("@/lib/editorial/store", () => ({
  adminClient: () => ({
    from: () => ({ select: async () => ({ error: null }) }),
    storage: { getBucket: async () => ({ error: null }) },
  }),
}));

import { GET, POST } from "./route";

const WEBHOOK_SECRET = "webhook_secret_0123456789abcdef";
const SETUP_KEY = "setup_key_0123456789abcdef_xyz";

function request(path = "/api/telegram/setup", headers: Record<string, string> = {}, method = "GET") {
  return new Request(`https://healthguide.cy${path}`, { method, headers });
}

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", "123456789");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("TELEGRAM_SETUP_KEY", SETUP_KEY);
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
  vi.stubEnv("SITE_URL", "https://healthguide.cy");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  webhookInfoMock.mockResolvedValue({ url: "https://healthguide.cy/api/telegram/webhook", pending_update_count: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Telegram setup route", () => {
  it("answers strangers with an empty 404 and registers nothing", async () => {
    for (const response of [
      await GET(request()),
      await POST(request("/api/telegram/setup", {}, "POST")),
      await GET(request("/api/telegram/setup?key=wrong_key_0123456789abcdef")),
      await GET(request("/api/telegram/setup", { Authorization: "Bearer wrong_key_0123456789abcdef" })),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(setWebhookMock).not.toHaveBeenCalled();
  });

  it("never accepts the webhook secret in the URL", async () => {
    const response = await GET(request(`/api/telegram/setup?key=${WEBHOOK_SECRET}`));
    expect(response.status).toBe(404);
    expect(setWebhookMock).not.toHaveBeenCalled();
  });

  it("is disabled for browser links when no setup key is configured", async () => {
    vi.stubEnv("TELEGRAM_SETUP_KEY", "");
    expect((await GET(request(`/api/telegram/setup?key=${SETUP_KEY}`))).status).toBe(404);
  });

  it("runs for the setup key in the link or either key in the Authorization header", async () => {
    for (const authorized of [
      request(`/api/telegram/setup?key=${SETUP_KEY}`),
      request("/api/telegram/setup", { Authorization: `Bearer ${SETUP_KEY}` }, "POST"),
      request("/api/telegram/setup", { Authorization: `Bearer ${WEBHOOK_SECRET}` }, "POST"),
    ]) {
      const response = authorized.method === "POST" ? await POST(authorized) : await GET(authorized);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain('"telegram_webhook"');
      for (const secret of [WEBHOOK_SECRET, SETUP_KEY, "sk-test", "sb_secret_x", "123:abc"]) {
        expect(body).not.toContain(secret);
      }
    }
    expect(setWebhookMock).toHaveBeenCalledWith("https://healthguide.cy/api/telegram/webhook", WEBHOOK_SECRET);
  });
});
