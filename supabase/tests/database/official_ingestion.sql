begin;

select plan(16);

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

select * from finish();
rollback;
