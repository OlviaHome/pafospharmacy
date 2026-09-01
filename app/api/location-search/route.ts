import {
  buildGeoapifySearchUrl,
  buildManualLocationQuery,
  manualLocationSuggestions,
  type GeoapifyResponse,
} from "@/lib/geocoding/geoapify";

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
  if (query.length < 2 || query.length > 120) {
    return json(
      { error: "Enter between 2 and 120 characters." },
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
        limit: 5,
        language: "en",
      }),
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      return json(
        { error: "Location search is temporarily unavailable. Try again." },
        { status: 502 },
      );
    }
    const providerResponse = (await response.json()) as GeoapifyResponse;
    return json({ suggestions: manualLocationSuggestions(providerResponse.results ?? []) });
  } catch {
    return json(
      { error: "Location search is temporarily unavailable. Try again." },
      { status: 502 },
    );
  }
}
