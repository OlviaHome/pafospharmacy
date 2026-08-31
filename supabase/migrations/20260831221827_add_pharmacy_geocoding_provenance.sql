alter table public.pharmacies
  add column geocode_provider text,
  add column geocode_result_identifier text,
  add column geocode_query text,
  add column geocode_quality text,
  add column geocoded_at timestamptz,
  add constraint pharmacies_coordinate_pair_complete
    check ((latitude is null) = (longitude is null)),
  add constraint pharmacies_geocode_quality_valid
    check (geocode_quality is null or geocode_quality in ('high', 'medium')),
  add constraint pharmacies_geocode_provenance_complete
    check (
      (
        geocode_provider is null
        and geocode_result_identifier is null
        and geocode_query is null
        and geocode_quality is null
        and geocoded_at is null
      )
      or
      (
        latitude is not null
        and longitude is not null
        and geocode_provider is not null
        and geocode_result_identifier is not null
        and geocode_query is not null
        and geocode_quality is not null
        and geocoded_at is not null
        and btrim(geocode_provider) <> ''
        and btrim(geocode_result_identifier) <> ''
        and btrim(geocode_query) <> ''
      )
    );

comment on column public.pharmacies.latitude is
  'Nullable coordinate latitude. Official directory imports do not populate or overwrite this independently sourced enrichment.';

comment on column public.pharmacies.longitude is
  'Nullable coordinate longitude. Official directory imports do not populate or overwrite this independently sourced enrichment.';

comment on column public.pharmacies.geocode_provider is
  'Provider that produced the coordinate enrichment; null for coordinates not produced by a geocoding run, such as synthetic fixtures.';

comment on column public.pharmacies.geocode_result_identifier is
  'Provider-specific identifier for the accepted result. Nominatim enrichments use the stable OSM object type and ID, not its internal place_id.';

comment on column public.pharmacies.geocode_query is
  'Exact address query submitted to the geocoding provider.';

comment on column public.pharmacies.geocode_quality is
  'Conservative application reconciliation grade (high or medium), not a provider confidence score.';

comment on column public.pharmacies.geocoded_at is
  'Time the accepted geocoding result was retrieved.';
