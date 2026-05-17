/**
 * audit.ts — Centralny, zunifikowany system audit logu.
 *
 * Jeden punkt wejścia dla wszystkich operacji logujących w Parking.OS.
 * Pisze do tabeli `admin_logs` (po migracji audit_log_unified).
 *
 * Cele:
 *  - Każda mutacja danych musi być zalogowana (rezerwacje, finanse, konta,
 *    bany, kamery, ustawienia).
 *  - Diff edycji: snapshot przed/po (kolumny `before`, `after`).
 *  - Severity: info / warning / critical.
 *  - Session grouping: wszystkie wpisy jednej sesji loginu mają wspólne `session_id`.
 *  - Linkowanie do encji: `entity_type` + `entity_id` → klikalny log otwierający
 *    rezerwację / użytkownika / fakturę.
 *
 * Logi NIGDY nie blokują głównego flow — błędy są swallowed silently.
 */

import { getSupabaseClient } from './supabase';
import { getCurrentUser } from './session';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Typy ────────────────────────────────────────────────────────────────────

export type LogCategory =
  | 'session'      // logowanie, wylogowanie, lock
  | 'action'       // ogólne akcje admina (page_view, settings_change)
  | 'reservation'  // dodanie/edycja/usunięcie/no-show/restore rezerwacji
  | 'finance'      // utargi, faktury, eksporty
  | 'user'         // tworzenie/edycja/usunięcie kont, zmiana uprawnień
  | 'mail'         // wysłanie maila, usunięcie z IMAP
  | 'camera'       // online/offline, ROI
  | 'bot'          // alerty bota, błędy AI
  | 'chat'         // asystent Orzeł (tools, function calling)
  | 'system';      // backup, migracje, błędy techniczne

export type LogSeverity = 'info' | 'warning' | 'critical';

export interface LogOpts {
  description?: string;
  entityType?: string;          // 'reservation' | 'user' | 'invoice' | 'ban' | ...
  entityId?: string | number;
  before?: unknown;             // snapshot przed zmianą (dla diffów)
  after?: unknown;              // snapshot po zmianie
  severity?: LogSeverity;       // domyślnie 'info'
  metadata?: Record<string, unknown>;
}

// ─── Session ID — grupowanie wpisów jednej sesji ─────────────────────────────

const SESSION_KEY = 'parking_os_audit_session';

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `sess_${Date.now()}`;
  }
}

/** Reset session ID — wywołaj przy logout. */
export function resetAuditSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}

// ─── Główna funkcja zapisu ───────────────────────────────────────────────────

/**
 * Uniwersalny zapis do audit logu.
 * Bezpieczny do użycia w dowolnym miejscu — nigdy nie rzuca wyjątku.
 */
export async function audit(
  category: LogCategory,
  action: string,
  opts: LogOpts = {},
): Promise<void> {
  try {
    const user = getCurrentUser();
    const sb = await getSupabaseClient();
    const payload: Record<string, unknown> = {
      category,
      action,
      description: opts.description ?? action,
      user_email: user?.email ?? null,
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      severity: opts.severity ?? 'info',
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId != null ? String(opts.entityId) : null,
      before: opts.before ?? null,
      after: opts.after ?? null,
      metadata: opts.metadata ?? null,
    };
    await (sb as SupabaseClient).from('admin_logs').insert(payload as never);
  } catch {
    // Audit nigdy nie blokuje aplikacji
  }
}

// ─── Pomocnicze diff helper ──────────────────────────────────────────────────

/**
 * Zwraca obiekt z polami które się zmieniły (before -> after).
 * Pusty obiekt = brak zmian.
 */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  if (!before && !after) return { before: b, after: a };
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const k of keys) {
    const bv = (before as Record<string, unknown> | null | undefined)?.[k];
    const av = (after as Record<string, unknown> | null | undefined)?.[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      (b as Record<string, unknown>)[k] = bv as T[Extract<keyof T, string>];
      (a as Record<string, unknown>)[k] = av as T[Extract<keyof T, string>];
    }
  }
  return { before: b, after: a };
}

// ─── Backward-compat aliases ─────────────────────────────────────────────────
// Stary kod wywołuje logAction — kierujemy je tutaj.

/** @deprecated używaj `audit(category, action, opts)` */
export async function logAction(
  action: string,
  details?: Record<string, unknown>,
): Promise<void> {
  return audit('action', action, { metadata: details });
}

// ─── Skróty domenowe — czytelniejsze wywołania w kodzie ──────────────────────

export const auditReservation = (
  action:
    | 'created' | 'updated' | 'deleted' | 'restored'
    | 'status_changed' | 'no_show_marked' | 'no_show_reverted',
  opts: LogOpts,
) => audit('reservation', `reservation_${action}`, opts);

export const auditFinance = (
  action:
    | 'revenue_saved' | 'revenue_deleted'
    | 'invoice_added' | 'invoice_updated' | 'invoice_deleted'
    | 'export',
  opts: LogOpts = {},
) => audit('finance', action, opts);

export const auditUser = (
  action:
    | 'created' | 'deleted' | 'permissions_changed'
    | 'password_changed' | 'invite_sent' | 'first_login',
  opts: LogOpts,
) => audit('user', `user_${action}`, opts);

export const auditBan = (
  action: 'banned' | 'unbanned' | 'reset' | 'removed',
  opts: LogOpts,
) => audit('action', `vehicle_${action}`, { ...opts, entityType: 'ban' });

export const auditMail = (
  action: 'sent' | 'deleted' | 'config_updated',
  opts: LogOpts = {},
) => audit('mail', `mail_${action}`, opts);

export const auditSession = (
  action: 'login' | 'logout' | 'lock' | 'unlock' | 'failed_login',
  opts: LogOpts = {},
) => {
  if (action === 'logout') {
    void audit('session', action, opts);
    resetAuditSession();
    return Promise.resolve();
  }
  return audit('session', action, opts);
};
