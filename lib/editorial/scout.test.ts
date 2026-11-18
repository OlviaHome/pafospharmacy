import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateScoutLimits } from "./limits";
import {
  cyprusDate,
  dedupeItems,
  hostInDomains,
  normalizeUrl,
  parseFeed,
  pickDigest,
  planSelection,
  scoutReservedUsd,
  titleKey,
  windowStart,
  type KnownEvent,
  type SelectionEvent,
} from "./scout";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Feed</title>
<item>
  <title><![CDATA[GeSY &amp; pharmacies: new rules]]></title>
  <link>http://example.com/news/gesy-rules/?utm_source=rss&amp;id=7#top</link>
  <pubDate>Tue, 17 Nov 2026 08:30:00 +0200</pubDate>
  <description>&lt;p&gt;The ministry &lt;b&gt;announced&lt;/b&gt; changes.&lt;/p&gt;</description>
</item>
<item>
  <title>Second item</title>
  <guid isPermaLink="true">https://example.com/news/second</guid>
  <description><![CDATA[<div>Plain <i>text</i> here</div>]]></description>
</item>
<item><title>No link at all</title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom entry</title><link rel="self" href="https://a.example/self"/><link rel="alternate" href="https://a.example/post-1"/>
<updated>2026-11-16T10:00:00Z</updated><summary>Short summary</summary></entry></feed>`;

describe("feeds", () => {
  it("reads RSS: CDATA, escaped HTML, entities, tracking parameters, a missing date, an item without a link", () => {
    const items = parseFeed(RSS)!;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "GeSY & pharmacies: new rules",
      url: "https://example.com/news/gesy-rules?id=7",
      summary: "The ministry announced changes.",
      publishedAt: "2026-11-17T06:30:00.000Z",
    });
    expect(items[1]).toMatchObject({ url: "https://example.com/news/second", summary: "Plain text here", publishedAt: null });
  });

  it("reads Atom and prefers the alternate link", () => {
    expect(parseFeed(ATOM)).toEqual([
      { title: "Atom entry", url: "https://a.example/post-1", summary: "Short summary", publishedAt: "2026-11-16T10:00:00.000Z" },
    ]);
  });

  it("tells an empty feed from something that is not a feed", () => {
    expect(parseFeed('<rss version="2.0"><channel><title>x</title></channel></rss>')).toEqual([]);
    expect(parseFeed("<html><body>Access denied</body></html>")).toBeNull();
    expect(parseFeed("")).toBeNull();
  });

  it("keeps markup in a feed as plain text (it is data, never HTML for the bot to send)", () => {
    const [item] = parseFeed(
      `<rss><channel><item><title>&lt;script&gt;alert(1)&lt;/script&gt;Hello</title><link>https://x.example/a</link><description>&lt;img src=x onerror=1&gt;Text</description></item></channel></rss>`,
    )!;
    expect(item.title).not.toContain("<");
    expect(item.summary).toBe("Text");
  });
});

describe("technical duplicates", () => {
  it("normalises addresses: https, no fragment, no tracking parameters, no trailing slash", () => {
    expect(normalizeUrl("http://Example.com/a/b/?utm_medium=x&b=2&a=1#c")).toBe("https://example.com/a/b?a=1&b=2");
    expect(normalizeUrl("https://user:pw@example.com/")).toBeNull();
    expect(normalizeUrl("ftp://example.com/")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("removes the same address and the same headline, keeping the first", () => {
    const kept = dedupeItems([
      { url: "https://a.example/x/", title: "GeSY: new fee!" },
      { url: "https://a.example/x?utm_source=feed", title: "other" },
      { url: "https://b.example/y", title: "gesy new fee" },
      { url: "https://b.example/z", title: "Different" },
    ]);
    expect(kept.map((item) => item.url)).toEqual(["https://a.example/x/", "https://b.example/z"]);
    expect(titleKey("GeSY: new fee!")).toBe("gesy new fee");
  });
});

describe("the collection window", () => {
  const now = new Date("2026-11-18T07:00:00Z");
  it("starts at the last successful run (an hour of overlap), a missed day is caught up", () => {
    expect(windowStart(new Date("2026-11-17T07:00:00Z"), now).toISOString()).toBe("2026-11-17T06:00:00.000Z");
    expect(windowStart(new Date("2026-11-14T07:00:00Z"), now).toISOString()).toBe("2026-11-14T06:00:00.000Z");
  });
  it("never reaches back more than a week, and starts at three days with no earlier run", () => {
    expect(windowStart(new Date("2026-10-01T00:00:00Z"), now).toISOString()).toBe("2026-11-11T07:00:00.000Z");
    expect(windowStart(null, now).toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });
  it("the day of a run is the Cyprus day", () => {
    expect(cyprusDate(new Date("2026-11-17T22:30:00Z"))).toBe("2026-11-18");
    expect(cyprusDate(new Date("2026-11-18T06:00:00Z"))).toBe("2026-11-18");
  });
});

describe("checking the model's selection", () => {
  const event = (overrides: Partial<SelectionEvent> = {}): SelectionEvent => ({
    title_ru: "Новые правила ГеСИ",
    gist_ru: "Министерство объявило об изменениях.",
    why_ru: "Касается всех пациентов.",
    score: 4,
    score_reason_ru: "затрагивает многих",
    item_ids: ["i1", "i2"],
    matches_event_id: "",
    new_development: false,
    ...overrides,
  });
  const context = (known: KnownEvent[] = []) => ({
    itemIds: new Set(["i1", "i2", "i3"]),
    known: new Map(known.map((entry) => [entry.id, entry])),
  });

  it("makes a new event from valid items and clamps the score", () => {
    const { actions } = planSelection({ events: [event({ score: 9 })] }, context());
    expect(actions).toEqual([
      { kind: "new", itemIds: ["i1", "i2"], event: { title: "Новые правила ГеСИ", gist: "Министерство объявило об изменениях.", why: "Касается всех пациентов.", score: 5, scoreReason: "затрагивает многих" } },
    ]);
  });

  it("trusts only item ids that were collected, and drops an event left with none", () => {
    const { actions, dropped } = planSelection(
      { events: [event({ item_ids: ["i1", "forged-id"] }), event({ title_ru: "Ghost", item_ids: ["nope"] })] },
      context(),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ itemIds: ["i1"] });
    expect(dropped).toBe(1);
  });

  it("an item belongs to one event only", () => {
    const { actions } = planSelection({ events: [event({ item_ids: ["i1"] }), event({ title_ru: "Другое", item_ids: ["i1", "i3"] })] }, context());
    expect(actions.map((action) => (action.kind === "new" ? action.itemIds : []))).toEqual([["i1"], ["i3"]]);
  });

  it("a new event below the minimum score is dropped", () => {
    expect(planSelection({ events: [event({ score: 1 })] }, context()).actions).toEqual([]);
  });

  it("a known event: nothing new only links the items, a substantial development reopens it, one in work is never reopened", () => {
    const known = [
      { id: "shown", status: "shown" as const },
      { id: "skipped", status: "skipped" as const },
      { id: "inwork", status: "in_work" as const },
      { id: "fresh", status: "new" as const },
    ];
    const plan = (id: string, newDevelopment: boolean) =>
      planSelection({ events: [event({ matches_event_id: id, new_development: newDevelopment, item_ids: ["i1"] })] }, context(known)).actions[0].kind;
    expect(plan("shown", false)).toBe("attach");
    expect(plan("skipped", false)).toBe("attach");
    expect(plan("shown", true)).toBe("update");
    expect(plan("skipped", true)).toBe("update");
    expect(plan("inwork", true)).toBe("attach");
    expect(plan("fresh", false)).toBe("update");
  });

  it("an event id the model made up is treated as a new event", () => {
    const { actions } = planSelection({ events: [event({ matches_event_id: "made-up", new_development: true })] }, context());
    expect(actions[0].kind).toBe("new");
  });

  it("survives a malformed answer", () => {
    expect(planSelection(null, context()).actions).toEqual([]);
    expect(planSelection({ events: "x" as never }, context()).actions).toEqual([]);
    expect(planSelection({ events: [null as never, { item_ids: "i1" } as never] }, context()).actions).toEqual([]);
  });

  it("a digest has the best five, and nothing below the minimum", () => {
    const events = Array.from({ length: 8 }, (_, index) => ({ id: index, score: (index % 5) + 1, firstSeenAt: `2026-11-0${index + 1}` }));
    const digest = pickDigest(events);
    expect(digest).toHaveLength(5);
    expect(digest.every((entry) => entry.score >= 2)).toBe(true);
    expect(digest.map((entry) => entry.score)).toEqual([5, 4, 3, 3, 2]);
  });
});

describe("domains and limits", () => {
  it("matches a domain and its subdomains only", () => {
    expect(hostInDomains("https://www.moh.gov.cy/page", ["moh.gov.cy"])).toBe(true);
    expect(hostInDomains("https://moh.gov.cy/", ["moh.gov.cy"])).toBe(true);
    expect(hostInDomains("https://moh.gov.cy.evil.example/", ["moh.gov.cy"])).toBe(false);
    expect(hostInDomains("https://notmoh.gov.cy/", ["moh.gov.cy"])).toBe(false);
    expect(hostInDomains("garbage", ["moh.gov.cy"])).toBe(false);
  });

  const limits = { scoutBudgetUsd: 5, monthlyBudgetUsd: 10, parallelJobs: 3 };
  const idle = { activeJobs: 0, jobsToday: 0, articlesToday: 0, spentThisMonthUsd: 0 };

  it("reserves a few tenths of a dollar for a run on the main model", () => {
    expect(scoutReservedUsd("gpt-5.6-terra")).toBeGreaterThan(0.1);
    expect(scoutReservedUsd("gpt-5.6-terra")).toBeLessThan(0.5);
    expect(scoutReservedUsd("gpt-5.6-luna")).toBeLessThan(scoutReservedUsd("gpt-5.6-terra"));
  });

  it("stops at the Scout's own share with the agreed words, then at the general budget, then when busy", () => {
    expect(evaluateScoutLimits(idle, 0, limits, 0.3)).toEqual({ ok: true });
    expect(evaluateScoutLimits(idle, 4.8, limits, 0.3)).toEqual({ ok: false, code: "limit_scout", reason: "исчерпан лимит $5 на этот месяц" });
    expect(evaluateScoutLimits({ ...idle, spentThisMonthUsd: 9.9 }, 1, limits, 0.3)).toMatchObject({ ok: false, code: "limit_total" });
    expect(evaluateScoutLimits({ ...idle, activeJobs: 3 }, 0, limits, 0.3)).toMatchObject({ ok: false, code: "busy" });
  });
});
