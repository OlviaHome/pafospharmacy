import dns from "node:dns";
import net from "node:net";

/*
 * Test isolation. No test may reach the production database, the production Telegram bot,
 * OpenAI or any other service, even when the shell running the tests holds real credentials:
 * 1. real secrets are removed from the environment (tests set their own fake values);
 * 2. every outgoing TCP connection fails unless it goes to this machine (127.0.0.1, ::1).
 * Tests that need a server start one on 127.0.0.1; tests that need HTTP stub fetch.
 */

const SECRET_VARIABLES = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_ID",
  "TELEGRAM_SETUP_KEY",
  "OPENAI_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "PEXELS_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "GEOAPIFY_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "LOCATION_SEARCH_HMAC_SECRET",
  "SITE_URL",
  "VERCEL_ENV",
];
for (const name of SECRET_VARIABLES) delete process.env[name];

// The editorial code refuses to run outside production unless explicitly allowed; tests allow it
// because everything above guarantees they only ever see fakes.
process.env.EDITORIAL_ALLOW_NON_PRODUCTION = "true";

function isLoopback(address: string): boolean {
  return address === "::1" || address === "localhost" || /^(::ffff:)?127\./.test(address);
}

function blocked(target: string): Error {
  return Object.assign(new Error(`Network access is disabled in tests (tried ${target}).`), { code: "ENETUNREACH" });
}

type LookupCallback = (error: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;
type LookupFunction = (hostname: string, options: object, callback: LookupCallback) => void;

/** Lets the real (or the test's scripted) lookup run, then refuses any non-loopback answer. */
function loopbackOnly(original: LookupFunction): LookupFunction {
  return (hostname, options, callback) => {
    original(hostname, options, (error, address, family) => {
      if (error) return callback(error);
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [String(address)];
      if (addresses.every(isLoopback)) return callback(null, address, family);
      callback(blocked(hostname));
    });
  };
}

type ConnectOptions = { host?: string; port?: number; path?: string; lookup?: LookupFunction };

const GUARDED = Symbol("loopback-only lookup");
const originalConnect = net.Socket.prototype.connect as (...args: unknown[]) => net.Socket;

net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  // net.connect() and tls.connect() pass Node's own normalized [options, callback] array, which
  // must be passed on as is; sockets also accept (options, cb), (port, host, cb) and (path, cb).
  const list = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  let host: string;
  let options: ConnectOptions | null = null;
  if (typeof list[0] === "object" && list[0] !== null) {
    options = list[0] as ConnectOptions;
    if (options.path) return originalConnect.apply(this, args); // Unix socket: local by definition.
    host = options.host ?? "localhost";
  } else if (typeof list[0] === "string" && Number.isNaN(Number(list[0]))) {
    return originalConnect.apply(this, args); // Unix socket path.
  } else {
    host = typeof list[1] === "string" ? list[1] : "localhost";
  }

  if (isLoopback(host)) return originalConnect.apply(this, args);
  if (net.isIP(host) || !options) {
    process.nextTick(() => this.destroy(blocked(host)));
    return this;
  }
  // A host name: the address is only known after the lookup, which then must be loopback.
  const lookup = options.lookup as (LookupFunction & { [GUARDED]?: true }) | undefined;
  if (!lookup?.[GUARDED]) {
    const guarded = loopbackOnly((lookup ?? dns.lookup) as LookupFunction) as LookupFunction & { [GUARDED]?: true };
    guarded[GUARDED] = true;
    options.lookup = guarded;
  }
  return originalConnect.apply(this, args);
} as typeof net.Socket.prototype.connect;
