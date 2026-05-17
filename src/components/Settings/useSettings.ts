/**
 * useSettings — hook do auto-save z toastem i undo.
 *
 * Wzorzec:
 *   - Wczytanie z `getStore()` raz przy montowaniu.
 *   - Każda zmiana (`set(key, val)`) trafia do bufora i jest zapisywana po 1.5s
 *     debounce (klucz po kluczu, więc szybkie zmiany w różnych polach łączą się
 *     w jeden flush).
 *   - Po zapisie pokazujemy toast „Zapisano · undo".
 *   - Undo cofa wszystkie zmiany z ostatniego batch'a (snapshot przed flushem).
 *
 * Wyjątek: zmiany w sekcji „Parking" (cloud-mirrored keys) są zapisywane lokalnie,
 * ale do Supabase trzeba je dodatkowo zsynchronizować przyciskiem „Zapisz w chmurze"
 * (kompatybilność z botem/stroną — nie chcemy spamować writes do Supabase
 * przy każdym keystroke).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getStore } from '../../lib/store';
import { ALL_SETTINGS_KEYS } from './settingsTypes';
import { logAction } from '../../lib/audit';

const DEBOUNCE_MS = 1500;

const DEFAULTS: Record<string, string> = {
  snapshot_interval: '1500',
  show_roi_overlay: 'true',
  detection_confidence: '0.5',
  detection_interval: '330',
  detector_autostart: 'false',
  currency: 'PLN',
  session_timeout: '3600',
  confirm_exit: 'true',
  groq_model: 'llama-3.3-70b-versatile',
  orzel_temperature: '0.3',
  orzel_expanded_mode: 'false',
  orzel_quick_actions: '[{"label":"Znajdź tablicę","tool":"find_reservation"},{"label":"Sprawdź obłożenie","tool":"check_capacity"},{"label":"Lista rezerwacji","tool":"list_reservations"}]',
};

export interface ToastState {
  text: string;
  kind: 'success' | 'error' | 'info';
  undo?: () => void;
  // numer batch'a (do dismiss przy nowym zapisie)
  id: number;
}

export function useSettings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Bufor dirty: klucze które wymagają zapisu (ich aktualna wartość jest w `values`)
  const dirtyRef = useRef<Set<string>>(new Set());
  // Snapshot poprzednich wartości — do undo
  const snapshotRef = useRef<Record<string, string>>({});
  const timerRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  // Live mirror values — flush NIE może czytać closure `values` bo gdy useEffect[flush]
  // cleanup odpala stary flush, ten ma stale snapshot i nadpisuje świeżo dodane wartości
  // pustym stringiem (bug: PSID dodany i nieobecny po reload).
  const valuesRef = useRef<Record<string, string>>({});

  // Wczytanie raz przy mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getStore();
        const out: Record<string, string> = {};
        for (const k of ALL_SETTINGS_KEYS) {
          const v = await store.get<string | number | boolean>(k);
          out[k] = v != null ? String(v) : (DEFAULTS[k] ?? '');
        }
        if (!cancelled) {
          setValues(out);
          valuesRef.current = out;
          setLoaded(true);
        }
      } catch (e) {
        console.error('[useSettings] load failed', e);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const flush = useCallback(async () => {
    if (dirtyRef.current.size === 0) return;
    const keys = Array.from(dirtyRef.current);
    dirtyRef.current.clear();
    try {
      const store = await getStore();
      for (const k of keys) {
        await store.set(k, valuesRef.current[k] ?? '');
      }
      await store.save();
      void logAction('settings_saved', { keys });
      // Powiadom resztę aplikacji że ustawienia zostały zapisane (np. panel Orła odświeża quick-actions).
      try { window.dispatchEvent(new CustomEvent('app:settings-saved', { detail: { keys } })); } catch { /* SSR? */ }
      // Pokaż toast z undo
      const prev = { ...snapshotRef.current };
      const id = ++toastIdRef.current;
      setToast({
        text: keys.length === 1 ? `Zapisano: ${prettyKey(keys[0])}` : `Zapisano (${keys.length} pól)`,
        kind: 'success',
        id,
        undo: () => {
          // Cofnij do snapshotu
          setValues(v => ({ ...v, ...prev }));
          // I oznacz jako dirty żeby trafiło do storage
          for (const k of Object.keys(prev)) dirtyRef.current.add(k);
          snapshotRef.current = {};
          scheduleFlush();
          setToast({ text: 'Cofnięto', kind: 'info', id: ++toastIdRef.current });
          window.setTimeout(() => setToast(t => (t?.id === toastIdRef.current ? null : t)), 1800);
        },
      });
      window.setTimeout(() => setToast(t => (t?.id === id ? null : t)), 4500);
      snapshotRef.current = {};
    } catch (e) {
      console.error('[useSettings] save failed', e);
      setToast({
        text: 'Błąd zapisu: ' + (e instanceof Error ? e.message : String(e)),
        kind: 'error',
        id: ++toastIdRef.current,
      });
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, DEBOUNCE_MS);
  }, [flush]);

  const set = useCallback((key: string, val: string) => {
    setValues(v => {
      // Zapisz snapshot pierwszej zmiany w batch'u (do undo)
      if (!(key in snapshotRef.current)) snapshotRef.current[key] = v[key] ?? '';
      const next = { ...v, [key]: val };
      valuesRef.current = next;
      return next;
    });
    dirtyRef.current.add(key);
    scheduleFlush();
  }, [scheduleFlush]);

  // Bezpośredni patch (bulk) — np. po fetchu z chmury
  const patch = useCallback((next: Record<string, string>) => {
    setValues(v => {
      const merged = { ...v, ...next };
      valuesRef.current = merged;
      return merged;
    });
  }, []);

  // Wymuś natychmiastowy flush (np. przed unmountem komponentu / przy „Zapisz teraz")
  const flushNow = useCallback(async () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await flush();
  }, [flush]);

  // Cleanup: flush na unmount (jednorazowo — bez deps żeby nie odpalać przy każdej zmianie values)
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // best-effort sync flush — używa valuesRef więc widzi najświeższe dane
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { values, set, patch, loaded, toast, dismissToast: () => setToast(null), flushNow };
}

// ─── Pretty labels dla toasta ───────────────────────────────────────────────
const KEY_LABELS: Record<string, string> = {
  rate_basic: 'cena walk-in',
  rate_reservation: 'cena z rezerwacją',
  rate_after_hours: 'cena nocna',
  open_from: 'godzina otwarcia',
  open_to: 'godzina zamknięcia',
  open_days: 'dni pracujące',
  spots_available: 'status parkingu',
  komunikat: 'komunikat na WWW',
  parking_capacity: 'pojemność',
  parking_name: 'nazwa parkingu',
  parking_address: 'adres',
  parking_nip: 'NIP',
  owner_phone: 'telefon',
  owner_email: 'e-mail kontaktowy',
  detection_confidence: 'próg pewności',
  detection_interval: 'interwał detekcji',
  detector_autostart: 'autostart detektora',
  show_roi_overlay: 'overlay ROI',
  snapshot_interval: 'interwał snapshot',
  accent_color: 'kolor akcentu',
  supabase_url: 'Supabase URL',
  supabase_key: 'Supabase key',
  email_user: 'login e-mail',
  email_pass: 'hasło e-mail',
  admin_url: 'URL panelu',
  admin_token: 'admin token',
  groq_api_key: 'klucz Groq',
  groq_model: 'model AI',
  orzel_temperature: 'kreatywność Orła',
};

function prettyKey(k: string): string {
  if (KEY_LABELS[k]) return KEY_LABELS[k];
  if (k.startsWith('cam')) {
    const m = /^cam(\d)_(.+)$/.exec(k);
    if (m) return `CAM ${m[1]} ${m[2]}`;
  }
  return k;
}
