-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: zunifikowany audit log (Iteracja 1)
-- Data: 2026-05-10
-- Cel: jedna tabela `admin_logs` zamiast trzech (admin_logs + audit_log + events).
--      Dodaje entity_type/entity_id (linkowanie do encji), severity, before/after
--      (diff edycji), session_id (grupowanie po sesji loginu).
--      Dodaje soft-delete na rezerwacjach.
-- Uruchom raz w Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rozszerzenie tabeli admin_logs ─────────────────────────────────────────
alter table public.admin_logs
  add column if not exists entity_type text,           -- 'reservation' | 'user' | 'invoice' | 'ban' | 'camera' | ...
  add column if not exists entity_id   text,           -- id rekordu którego dotyczy log
  add column if not exists severity    text not null default 'info',  -- 'info' | 'warning' | 'critical'
  add column if not exists before      jsonb,          -- snapshot przed zmianą (dla diffów)
  add column if not exists after       jsonb,          -- snapshot po zmianie
  add column if not exists session_id  text,           -- grupowanie wpisów jednej sesji loginu
  add column if not exists user_id     uuid;           -- auth.users.id (jeśli dostępne)

-- Constraint dla severity
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_logs_severity_chk'
  ) then
    alter table public.admin_logs
      add constraint admin_logs_severity_chk
      check (severity in ('info','warning','critical'));
  end if;
end $$;

-- Rozszerzenie kategorii (akceptujemy nową: 'reservation', 'finance', 'user', 'mail')
-- — w obecnym kodzie kategoria jest typowana stringiem, więc nic nie psujemy.

-- Indeksy dla szybkich filtrów
create index if not exists admin_logs_entity_idx       on public.admin_logs (entity_type, entity_id);
create index if not exists admin_logs_user_idx         on public.admin_logs (user_email, created_at desc);
create index if not exists admin_logs_severity_idx     on public.admin_logs (severity, created_at desc);
create index if not exists admin_logs_session_idx      on public.admin_logs (session_id, created_at);
create index if not exists admin_logs_category_idx     on public.admin_logs (category, created_at desc);

-- 2. Migracja danych z `events` (jeśli istnieje) ────────────────────────────
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='events') then
    insert into public.admin_logs (category, action, description, metadata, created_at)
    select
      'reservation' as category,
      e.event_type as action,
      coalesce(e.details->>'description', e.event_type) as description,
      e.details as metadata,
      e.created_at
    from public.events e
    -- nie duplikuj jeśli kiedyś już migrowaliśmy
    where not exists (
      select 1 from public.admin_logs a
      where a.action = e.event_type and a.created_at = e.created_at
    );
    -- Tabelę zostawiamy do czasu manualnego usunięcia po weryfikacji.
    -- Po sprawdzeniu wyników: drop table public.events;
  end if;
end $$;

-- 3. Migracja danych z `audit_log` (jeśli istnieje, używana przez audit.ts) ─
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='audit_log') then
    insert into public.admin_logs (category, action, description, user_email, user_id, metadata, created_at)
    select
      'action' as category,
      a.action,
      a.action as description,
      a.user_email,
      a.user_id,
      a.details as metadata,
      a.created_at
    from public.audit_log a
    where not exists (
      select 1 from public.admin_logs al
      where al.action = a.action
        and al.user_email is not distinct from a.user_email
        and al.created_at = a.created_at
    );
    -- Po sprawdzeniu: drop table public.audit_log;
  end if;
end $$;

-- 4. Soft-delete dla rezerwacji ─────────────────────────────────────────────
alter table public.reservations
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  text;

create index if not exists reservations_active_idx
  on public.reservations (arrival_date) where deleted_at is null;

-- 5. RLS (jeśli włączone, zachowaj kompatybilność) ──────────────────────────
-- admin_logs zwykle ma już politykę. Jeśli nie:
do $$ begin
  if not exists (select 1 from pg_policies where tablename='admin_logs' and policyname='anon_insert_logs') then
    alter table public.admin_logs enable row level security;
    create policy "anon_insert_logs" on public.admin_logs
      for insert to anon with check (true);
    create policy "anon_select_logs" on public.admin_logs
      for select to anon using (true);
  end if;
end $$;

-- ─── KONIEC MIGRACJI ────────────────────────────────────────────────────────
