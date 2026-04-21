import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getSupabaseClient } from './supabase';

let lastKnownTimestamp: string | null = null;
let intervalId: number | null = null;

let lastKnownChatTimestamp: string | null = null;
let chatIntervalId: number | null = null;
let titleFlashIntervalId: number | null = null;
const ORIGINAL_TITLE = 'Parking.OS';

export interface NewReservationCallback {
  (reservation: { registration: string; arrival_date: string }): void;
}

export interface NewChatMessageCallback {
  (message: { content: string; session_id: string }): void;
}

interface ReservationRow {
  id: string;
  registration: string;
  arrival_date: string;
  created_at: string;
}

interface ChatMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

/** Syntetyczny dźwięk powiadomienia (Web Audio API — bez pliku) */
function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const times = [0, 0.18];
    const freqs = [880, 1100];
    times.forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freqs[i];
      gain.gain.setValueAtTime(0.35, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.25);
    });
  } catch { /* AudioContext może być niedostępny */ }
}

/** Migający tytuł okna — widoczny na pasku zadań Windows */
async function startTitleFlash(count = 6) {
  if (titleFlashIntervalId !== null) return; // już miga
  let flashes = 0;
  const win = getCurrentWindow();
  titleFlashIntervalId = window.setInterval(async () => {
    flashes++;
    const isAlert = flashes % 2 === 1;
    try {
      await win.setTitle(isAlert ? `🔔 Nowa wiadomość — Orzeł` : ORIGINAL_TITLE);
    } catch { /* ignoruj */ }
    if (flashes >= count * 2) {
      stopTitleFlash();
    }
  }, 700);
}

async function stopTitleFlash() {
  if (titleFlashIntervalId !== null) {
    clearInterval(titleFlashIntervalId);
    titleFlashIntervalId = null;
    try { await getCurrentWindow().setTitle(ORIGINAL_TITLE); } catch { /* ignoruj */ }
  }
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

export function startChatPolling(onNewMessage: NewChatMessageCallback) {
  if (chatIntervalId !== null) return;

  // Inicjalizacja — zapamiętaj ostatnią wiadomość bez powiadomienia
  getSupabaseClient().then(sb =>
    sb.from('chat_messages')
      .select('created_at')
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ).then(({ data }) => {
    lastKnownChatTimestamp = (data as { created_at: string } | null)?.created_at ?? null;
  }).catch(() => {});

  chatIntervalId = window.setInterval(async () => {
    try {
      const sb = await getSupabaseClient();
      const { data } = await sb
        .from('chat_messages')
        .select('id, session_id, role, content, created_at')
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!data || data.length === 0) return;

      const rows = data as ChatMessageRow[];

      if (lastKnownChatTimestamp === null) {
        lastKnownChatTimestamp = rows[0].created_at;
        return;
      }

      const newItems = rows.filter(r => r.created_at > lastKnownChatTimestamp!);
      if (newItems.length === 0) return;

      lastKnownChatTimestamp = newItems[0].created_at;

      for (const r of newItems) {
        onNewMessage({ content: r.content, session_id: r.session_id });
      }

      // Dźwięk + Windows toast + migający tytuł
      playNotificationSound();
      startTitleFlash(8);
      try {
        await invoke('send_notification', {
          title: 'Parking.OS — Nowa wiadomość do Orła!',
          body: newItems[newItems.length - 1].content.slice(0, 80),
        });
      } catch { /* ignoruj jeśli powiadomienia niedostępne */ }
    } catch {
      // Supabase niedostępny — ignoruj
    }
  }, 15_000);
}

export function stopChatPolling() {
  if (chatIntervalId !== null) {
    clearInterval(chatIntervalId);
    chatIntervalId = null;
  }
  stopTitleFlash();
}
