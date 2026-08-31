begin;

select plan(8);

select has_table('public', 'pharmacies');
select has_table('public', 'availability_intervals');
select col_is_pk('public', 'pharmacies', 'id');
select col_is_pk('public', 'availability_intervals', 'id');
select has_index('public', 'availability_intervals', 'availability_intervals_pharmacy_id_idx');
select policies_are(
  'public',
  'pharmacies',
  array['pharmacies_public_read_active']
);
select policies_are(
  'public',
  'availability_intervals',
  array['availability_intervals_public_read_active_pharmacy']
);
select ok(
  (
    select count(*)
    from public.availability_intervals a
    join public.availability_intervals b
      on a.pharmacy_id = b.pharmacy_id
      and a.schedule_kind <> b.schedule_kind
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
    where a.id < b.id
  ) > 0,
  'ordinary and duty seed intervals may overlap'
);

select * from finish();
rollback;
