revoke select on table public.pharmacies from anon, authenticated;

grant select (
  id,
  name,
  address_line,
  address_additional,
  locality,
  district,
  postal_code,
  latitude,
  longitude,
  geocode_provider,
  geocode_result_identifier,
  geocode_query,
  geocode_quality,
  geocoded_at,
  phone_e164,
  official_registration_number,
  pharmacist_given_name,
  pharmacist_surname,
  source,
  source_dataset,
  source_resource_url,
  source_retrieved_at,
  is_active
) on table public.pharmacies to anon, authenticated;

comment on column public.pharmacies.house_phone_raw is
  'Exact decoded House Tel. No. source value. Retained for privileged ingestion and provenance; not granted to public Data API roles.';

comment on column public.pharmacies.house_phone_e164 is
  'Conservative singular normalized house phone. Retained internally and not granted to public Data API roles.';

comment on column public.pharmacies.house_phone_e164_values is
  'Distinct normalized house phones in source order. Retained internally and not granted to public Data API roles.';
