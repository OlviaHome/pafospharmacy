-- Editorial agent (Telegram bot + OpenAI) bookkeeping for the blog.
-- Everything here is private: no anon/authenticated access, only the server-side secret key.

-- Short human number for drafts in the bot ("#12").
alter table public.blog_posts
  add column number bigint generated always as identity,
  add column last_error text,
  -- The agent's notes for the human editor: unverified facts, conflicting sources.
  add column editor_notes text;

alter table public.blog_posts
  add constraint blog_posts_number_key unique (number);

-- Stock providers: Pexels stopped issuing keys, so Unsplash (hotlinked, as its API requires)
-- and Openverse (openly licensed, stored in our bucket) are supported as well.
alter table public.blog_images drop constraint blog_images_source_check;
alter table public.blog_images drop constraint blog_images_placeholder_has_no_url;
alter table public.blog_images
  add constraint blog_images_source_check
    check (source in ('pexels', 'unsplash', 'openverse', 'upload', 'placeholder')),
  add constraint blog_images_placeholder_has_no_url check ((source = 'placeholder') = (url is null)),
  add column license_name text,
  add column license_url text check (license_url is null or license_url ~ '^https?://'),
  -- Provider photo id, so "another stock photo" never repeats one already tried.
  add column provider_photo_id text,
  add column tried_photo_ids text[] not null default '{}',
  -- English stock search query chosen by the agent.
  add column search_query text,
  -- Storage object path when the file lives in our bucket (so a replaced file can be removed).
  add column storage_path text;

-- Group revision rows written by the same change so they can be rolled back together.
alter table public.blog_post_revisions add column batch_id uuid;
create index blog_post_revisions_batch_idx on public.blog_post_revisions (post_id, batch_id);

-- One unit of agent work. A runner claims a queued job atomically, so a job never runs twice.
create table public.blog_agent_jobs (
  id bigint generated always as identity primary key,
  post_id uuid references public.blog_posts(id) on delete cascade,
  kind text not null check (kind in ('write', 'translate', 'edit')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- Job input, e.g. {"locales": ["en"]} or {"instruction": "..."}.
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index blog_agent_jobs_status_idx on public.blog_agent_jobs (status, created_at);
create index blog_agent_jobs_created_idx on public.blog_agent_jobs (created_at);

-- Every OpenAI call with its token usage and estimated cost, for daily and monthly limits.
create table public.blog_ai_usage (
  id bigint generated always as identity primary key,
  job_id bigint references public.blog_agent_jobs(id) on delete set null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  web_search_calls integer not null default 0 check (web_search_calls >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index blog_ai_usage_created_idx on public.blog_ai_usage (created_at);

-- Telegram may deliver an update more than once; each update_id is processed once.
create table public.blog_bot_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

-- Links bot messages to drafts, so a reply to a message knows which draft it is about.
create table public.blog_bot_messages (
  chat_id bigint not null,
  message_id bigint not null,
  post_id uuid references public.blog_posts(id) on delete cascade,
  purpose text not null check (purpose in ('card', 'edit_prompt', 'image_prompt', 'topic_confirm', 'images')),
  slot text,
  -- e.g. the proposed topic awaiting confirmation.
  payload text,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index blog_bot_messages_post_idx on public.blog_bot_messages (post_id);

alter table public.blog_agent_jobs enable row level security;
alter table public.blog_ai_usage enable row level security;
alter table public.blog_bot_updates enable row level security;
alter table public.blog_bot_messages enable row level security;

revoke all on table public.blog_agent_jobs from anon, authenticated;
revoke all on table public.blog_ai_usage from anon, authenticated;
revoke all on table public.blog_bot_updates from anon, authenticated;
revoke all on table public.blog_bot_messages from anon, authenticated;

grant select, insert, update, delete on table public.blog_agent_jobs to service_role;
grant select, insert, update, delete on table public.blog_ai_usage to service_role;
grant select, insert, update, delete on table public.blog_bot_updates to service_role;
grant select, insert, update, delete on table public.blog_bot_messages to service_role;
grant usage on sequence public.blog_agent_jobs_id_seq to service_role;
grant usage on sequence public.blog_ai_usage_id_seq to service_role;

-- The new identity column is not public.
-- (Column grants on blog_posts list public columns explicitly, so `number` stays private.)

-- Atomically claim a queued job; returns the job only to the first runner.
create function public.claim_blog_agent_job(job_id bigint)
returns setof public.blog_agent_jobs
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.blog_agent_jobs
  set status = 'running', started_at = now()
  where id = job_id and status = 'queued'
  returning *;
$$;

revoke all on function public.claim_blog_agent_job(bigint) from public;
grant execute on function public.claim_blog_agent_job(bigint) to service_role;
