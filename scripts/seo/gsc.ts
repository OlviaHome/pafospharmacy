/**
 * Google Search Console client, read-only.
 *
 * Auth: a service account JSON key from the runner's secret store (env GSC_SERVICE_ACCOUNT_JSON),
 * exchanged for a short-lived token with the `webmasters.readonly` scope only. The service account
 * is a "Restricted" user of the property, so even a leaked token cannot change anything.
 * No Google SDK: a signed JWT and three REST endpoints keep the dependency surface at zero.
 */
import { createSign } from "node:crypto";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface UrlInspection {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  pageFetchState?: string;
  lastCrawlTime?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

export interface SitemapStatus {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  errors?: string;
  warnings?: string;
}

export interface GscClient {
  searchAnalytics(body: Record<string, unknown>): Promise<SearchAnalyticsRow[]>;
  inspect(url: string): Promise<UrlInspection>;
  sitemaps(): Promise<SitemapStatus[]>;
}

type Http = (url: string, init: RequestInit) => Promise<Response>;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function parseServiceAccount(raw: string | undefined): ServiceAccountKey {
  if (!raw?.trim()) throw new Error("GSC_SERVICE_ACCOUNT_JSON is not set");
  const key = JSON.parse(raw) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) throw new Error("GSC_SERVICE_ACCOUNT_JSON is not a service account key");
  return key;
}

export function signedAssertion(key: ServiceAccountKey, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email,
    scope: GSC_SCOPE,
    aud: key.token_uri ?? TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(key.private_key))}`;
}

/** Errors never echo the key or the token: only the endpoint and Google's status/message. */
async function json<T>(response: Response, what: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
      message = body.error_description ?? (typeof body.error === "object" ? body.error.message : body.error) ?? message;
    } catch {
      // not JSON: keep the raw (truncated) text
    }
    throw new Error(`${what}: HTTP ${response.status} ${message}`);
  }
  return JSON.parse(text) as T;
}

export async function createGscClient(key: ServiceAccountKey, property: string, http: Http = fetch): Promise<GscClient> {
  const token = await json<{ access_token: string }>(
    await http(key.token_uri ?? TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signedAssertion(key, Math.floor(Date.now() / 1000)),
      }),
    }),
    "token",
  );
  const headers = { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" };
  const site = encodeURIComponent(property);
  return {
    async searchAnalytics(body) {
      const result = await json<{ rows?: SearchAnalyticsRow[] }>(
        await http(`${API}/webmasters/v3/sites/${site}/searchAnalytics/query`, { method: "POST", headers, body: JSON.stringify(body) }),
        "searchAnalytics.query",
      );
      return result.rows ?? [];
    },
    async inspect(url) {
      const result = await json<{ inspectionResult?: { indexStatusResult?: UrlInspection } }>(
        await http(`${API}/v1/urlInspection/index:inspect`, {
          method: "POST",
          headers,
          body: JSON.stringify({ inspectionUrl: url, siteUrl: property }),
        }),
        "urlInspection.index.inspect",
      );
      return result.inspectionResult?.indexStatusResult ?? {};
    },
    async sitemaps() {
      const result = await json<{ sitemap?: SitemapStatus[] }>(
        await http(`${API}/webmasters/v3/sites/${site}/sitemaps`, { method: "GET", headers }),
        "sitemaps.list",
      );
      return result.sitemap ?? [];
    },
  };
}
