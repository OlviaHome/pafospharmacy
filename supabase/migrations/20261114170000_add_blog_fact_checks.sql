-- Fact checking by source content for blog drafts.
-- [{ id, kind: "claim" | "sentence" | "no_claims", claim, importance, sourceUrl, quote,
--    state, detail, checkedAt, manual: { at, sourceUrl } | null }]
-- Private: only the editorial bot reads and writes it. Existing drafts get an empty list,
-- which counts as "not checked" (never as a passed check).
alter table public.blog_posts
  add column fact_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(fact_checks) = 'array');
