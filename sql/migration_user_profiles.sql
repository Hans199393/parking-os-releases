-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: rozszerzenie profili użytkowników (Iteracja 3)
-- Data: 2026-05-10
-- Cel: zmigruj stare uprawnienia (page id'ki: 'reservations') na granularne
--      ('reservations.view', 'reservations.create', ...) - bez utraty dostępu.
-- Opcjonalnie. NIC nie psuje jeśli jest już w nowym formacie.
-- Uruchom raz w Supabase SQL editor (jako service_role).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pomocnicza funkcja: rozwiń page id na wszystkie akcje danego modułu
create or replace function public._expand_old_perm(old text)
returns jsonb
language plpgsql
immutable
as $$
begin
  case old
    when 'dashboard'    then return '["dashboard.view"]'::jsonb;
    when 'cameras'      then return '["cameras.view","cameras.roi_edit","cameras.detector"]'::jsonb;
    when 'reservations' then return '["reservations.view","reservations.create","reservations.edit","reservations.delete","reservations.restore","reservations.no_show","reservations.ban","reservations.unban"]'::jsonb;
    when 'finances'     then return '["finances.view","finances.add_income","finances.add_expense","finances.edit","finances.delete","finances.export"]'::jsonb;
    when 'admin'        then return '["admin.view","admin.edit_content","admin.manage_psids"]'::jsonb;
    when 'chat'         then return '["chat.view","chat.use","chat.reset"]'::jsonb;
    when 'email'        then return '["email.view","email.send","email.reply","email.delete"]'::jsonb;
    when 'logs'         then return '["logs.view","logs.export","logs.clear"]'::jsonb;
    when 'settings'     then return '["settings.view","settings.edit_parking","settings.edit_devices","settings.edit_integrations","settings.edit_appearance","settings.manage_accounts"]'::jsonb;
    else return jsonb_build_array(old);
  end case;
end;
$$;

-- Migracja: dla każdego usera, jeśli `permissions` zawiera elementy bez kropki,
-- rozwiń je na granularne klucze.
do $$
declare
  u record;
  raw_perms jsonb;
  new_perms jsonb;
  perm text;
begin
  for u in select id, raw_user_meta_data from auth.users loop
    raw_perms := coalesce(u.raw_user_meta_data->'permissions', '[]'::jsonb);
    if jsonb_typeof(raw_perms) <> 'array' then
      continue;
    end if;
    new_perms := '[]'::jsonb;
    for perm in select jsonb_array_elements_text(raw_perms) loop
      if position('.' in perm) > 0 then
        -- już granularne
        new_perms := new_perms || jsonb_build_array(perm);
      else
        -- stary page id → rozwiń
        new_perms := new_perms || public._expand_old_perm(perm);
      end if;
    end loop;
    -- Deduplikacja
    select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into new_perms
      from jsonb_array_elements_text(new_perms) e;
    -- Zapis
    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('permissions', new_perms)
    where id = u.id;
  end loop;
end $$;

-- Drop helper
drop function if exists public._expand_old_perm(text);

-- ─── KONIEC MIGRACJI ────────────────────────────────────────────────────────
