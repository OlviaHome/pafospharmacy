begin;

select plan(10);

select ok(not has_table_privilege('anon', 'public.blog_agent_jobs', 'select'), 'anon cannot read agent jobs');
select ok(not has_table_privilege('anon', 'public.blog_ai_usage', 'select'), 'anon cannot read AI usage');
select ok(not has_table_privilege('anon', 'public.blog_bot_messages', 'select'), 'anon cannot read bot messages');
select ok(not has_column_privilege('anon', 'public.blog_posts', 'editor_notes', 'select'), 'anon cannot read editor notes');
select ok(not has_function_privilege('anon', 'public.claim_blog_agent_job(bigint)', 'execute'), 'anon cannot claim jobs');

select ok(not has_column_privilege('anon', 'public.blog_posts', 'source_checks', 'select'), 'anon cannot read link checks');
select ok(has_column_privilege('anon', 'public.blog_posts', 'view_count', 'select'), 'anon can read view counts');
select ok(has_function_privilege('anon', 'public.increment_blog_view(text)', 'execute'), 'anon can count a view');

insert into public.blog_agent_jobs (kind) values ('write');

select is(
  (select count(*)::int from public.claim_blog_agent_job((select max(id) from public.blog_agent_jobs))),
  1,
  'the first claim gets the job'
);

select is(
  (select count(*)::int from public.claim_blog_agent_job((select max(id) from public.blog_agent_jobs))),
  0,
  'a second claim gets nothing'
);

select * from finish();
rollback;
