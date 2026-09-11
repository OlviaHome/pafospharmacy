import {
  checkLocationSearchBudget,
  fetchManualLocationSuggestions,
  LocationSearchProviderError,
  LocationSearchRequestError,
  LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS,
  manualLocationProviderIsConfigured,
  parseLocationSearchRequest,
  readCachedManualLocationSuggestions,
  writeCachedManualLocationSuggestions,
} from "@/lib/location/location-search-server";

export const dynamic = "force-dynamic";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request): Promise<Response> {
  let query: string;
  try {
    query = await parseLocationSearchRequest(request);
  } catch (error) {
    if (error instanceof LocationSearchRequestError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json({ error: "Enter a valid location search." }, { status: 400 });
  }

  const cachedSuggestions = await readCachedManualLocationSuggestions(query);
  if (cachedSuggestions !== null) {
    return json({ suggestions: cachedSuggestions });
  }

  if (!manualLocationProviderIsConfigured()) {
    return json(
      { error: "Manual location search is temporarily unavailable." },
      { status: 503 },
    );
  }

  const budgetStatus = await checkLocationSearchBudget(request);
  if (budgetStatus === "rate_limited") {
    return json(
      { error: "Too many location searches. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS),
        },
      },
    );
  }
  if (budgetStatus === "unavailable") {
    return json(
      { error: "Manual location search is temporarily unavailable." },
      { status: 503 },
    );
  }

  try {
    const suggestions = await fetchManualLocationSuggestions(query, request.signal);
    await writeCachedManualLocationSuggestions(query, suggestions);
    return json({ suggestions });
  } catch (error) {
    if (error instanceof LocationSearchProviderError && error.status === 429) {
      return json(
        { error: "Too many location searches. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS),
          },
        },
      );
    }
    if (error instanceof LocationSearchProviderError && error.status === 503) {
      return json(
        { error: "Manual location search is temporarily unavailable." },
        { status: 503 },
      );
    }
    return json(
      { error: "Location search is temporarily unavailable. Try again." },
      { status: 502 },
    );
  }
}
