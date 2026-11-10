import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runJobMock, afterMock } = vi.hoisted(() => ({ runJobMock: vi.fn(), afterMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/editorial/bot", () => ({}));
vi.mock("@/lib/editorial/pipeline", () => ({ runJob: runJobMock }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));

import { POST } from "./route";

const SECRET = "test_webhook_secret_0123456789";

function request(body: unknown, secret: string | null = SECRET) {
  return new Request("https://healthguide.cy/api/editorial/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "x-editorial-secret": secret } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", "123456789");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("editorial job runner", () => {
  it("requires the internal secret", async () => {
    expect((await POST(request({ jobId: 1 }, null))).status).toBe(401);
    expect((await POST(request({ jobId: 1 }, "x".repeat(30)))).status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid job id", async () => {
    expect((await POST(request({ jobId: "1; drop" }))).status).toBe(400);
    expect((await POST(request({ jobId: -3 }))).status).toBe(400);
  });

  it("accepts a job and runs it after responding", async () => {
    const response = await POST(request({ jobId: 7 }));
    expect(response.status).toBe(202);
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0][0]();
    expect(runJobMock).toHaveBeenCalledWith(7);
  });
});
