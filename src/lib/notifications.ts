import { invoke } from '@tauri-apps/api/core';
import { getSupabaseClient } from './supabase';

let lastKnownTimestamp: string | null = null;
let intervalId: number | null = null;

export interface NewReservationCallback {
  (reservation: { registration: string; arrival_date: string }): void;
}

interface ReservationRow {
  id: string;
  registration: string;
  arrival_date: string;
  created_at: string;
}

export function startPolling(onNewReservation: NewReservationCallback) {
  if (intervalId !== null) return;

  // Initialise timestamp without triggering notification on first load
  getSupabaseClient().then(sb =>
    sb.from('reservations')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ).then(({ data }) => {
    lastKnownTimestamp = (data as { created_at: string } | null)?.created_at ?? null;
  }).catch(() => {});

  intervalId = window.setInterval(async () => {
    try {
      const sb = await getSupabaseClient();
      const { data } = await sb
        .from('reservations')
        .select('id, registration, arrival_date, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!data || data.length === 0) return;

      const rows = data as ReservationRow[];
      const newest = rows[0];

      if (lastKnownTimestamp === null) {
        lastKnownTimestamp = newest.created_at;
        return;
      }

      const newItems = rows.filter(r => r.created_at > lastKnownTimestamp!);
      if (newItems.length === 0) return;

      lastKnownTimestamp = newItems[0].created_at;

      for (const r of newItems) {
        onNewReservation({ registration: r.registration, arrival_date: r.arrival_date });
        await invoke('send_notification', {
          title: 'Parking.OS — Nowa rezerwacja!',
          body: `${r.registration} na dzień ${r.arrival_date}`,
        });
      }
    } catch {
      // Supabase may be unavailable — ignore until connected
    }
  }, 60_000);
}

export function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
