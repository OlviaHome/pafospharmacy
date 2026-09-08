grant select, insert, update
  on table public.pharmacies
  to service_role;

grant select, insert, update
  on table public.duty_assignments
  to service_role;

grant usage
  on sequence public.pharmacies_id_seq
  to service_role;

grant usage
  on sequence public.duty_assignments_id_seq
  to service_role;
