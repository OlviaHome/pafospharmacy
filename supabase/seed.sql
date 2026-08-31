-- SYNTHETIC DEVELOPMENT DATA ONLY.
-- Names, contact details, opening intervals, and duty assignments below are
-- invented for testing. They must never be presented as official/current data.

insert into public.pharmacies (
  id, name, address_line, locality, postal_code, latitude, longitude, phone_e164
) overriding system value values
  (9001, 'Harbour Demo Pharmacy', '18 Poseidonos Avenue', 'Kato Paphos', '8042', 34.7559, 32.4076, '+35726000001'),
  (9002, 'Tombs Road Test Pharmacy', '42 Tombs of the Kings Avenue', 'Paphos', '8015', 34.7765, 32.4097, '+35726000002'),
  (9003, 'Old Town Sample Pharmacy', '7 Kennedy Square', 'Ktima', '8010', 34.7761, 32.4218, '+35726000003'),
  (9004, 'Universal Demo Pharmacy', '12 Agapinoros Street', 'Universal', '8036', 34.7608, 32.4274, '+35726000004'),
  (9005, 'Chloraka Test Pharmacy', '31 Eleftherias Avenue', 'Chloraka', '8220', 34.7986, 32.4072, '+35726000005');

with cyprus_day as (
  select date_trunc('day', now() at time zone 'Europe/Nicosia') as today
)
insert into public.availability_intervals (
  pharmacy_id, starts_at, ends_at, schedule_kind, service_mode
)
select pharmacy_id, starts_at, ends_at, schedule_kind, service_mode
from cyprus_day
cross join lateral (
  values
    (9001, now() - interval '2 hours', now() + interval '5 hours', 'ordinary', 'open'),
    (9001, now() - interval '1 hour', now() + interval '2 hours', 'duty', 'open'),
    (9002, now() - interval '2 hours', now() + interval '2 hours', 'ordinary', 'open'),
    (9002, now() - interval '1 hour', now() + interval '4 hours', 'duty', 'on_call'),
    (9003, now() - interval '30 minutes', now() + interval '6 hours', 'duty', 'unknown'),
    (9004, now() - interval '3 hours', now() + interval '3 hours', 'ordinary', 'open'),
    (9005, (today + interval '23 hours') at time zone 'Europe/Nicosia', (today + interval '1 day 2 hours') at time zone 'Europe/Nicosia', 'duty', 'on_call'),
    (9001, (today + interval '1 day 9 hours') at time zone 'Europe/Nicosia', (today + interval '1 day 19 hours') at time zone 'Europe/Nicosia', 'ordinary', 'open'),
    (9001, (today + interval '1 day 13 hours 30 minutes') at time zone 'Europe/Nicosia', (today + interval '1 day 16 hours') at time zone 'Europe/Nicosia', 'duty', 'open'),
    (9002, (today + interval '1 day 8 hours') at time zone 'Europe/Nicosia', (today + interval '1 day 12 hours') at time zone 'Europe/Nicosia', 'duty', 'on_call'),
    (9003, (today + interval '1 day 20 hours') at time zone 'Europe/Nicosia', (today + interval '1 day 23 hours') at time zone 'Europe/Nicosia', 'duty', 'unknown'),
    (9004, (today + interval '1 day 8 hours 30 minutes') at time zone 'Europe/Nicosia', (today + interval '1 day 18 hours') at time zone 'Europe/Nicosia', 'ordinary', 'open')
) as intervals(pharmacy_id, starts_at, ends_at, schedule_kind, service_mode);
