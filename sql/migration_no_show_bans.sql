-- =========================================================
-- Migration: System no-show + czarna lista
-- Uruchom w Supabase: Dashboard → SQL Editor → New Query
-- =========================================================

-- Tabela śledząca no-show i bany per numer rejestracyjny
CREATE TABLE IF NOT EXISTS no_show_bans (
  registration   TEXT PRIMARY KEY,
  no_show_count  INTEGER NOT NULL DEFAULT 0,
  is_banned      BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason     TEXT,
  last_no_show   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indeks dla szybkiego sprawdzania banów
CREATE INDEX IF NOT EXISTS idx_no_show_bans_is_banned
  ON no_show_bans (is_banned);

-- Funkcja automatycznie aktualizująca updated_at
CREATE OR REPLACE FUNCTION update_no_show_bans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_show_bans_updated_at ON no_show_bans;
CREATE TRIGGER trg_no_show_bans_updated_at
  BEFORE UPDATE ON no_show_bans
  FOR EACH ROW EXECUTE FUNCTION update_no_show_bans_updated_at();

-- Zezwól na status 'no_show' w tabeli reservations
-- (żaden CHECK constraint nie blokuje — status TEXT, więc wystarczy używać wartości)
-- Dopuszczalne statusy: 'confirmed', 'cancelled', 'no_show'

-- RLS: dostęp dla service_role (używanego przez Parking.OS i bota)
ALTER TABLE no_show_bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON no_show_bans;
CREATE POLICY "service_role full access" ON no_show_bans
  FOR ALL TO service_role USING (true) WITH CHECK (true);
