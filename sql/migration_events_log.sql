-- Migration: tabela logów zdarzeń systemu Parking.OS
-- Uruchom raz w Supabase SQL editor

create table if not exists public.events (
  id          bigserial primary key,
  event_type  text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

-- Indeks dla szybkiego sortowania po dacie
create index if not exists events_created_at_idx on public.events (created_at desc);

-- RLS: odczyt i zapis dla service_role (bot) i anon (OS przez anon key)
alter table public.events enable row level security;

create policy "service_role full access" on public.events
  for all to service_role using (true) with check (true);

create policy "anon insert" on public.events
  for insert to anon with check (true);

create policy "anon select" on public.events
  for select to anon using (true);
