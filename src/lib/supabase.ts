import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getStore } from './store';
import { getDefaultSetting } from './defaultSettings';

export interface Database {
  public: {
    Tables: {
      reservations: {
        Row: {
          id: string;
          messenger_id: string;
          arrival_date: string;
          registration: string;
          status: string;
          created_at: string;
        };
        Insert: {
          messenger_id: string;
          arrival_date: string;
          registration: string;
          status?: string;
        };
        Update: {
          arrival_date?: string;
          registration?: string;
          status?: string;
        };
        Relationships: [];
      };
      parking_config: {
        Row: { key: string; value: string; updated_at: string };
        Insert: { key: string; value: string };
        Update: { value?: string };
        Relationships: [];
      };
      no_show_bans: {
        Row: {
          registration: string;
          no_show_count: number;
          is_banned: boolean;
          ban_reason: string | null;
          last_no_show: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          registration: string;
          no_show_count?: number;
          is_banned?: boolean;
          ban_reason?: string | null;
          last_no_show?: string | null;
        };
        Update: {
          no_show_count?: number;
          is_banned?: boolean;
          ban_reason?: string | null;
          last_no_show?: string | null;
        };
        Relationships: [];
      };
      chat_sessions: {
        Row: {
          id: string;
          lang: string;
          status: string;
          started_at: string;
          last_activity: string;
        };
        Insert: {
          lang?: string;
          status?: string;
        };
        Update: {
          lang?: string;
          status?: string;
          last_activity?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: number;
          session_id: string;
          role: string;
          content: string;
          created_at: string;
        };
        Insert: {
          session_id: string;
          role: string;
          content: string;
        };
        Update: {
          content?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

let supabaseInstance: SupabaseClient<Database> | null = null;

function withDefault(value: string | null | undefined, key: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || getDefaultSetting(key) || '';
}

export async function isConfigured(): Promise<boolean> {
  const store = await getStore();
  const url = withDefault(await store.get<string>('supabase_url'), 'supabase_url');
  const key = withDefault(await store.get<string>('supabase_key'), 'supabase_key');
  return !!(url && key);
}

export async function getSupabaseClient(): Promise<SupabaseClient<Database>> {
  if (supabaseInstance) return supabaseInstance;

  const store = await getStore();
  const url = withDefault(await store.get<string>('supabase_url'), 'supabase_url');
  const key = withDefault(await store.get<string>('supabase_key'), 'supabase_key');

  if (!url || !key) {
    throw new Error('Supabase nie jest skonfigurowany. Uzupełnij dane w Ustawieniach.');
  }

  supabaseInstance = createClient<Database>(url, key);
  return supabaseInstance;
}

export function resetSupabaseClient() {
  supabaseInstance = null;
}

export async function testConnection(): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const sb = await getSupabaseClient();
    const { data, error } = await sb.from('reservations').select('id', { count: 'exact', head: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: (data as unknown as number) ?? 0 };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface Reservation {
  id: string;
  messenger_id: string;
  arrival_date: string;
  registration: string;
  status: string;
  created_at: string;
  // Iter 12: soft-delete
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export interface NoShowBan {
  registration: string;
  no_show_count: number;
  is_banned: boolean;
  ban_reason: string | null;
  last_no_show: string | null;
  created_at: string;
  updated_at: string;
}

export const NO_SHOW_BAN_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Internal mutation logger — pisze do tabeli `admin_logs` (zunifikowanej).
// Inline (nie importujemy audit.ts) by uniknąć cyklicznej zależności.
// Każda funkcja mutująca dane MUSI zawołać _logMutation.
// ---------------------------------------------------------------------------
async function _logMutation(
  category: 'reservation' | 'action' | 'finance' | 'user' | 'mail' | 'camera' | 'system',
  action: string,
  opts: {
    description?: string;
    entityType?: string;
    entityId?: string | number | null;
    before?: unknown;
    after?: unknown;
    severity?: 'info' | 'warning' | 'critical';
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    const sb = await getSupabaseClient();
    const userResult = await (sb as SupabaseClient).auth.getUser();
    const u = userResult.data?.user ?? null;
    let sessionId: string | null = null;
    try { sessionId = sessionStorage.getItem('parking_os_audit_session'); } catch { /* noop */ }
    await (sb as SupabaseClient).from('admin_logs').insert({
      category,
      action,
      description: opts.description ?? action,
      user_email: u?.email ?? null,
      user_id: u?.id ?? null,
      session_id: sessionId,
      severity: opts.severity ?? 'info',
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId != null ? String(opts.entityId) : null,
      before: opts.before ?? null,
      after: opts.after ?? null,
      metadata: opts.metadata ?? null,
    } as never);
  } catch { /* logi nigdy nie blokują aplikacji */ }
}

// ---------------------------------------------------------------------------
// Settings table (shared with bot + website)
// spots_available: 'true' = miejsca wolne, 'false' = brak miejsc
// ---------------------------------------------------------------------------
export async function getConfig(key: string): Promise<string | null> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('settings' as never)
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return (data as { value: string } | null)?.value ?? null;
}

// Bulk read — wczytuje wiele kluczy jedną kwerendą
export async function getConfigs(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('settings' as never)
    .select('key,value')
    .in('key', keys);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of (data as { key: string; value: string }[] | null) ?? []) {
    out[row.key] = row.value;
  }
  return out;
}

export async function setConfigs(settings: Record<string, string>): Promise<void> {
  const entries = Object.entries(settings);
  if (entries.length === 0) return;

  const sb = await getSupabaseClient();
  const payload = entries.map(([key, value]) => ({ key, value }));
  const { error } = await (sb as SupabaseClient)
    .from('settings' as never)
    .upsert(payload as never, { onConflict: 'key' });
  if (error) throw error;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('settings' as never)
    .upsert({ key, value } as never, { onConflict: 'key' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Asystent prompt config (Iter 10) — singleton row id=1
// ---------------------------------------------------------------------------
import type { PromptConfig } from './promptDefaults';

export async function getAssistantPromptConfig(): Promise<PromptConfig | null> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('assistant_prompt_config' as never)
    .select('config')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  const cfg = (data as { config: unknown } | null)?.config;
  if (!cfg || typeof cfg !== 'object' || Object.keys(cfg as Record<string, unknown>).length === 0) {
    return null;
  }
  return cfg as PromptConfig;
}

export async function saveAssistantPromptConfig(config: PromptConfig, updatedBy: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('assistant_prompt_config' as never)
    .upsert(
      { id: 1, config, updated_by: updatedBy, updated_at: new Date().toISOString() } as never,
      { onConflict: 'id' }
    );
  if (error) throw error;
}

// Bot stores arrival_date as DD.MM.YYYY — helpers to convert back and forth
export function toDbDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function fromDbDate(db: string): string {
  const parts = db.split('.');
  if (parts.length !== 3) return db; // already ISO or unknown
  const [d, m, y] = parts;
  return `${y}-${m}-${d}`;
}

export async function getReservations(): Promise<Reservation[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservations')
    .select('*')
    .is('deleted_at' as never, null)
    .order('arrival_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getReservationsForDate(date: string): Promise<Reservation[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservations')
    .select('*')
    .is('deleted_at' as never, null)
    .eq('arrival_date', toDbDate(date))
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addReservation(arrival_date: string, registration: string): Promise<Reservation> {
  // Idempotency: nie dodawaj duplikatów — jeśli istnieje confirmed rezerwacja o tej samej dacie i rejestracji, zwróć ją.
  try {
    const existing = await getReservationsForDate(arrival_date);
    const needle = registration.toUpperCase().replace(/\s+/g, '');
    const dup = existing.find(r => r.registration.toUpperCase().replace(/\s+/g, '') === needle && r.status === 'confirmed');
    if (dup) {
      // Zaloguj próbę i zwróć istniejącą rezerwację zamiast tworzyć nową
      await _logMutation('reservation', 'reservation_create_ignored_duplicate', {
        description: `Ignorowano duplikat rezerwacji ${registration} na ${arrival_date}`,
        entityType: 'reservation',
        entityId: dup.id,
        metadata: { registration, arrival_date },
        severity: 'info',
      });
      return dup;
    }
  } catch (e) {
    // jeśli check dup zawiedzie, kontynuujemy i spróbujemy normalnie utworzyć rezerwację
  }
  // Iter 11: walidacja konfliktów — count(date) >= parking_capacity ⇒ blokada
  const capRaw = await getConfig('parking_capacity');
  const capacity = capRaw ? parseInt(capRaw, 10) : 0;
  if (capacity > 0) {
    const existing = await getReservationsForDate(arrival_date);
    const active = existing.filter(r => r.status === 'confirmed').length;
    if (active >= capacity) {
      throw new Error(`Brak wolnych miejsc na ${arrival_date} (${active}/${capacity}). Dodaj klienta do listy oczekujących.`);
    }
  }
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservations')
    .insert({ messenger_id: 'manual', arrival_date: toDbDate(arrival_date), registration, status: 'confirmed', channel: 'admin', source: 'parking_os' })
    .select()
    .single();
  if (error) throw error;
  await _logMutation('reservation', 'reservation_created', {
    description: `Dodano rezerwację ${registration} na ${arrival_date}`,
    entityType: 'reservation',
    entityId: data.id,
    after: data,
  });
  return data;
}

/**
 * Iter 11: dodaje rezerwację na zakres dat (włącznie obie granice).
 * Najpierw waliduje wszystkie dni — jeśli któryś jest pełny, NIE WSTAWIA NIC.
 * Zwraca tablicę nowo utworzonych rezerwacji.
 */
export async function addReservationRange(start_date: string, end_date: string, registration: string): Promise<Reservation[]> {
  const start = new Date(start_date + 'T00:00:00');
  const end = new Date(end_date + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    throw new Error('Niepoprawny zakres dat.');
  }
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  // Walidacja capacity dla KAŻDEGO dnia przed wstawieniem
  const capRaw = await getConfig('parking_capacity');
  const capacity = capRaw ? parseInt(capRaw, 10) : 0;
  if (capacity > 0) {
    for (const d of dates) {
      const existing = await getReservationsForDate(d);
      const active = existing.filter(r => r.status === 'confirmed').length;
      if (active >= capacity) {
        throw new Error(`Brak wolnych miejsc na ${d} (${active}/${capacity}). Skróć zakres lub dodaj do waitlisty.`);
      }
    }
  }
  const sb = await getSupabaseClient();
  // Idempotency for ranges: nie twórz duplikatów — wstaw tylko brakujące dni
  const rows: any[] = [];
  const needle = registration.toUpperCase().replace(/\s+/g, '');
  for (const d of dates) {
    const existing = await getReservationsForDate(d);
    const dup = existing.find(r => r.registration.toUpperCase().replace(/\s+/g, '') === needle && r.status === 'confirmed');
    if (!dup) {
      rows.push({ messenger_id: 'manual', arrival_date: toDbDate(d), registration, status: 'confirmed', channel: 'admin', source: 'parking_os' });
    } else {
      // log that this date already had reservation
      await _logMutation('reservation', 'reservation_range_ignored_duplicate', {
        description: `Ignorowano duplikat dla ${registration} na ${d}`,
        entityType: 'reservation',
        entityId: dup.id,
        metadata: { registration, date: d },
      });
    }
  }
  const { data, error } = rows.length > 0 ? await sb.from('reservations').insert(rows).select() : { data: [], error: null };
  if (error) throw error;
  await _logMutation('reservation', 'reservation_range_created', {
    description: `Dodano rezerwację ${registration} na zakres ${start_date} → ${end_date} (${dates.length} dni)`,
    entityType: 'reservation_range',
    after: { count: data?.length ?? 0, dates },
  });
  return data ?? [];
}

/**
 * Iter 11: sprawdza dostępność miejsc na dany dzień.
 * Zwraca obiekt: { capacity, booked, free, full }.
 */
export async function getCapacityForDate(date: string): Promise<{ capacity: number; booked: number; free: number; full: boolean }> {
  const capRaw = await getConfig('parking_capacity');
  const capacity = capRaw ? parseInt(capRaw, 10) : 0;
  const existing = await getReservationsForDate(date);
  const booked = existing.filter(r => r.status === 'confirmed').length;
  const free = Math.max(0, capacity - booked);
  return { capacity, booked, free, full: capacity > 0 && booked >= capacity };
}

// ---------------------------------------------------------------------------
// Iter 11: Waitlist (lista oczekujących)
// ---------------------------------------------------------------------------
export interface WaitlistEntry {
  id: string;
  arrival_date: string;        // DD.MM.YYYY (zgodnie z reservations)
  registration: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  channel: string;
  source: string;
  status: 'waiting' | 'promoted' | 'cancelled' | 'expired';
  promoted_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getWaitlistForDate(date: string): Promise<WaitlistEntry[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservation_waitlist' as never)
    .select('*')
    .eq('arrival_date', toDbDate(date))
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as WaitlistEntry[]) ?? [];
}

export async function getAllWaitlist(): Promise<WaitlistEntry[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservation_waitlist' as never)
    .select('*')
    .order('arrival_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as WaitlistEntry[]) ?? [];
}

export async function addToWaitlist(entry: {
  arrival_date: string;        // ISO YYYY-MM-DD
  registration: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  notes?: string;
}): Promise<WaitlistEntry> {
  const sb = await getSupabaseClient();
  const { data, error } = await (sb as SupabaseClient)
    .from('reservation_waitlist' as never)
    .insert({
      arrival_date: toDbDate(entry.arrival_date),
      registration: entry.registration,
      contact_name: entry.contact_name ?? null,
      contact_phone: entry.contact_phone ?? null,
      contact_email: entry.contact_email ?? null,
      notes: entry.notes ?? null,
      channel: 'admin',
      source: 'parking_os',
      status: 'waiting',
    } as never)
    .select()
    .single();
  if (error) throw error;
  await _logMutation('reservation', 'waitlist_added', {
    description: `Dodano do waitlisty ${entry.registration} na ${entry.arrival_date}`,
    entityType: 'waitlist',
    entityId: (data as WaitlistEntry).id,
    after: data,
  });
  return data as WaitlistEntry;
}

export async function removeFromWaitlist(id: string, status: 'cancelled' | 'expired' = 'cancelled'): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('reservation_waitlist' as never)
    .update({ status, updated_at: new Date().toISOString() } as never)
    .eq('id', id);
  if (error) throw error;
  await _logMutation('reservation', 'waitlist_removed', {
    entityType: 'waitlist',
    entityId: id,
    metadata: { new_status: status },
  });
}

/**
 * Iter 11: po anulowaniu rezerwacji promuje pierwszego z waitlisty na confirmed.
 * Zwraca utworzoną rezerwację lub null jeśli waitlista pusta.
 */
export async function promoteFromWaitlist(date: string): Promise<Reservation | null> {
  const list = await getWaitlistForDate(date);
  const first = list.find(w => w.status === 'waiting');
  if (!first) return null;
  // Sprawdź czy jest miejsce
  const cap = await getCapacityForDate(date);
  if (cap.full) return null;
  // Utwórz rezerwację
  const reservation = await addReservation(date, first.registration);
  // Oznacz waitlist entry jako promoted
  const sb = await getSupabaseClient();
  await (sb as SupabaseClient)
    .from('reservation_waitlist' as never)
    .update({ status: 'promoted', promoted_to: reservation.id, updated_at: new Date().toISOString() } as never)
    .eq('id', first.id);
  await _logMutation('reservation', 'waitlist_promoted', {
    description: `Promowano z waitlisty: ${first.registration} → rezerwacja ${reservation.id}`,
    entityType: 'waitlist',
    entityId: first.id,
    metadata: { reservation_id: reservation.id },
  });
  return reservation;
}

export async function updateReservation(id: string, arrival_date: string, registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  // snapshot before
  const { data: before } = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
  const { error } = await sb
    .from('reservations')
    .update({ arrival_date: toDbDate(arrival_date), registration })
    .eq('id', id);
  if (error) throw error;
  const { data: after } = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
  await _logMutation('reservation', 'reservation_updated', {
    description: `Edytowano rezerwację #${id} (${registration})`,
    entityType: 'reservation',
    entityId: id,
    before,
    after,
  });
}

/**
 * Soft-delete: ustawia `deleted_at` zamiast fizycznego DELETE.
 * Pozwala przywrócić rezerwację (restoreReservation) i zachować audit trail.
 */
export async function deleteReservation(id: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { data: before } = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
  const userResult = await (sb as SupabaseClient).auth.getUser();
  const userEmail = userResult.data?.user?.email ?? null;
  const { error } = await (sb as SupabaseClient)
    .from('reservations')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userEmail } as never)
    .eq('id', id);
  if (error) throw error;
  await _logMutation('reservation', 'reservation_deleted', {
    description: `Usunięto rezerwację #${id}` + (before ? ` (${(before as Reservation).registration})` : ''),
    entityType: 'reservation',
    entityId: id,
    before,
    severity: 'warning',
  });
}

/** Przywróć soft-usuniętą rezerwację. */
export async function restoreReservation(id: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { data: before } = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
  const { error } = await (sb as SupabaseClient)
    .from('reservations')
    .update({ deleted_at: null, deleted_by: null } as never)
    .eq('id', id);
  if (error) throw error;
  await _logMutation('reservation', 'reservation_restored', {
    description: `Przywrócono rezerwację #${id}`,
    entityType: 'reservation',
    entityId: id,
    before,
  });
}

export async function getReservationCountByMonth(year: number, month: number): Promise<Record<string, number>> {
  const sb = await getSupabaseClient();
  const mm = String(month).padStart(2, '0');
  const { data, error } = await sb
    .from('reservations')
    .select('arrival_date')
    .filter('arrival_date', 'like', `%.${mm}.${year}`)
    .eq('status', 'confirmed')
    .is('deleted_at' as never, null);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    const iso = fromDbDate(r.arrival_date);
    counts[iso] = (counts[iso] ?? 0) + 1;
  }
  return counts;
}

// --- parking_config (legacy — superseded by settings table) ----------------
export async function getLatestReservationTimestamp(): Promise<string | null> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservations')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.created_at ?? null;
}

// --- Full history ---------------------------------------------------------

export async function getFullHistory(statusFilter?: string): Promise<Reservation[]> {
  const sb = await getSupabaseClient();
  let query = sb
    .from('reservations')
    .select('*')
    .order('created_at', { ascending: false });
  // Iter 12: obsługa soft-deleted w historii
  // - 'deleted' → tylko usunięte (deleted_at not null)
  // - 'all'     → wszystkie (z usuniętymi włącznie)
  // - inne (confirmed/cancelled/no_show) → tylko nie-usunięte o danym statusie
  if (statusFilter === 'deleted') {
    query = (query as unknown as { not: (col: string, op: string, val: null) => typeof query }).not('deleted_at', 'is', null);
  } else if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter).is('deleted_at' as never, null);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function setReservationStatus(id: string, status: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { data: before } = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
  const oldStatus = (before as Reservation | null)?.status ?? null;
  const { error } = await sb
    .from('reservations')
    .update({ status })
    .eq('id', id);
  if (error) throw error;
  await _logMutation('reservation', 'reservation_status_changed', {
    description: `Status rezerwacji #${id}: ${oldStatus ?? '?'} → ${status}`,
    entityType: 'reservation',
    entityId: id,
    before: { status: oldStatus },
    after: { status },
    severity: status === 'cancelled' || status === 'no_show' ? 'warning' : 'info',
  });
}

// --- Reservation attempts (audit log) -----------------------------------
// Tabela reservation_attempts loguje KAŻDĄ próbę rezerwacji (z każdego
// kanału: web/messenger/admin) — także te odrzucone i błędne. Dzięki temu
// gdy klient mówi "rezerwowałem a nie ma" — tu jest dowód.

export interface ReservationAttempt {
  id: string;
  channel: string;
  customer_key: string | null;
  raw_message: string | null;
  parsed_dates: string[] | null;
  parsed_regs: string[] | null;
  llm_action: string | null;
  llm_raw: unknown;
  outcome: unknown;
  outcome_status: string | null;
  created_at: string;
}

export async function getReservationAttempts(limit = 100): Promise<ReservationAttempt[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservation_attempts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ReservationAttempt[];
}

// --- No-show / ban management -------------------------------------------

export async function markAsNoShow(id: string, registration: string): Promise<{ nowBanned: boolean }> {
  const sb = await getSupabaseClient();

  // 1. Mark reservation as no_show
  const { error: resErr } = await sb
    .from('reservations')
    .update({ status: 'no_show' })
    .eq('id', id);
  if (resErr) throw resErr;

  // 2. Upsert into no_show_bans — increment counter
  const { data: existing } = await sb
    .from('no_show_bans')
    .select('no_show_count, is_banned')
    .eq('registration', registration.toUpperCase())
    .maybeSingle();

  const currentCount = existing?.no_show_count ?? 0;
  const newCount = currentCount + 1;
  const nowBanned = newCount >= NO_SHOW_BAN_THRESHOLD;

  const { error: banErr } = await sb
    .from('no_show_bans')
    .upsert(
      {
        registration: registration.toUpperCase(),
        no_show_count: newCount,
        is_banned: nowBanned || (existing?.is_banned ?? false),
        last_no_show: new Date().toISOString(),
        ...(nowBanned && !existing?.is_banned
          ? { ban_reason: `Automatyczny ban: ${newCount} niestawień` }
          : {}),
      },
      { onConflict: 'registration' }
    );
  if (banErr) throw banErr;

  const justBanned = nowBanned && !(existing?.is_banned);
  await _logMutation('reservation', 'reservation_no_show_marked', {
    description: `Oznaczono jako no-show: ${registration} (rezerwacja #${id}); licznik: ${newCount}/${NO_SHOW_BAN_THRESHOLD}` + (justBanned ? ' — AUTO-BAN' : ''),
    entityType: 'reservation',
    entityId: id,
    metadata: { registration: registration.toUpperCase(), no_show_count: newCount, auto_banned: justBanned },
    severity: justBanned ? 'critical' : 'warning',
  });
  return { nowBanned: justBanned };
}

export async function getBannedVehicles(): Promise<NoShowBan[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('no_show_bans')
    .select('*')
    .order('no_show_count', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function banVehicle(registration: string, reason?: string): Promise<void> {
  const sb = await getSupabaseClient();
  const reg = registration.toUpperCase();
  const { data: before } = await sb.from('no_show_bans').select('*').eq('registration', reg).maybeSingle();
  const finalReason = reason ?? 'Ręczny ban przez administratora';
  const { error } = await sb
    .from('no_show_bans')
    .upsert(
      { registration: reg, is_banned: true, ban_reason: finalReason },
      { onConflict: 'registration' }
    );
  if (error) throw error;
  await _logMutation('action', 'vehicle_banned', {
    description: `Zablokowano tablicę: ${reg}${reason ? ' — ' + reason : ''}`,
    entityType: 'ban',
    entityId: reg,
    before,
    after: { registration: reg, is_banned: true, ban_reason: finalReason },
    severity: 'warning',
  });
}

export async function unbanVehicle(registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const reg = registration.toUpperCase();
  const { data: before } = await sb.from('no_show_bans').select('*').eq('registration', reg).maybeSingle();
  const { error } = await sb
    .from('no_show_bans')
    .update({ is_banned: false, ban_reason: null })
    .eq('registration', reg);
  if (error) throw error;
  await _logMutation('action', 'vehicle_unbanned', {
    description: `Odblokowano tablicę: ${reg}`,
    entityType: 'ban',
    entityId: reg,
    before,
    after: { ...(before ?? {}), is_banned: false, ban_reason: null },
  });
}

export async function resetNoShowCount(registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const reg = registration.toUpperCase();
  const { data: before } = await sb.from('no_show_bans').select('*').eq('registration', reg).maybeSingle();
  const { error } = await sb
    .from('no_show_bans')
    .update({ no_show_count: 0, is_banned: false, ban_reason: null })
    .eq('registration', reg);
  if (error) throw error;
  await _logMutation('action', 'vehicle_reset', {
    description: `Zresetowano licznik no-show dla: ${reg}`,
    entityType: 'ban',
    entityId: reg,
    before,
  });
}

export async function deleteFromBanList(registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const reg = registration.toUpperCase();
  const { data: before } = await sb.from('no_show_bans').select('*').eq('registration', reg).maybeSingle();
  const { error } = await sb
    .from('no_show_bans')
    .delete()
    .eq('registration', reg);
  if (error) throw error;
  await _logMutation('action', 'vehicle_removed', {
    description: `Usunięto z listy banów: ${reg}`,
    entityType: 'ban',
    entityId: reg,
    before,
    severity: 'warning',
  });
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export interface ParkingEvent {
  id: number;
  event_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

/**
 * @deprecated Pisze do `admin_logs` (kategoria 'reservation') przez kompatybilność.
 * Stary kod (Reservations.tsx) wywołuje logEvent(...) — dzięki temu te wpisy są
 * widoczne w głównej zakładce Logi. W nowym kodzie używaj `audit()` z lib/audit.ts.
 */
export async function logEvent(event_type: string, details?: Record<string, unknown>): Promise<void> {
  await _logMutation('reservation', event_type, {
    description: (details?.description as string | undefined) ?? event_type,
    metadata: details ?? undefined,
    entityType: typeof details?.id === 'string' || typeof details?.id === 'number' ? 'reservation' : undefined,
    entityId: (details?.id as string | number | undefined) ?? null,
  });
}

export async function getEvents(limit = 100): Promise<ParkingEvent[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await (sb as SupabaseClient)
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ParkingEvent[];
}

// ---------------------------------------------------------------------------
// Extra open days (dni otwarte poza harmonogramem)
// ---------------------------------------------------------------------------

export interface ExtraOpenDay {
  id: number;
  date: string;       // DD.MM.YYYY
  note: string | null;
  active: boolean;
  created_at: string;
}

export async function getExtraOpenDays(): Promise<ExtraOpenDay[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await (sb as SupabaseClient)
    .from('extra_open_days')
    .select('*')
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExtraOpenDay[];
}

export async function addExtraOpenDay(date: string, note?: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('extra_open_days')
    .insert({ date, note: note ?? null, active: true });
  if (error) throw error;
}

export async function toggleExtraOpenDay(id: number, active: boolean): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('extra_open_days')
    .update({ active })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteExtraOpenDay(id: number): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('extra_open_days')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function isExtraOpenDay(dateIso: string): Promise<boolean> {
  // dateIso: YYYY-MM-DD — konwertujemy do DD.MM.YYYY
  const [y, m, d] = dateIso.split('-');
  const dbDate = `${d}.${m}.${y}`;
  const sb = await getSupabaseClient();
  const { data } = await (sb as SupabaseClient)
    .from('extra_open_days')
    .select('id')
    .eq('date', dbDate)
    .eq('active', true)
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Bot alerts (alerty systemowe — np. wyczerpanie limitu Groq)
// ---------------------------------------------------------------------------

export interface BotAlert {
  id: number;
  type: string;
  message: string | null;
  resolved: boolean;
  created_at: string;
}

export async function getBotAlerts(onlyUnresolved = true): Promise<BotAlert[]> {
  const sb = await getSupabaseClient();
  const base = (sb as SupabaseClient)
    .from('bot_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  const { data, error } = onlyUnresolved
    ? await base.eq('resolved', false)
    : await base;
  if (error) throw error;
  return (data ?? []) as BotAlert[];
}

export async function resolveBotAlert(id: number): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('bot_alerts')
    .update({ resolved: true })
    .eq('id', id);
  if (error) throw error;
}

// ─── Admin logs ─────────────────────────────────────────────────────────────

export interface AdminLog {
  id: number;
  category: 'session' | 'action' | 'reservation' | 'finance' | 'user' | 'mail' | 'camera' | 'bot' | 'system' | 'chat';
  action: string;
  description: string | null;
  user_email: string | null;
  user_id?: string | null;
  session_id?: string | null;
  severity?: 'info' | 'warning' | 'critical' | null;
  entity_type?: string | null;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function writeAdminLog(
  category: AdminLog['category'],
  action: string,
  description?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const sb = await getSupabaseClient();
    const userResult = await (sb as SupabaseClient).auth.getUser();
    const user = userResult.data?.user ?? null;
    await (sb as SupabaseClient)
      .from('admin_logs')
      .insert({
        category,
        action,
        description: description ?? null,
        user_email: user?.email ?? null,
        metadata: metadata ?? null,
      });
  } catch { /* logi nigdy nie przerywają działania aplikacji */ }
}

export async function getAdminLogs(
  category?: AdminLog['category'],
  limit = 200
): Promise<AdminLog[]> {
  try {
    const sb = await getSupabaseClient();
    const base = (sb as SupabaseClient)
      .from('admin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    const { data, error } = category
      ? await base.eq('category', category)
      : await base;
    if (error) return [];
    return (data ?? []) as AdminLog[];
  } catch {
    return [];
  }
}

/** Usuwa logi starsze niż `days` dni. Zwraca liczbę usuniętych wierszy. */
export async function deleteOldAdminLogs(days: number): Promise<number> {
  try {
    const sb = await getSupabaseClient();
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { error, count } = await (sb as SupabaseClient)
      .from('admin_logs')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Subskrypcja nowych wpisów w admin_logs (realtime). Zwraca unsubscribe. */
export function subscribeAdminLogs(onInsert: (log: AdminLog) => void): () => void {
  let channel: { unsubscribe: () => void } | null = null;
  let cancelled = false;
  void (async () => {
    try {
      const sb = await getSupabaseClient();
      if (cancelled) return;
      channel = (sb as SupabaseClient)
        .channel('admin_logs_stream')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_logs' }, (payload: { new: AdminLog }) => {
          try { onInsert(payload.new); } catch { /* noop */ }
        })
        .subscribe();
    } catch { /* noop */ }
  })();
  return () => {
    cancelled = true;
    try { channel?.unsubscribe(); } catch { /* noop */ }
  };
}
