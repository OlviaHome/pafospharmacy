begin;

select plan(14);

insert into public.blog_posts (slug, topic, status)
values
  ('test-sched-a', 'a', 'review'),
  ('test-sched-b', 'b', 'review'),
  ('test-sched-c', 'c', 'paused');

insert into public.blog_post_translations (post_id, locale, status, title)
select id, 'ru', 'review', 'Запланированная' from public.blog_posts where slug = 'test-sched-a';

select is(
  public.schedule_blog_post(
    (select id from public.blog_posts where slug = 'test-sched-a'),
    now() + interval '1 day', 'queue', repeat('a', 64), '{}', array['review']
  ),
  'ok',
  'an article in review can be scheduled'
);

select is(
  (select status from public.blog_posts where slug = 'test-sched-a'),
  'scheduled',
  'the article gets the scheduled status'
);

select is(
  public.schedule_blog_post(
    (select id from public.blog_posts where slug = 'test-sched-b'),
    now() + interval '1 day', 'queue', repeat('a', 64), '{}', array['review']
  ),
  'slot_taken',
  'two articles never share a slot'
);

select is(
  (select status from public.blog_posts where slug = 'test-sched-b'),
  'review',
  'a refused scheduling leaves the article as it was'
);

select is(
  public.schedule_blog_post(
    (select id from public.blog_posts where slug = 'test-sched-a'),
    now() + interval '2 days', 'queue', repeat('a', 64), '{}', array['review', 'scheduled']
  ),
  'post_taken',
  'an article has at most one active entry'
);

select is(
  public.schedule_blog_post(
    (select id from public.blog_posts where slug = 'test-sched-b'),
    now() - interval '1 minute', 'manual', repeat('a', 64), '{}', array['review']
  ),
  'past',
  'a time in the past is refused'
);

select is(
  public.schedule_blog_post(
    (select id from public.blog_posts where slug = 'test-sched-c'),
    now() + interval '3 days', 'manual', repeat('a', 64), '{}', array['review']
  ),
  'status',
  'only the given statuses can be scheduled'
);

select is(
  public.schedule_blog_post(
    (select id from public.blog_posts where slug = 'test-sched-b'),
    now() + interval '2 days', 'manual', repeat('b', 64), '{links}', array['review']
  ),
  'ok',
  'another time is fine'
);

select is(
  public.move_blog_schedule(
    array(select s.id from public.blog_publish_schedule s join public.blog_posts p on p.id = s.post_id where p.slug like 'test-sched-%' order by s.scheduled_at),
    array(select s.scheduled_at from public.blog_publish_schedule s join public.blog_posts p on p.id = s.post_id where p.slug like 'test-sched-%' order by s.scheduled_at desc)
  ),
  'ok',
  'two entries can swap their times'
);

select ok(
  public.release_blog_schedule(
    (select s.id from public.blog_publish_schedule s join public.blog_posts p on p.id = s.post_id where p.slug = 'test-sched-a'),
    array['scheduled'], 'cancelled', 'removed', true, null
  ),
  'an entry leaves the queue'
);

select ok(
  not public.release_blog_schedule(
    (select s.id from public.blog_publish_schedule s join public.blog_posts p on p.id = s.post_id where p.slug = 'test-sched-a'),
    array['scheduled'], 'cancelled', 'removed', true, null
  ),
  'a second release does nothing'
);

select is(
  (select status from public.blog_posts where slug = 'test-sched-a'),
  'review',
  'the released article is back in review, with its texts'
);

set local role anon;

select is(
  (select count(*)::int from public.blog_posts where slug like 'test-sched-%'),
  0,
  'anon never sees scheduled articles'
);

reset role;

select ok(
  not has_table_privilege('anon', 'public.blog_publish_schedule', 'select')
    and not has_table_privilege('anon', 'public.blog_publish_settings', 'select'),
  'the calendar tables are private'
);

select * from finish();
rollback;
