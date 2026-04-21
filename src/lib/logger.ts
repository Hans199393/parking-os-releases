/**
 * logger.ts — Wrappers do logowania zdarzeń w Parking.OS
 * Używaj tych funkcji zamiast bezpośrednio writeAdminLog.
 */

import { writeAdminLog } from './supabase';

// ─── Sesje ───────────────────────────────────────────────────────────────────

export function logLogin(email: string) {
  void writeAdminLog('session', 'login', `Zalogowano: ${email}`, { email });
}

export function logLogout(email?: string | null) {
  void writeAdminLog('session', 'logout', `Wylogowano: ${email ?? 'nieznany'}`, { email });
}

// ─── Nawigacja ───────────────────────────────────────────────────────────────

const PAGE_LABELS: Record<string, string> = {
  dashboard:    'Dashboard',
  cameras:      'Kamery',
  reservations: 'Rezerwacje',
  finances:     'Finanse',
  admin:        'Panel WWW',
  chat:         'Czat Orzeł',
  email:        'Skrzynka',
  settings:     'Ustawienia',
  logs:         'Logi',
};

export function logPageView(page: string) {
  const label = PAGE_LABELS[page] ?? page;
  void writeAdminLog('action', 'page_view', `Otwarto: ${label}`, { page });
}

// ─── Rezerwacje ───────────────────────────────────────────────────────────────

export function logReservationAction(action: string, id: string, extra?: Record<string, unknown>) {
  void writeAdminLog('action', `reservation_${action}`, `Rezerwacja #${id}: ${action}`, { id, ...extra });
}

// ─── Kamery ───────────────────────────────────────────────────────────────────

export function logCameraOnline(label: string, url: string) {
  void writeAdminLog('camera', 'camera_online', `Kamera online: ${label}`, { label, url });
}

export function logCameraOffline(label: string, url: string, reason?: string) {
  void writeAdminLog('camera', 'camera_offline', `Kamera offline: ${label}${reason ? ' — ' + reason : ''}`, { label, url, reason });
}

// ─── Ustawienia ───────────────────────────────────────────────────────────────

export function logSettingsChange(key: string, value?: string) {
  void writeAdminLog('action', 'settings_change', `Zmieniono ustawienie: ${key}`, { key, value });
}

// ─── Ban / Unban tablic ───────────────────────────────────────────────────────

export function logBan(registration: string, reason?: string) {
  void writeAdminLog('action', 'vehicle_banned',
    `Zablokowano tablicę: ${registration}${reason ? ' — ' + reason : ''}`,
    { registration, reason }
  );
}

export function logUnban(registration: string, action?: string) {
  void writeAdminLog('action', 'vehicle_unbanned',
    `Odblokowano tablicę: ${registration}${action ? ' (' + action + ')' : ''}`,
    { registration, action }
  );
}

// ─── Faktury ─────────────────────────────────────────────────────────────────

export function logInvoiceAction(action: 'add' | 'update' | 'delete', id: string, name?: string) {
  const labels = { add: 'Dodano fakturę', update: 'Zaktualizowano fakturę', delete: 'Usunięto fakturę' };
  void writeAdminLog('action', `invoice_${action}`,
    `${labels[action]}${name ? ': ' + name : ''}${id ? ' #' + id : ''}`,
    { id, name }
  );
}

// ─── Eksport raportów ─────────────────────────────────────────────────────────

export function logExport(type: 'month' | 'owner', year: number, month: number) {
  const labels = { month: 'Raport miesięczny', owner: 'Raport właściciela' };
  void writeAdminLog('action', 'export_excel',
    `Eksportowano: ${labels[type]} ${String(month).padStart(2, '0')}/${year}`,
    { type, year, month }
  );
}
