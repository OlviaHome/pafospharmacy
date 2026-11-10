-- Pre-launch additions for the blog: source link checks and a public view counter.

-- Result of the last link check of the article's sources:
-- [{ "url": "...", "state": "ok" | "broken" | "unverified", "status": 200, "checked_at": "..." }]
-- Private (only the editorial bot reads it).
alter table public.blog_posts
  add column source_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(source_checks) = 'array'),
  add column view_count bigint not null default 0 check (view_count >= 0);

-- The view count is shown on public pages.
grant select (view_count) on table public.blog_posts to anon, authenticated;

-- Counts one view of a published article. Unknown or unpublished slugs are ignored.
create function public.increment_blog_view(post_slug text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.blog_posts
  set view_count = view_count + 1
  where slug = post_slug and status = 'published';
$$;

revoke all on function public.increment_blog_view(text) from public;
grant execute on function public.increment_blog_view(text) to anon, authenticated, service_role;
