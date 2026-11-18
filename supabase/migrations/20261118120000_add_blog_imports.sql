-- /import for the editorial bot (PR 2): material the editor sends to be turned into a draft.
-- Server-only tables like the other bot tables: RLS on, no access for anon/authenticated.

create table public.blog_imports (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  -- collecting: parts are being received; ready: "Это весь текст" pressed; started: a draft is
  -- being written from it; cancelled: the editor cancelled it.
  status text not null default 'collecting' check (status in ('collecting', 'ready', 'started', 'cancelled')),
  mode text check (mode is null or mode in ('rewrite')),
  -- Where the material came from, for the editor and the checks (never a primary source).
  source_url text check (source_url is null or source_url ~ '^https://'),
  source_label text,
  language text,
  source_text text check (source_text is null or char_length(source_text) <= 60000),
  -- Working Russian translation of a non-Russian material, used only to compare the article with it.
  source_text_ru text check (source_text_ru is null or char_length(source_text_ru) <= 80000),
  post_id uuid unique references public.blog_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_part_at timestamptz
);

create index blog_imports_chat_status_idx on public.blog_imports (chat_id, status, created_at desc);

create table public.blog_import_parts (
  import_id uuid not null references public.blog_imports(id) on delete cascade,
  -- The Telegram message the part came from: parts are assembled in message order, and a message
  -- redelivered by Telegram is stored once.
  message_id bigint not null,
  kind text not null check (kind in ('text', 'url', 'forward', 'file')),
  body text not null check (char_length(body) <= 60000),
  source_url text check (source_url is null or source_url ~ '^https://'),
  source_label text,
  created_at timestamptz not null default now(),
  primary key (import_id, message_id)
);

alter table public.blog_agent_jobs drop constraint blog_agent_jobs_kind_check;
alter table public.blog_agent_jobs
  add constraint blog_agent_jobs_kind_check check (kind in ('write', 'translate', 'edit', 'rewrite'));

alter table public.blog_bot_messages drop constraint blog_bot_messages_purpose_check;
alter table public.blog_bot_messages
  add constraint blog_bot_messages_purpose_check
    check (purpose in ('card', 'edit_prompt', 'image_prompt', 'topic_confirm', 'images', 'import'));

alter table public.blog_imports enable row level security;
alter table public.blog_import_parts enable row level security;

revoke all on table public.blog_imports from anon, authenticated;
revoke all on table public.blog_import_parts from anon, authenticated;

grant select, insert, update, delete on table public.blog_imports to service_role;
grant select, insert, update, delete on table public.blog_import_parts to service_role;
