-- ============================================================================
-- migration_assistant_prompts.sql
-- Iteracja 10 — Edytor promptów asystenta (3 profile + wspólne bloki)
--
-- Tworzy tabelę singleton (jeden wiersz id=1) przechowującą całą konfigurację
-- promptów dla:
--   • Messenger bot (parking_botaimess)
--   • Widget WWW (parking_botaimess)
--   • Asystent admin (parking_os, function calling)
--
-- Konfiguracja jest jedną kolumną jsonb — całość edytowana w panelu Ustawień.
-- Apps czytają na żądanie (z cache 60s w botaimess, 5min w Tauri).
-- Jeśli wiersz nie istnieje lub jest pusty → apps używają hardcoded fallbacków
-- z plików `promptDefaults.{ts,js}` (źródło: bieżące SYSTEM_PROMPT/CHAT_WIDGET_PROMPT).
-- ============================================================================

CREATE TABLE IF NOT EXISTS assistant_prompt_config (
  id          int PRIMARY KEY DEFAULT 1,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  version     int  NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  CONSTRAINT singleton_row CHECK (id = 1)
);

-- Pierwsza inicjalizacja — pusty obiekt; apps wsiadą na promptDefaults.* dopóki
-- użytkownik nie zapisze pierwszej zmiany w UI (wtedy panel zapisze pełną
-- DEFAULT_PROMPT_CONFIG do tej kolumny).
INSERT INTO assistant_prompt_config (id, config, version, updated_by)
VALUES (1, '{}'::jsonb, 1, 'migration')
ON CONFLICT (id) DO NOTHING;

-- RLS: tylko zalogowani użytkownicy mogą czytać; zapis wyłącznie przez service key
-- (Tauri używa service key, bot/widget tylko czytają).
ALTER TABLE assistant_prompt_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_prompt_config_read ON assistant_prompt_config;
CREATE POLICY assistant_prompt_config_read
  ON assistant_prompt_config
  FOR SELECT
  USING (true);

-- Brak polityki INSERT/UPDATE — domyślnie odmowa dla anonów; service key omija RLS.
