import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key);

export const CAM_BASE_URL = (import.meta.env.VITE_CAM_BASE_URL as string) || 'http://localhost:8888';

// Czas warszawski (CEST = UTC+2 w sezonie letnim)
function todayWarsaw(): string {
  const now = new Date();
  const warsawOffset = 2 * 60;
  const localMs = now.getTime() + (warsawOffset - now.getTimezoneOffset()) * 60000;
  const d = new Date(localMs);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export interface Reservation {
  id: string;
  registration: string;
  arrival_date: string;
  status: string;
  messenger_id: string;
  created_at: string;
}

export async function getTodayReservations(): Promise<{ reservations: Reservation[]; date: string }> {
  const date = todayWarsaw();
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('arrival_date', date)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return { reservations: (data as Reservation[]) ?? [], date };
}

export async function getSpotsAvailable(): Promise<boolean> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'spots_available')
    .maybeSingle();
  return (data as { value: string } | null)?.value !== 'false';
}

export async function setSpotsAvailable(available: boolean): Promise<void> {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'spots_available', value: available ? 'true' : 'false' }, { onConflict: 'key' });
  if (error) throw error;
}

export async function searchPlate(query: string): Promise<{
  reservations: Reservation[];
  isBanned: boolean;
  noShowCount: number;
  todayDate: string;
}> {
  const reg = query.trim().toUpperCase().replace(/\s+/g, '');
  const today = todayWarsaw();
  const [resResult, banResult] = await Promise.all([
    supabase
      .from('reservations')
      .select('*')
      .ilike('registration', `%${reg}%`)
      .order('arrival_date', { ascending: false })
      .limit(30),
    supabase
      .from('no_show_bans')
      .select('is_banned, no_show_count')
      .eq('registration', reg)
      .maybeSingle(),
  ]);
  return {
    reservations: (resResult.data as Reservation[]) ?? [],
    isBanned: (banResult.data as { is_banned: boolean } | null)?.is_banned ?? false,
    noShowCount: (banResult.data as { no_show_count: number } | null)?.no_show_count ?? 0,
    todayDate: today,
  };
}
