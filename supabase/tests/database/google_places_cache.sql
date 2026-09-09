begin;

select plan(23);

create function pg_temp.caught_constraint(statement text)
returns text
language plpgsql
as $$
declare
  caught_constraint_name text;
begin
  execute statement;
  return null;
exception when others then
  get stacked diagnostics caught_constraint_name = constraint_name;
  return caught_constraint_name;
end;
$$;

select has_table('public', 'pharmacy_google_places');
select col_is_pk(
  'public',
  'pharmacy_google_places',
  'official_registration_number'
);
select has_column('public', 'pharmacy_google_places', 'place_id');
select has_column('public', 'pharmacy_google_places', 'display_name');
select has_column('public', 'pharmacy_google_places', 'formatted_address');
select has_column('public', 'pharmacy_google_places', 'latitude');
select has_column('public', 'pharmacy_google_places', 'longitude');
select has_column('public', 'pharmacy_google_places', 'google_phone_e164');
select has_column('public', 'pharmacy_google_places', 'classification');
select has_column('public', 'pharmacy_google_places', 'matching_evidence');
select has_column('public', 'pharmacy_google_places', 'retrieved_at');
select has_column('public', 'pharmacy_google_places', 'expires_at');
select has_index(
  'public',
  'pharmacy_google_places',
  'pharmacy_google_places_refresh_idx'
);
select policies_are(
  'public',
  'pharmacy_google_places',
  array['pharmacy_google_places_public_read_fresh_exact']
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pharmacy_google_places'::regclass
      and conname = 'pharmacy_google_places_google_content_not_persisted'
  ),
  'Google descriptive response content is prohibited'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pharmacy_google_places'::regclass
      and conname = 'pharmacy_google_places_coordinates_exact_only'
  ),
  'Google coordinates are limited to exact identity matches'
);

insert into public.pharmacies (
  name,
  address_line,
  locality,
  district,
  official_registration_number
)
values
  ('Cache exact', 'Official address 1', 'Paphos', 'Paphos', 'cache-exact'),
  ('Cache probable', 'Official address 2', 'Paphos', 'Paphos', 'cache-probable'),
  ('Cache descriptive', 'Official address 3', 'Paphos', 'Paphos', 'cache-descriptive'),
  ('Cache expiry', 'Official address 4', 'Paphos', 'Paphos', 'cache-expiry');

select lives_ok(
  $$
    insert into public.pharmacy_google_places (
      official_registration_number,
      place_id,
      latitude,
      longitude,
      classification,
      matching_evidence,
      retrieved_at,
      expires_at
    ) values (
      'cache-exact',
      'place-cache-exact',
      34.75,
      32.42,
      'exact_identity_match',
      array['phone_exact'],
      '2026-09-09T00:00:00Z',
      '2026-10-09T00:00:00Z'
    )
  $$,
  'exact Google coordinates do not require name, address, or phone content'
);

select lives_ok(
  $$
    insert into public.pharmacy_google_places (
      official_registration_number,
      place_id,
      classification,
      matching_evidence,
      retrieved_at,
      expires_at
    ) values (
      'cache-probable',
      'place-cache-probable',
      'probable_match',
      array['address_evidence'],
      '2026-09-09T00:00:00Z',
      '2026-10-09T00:00:00Z'
    )
  $$,
  'probable reconciliation metadata may remain without coordinates'
);

select is(
  pg_temp.caught_constraint($$
    insert into public.pharmacy_google_places (
      official_registration_number,
      place_id,
      display_name,
      classification,
      retrieved_at,
      expires_at
    ) values (
      'cache-descriptive',
      'place-cache-descriptive',
      'Google name',
      'exact_identity_match',
      '2026-09-09T00:00:00Z',
      '2026-10-09T00:00:00Z'
    )
  $$),
  'pharmacy_google_places_google_content_not_persisted',
  'Google display name cannot be persisted'
);

select is(
  pg_temp.caught_constraint($$
    update public.pharmacy_google_places
    set latitude = 34.75, longitude = 32.42
    where official_registration_number = 'cache-probable'
  $$),
  'pharmacy_google_places_coordinates_exact_only',
  'probable Google coordinates cannot be persisted'
);

select is(
  pg_temp.caught_constraint($$
    insert into public.pharmacy_google_places (
      official_registration_number,
      place_id,
      classification,
      retrieved_at,
      expires_at
    ) values (
      'cache-expiry',
      'place-cache-expiry',
      'exact_identity_match',
      '2026-09-09T00:00:00Z',
      '2026-10-09T00:00:01Z'
    )
  $$),
  'pharmacy_google_places_expiry_valid',
  'Google coordinate-cache lifetime cannot exceed 30 days'
);

select is(
  (
    select count(*)::integer
    from public.pharmacy_google_places
    where display_name is not null
      or formatted_address is not null
      or google_phone_e164 is not null
  ),
  0,
  'persisted Google descriptive fields remain null'
);

select is(
  (
    select count(*)::integer
    from public.pharmacy_google_places
    where classification <> 'exact_identity_match'
      and latitude is not null
  ),
  0,
  'non-exact reconciliation rows contain no coordinates'
);

select * from finish();
rollback;
