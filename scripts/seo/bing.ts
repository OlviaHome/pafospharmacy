/**
 * Bing Webmaster Tools client, read-only (OAuth 2.0, scope webmaster.read).
 *
 * The runner holds a long-lived refresh token (environment secret) and exchanges it for a one-hour
 * access token at the start of every run. Only GET methods of the JSON API are used; nothing here
 * can submit URLs, change settings or touch IndexNow. Errors carry the method name and Bing's error
 * code/message, never the client secret, the refresh token or the access token.
 *
 * Docs: https://learn.microsoft.com/en-us/bingwebmaster/oauth2 ,
 *       https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi
 */
export const BING_TOKEN_URL = "https://www.bing.com/webmasters/oauth/token";
export const BING_API = "https://www.bing.com/webmaster/api.svc/json";

type Http = (url: string, init?: RequestInit) => Promise<Response>;

export interface BingCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface BingSite { Url: string; IsVerified?: boolean }
export interface BingTrafficRow { Date: string; Clicks: number; Impressions: number }
export interface BingQueryRow { Query: string; Date?: string; Clicks: number; Impressions: number; AvgClickPosition?: number; AvgImpressionPosition?: number }
export interface BingCrawlRow {
  Date: string;
  CrawledPages?: number;
  CrawlErrors?: number;
  InIndex?: number;
  InLinks?: number;
  BlockedByRobotsTxt?: number;
  Code2xx?: number;
  Code301?: number;
  Code302?: number;
  Code4xx?: number;
  Code5xx?: number;
  AllOtherCodes?: number;
  ContainsMalware?: number;
  DnsFailures?: number;
  ConnectionTimeout?: number;
}
export interface BingFeed { Url: string; Status?: string; Submitted?: string; LastCrawled?: string; UrlCount?: number; Type?: string }
export interface BingCrawlIssue { Url: string; Issues?: number | string; HttpCode?: number; InLinks?: number }
export interface BingUrlInfo { Url?: string; HttpStatus?: number; LastCrawledDate?: string; DiscoveryDate?: string; DocumentSize?: number; IsPage?: boolean }

export interface BingClient {
  userSites(): Promise<BingSite[]>;
  rankAndTraffic(): Promise<BingTrafficRow[]>;
  queryStats(): Promise<BingQueryRow[]>;
  crawlStats(): Promise<BingCrawlRow[]>;
  feeds(): Promise<BingFeed[]>;
  crawlIssues(): Promise<BingCrawlIssue[]>;
  urlInfo(url: string): Promise<BingUrlInfo>;
  /** True when Bing answered the refresh with a different refresh token (it has to be replaced by hand). */
  refreshTokenRotated: boolean;
}

export function readBingCredentials(env: Record<string, string | undefined> = process.env): BingCredentials | Error {
  const clientId = env.BING_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.BING_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.BING_REFRESH_TOKEN?.trim() ?? "";
  const missing = [
    !clientId && "BING_CLIENT_ID",
    !clientSecret && "BING_CLIENT_SECRET",
    !refreshToken && "BING_REFRESH_TOKEN",
  ].filter(Boolean);
  return missing.length ? new Error(`Bing credentials not set: ${missing.join(", ")}`) : { clientId, clientSecret, refreshToken };
}

/** Bing's JSON dates look like "/Date(1732406400000)/" or "/Date(1732406400000-0800)/". */
export function bingDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(value);
  if (match) return new Date(Number(match[1]));
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

/** Error text without any credential: method + HTTP status + Bing's ErrorCode/Message (truncated). */
async function readJson<T>(response: Response, what: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 200);
    try {
      const body = JSON.parse(text) as { ErrorCode?: number | string; Message?: string; error?: string; error_description?: string };
      if (body.error || body.error_description) message = [body.error, body.error_description].filter(Boolean).join(": ");
      else if (body.ErrorCode !== undefined || body.Message) message = `ErrorCode=${body.ErrorCode ?? "?"} ${body.Message ?? ""}`.trim();
    } catch {
      // not JSON: keep the truncated text
    }
    throw new Error(`${what}: HTTP ${response.status} ${message}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what}: response is not JSON`);
  }
}

export async function createBingClient(credentials: BingCredentials, siteUrl: string, http: Http = fetch): Promise<BingClient> {
  const token = await readJson<{ access_token?: string; refresh_token?: string }>(
    await http(BING_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    }),
    "oauth.token",
  );
  if (!token.access_token) throw new Error("oauth.token: no access_token in the answer");
  const client = bingClientWithToken(token.access_token, siteUrl, http);
  client.refreshTokenRotated = Boolean(token.refresh_token && token.refresh_token !== credentials.refreshToken);
  return client;
}

export function bingClientWithToken(accessToken: string, siteUrl: string, http: Http = fetch): BingClient {
  if (!accessToken.trim()) throw new Error("Bing access token is empty");
  const headers = { authorization: `Bearer ${accessToken.trim()}`, accept: "application/json" };
  async function get<T>(method: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const result = await readJson<{ d?: T }>(
      await http(`${BING_API}/${method}${query ? `?${query}` : ""}`, { method: "GET", headers }),
      method,
    );
    return result.d as T;
  }
  const site = { siteUrl };
  return {
    refreshTokenRotated: false,
    userSites: async () => (await get<BingSite[]>("GetUserSites")) ?? [],
    rankAndTraffic: async () => (await get<BingTrafficRow[]>("GetRankAndTrafficStats", site)) ?? [],
    queryStats: async () => (await get<BingQueryRow[]>("GetQueryStats", site)) ?? [],
    crawlStats: async () => (await get<BingCrawlRow[]>("GetCrawlStats", site)) ?? [],
    feeds: async () => (await get<BingFeed[]>("GetFeeds", site)) ?? [],
    crawlIssues: async () => (await get<BingCrawlIssue[]>("GetCrawlIssues", site)) ?? [],
    urlInfo: async (url: string) => (await get<BingUrlInfo>("GetUrlInfo", { siteUrl, url })) ?? {},
  };
}
