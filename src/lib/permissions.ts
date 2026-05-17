/**
 * Granularne uprawnienia: menu → akcja.
 *
 * Format: "module.action" (np. "reservations.create").
 * Backcompat: stary kod woła `hasPermission('reservations')` — to nadal działa
 * (zwraca true jeśli user ma JAKĄKOLWIEK akcję w tym module).
 *
 * Superadmin ma zawsze wszystko (sprawdzane w session.ts).
 */

export interface PermAction {
  id: string;        // 'view', 'create', 'edit', ...
  label: string;     // PL
  description?: string;
}

export interface PermModule {
  id: string;        // 'reservations', 'finances', ...
  label: string;
  icon?: string;     // lucide icon name (do UI tree)
  pageId?: string;   // dla backcompat: page id z Sidebar
  actions: PermAction[];
}

export const PERMISSION_MODULES: PermModule[] = [
  {
    id: 'dashboard', label: 'Dashboard', pageId: 'dashboard',
    actions: [
      { id: 'view', label: 'Zobacz pulpit' },
    ],
  },
  {
    id: 'cameras', label: 'Kamery', pageId: 'cameras',
    actions: [
      { id: 'view',     label: 'Podgląd na żywo' },
      { id: 'roi_edit', label: 'Edytuj ROI', description: 'Linia detekcji wjazdu' },
      { id: 'detector', label: 'Steruj detektorem', description: 'Start/stop YOLO' },
    ],
  },
  {
    id: 'reservations', label: 'Rezerwacje', pageId: 'reservations',
    actions: [
      { id: 'view',     label: 'Zobacz listę' },
      { id: 'create',   label: 'Dodaj nową' },
      { id: 'edit',     label: 'Edytuj' },
      { id: 'delete',   label: 'Usuń (soft-delete)' },
      { id: 'restore',  label: 'Przywróć usuniętą' },
      { id: 'no_show',  label: 'Oznacz no-show' },
      { id: 'ban',      label: 'Banuj pojazd' },
      { id: 'unban',    label: 'Odbanuj' },
    ],
  },
  {
    id: 'finances', label: 'Finanse', pageId: 'finances',
    actions: [
      { id: 'view',         label: 'Zobacz podsumowania' },
      { id: 'add_income',   label: 'Dodaj dochód' },
      { id: 'add_expense',  label: 'Dodaj wydatek' },
      { id: 'edit',         label: 'Edytuj wpisy' },
      { id: 'delete',       label: 'Usuń wpisy' },
      { id: 'export',       label: 'Eksport CSV/PDF' },
    ],
  },
  {
    id: 'admin', label: 'Panel WWW (CMS)', pageId: 'admin',
    actions: [
      { id: 'view',          label: 'Zobacz panel' },
      { id: 'edit_content',  label: 'Edytuj treści strony' },
      { id: 'manage_psids',  label: 'Zarządzaj PSID Messengera' },
    ],
  },
  {
    id: 'chat', label: 'Czat AI (Orzeł)', pageId: 'chat',
    actions: [
      { id: 'view',  label: 'Zobacz historię' },
      { id: 'use',   label: 'Pisz wiadomości' },
      { id: 'reset', label: 'Wyczyść kontekst' },
    ],
  },
  {
    id: 'email', label: 'Skrzynka e-mail', pageId: 'email',
    actions: [
      { id: 'view',   label: 'Czytaj wiadomości' },
      { id: 'send',   label: 'Wysyłaj' },
      { id: 'delete', label: 'Usuń wiadomości' },
      { id: 'reply',  label: 'Odpowiadaj' },
    ],
  },
  {
    id: 'logs', label: 'Logi systemowe', pageId: 'logs',
    actions: [
      { id: 'view',   label: 'Zobacz' },
      { id: 'export', label: 'Eksport' },
      { id: 'clear',  label: 'Wyczyść stare' },
    ],
  },
  {
    id: 'settings', label: 'Ustawienia', pageId: 'settings',
    actions: [
      { id: 'view',              label: 'Zobacz' },
      { id: 'edit_parking',      label: 'Edytuj parking', description: 'Cennik, godziny, komunikat' },
      { id: 'edit_devices',      label: 'Edytuj kamery i detektor' },
      { id: 'edit_integrations', label: 'Edytuj integracje', description: 'Supabase, IMAP, panel' },
      { id: 'edit_appearance',   label: 'Edytuj wygląd' },
      { id: 'manage_accounts',   label: 'Zarządzaj kontami', description: 'Tylko zaufani' },
    ],
  },
];

// ─── Presety ────────────────────────────────────────────────────────────────
export interface PermPreset {
  id: string;
  label: string;
  description: string;
  perms: string[];
}

export const PERMISSION_PRESETS: PermPreset[] = [
  {
    id: 'viewer',
    label: 'Tylko podgląd',
    description: 'Może oglądać dashboard, kamery, listę rezerwacji — bez edycji',
    perms: ['dashboard.view', 'cameras.view', 'reservations.view', 'finances.view', 'logs.view'],
  },
  {
    id: 'operator',
    label: 'Operator',
    description: 'Codzienna obsługa: rezerwacje, finanse, kamery, czat',
    perms: [
      'dashboard.view',
      'cameras.view', 'cameras.detector',
      'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.no_show',
      'finances.view', 'finances.add_income', 'finances.add_expense',
      'chat.view', 'chat.use',
      'email.view', 'email.reply',
      'logs.view',
    ],
  },
  {
    id: 'manager',
    label: 'Menedżer',
    description: 'Operator + bany, usuwanie, eksporty, edycja CMS',
    perms: [
      'dashboard.view',
      'cameras.view', 'cameras.roi_edit', 'cameras.detector',
      'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.delete', 'reservations.restore', 'reservations.no_show', 'reservations.ban', 'reservations.unban',
      'finances.view', 'finances.add_income', 'finances.add_expense', 'finances.edit', 'finances.delete', 'finances.export',
      'admin.view', 'admin.edit_content',
      'chat.view', 'chat.use', 'chat.reset',
      'email.view', 'email.send', 'email.reply', 'email.delete',
      'logs.view', 'logs.export',
      'settings.view', 'settings.edit_parking', 'settings.edit_appearance',
    ],
  },
];

export function expandAllPerms(): string[] {
  const out: string[] = [];
  for (const m of PERMISSION_MODULES) {
    for (const a of m.actions) out.push(`${m.id}.${a.id}`);
  }
  return out;
}

/**
 * Sprawdza uprawnienie. Akceptuje:
 *  - 'reservations'           — true jeśli user ma JAKĄKOLWIEK akcję w module (backcompat)
 *  - 'reservations.create'    — dokładne dopasowanie
 */
export function checkPermission(perms: string[], key: string): boolean {
  if (perms.includes(key)) return true;
  if (!key.includes('.')) {
    const prefix = `${key}.`;
    return perms.some(p => p.startsWith(prefix));
  }
  return false;
}

/**
 * Zwraca page id (do Sidebar) z tablicy granularnych uprawnień.
 * Stary kod używa `permissions: string[]` z page id'kami — stąd ten mapper.
 */
export function permsToPageIds(perms: string[]): string[] {
  const out = new Set<string>();
  for (const m of PERMISSION_MODULES) {
    if (!m.pageId) continue;
    if (perms.some(p => p === m.id || p.startsWith(`${m.id}.`))) out.add(m.pageId);
  }
  return [...out];
}
