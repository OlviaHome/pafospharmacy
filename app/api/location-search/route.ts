import {
  buildGeoapifySearchUrl,
  buildManualLocationQuery,
  manualLocationSuggestions,
  type GeoapifyResponse,
} from "@/lib/geocoding/geoapify";
import {
  MANUAL_SUGGESTION_LIMIT,
  MINIMUM_MANUAL_QUERY_CHARACTERS,
  normalizeManualLocationQuery,
} from "@/lib/location/manual-search";

export const dynamic = "force-dynamic";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Enter an area or address." }, { status: 400 });
  }

  const query =
    typeof body === "object" && body !== null && "query" in body
      ? String(body.query).trim().replace(/\s+/g, " ")
      : "";
  if (
    normalizeManualLocationQuery(query).length < MINIMUM_MANUAL_QUERY_CHARACTERS ||
    query.length > 120
  ) {
    return json(
      { error: "Enter between 3 and 120 characters." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return json(
      { error: "Manual location search is temporarily unavailable." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      buildGeoapifySearchUrl(buildManualLocationQuery(query), apiKey, {
        limit: MANUAL_SUGGESTION_LIMIT,
        language: "en",
      }),
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      },
    );
    if (!response.ok) {
      return json(
        { error: "Location search is temporarily unavailable. Try again." },
        { status: 502 },
      );
    }
    const providerResponse = (await response.json()) as GeoapifyResponse;
    return json({
      suggestions: manualLocationSuggestions(providerResponse.results ?? []).slice(
        0,
        MANUAL_SUGGESTION_LIMIT,
      ),
    });
  } catch {
    return json(
      { error: "Location search is temporarily unavailable. Try again." },
      { status: 502 },
    );
  }
}
