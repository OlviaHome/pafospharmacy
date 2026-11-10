-- Blog: articles written by the editorial agent and approved by a human before publication.
-- One article (blog_posts) has one translation row per locale. Many drafts can exist at once.
-- Anonymous visitors can read only published articles and published translations.
-- All writes go through trusted server code using the secret key (the Telegram editorial bot).

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  -- Shared latin slug used by every locale: /{locale}/blog/{slug}
  -- 'preview' is reserved for the hidden preview route.
  slug text not null unique check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 120 and slug <> 'preview'
  ),
  -- The topic exactly as the editor requested it.
  topic text not null check (btrim(topic) <> ''),
  status text not null default 'generating' check (
    status in ('generating', 'review', 'paused', 'published', 'archived', 'failed')
  ),
  -- Unguessable token for the hidden preview page /{locale}/blog/preview/{token}.
  preview_token uuid not null unique default gen_random_uuid(),
  author_name text not null default 'HealthGuide Cyprus',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_posts_published_has_date check (status <> 'published' or published_at is not null)
);

create table public.blog_post_translations (
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  locale text not null check (locale in ('en', 'el', 'ru', 'ar')),
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  title text not null check (btrim(title) <> ''),
  -- Meta description / list excerpt.
  description text not null default '',
  -- Markdown body. A line containing only [[image:<slot>]] places an image from blog_images.
  body_md text not null default '',
  -- [{ "question": "...", "answer": "..." }]
  faq jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array'),
  -- [{ "title": "...", "url": "https://..." }]
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, locale),
  constraint blog_post_translations_published_has_date check (status <> 'published' or published_at is not null)
);

create table public.blog_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  -- 'cover' or an inline slot referenced from the body, e.g. 'inline-1'.
  slot text not null check (slot ~ '^[a-z0-9-]{1,40}$'),
  -- Public image URL (Supabase Storage). Null means a placeholder the editor must fill,
  -- e.g. a screenshot of a portal step that no stock library can provide.
  url text check (url is null or url ~ '^https://'),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  -- { "ru": "...", "en": "..." }
  alt jsonb not null default '{}'::jsonb check (jsonb_typeof(alt) = 'object'),
  -- What the editor should put here when url is null.
  placeholder_note text,
  source text not null default 'placeholder' check (source in ('pexels', 'upload', 'placeholder')),
  credit_name text,
  credit_url text check (credit_url is null or credit_url ~ '^https://'),
  source_page_url text check (source_page_url is null or source_page_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, slot),
  constraint blog_images_placeholder_has_no_url check ((source = 'placeholder') = (url is null))
);

-- Version history so an edit can be rolled back.
create table public.blog_post_revisions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  locale text not null check (locale in ('en', 'el', 'ru', 'ar')),
  title text not null,
  description text not null,
  body_md text not null,
  faq jsonb not null,
  sources jsonb not null,
  -- Why this version exists, e.g. 'generated', 'edit: shorten intro', 'translated'.
  note text not null default '',
  created_at timestamptz not null default now()
);

create index blog_posts_status_published_at_idx on public.blog_posts (status, published_at desc);
create index blog_images_post_id_idx on public.blog_images (post_id);
create index blog_post_revisions_post_locale_idx on public.blog_post_revisions (post_id, locale, created_at desc);

alter table public.blog_posts enable row level security;
alter table public.blog_post_translations enable row level security;
alter table public.blog_images enable row level security;
alter table public.blog_post_revisions enable row level security;

revoke all on table public.blog_posts from anon, authenticated;
revoke all on table public.blog_post_translations from anon, authenticated;
revoke all on table public.blog_images from anon, authenticated;
revoke all on table public.blog_post_revisions from anon, authenticated;

-- The editorial bot writes with the secret key (service_role).
grant select, insert, update, delete on table public.blog_posts to service_role;
grant select, insert, update, delete on table public.blog_post_translations to service_role;
grant select, insert, update, delete on table public.blog_images to service_role;
grant select, insert, update, delete on table public.blog_post_revisions to service_role;
grant usage on sequence public.blog_post_revisions_id_seq to service_role;

-- Public columns only: the preview token and the editor's raw topic stay private.
grant select (id, slug, status, author_name, published_at, updated_at)
  on table public.blog_posts to anon, authenticated;
grant select on table public.blog_post_translations to anon, authenticated;
grant select on table public.blog_images to anon, authenticated;

create policy blog_posts_public_read_published
  on public.blog_posts
  for select
  to anon, authenticated
  using (status = 'published');

create policy blog_post_translations_public_read_published
  on public.blog_post_translations
  for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.blog_posts
      where blog_posts.id = blog_post_translations.post_id
        and blog_posts.status = 'published'
    )
  );

create policy blog_images_public_read_published
  on public.blog_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.blog_posts
      where blog_posts.id = blog_images.post_id
        and blog_posts.status = 'published'
    )
  );

-- Hidden preview: anyone holding the unguessable token can read that one article in any state,
-- without the runtime site needing the secret key.
create function public.get_blog_preview(token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'status', p.status,
    'author_name', p.author_name,
    'published_at', p.published_at,
    'updated_at', p.updated_at,
    'translations', coalesce((
      select jsonb_agg(to_jsonb(t) - 'post_id' order by t.locale)
      from public.blog_post_translations t
      where t.post_id = p.id
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(to_jsonb(i) - 'post_id' order by i.slot)
      from public.blog_images i
      where i.post_id = p.id
    ), '[]'::jsonb)
  )
  from public.blog_posts p
  where p.preview_token = token
    and p.status <> 'archived';
$$;

revoke all on function public.get_blog_preview(uuid) from public;
grant execute on function public.get_blog_preview(uuid) to anon, authenticated, service_role;

-- Public bucket for article images (stock downloads and editor uploads).
-- Guarded so the migration also runs on plain Postgres in tests.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('blog-images', 'blog-images', true)
    on conflict (id) do nothing;
  end if;
end;
$$;
