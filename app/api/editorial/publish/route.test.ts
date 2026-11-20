import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/editorial/bot", () => ({ runScheduledPublications: runMock }));

import { GET } from "./route";

const SECRET = "cron_secret_0123456789abcdef";

function request(authorization: string | null) {
  return new Request("https://healthguide.cy/api/editorial/publish", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  runMock.mockResolvedValue({ published: [12], failed: [], missed: [], recovered: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("publication queue route", () => {
  it("refuses a request without the scheduler secret", async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await GET(request("Bearer wrong_secret_0123456789ab"))).status).toBe(401);
    expect((await GET(request(SECRET))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("is closed when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(503);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("never runs on a preview deployment", async () => {
    vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "false");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(503);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("runs the queue once for a valid call and reports what happened", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, published: [12], failed: [], missed: [], recovered: [] });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when the run itself fails, so the scheduler logs it", async () => {
    runMock.mockRejectedValue(new Error("database down"));
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(500);
  });
});
