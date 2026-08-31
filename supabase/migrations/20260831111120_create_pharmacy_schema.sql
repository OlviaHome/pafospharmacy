create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

set search_path = public, extensions;

create table public.pharmacies (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  address_line text not null check (btrim(address_line) <> ''),
  locality text not null check (btrim(locality) <> ''),
  postal_code text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.availability_intervals (
  id bigint generated always as identity primary key,
  pharmacy_id bigint not null references public.pharmacies(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  schedule_kind text not null check (schedule_kind in ('ordinary', 'duty')),
  service_mode text not null check (service_mode in ('open', 'on_call', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_intervals_positive_duration check (ends_at > starts_at),
  constraint availability_intervals_valid_kind_mode check (
    (schedule_kind = 'ordinary' and service_mode = 'open')
    or
    (schedule_kind = 'duty' and service_mode in ('open', 'on_call', 'unknown'))
  ),
  constraint availability_intervals_no_same_kind_overlap
    exclude using gist (
      pharmacy_id with =,
      schedule_kind with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    )
);

create index availability_intervals_pharmacy_id_idx
  on public.availability_intervals (pharmacy_id);

alter table public.pharmacies enable row level security;
alter table public.availability_intervals enable row level security;

revoke all on table public.pharmacies from anon, authenticated;
revoke all on table public.availability_intervals from anon, authenticated;
grant select on table public.pharmacies to anon, authenticated;
grant select on table public.availability_intervals to anon, authenticated;

create policy pharmacies_public_read_active
  on public.pharmacies
  for select
  to anon, authenticated
  using (is_active);

create policy availability_intervals_public_read_active_pharmacy
  on public.availability_intervals
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.pharmacies
      where pharmacies.id = availability_intervals.pharmacy_id
        and pharmacies.is_active
    )
  );
