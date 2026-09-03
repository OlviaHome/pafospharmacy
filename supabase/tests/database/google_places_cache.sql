begin;

select plan(14);

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

select * from finish();
rollback;
