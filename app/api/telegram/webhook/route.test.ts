import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handleUpdateMock, markUpdateProcessedMock } = vi.hoisted(() => ({
  handleUpdateMock: vi.fn(),
  markUpdateProcessedMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/editorial/bot", () => ({ handleUpdate: handleUpdateMock }));
vi.mock("@/lib/editorial/store", () => ({ markUpdateProcessed: markUpdateProcessedMock }));

import { POST } from "./route";

const SECRET = "test_webhook_secret_0123456789";
const ADMIN = "123456789";

function request(body: unknown, secret: string | null = SECRET) {
  return new Request("https://healthguide.cy/api/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }),
    },
    body: JSON.stringify(body),
  });
}

function textUpdate(fromId: number, updateId = 1) {
  return {
    update_id: updateId,
    message: { message_id: 10, from: { id: fromId }, chat: { id: fromId, type: "private" }, text: "/new тема" },
  };
}

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", ADMIN);
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
  markUpdateProcessedMock.mockResolvedValue(true);
  handleUpdateMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Telegram webhook", () => {
  it("rejects a request without the secret header", async () => {
    const response = await POST(request(textUpdate(Number(ADMIN)), null));
    expect(response.status).toBe(401);
    expect(handleUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const response = await POST(request(textUpdate(Number(ADMIN)), "wrong_secret_but_long_enough"));
    expect(response.status).toBe(401);
    expect(markUpdateProcessedMock).not.toHaveBeenCalled();
  });

  it("silently ignores anyone who is not the admin", async () => {
    const response = await POST(request(textUpdate(42)));
    expect(response.status).toBe(200);
    expect(markUpdateProcessedMock).not.toHaveBeenCalled();
    expect(handleUpdateMock).not.toHaveBeenCalled();
  });

  it("handles an admin update once", async () => {
    const response = await POST(request(textUpdate(Number(ADMIN))));
    expect(response.status).toBe(200);
    expect(handleUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("does not handle a redelivered update twice", async () => {
    markUpdateProcessedMock.mockResolvedValue(false);
    await POST(request(textUpdate(Number(ADMIN))));
    expect(handleUpdateMock).not.toHaveBeenCalled();
  });

  it("fails closed when the configuration is missing or invalid", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_ID", "");
    expect((await POST(request(textUpdate(Number(ADMIN))))).status).toBe(503);
    vi.stubEnv("TELEGRAM_ADMIN_ID", "not-a-number");
    expect((await POST(request(textUpdate(Number(ADMIN))))).status).toBe(503);
    vi.stubEnv("TELEGRAM_ADMIN_ID", ADMIN);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "short");
    expect((await POST(request(textUpdate(Number(ADMIN)), "short"))).status).toBe(503);
    expect(handleUpdateMock).not.toHaveBeenCalled();
  });
});
