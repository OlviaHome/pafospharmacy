import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startMock, sendMock } = vi.hoisted(() => ({ startMock: vi.fn(), sendMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/editorial/pipeline", () => ({ startScoutJob: startMock }));
vi.mock("@/lib/editorial/telegram", () => ({ sendMessage: sendMock }));

import { GET } from "./route";

const SECRET = "cron_secret_0123456789abcdef";

function request(authorization: string | null) {
  return new Request("https://healthguide.cy/api/editorial/scout", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", "123456789");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test_webhook_secret_0123456789");
  startMock.mockResolvedValue({ ok: true, jobId: 5 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("scheduled scout run", () => {
  it("refuses a request without the scheduler secret", async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await GET(request("Bearer wrong_secret_0123456789ab"))).status).toBe(401);
    expect((await GET(request(SECRET))).status).toBe(401);
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("is closed when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(503);
    expect((await GET(request("Bearer undefined"))).status).toBe(503);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts the real run of the day for a valid call", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "started" });
    expect(startMock).toHaveBeenCalledWith({ kind: "real", trigger: "schedule" });
  });

  it("answers a repeated call without starting anything new", async () => {
    startMock.mockResolvedValue({ ok: false, reason: "done" });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "done" });
  });

  it("tells the editor in Telegram when the run could not even start", async () => {
    startMock.mockRejectedValue(new Error("db down"));
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(sendMock).toHaveBeenCalledWith(123456789, expect.stringContaining("не запустился"));
  });
});
