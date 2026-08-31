alter table public.pharmacies
  add column house_phone_raw text,
  add column house_phone_e164_values text[] not null default '{}'::text[],
  add constraint pharmacies_house_phone_e164_values_format
    check (
      array_position(house_phone_e164_values, null) is null
      and (
        cardinality(house_phone_e164_values) = 0
        or array_to_string(house_phone_e164_values, ',')
          ~ '^\+[1-9][0-9]{7,14}(,\+[1-9][0-9]{7,14})*$'
      )
    );

comment on column public.pharmacies.house_phone_raw is
  'Exact decoded source-field value for House Tel. No.; separators and embedded line breaks are preserved.';

comment on column public.pharmacies.house_phone_e164_values is
  'Distinct valid E.164 numbers parsed from house_phone_raw in source order. Multiple values have no implied priority.';
