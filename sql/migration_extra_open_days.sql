-- Migration: dni otwarte poza harmonogramem
-- Uruchom raz w Supabase SQL editor

create table if not exists public.extra_open_days (
  id          bigserial primary key,
  date        text not null unique,          -- format DD.MM.YYYY
  note        text,                          -- opcjonalna notatka (np. "Dodatkowy dzień — promocja")
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists extra_open_days_date_idx on public.extra_open_days (date);

alter table public.extra_open_days enable row level security;

create policy "service_role full access" on public.extra_open_days
  for all to service_role using (true) with check (true);

create policy "anon insert" on public.extra_open_days
  for insert to anon with check (true);

create policy "anon select" on public.extra_open_days
  for select to anon using (true);

create policy "anon update" on public.extra_open_days
  for update to anon using (true) with check (true);

create policy "anon delete" on public.extra_open_days
  for delete to anon using (true);
