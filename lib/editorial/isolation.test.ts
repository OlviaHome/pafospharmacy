import net from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
vi.mock("@/lib/editorial/store", () => ({ claimJob: vi.fn(async () => null) }));

const { editorialRuntimeAllowed, isProductionRuntime, openAiKey, supabaseAdminConfig, telegramConfig } = await import(
  "./config"
);
const { dispatchJob } = await import("./pipeline");

function fakeSecrets() {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_ID", "709466772");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret-test-secret");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  afterCallbacks.length = 0;
});

describe("editorial runtime outside production", () => {
  it("refuses production credentials on a Preview deployment without explicit permission", () => {
    fakeSecrets();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "");
    expect(editorialRuntimeAllowed()).toBe(false);
    expect(() => telegramConfig()).toThrow(/only in production/);
    expect(() => openAiKey()).toThrow(/only in production/);
    expect(() => supabaseAdminConfig()).toThrow(/only in production/);
  });

  it("refuses in `next dev` without explicit permission", () => {
    fakeSecrets();
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "");
    expect(() => telegramConfig()).toThrow(/only in production/);
  });

  it("works on the production deployment, with or without Vercel's system variables", () => {
    fakeSecrets();
    vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(telegramConfig().adminId).toBe("709466772");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
    expect(telegramConfig().adminId).toBe("709466772");
  });

  it("never sends a Preview job to the production runner", async () => {
    fakeSecrets();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("EDITORIAL_ALLOW_NON_PRODUCTION", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await dispatchJob(5);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });
});

describe("test isolation", () => {
  it("has no real credentials in the environment", () => {
    for (const name of ["SUPABASE_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY", "SUPABASE_URL"]) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  const connectError = (options: net.NetConnectOpts) =>
    new Promise<Error>((resolve, reject) => {
      const socket = net.connect(options);
      socket.once("connect", () => {
        socket.destroy();
        reject(new Error("connected"));
      });
      socket.once("error", resolve);
    });

  it("blocks connections to a public address", async () => {
    const error = await fetch("https://1.1.1.1/").catch((e: Error & { cause?: Error }) => e.cause ?? e);
    expect(String(error)).toMatch(/Network access is disabled in tests/);
    expect(String(await connectError({ host: "149.154.167.220", port: 443 }))).toMatch(/disabled in tests/);
  });

  it("blocks a host name that resolves to a public address", async () => {
    const publicLookup = ((_host: string, _options: object, callback: (e: null, a: string, f: number) => void) =>
      callback(null, "149.154.167.220", 4)) as unknown as net.LookupFunction;
    const error = await connectError({ host: "api.telegram.org", port: 443, lookup: publicLookup });
    expect(String(error)).toMatch(/Network access is disabled in tests \(tried api\.telegram\.org\)/);
  });

  it("still allows local test servers", async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const socket = net.connect({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
});
