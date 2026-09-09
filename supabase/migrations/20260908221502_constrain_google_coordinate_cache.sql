update public.pharmacy_google_places
set
  display_name = null,
  formatted_address = null,
  google_phone_e164 = null,
  latitude = case
    when classification = 'exact_identity_match' then latitude
    else null
  end,
  longitude = case
    when classification = 'exact_identity_match' then longitude
    else null
  end
where
  display_name is not null
  or formatted_address is not null
  or google_phone_e164 is not null
  or (
    classification <> 'exact_identity_match'
    and latitude is not null
  );

alter table public.pharmacy_google_places
  drop constraint pharmacy_google_places_cached_content_complete,
  add constraint pharmacy_google_places_google_content_not_persisted
    check (
      display_name is null
      and formatted_address is null
      and google_phone_e164 is null
    ),
  add constraint pharmacy_google_places_coordinates_exact_only
    check (
      (latitude is null and longitude is null)
      or classification = 'exact_identity_match'
    );

comment on table public.pharmacy_google_places is
  'Paphos-only Google Places reconciliation. Place IDs and reconciliation metadata are durable; only exact-match coordinates may be cached, for no more than 30 days.';

comment on column public.pharmacy_google_places.display_name is
  'Reserved nullable compatibility column. Google display names are not persisted.';

comment on column public.pharmacy_google_places.formatted_address is
  'Reserved nullable compatibility column. Google formatted addresses are not persisted and never replace the official address.';

comment on column public.pharmacy_google_places.google_phone_e164 is
  'Reserved nullable compatibility column. Google phone values are not persisted and never replace the official phone.';

comment on column public.pharmacy_google_places.latitude is
  'Temporary latitude cache for exact identity matches only; expires within 30 days.';

comment on column public.pharmacy_google_places.longitude is
  'Temporary longitude cache for exact identity matches only; expires within 30 days.';

comment on column public.pharmacy_google_places.expires_at is
  'Hard expiry for temporary Google coordinates, no more than 720 hours after retrieval.';
