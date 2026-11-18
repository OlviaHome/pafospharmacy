-- Medical News Scout (PR 4): sources, collected publications, events and run records.
-- Monitoring only selects topics; articles are still written by the editor's own flow, and only
-- after the editor's button. Server-only tables: RLS on, no access for anon/authenticated.
-- Requires 20261118140000 (it widens the same job-kind constraint).

create table public.news_sources (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  name text not null check (char_length(name) between 1 and 120),
  -- rss: a feed read directly; search: an official domain covered by one restricted web search.
  kind text not null check (kind in ('rss', 'search')),
  -- rss: the feed URL; search: the domain (e.g. moh.gov.cy).
  url text not null check (char_length(url) <= 500),
  language text not null default 'en',
  -- 1 = most important.
  priority smallint not null default 2 check (priority between 1 and 3),
  -- A source takes part in the daily run only after the editor approves it.
  enabled boolean not null default false,
  approved_at timestamptz,
  -- The last access check made from the server function (never from a laptop).
  check_state text check (check_state is null or check_state in ('ok', 'blocked', 'unreachable', 'not_feed', 'empty', 'search')),
  check_detail text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, url),
  check (not enabled or approved_at is not null)
);

create table public.news_events (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  title_ru text not null check (char_length(title_ru) <= 300),
  gist text not null check (char_length(gist) <= 1500),
  why text check (why is null or char_length(why) <= 800),
  score smallint not null default 1 check (score between 1 and 5),
  score_reason text check (score_reason is null or char_length(score_reason) <= 500),
  -- new: found, not shown yet; shown: in a digest; skipped: the editor hid it; in_work: an article was started.
  status text not null default 'new' check (status in ('new', 'shown', 'skipped', 'in_work')),
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  first_seen_at timestamptz not null default now(),
  shown_at timestamptz,
  skipped_at timestamptz,
  post_id uuid references public.blog_posts(id) on delete set null,
  -- The real run whose digest showed the event.
  shown_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index news_events_status_idx on public.news_events (status, updated_at desc);

-- One row per run. A real and a test run of the same day are separate rows; the unique key makes a
-- repeated scheduler call a no-op.
create table public.news_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  kind text not null check (kind in ('real', 'test')),
  trigger text not null default 'manual' check (trigger in ('manual', 'schedule')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  -- A short code, never a message with secrets: limit, no_sources, all_sources_down, openai, internal.
  error_code text,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  model text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_date, kind)
);

alter table public.news_events
  add constraint news_events_shown_run_fk foreign key (shown_run_id) references public.news_runs(id) on delete set null;

create table public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.news_sources(id) on delete set null,
  -- Normalised address: the technical duplicate key.
  url text not null unique check (url ~ '^https://' and char_length(url) <= 1000),
  title text not null check (char_length(title) <= 400),
  summary text check (summary is null or char_length(summary) <= 1200),
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  -- Set when a selection run has looked at the item, so a failed run never loses publications.
  processed_at timestamptz,
  event_id uuid references public.news_events(id) on delete set null
);

create index news_items_pending_idx on public.news_items (fetched_at) where processed_at is null;
create index news_items_event_idx on public.news_items (event_id);

alter table public.blog_agent_jobs drop constraint blog_agent_jobs_kind_check;
alter table public.blog_agent_jobs
  add constraint blog_agent_jobs_kind_check check (kind in ('write', 'translate', 'edit', 'rewrite', 'prepare', 'scout'));

alter table public.news_sources enable row level security;
alter table public.news_events enable row level security;
alter table public.news_runs enable row level security;
alter table public.news_items enable row level security;

revoke all on table public.news_sources from anon, authenticated;
revoke all on table public.news_events from anon, authenticated;
revoke all on table public.news_runs from anon, authenticated;
revoke all on table public.news_items from anon, authenticated;

grant select, insert, update, delete on table public.news_sources to service_role;
grant select, insert, update, delete on table public.news_events to service_role;
grant select, insert, update, delete on table public.news_runs to service_role;
grant select, insert, update, delete on table public.news_items to service_role;

-- Preliminary source list. EVERY source starts disabled; none has been checked from the server yet
-- (the addresses are not verified): /sources checks them from the function and the editor approves.
insert into public.news_sources (name, kind, url, language, priority) values
  ('Cyprus Mail: здоровье', 'rss', 'https://cyprus-mail.com/tag/health/feed/', 'en', 1),
  ('in-cyprus (Phileleftheros)', 'rss', 'https://in-cyprus.philenews.com/feed/', 'en', 2),
  ('Kathimerini Cyprus (English)', 'rss', 'https://knews.kathimerini.com.cy/en/feed', 'en', 2),
  ('Министерство здравоохранения', 'search', 'moh.gov.cy', 'en', 1),
  ('ГеСИ / HIO', 'search', 'gesy.org.cy', 'en', 1),
  ('Организация здравоохранения Кипра (ShSO)', 'search', 'shso.org.cy', 'en', 1),
  ('Служба общественного здравоохранения (PHS)', 'search', 'phs.moh.gov.cy', 'en', 1),
  ('Портал gov.cy', 'search', 'gov.cy', 'en', 2),
  ('Управление информации (PIO)', 'search', 'pio.gov.cy', 'en', 2)
on conflict do nothing;
