-- =====================================================================
-- Iter 11: Lista oczekujących (waitlist) dla rezerwacji
-- =====================================================================
-- Uruchom w Supabase SQL Editor po wcześniejszych migracjach.
-- Tworzy tabelę reservation_waitlist (klient czeka aż zwolni się miejsce).
-- =====================================================================

CREATE TABLE IF NOT EXISTS reservation_waitlist (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  arrival_date    text          NOT NULL,           -- DD.MM.YYYY (zgodnie z reservations)
  registration    text          NOT NULL,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  channel         text          NOT NULL DEFAULT 'admin',  -- admin | messenger | widget
  source          text          NOT NULL DEFAULT 'parking_os',
  status          text          NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','promoted','cancelled','expired')),
  promoted_to     uuid,         -- id rezerwacji do której promowano (po zwolnieniu miejsca)
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_date_status
  ON reservation_waitlist (arrival_date, status, created_at);

-- RLS: tylko zalogowani admini odczytują/edytują (taka sama polityka jak reservations)
ALTER TABLE reservation_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waitlist_select_authenticated" ON reservation_waitlist;
CREATE POLICY "waitlist_select_authenticated" ON reservation_waitlist
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "waitlist_all_authenticated" ON reservation_waitlist;
CREATE POLICY "waitlist_all_authenticated" ON reservation_waitlist
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Bot (anon) może tylko INSERT (zapisanie się do waitlisty z chatu)
DROP POLICY IF EXISTS "waitlist_insert_anon" ON reservation_waitlist;
CREATE POLICY "waitlist_insert_anon" ON reservation_waitlist
  FOR INSERT TO anon WITH CHECK (true);

COMMENT ON TABLE reservation_waitlist IS
  'Iter 11 — lista oczekujących na zwolnione miejsce parkingowe. Promocja: gdy ktoś anuluje rezerwację, najstarszy "waiting" awansuje na confirmed.';
