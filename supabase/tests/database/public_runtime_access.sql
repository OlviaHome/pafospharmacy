begin;

select plan(7);

select is(
  (
    select array_agg(distinct column_name::text order by column_name::text)
    from information_schema.column_privileges
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name = 'pharmacies'
      and privilege_type = 'SELECT'
  ),
  array[
    'address_additional',
    'address_line',
    'district',
    'geocode_provider',
    'geocode_quality',
    'geocode_query',
    'geocode_result_identifier',
    'geocoded_at',
    'id',
    'is_active',
    'latitude',
    'locality',
    'longitude',
    'name',
    'official_registration_number',
    'pharmacist_given_name',
    'pharmacist_surname',
    'phone_e164',
    'postal_code',
    'source',
    'source_dataset',
    'source_resource_url',
    'source_retrieved_at'
  ]::text[],
  'anon can select exactly the public runtime pharmacy columns'
);

select is(
  (
    select array_agg(distinct column_name::text order by column_name::text)
    from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name = 'pharmacies'
      and privilege_type = 'SELECT'
  ),
  array[
    'address_additional',
    'address_line',
    'district',
    'geocode_provider',
    'geocode_quality',
    'geocode_query',
    'geocode_result_identifier',
    'geocoded_at',
    'id',
    'is_active',
    'latitude',
    'locality',
    'longitude',
    'name',
    'official_registration_number',
    'pharmacist_given_name',
    'pharmacist_surname',
    'phone_e164',
    'postal_code',
    'source',
    'source_dataset',
    'source_resource_url',
    'source_retrieved_at'
  ]::text[],
  'authenticated can select exactly the public runtime pharmacy columns'
);

select ok(
  not has_table_privilege('anon', 'public.pharmacies', 'select'),
  'anon has no broad table-level pharmacy select grant'
);

select ok(
  not has_table_privilege('authenticated', 'public.pharmacies', 'select'),
  'authenticated has no broad table-level pharmacy select grant'
);

select ok(
  has_table_privilege('service_role', 'public.pharmacies', 'select'),
  'service_role retains broad pharmacy select for imports'
);

select ok(
  has_table_privilege('service_role', 'public.pharmacies', 'insert'),
  'service_role retains pharmacy insert for imports'
);

select ok(
  has_table_privilege('service_role', 'public.pharmacies', 'update'),
  'service_role retains pharmacy update for imports'
);

select * from finish();
rollback;
