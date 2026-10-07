drop index public.pharmacy_google_places_exact_place_id_idx;

create index pharmacy_google_places_exact_place_id_idx
  on public.pharmacy_google_places (place_id)
  where classification = 'exact_identity_match';

create function public.enforce_active_google_place_id_uniqueness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'pharmacy-google-registration:' || new.official_registration_number,
      0
    )
  );

  if new.classification <> 'exact_identity_match' or new.place_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pharmacy-google-place:' || new.place_id, 0)
  );

  if exists (
    select 1
    from public.pharmacies as current_pharmacy
    where current_pharmacy.official_registration_number =
      new.official_registration_number
      and current_pharmacy.is_active
  ) and exists (
    select 1
    from public.pharmacy_google_places as existing_link
    join public.pharmacies as existing_pharmacy
      on existing_pharmacy.official_registration_number =
        existing_link.official_registration_number
    where existing_link.place_id = new.place_id
      and existing_link.classification = 'exact_identity_match'
      and existing_link.official_registration_number <>
        new.official_registration_number
      and existing_pharmacy.is_active
  ) then
    raise unique_violation using
      message = 'An active pharmacy already has this exact Google Place ID.';
  end if;

  return new;
end;
$$;

create trigger pharmacy_google_places_active_place_id_unique
before insert or update of official_registration_number, place_id, classification
on public.pharmacy_google_places
for each row
execute function public.enforce_active_google_place_id_uniqueness();

create function public.enforce_google_place_id_uniqueness_on_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  exact_place_id text;
begin
  if not new.is_active or old.is_active then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'pharmacy-google-registration:' || new.official_registration_number,
      0
    )
  );

  select google_link.place_id
  into exact_place_id
  from public.pharmacy_google_places as google_link
  where google_link.official_registration_number =
    new.official_registration_number
    and google_link.classification = 'exact_identity_match';

  if exact_place_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pharmacy-google-place:' || exact_place_id, 0)
  );

  if exists (
    select 1
    from public.pharmacy_google_places as existing_link
    join public.pharmacies as existing_pharmacy
      on existing_pharmacy.official_registration_number =
        existing_link.official_registration_number
    where existing_link.place_id = exact_place_id
      and existing_link.classification = 'exact_identity_match'
      and existing_link.official_registration_number <>
        new.official_registration_number
      and existing_pharmacy.is_active
  ) then
    raise unique_violation using
      message = 'An active pharmacy already has this exact Google Place ID.';
  end if;

  return new;
end;
$$;

create trigger pharmacies_active_google_place_id_unique
before update of is_active
on public.pharmacies
for each row
execute function public.enforce_google_place_id_uniqueness_on_activation();

revoke all
  on function public.enforce_active_google_place_id_uniqueness()
  from public, anon, authenticated;

revoke all
  on function public.enforce_google_place_id_uniqueness_on_activation()
  from public, anon, authenticated;

comment on function public.enforce_active_google_place_id_uniqueness() is
  'Allows historical licence rows to share a physical Google Place ID while rejecting duplicate exact mappings among active registrations.';

comment on function public.enforce_google_place_id_uniqueness_on_activation() is
  'Prevents reactivation of a licence whose exact Google Place ID is already assigned to another active registration.';
