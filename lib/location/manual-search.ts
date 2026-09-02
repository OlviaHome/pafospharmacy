export const MINIMUM_MANUAL_QUERY_CHARACTERS = 3;
export const MANUAL_SEARCH_DEBOUNCE_MILLISECONDS = 400;
export const MANUAL_SUGGESTION_LIMIT = 3;

export function normalizeManualLocationQuery(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function cancellationError(): Error {
  const error = new Error("Manual location search was cancelled.");
  error.name = "AbortError";
  return error;
}

export function isManualSearchCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class SessionManualLocationLookup<Result> {
  private readonly cache = new Map<string, Result>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  private generation = 0;

  constructor(
    private readonly debounceMilliseconds = MANUAL_SEARCH_DEBOUNCE_MILLISECONDS,
  ) {}

  lookup(
    query: string,
    request: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    const normalizedQuery = normalizeManualLocationQuery(query);
    this.cancel();

    if (this.cache.has(normalizedQuery)) {
      return Promise.resolve(this.cache.get(normalizedQuery)!);
    }

    const generation = ++this.generation;
    return new Promise<Result>((resolve, reject) => {
      this.rejectPending = reject;
      this.timer = setTimeout(async () => {
        this.timer = null;
        const controller = new AbortController();
        this.controller = controller;
        try {
          const result = await request(controller.signal);
          if (controller.signal.aborted || this.generation !== generation) return;
          this.cache.set(normalizedQuery, result);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          if (this.generation === generation) {
            this.controller = null;
            this.rejectPending = null;
          }
        }
      }, this.debounceMilliseconds);
    });
  }

  cancel(): void {
    const hadPendingWork = this.timer !== null || this.controller !== null;
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
    if (hadPendingWork) this.rejectPending?.(cancellationError());
    this.rejectPending = null;
  }
}
