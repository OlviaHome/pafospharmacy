begin;

select plan(12);

insert into public.blog_posts (slug, topic, status, published_at)
values
  ('test-published-post', 'published topic', 'published', now()),
  ('test-review-post', 'draft topic', 'review', null);

insert into public.blog_post_translations (post_id, locale, status, title, published_at)
select id, 'ru', 'published', 'Опубликовано', now() from public.blog_posts where slug = 'test-published-post';

insert into public.blog_post_translations (post_id, locale, status, title)
select id, 'el', 'review', 'Υπό έλεγχο' from public.blog_posts where slug = 'test-published-post';

insert into public.blog_post_translations (post_id, locale, status, title)
select id, 'ru', 'review', 'Черновик' from public.blog_posts where slug = 'test-review-post';

insert into public.blog_images (post_id, slot, placeholder_note)
select id, 'inline-1', 'portal screenshot' from public.blog_posts where slug = 'test-review-post';

select ok(
  not has_column_privilege('anon', 'public.blog_posts', 'preview_token', 'select'),
  'anon cannot read preview tokens'
);

select ok(
  not has_column_privilege('anon', 'public.blog_posts', 'topic', 'select'),
  'anon cannot read the raw editorial topic'
);

select ok(
  not has_table_privilege('anon', 'public.blog_post_revisions', 'select'),
  'anon cannot read revision history'
);

select ok(
  not has_table_privilege('anon', 'public.blog_posts', 'insert'),
  'anon cannot create posts'
);

select ok(
  has_table_privilege('service_role', 'public.blog_post_translations', 'update'),
  'service_role can update translations for the editorial bot'
);

set local role anon;

select is(
  (select array_agg(slug::text order by slug) from public.blog_posts where slug like 'test-%'),
  array['test-published-post']::text[],
  'anon sees only published posts'
);

select is(
  (
    select array_agg(t.locale::text order by t.locale)
    from public.blog_post_translations t
    join public.blog_posts p on p.id = t.post_id
    where p.slug like 'test-%'
  ),
  array['ru']::text[],
  'anon sees only published translations of published posts'
);

select is(
  (
    select count(*)::int
    from public.blog_images i
    where i.slot = 'inline-1' and i.placeholder_note = 'portal screenshot'
  ),
  0,
  'anon cannot see images of unpublished posts'
);

select ok(
  public.get_blog_preview('00000000-0000-0000-0000-000000000000'::uuid) is null,
  'an unknown preview token returns nothing'
);

reset role;

select is(
  (
    select public.get_blog_preview(preview_token)->>'slug'
    from public.blog_posts where slug = 'test-review-post'
  ),
  'test-review-post',
  'a valid preview token returns the draft'
);

select is(
  (
    select jsonb_array_length(public.get_blog_preview(preview_token)->'translations')
    from public.blog_posts where slug = 'test-published-post'
  ),
  2,
  'preview includes translations in every status'
);

update public.blog_posts set status = 'archived' where slug = 'test-review-post';

select ok(
  (
    select public.get_blog_preview(preview_token) is null
    from public.blog_posts where slug = 'test-review-post'
  ),
  'archived drafts are not previewable'
);

select * from finish();
rollback;
