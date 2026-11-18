-- /import mode B («Без рерайта»): the editor's own text stays the text (PR 3).
-- Only adds columns and widens two value lists; no existing row changes.

alter table public.blog_imports drop constraint blog_imports_mode_check;
alter table public.blog_imports
  add constraint blog_imports_mode_check check (mode is null or mode in ('rewrite', 'prepare'));

-- Date the editor confirmed that she has the rights to the material (mode B).
alter table public.blog_imports add column rights_confirmed_at timestamptz;
-- Mode B, material in another language: [{ "o": original paragraph, "t": its Russian translation }] and
-- the translation as one text; used for «Сравнить с оригиналом» and the checks.
alter table public.blog_imports add column prepared jsonb check (prepared is null or jsonb_typeof(prepared) = 'object');
-- Fingerprint of the words of the article's own text that the editor confirmed as it is.
alter table public.blog_imports add column accepted_hash text;

alter table public.blog_agent_jobs drop constraint blog_agent_jobs_kind_check;
alter table public.blog_agent_jobs
  add constraint blog_agent_jobs_kind_check check (kind in ('write', 'translate', 'edit', 'rewrite', 'prepare'));

-- Proposed changes to the author's text: [{ id, before, after, reason, status: pending|accepted|rejected }].
-- Private like fact_checks: anonymous visitors only read the columns granted to them.
alter table public.blog_posts
  add column suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array');
