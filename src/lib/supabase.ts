import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getStore } from './store';

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

export async function isConfigured(): Promise<boolean> {
  const store = await getStore();
  const url = await store.get<string>('supabase_url') ?? '';
  const key = await store.get<string>('supabase_key') ?? '';
  return !!(url && key);
}

export async function getSupabaseClient(): Promise<SupabaseClient<Database>> {
  if (supabaseInstance) return supabaseInstance;

  const store = await getStore();
  const url = await store.get<string>('supabase_url') ?? '';
  const key = await store.get<string>('supabase_key') ?? '';

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

export async function setConfig(key: string, value: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await (sb as SupabaseClient)
    .from('settings' as never)
    .upsert({ key, value } as never, { onConflict: 'key' });
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
    .order('arrival_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getReservationsForDate(date: string): Promise<Reservation[]> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservations')
    .select('*')
    .eq('arrival_date', toDbDate(date))
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addReservation(arrival_date: string, registration: string): Promise<Reservation> {
  const sb = await getSupabaseClient();
  const { data, error } = await sb
    .from('reservations')
    .insert({ messenger_id: 'manual', arrival_date: toDbDate(arrival_date), registration, status: 'confirmed' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReservation(id: string, arrival_date: string, registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb
    .from('reservations')
    .update({ arrival_date: toDbDate(arrival_date), registration })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteReservation(id: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb
    .from('reservations')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function getReservationCountByMonth(year: number, month: number): Promise<Record<string, number>> {
  const sb = await getSupabaseClient();
  const mm = String(month).padStart(2, '0');
  const { data, error } = await sb
    .from('reservations')
    .select('arrival_date')
    .filter('arrival_date', 'like', `%.${mm}.${year}`)
    .eq('status', 'confirmed');
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
  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function setReservationStatus(id: string, status: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb
    .from('reservations')
    .update({ status })
    .eq('id', id);
  if (error) throw error;
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

  return { nowBanned: nowBanned && !(existing?.is_banned) };
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
  const { error } = await sb
    .from('no_show_bans')
    .upsert(
      {
        registration: registration.toUpperCase(),
        is_banned: true,
        ban_reason: reason ?? 'Ręczny ban przez administratora',
      },
      { onConflict: 'registration' }
    );
  if (error) throw error;
}

export async function unbanVehicle(registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb
    .from('no_show_bans')
    .update({ is_banned: false, ban_reason: null })
    .eq('registration', registration.toUpperCase());
  if (error) throw error;
}

export async function resetNoShowCount(registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb
    .from('no_show_bans')
    .update({ no_show_count: 0, is_banned: false, ban_reason: null })
    .eq('registration', registration.toUpperCase());
  if (error) throw error;
}

export async function deleteFromBanList(registration: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb
    .from('no_show_bans')
    .delete()
    .eq('registration', registration.toUpperCase());
  if (error) throw error;
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

export async function logEvent(event_type: string, details?: Record<string, unknown>): Promise<void> {
  try {
    const sb = await getSupabaseClient();
    await (sb as SupabaseClient).from('events').insert({ event_type, details: details ?? null });
  } catch {
    // logi nie mogą blokować głównej operacji
  }
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
  category: 'session' | 'action' | 'camera' | 'bot' | 'system';
  action: string;
  description: string | null;
  user_email: string | null;
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
