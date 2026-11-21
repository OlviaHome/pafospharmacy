-- News Scout: the pause switch of the automatic monitoring (additive; nothing existing changes).
-- One row. While `paused` is true the scheduled run does nothing: no search, no selection, no
-- OpenAI call, no budget reservation, no run record. Events, drafts and articles are untouched.
-- Server-only table: RLS on, no access for anon/authenticated.

create table public.news_scout_settings (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  paused_at timestamptz,
  -- When monitoring was last resumed. A run never looks at publications older than this, so the
  -- news of the pause is not collected afterwards.
  resumed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.news_scout_settings (id) values (true) on conflict (id) do nothing;

alter table public.news_scout_settings enable row level security;

revoke all on table public.news_scout_settings from anon, authenticated;

grant select, insert, update on table public.news_scout_settings to service_role;
