begin;

select plan(24);

select has_table('public', 'duty_assignments');
select col_is_pk('public', 'duty_assignments', 'id');
select hasnt_column('public', 'duty_assignments', 'service_mode');
select has_column('public', 'pharmacies', 'official_registration_number');
select has_column('public', 'pharmacies', 'district');
select has_column('public', 'pharmacies', 'house_phone_raw');
select has_column('public', 'pharmacies', 'house_phone_e164_values');
select has_column('public', 'pharmacies', 'geocode_provider');
select has_column('public', 'pharmacies', 'geocode_result_identifier');
select has_column('public', 'pharmacies', 'geocode_query');
select has_column('public', 'pharmacies', 'geocode_quality');
select has_column('public', 'pharmacies', 'geocoded_at');
select col_is_null('public', 'pharmacies', 'latitude');
select col_is_null('public', 'pharmacies', 'longitude');
select has_index(
  'public',
  'duty_assignments',
  'duty_assignments_duty_date_pharmacy_id_idx'
);
select policies_are(
  'public',
  'duty_assignments',
  array['duty_assignments_public_read_active_pharmacy']
);
select ok(
  has_table_privilege('service_role', 'public.pharmacies', 'select'),
  'service_role can inspect pharmacies for idempotent imports'
);
select ok(
  has_table_privilege('service_role', 'public.pharmacies', 'insert'),
  'service_role can insert official pharmacies'
);
select ok(
  has_table_privilege('service_role', 'public.pharmacies', 'update'),
  'service_role can update official pharmacies'
);
select ok(
  has_sequence_privilege('service_role', 'public.pharmacies_id_seq', 'usage'),
  'service_role can generate pharmacy identity values'
);
select ok(
  has_table_privilege('service_role', 'public.duty_assignments', 'select'),
  'service_role can inspect duty assignments for idempotent imports'
);
select ok(
  has_table_privilege('service_role', 'public.duty_assignments', 'insert'),
  'service_role can insert official duty assignments'
);
select ok(
  has_table_privilege('service_role', 'public.duty_assignments', 'update'),
  'service_role can update official duty assignments'
);
select ok(
  has_sequence_privilege(
    'service_role',
    'public.duty_assignments_id_seq',
    'usage'
  ),
  'service_role can generate duty-assignment identity values'
);

select * from finish();
rollback;
