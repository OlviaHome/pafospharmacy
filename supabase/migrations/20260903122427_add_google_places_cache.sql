create table public.pharmacy_google_places (
  official_registration_number text primary key
    references public.pharmacies (official_registration_number) on delete restrict,
  place_id text,
  display_name text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  google_phone_e164 text,
  classification text not null,
  matching_evidence text[] not null default '{}',
  retrieved_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pharmacy_google_places_place_id_nonempty
    check (place_id is null or btrim(place_id) <> ''),
  constraint pharmacy_google_places_classification_valid
    check (
      classification in (
        'exact_identity_match',
        'probable_match',
        'ambiguous',
        'no_match'
      )
    ),
  constraint pharmacy_google_places_match_has_place_id
    check ((classification = 'no_match') = (place_id is null)),
  constraint pharmacy_google_places_coordinates_complete
    check ((latitude is null) = (longitude is null)),
  constraint pharmacy_google_places_latitude_valid
    check (latitude is null or latitude between -90 and 90),
  constraint pharmacy_google_places_longitude_valid
    check (longitude is null or longitude between -180 and 180),
  constraint pharmacy_google_places_cached_content_complete
    check (
      (display_name is null and formatted_address is null and latitude is null)
      or
      (display_name is not null and formatted_address is not null and latitude is not null)
    ),
  constraint pharmacy_google_places_phone_valid
    check (
      google_phone_e164 is null
      or google_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    ),
  constraint pharmacy_google_places_expiry_valid
    check (
      expires_at > retrieved_at
      and expires_at <= retrieved_at + interval '720 hours'
    )
);

create unique index pharmacy_google_places_exact_place_id_idx
  on public.pharmacy_google_places (place_id)
  where classification = 'exact_identity_match';

create index pharmacy_google_places_refresh_idx
  on public.pharmacy_google_places (expires_at)
  where latitude is not null;

alter table public.pharmacy_google_places enable row level security;

revoke all on table public.pharmacy_google_places from anon, authenticated;
grant select on table public.pharmacy_google_places to anon, authenticated;
grant select, insert, update, delete
  on table public.pharmacy_google_places
  to service_role;

create policy pharmacy_google_places_public_read_fresh_exact
  on public.pharmacy_google_places
  for select
  to anon, authenticated
  using (
    classification = 'exact_identity_match'
    and latitude is not null
    and longitude is not null
    and expires_at > now()
    and exists (
      select 1
      from public.pharmacies
      where pharmacies.official_registration_number =
        pharmacy_google_places.official_registration_number
        and pharmacies.is_active
    )
  );

comment on table public.pharmacy_google_places is
  'Paphos-only Google Places reconciliation. Place IDs are durable provider links; returned Google content, including coordinates, must be refreshed or deleted within 30 days.';

comment on column public.pharmacy_google_places.official_registration_number is
  'Canonical Cyprus Pharmaceutical Services identity; Google Places never replaces it.';

comment on column public.pharmacy_google_places.classification is
  'Identity decision. Only unexpired exact_identity_match rows may supply runtime coordinates.';

comment on column public.pharmacy_google_places.expires_at is
  'Hard expiry for cached Google response content, no more than 720 hours after retrieval.';
