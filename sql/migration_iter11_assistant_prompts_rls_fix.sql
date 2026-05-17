-- ============================================================================
-- Iter 11 FIX: assistant_prompt_config — brakujące policies dla zapisu
-- ============================================================================
-- Problem: migration_assistant_prompts.sql założył tylko SELECT policy.
-- Komentarz mówił "service key omija RLS" ale Tauri loguje się przez anon key
-- + auth → potrzebuje policy `authenticated` dla INSERT/UPDATE.
-- Skutek: zapis prompt-configu z panelu Ustawień → błąd RLS → "[object Object]".
-- Uruchom w Supabase SQL Editor jeden raz.
-- ============================================================================

DROP POLICY IF EXISTS assistant_prompt_config_write ON assistant_prompt_config;
CREATE POLICY assistant_prompt_config_write
  ON assistant_prompt_config
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY assistant_prompt_config_write ON assistant_prompt_config IS
  'Iter 11: zalogowani admini mogą edytować konfigurację promptów (singleton id=1).';
