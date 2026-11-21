begin;

select plan(9);

select is((select count(*)::int from public.news_scout_settings), 1, 'the pause switch has exactly one row');
select is((select paused from public.news_scout_settings), false, 'monitoring is on by default');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.news_scout_settings'::regclass),
  'row level security is on'
);
select ok(not has_table_privilege('anon', 'public.news_scout_settings', 'select'), 'anon cannot read the pause switch');
select ok(not has_table_privilege('authenticated', 'public.news_scout_settings', 'update'), 'authenticated cannot change it');
select ok(has_table_privilege('service_role', 'public.news_scout_settings', 'update'), 'the server can change it');

-- The conditional updates the bot relies on: of two identical taps only the first changes anything.
with first_tap as (
  update public.news_scout_settings set paused = true, paused_at = now() where id and not paused returning id
)
select is((select count(*)::int from first_tap), 1, 'the first pause changes the state');

with second_tap as (
  update public.news_scout_settings set paused = true, paused_at = now() where id and not paused returning id
)
select is((select count(*)::int from second_tap), 0, 'a repeated pause changes nothing');

select throws_ok(
  $$ insert into public.news_scout_settings (id) values (false) $$,
  '23514',
  null,
  'there can never be a second row'
);

select * from finish();
rollback;
