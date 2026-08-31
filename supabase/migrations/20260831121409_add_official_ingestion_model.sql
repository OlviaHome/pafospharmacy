alter table public.pharmacies
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column phone_e164 drop not null;

alter table public.pharmacies
  add column official_registration_number text,
  add column pharmacist_given_name text,
  add column pharmacist_surname text,
  add column address_additional text,
  add column district text,
  add column house_phone_e164 text,
  add column source text not null default 'legacy',
  add column source_dataset text,
  add column source_record_identifier text,
  add column source_resource_url text,
  add column source_retrieved_at timestamptz;

alter table public.pharmacies
  add constraint pharmacies_official_registration_number_nonempty
    check (
      official_registration_number is null
      or btrim(official_registration_number) <> ''
    ),
  add constraint pharmacies_official_registration_number_key
    unique (official_registration_number),
  add constraint pharmacies_house_phone_e164_format
    check (
      house_phone_e164 is null
      or house_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    ),
  add constraint pharmacies_source_valid
    check (
      source in (
        'legacy',
        'synthetic_fixture',
        'cyprus_open_data',
        'pharmacy_confirmed',
        'third_party'
      )
    );

create unique index pharmacies_source_record_identifier_idx
  on public.pharmacies (source, source_record_identifier)
  where source_record_identifier is not null;

create index pharmacies_active_district_idx
  on public.pharmacies (district)
  where is_active;

create table public.duty_assignments (
  id bigint generated always as identity primary key,
  pharmacy_id bigint not null references public.pharmacies(id) on delete restrict,
  duty_date date not null,
  source text not null,
  source_dataset text not null check (btrim(source_dataset) <> ''),
  source_record_identifier text not null check (btrim(source_record_identifier) <> ''),
  source_resource_url text not null check (btrim(source_resource_url) <> ''),
  source_retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_assignments_source_valid
    check (source in ('cyprus_open_data', 'pharmacy_confirmed', 'third_party')),
  constraint duty_assignments_source_record_identifier_key
    unique (source, source_record_identifier),
  constraint duty_assignments_pharmacy_date_dataset_key
    unique (pharmacy_id, duty_date, source_dataset)
);

create index duty_assignments_duty_date_pharmacy_id_idx
  on public.duty_assignments (duty_date, pharmacy_id);

alter table public.duty_assignments enable row level security;

revoke all on table public.duty_assignments from anon, authenticated;
grant select on table public.duty_assignments to anon, authenticated;

create policy duty_assignments_public_read_active_pharmacy
  on public.duty_assignments
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.pharmacies
      where pharmacies.id = duty_assignments.pharmacy_id
        and pharmacies.is_active
    )
  );

comment on table public.duty_assignments is
  'Date-only duty-rota assignments. Rows do not establish opening hours, on-call mode, or start/end times.';

comment on column public.pharmacies.official_registration_number is
  'Stable external identity assigned by the Cyprus Pharmaceutical Services when available.';

comment on column public.pharmacies.source is
  'Row-level provenance category; field-level provenance is intentionally out of scope for the MVP.';
