/**
 * Sesja — bieżący zalogowany użytkownik + uprawnienia.
 *
 * AppUser.permissions to teraz tablica granularnych kluczy `module.action`
 * (np. 'reservations.create'). Stare wpisy „page id" (np. 'reservations') są
 * traktowane jako shortcut → user dostaje wszystkie akcje z tego modułu.
 */

import { checkPermission, expandAllPerms, PERMISSION_MODULES } from './permissions';

export interface AppUser {
  id: string;
  email: string;
  role: 'superadmin' | 'operator';
  permissions: string[];                   // granularne klucze 'module.action'
  // Profil (rozszerzone w iteracji 3)
  firstName?: string;
  lastName?: string;
  avatarColor?: string;                    // hex tła awatara z inicjałami
  mustChangePassword?: boolean;
}

export const SUPERADMIN_EMAIL = 'klosekmichal@gmail.com';

// Page id'ki w sidebarze — kolejność = kolejność w menu.
export const ALL_PAGES = [
  'dashboard', 'cameras', 'reservations', 'finances', 'admin', 'chat', 'email', 'settings',
] as const;

let _user: AppUser | null = null;

export function setCurrentUser(u: AppUser | null): void {
  _user = u;
}

export function getCurrentUser(): AppUser | null {
  return _user;
}

export function isSuperAdmin(): boolean {
  return _user?.role === 'superadmin';
}

/**
 * Sprawdza uprawnienie. Superadmin ma zawsze true.
 * Akceptuje stare page id (np. 'reservations') i nowe granularne ('reservations.create').
 */
export function hasPermission(key: string): boolean {
  if (!_user) return false;
  if (_user.role === 'superadmin') return true;
  return checkPermission(_user.permissions, key);
}

/**
 * Normalizuje listę uprawnień: jeśli ktoś przekaże stare page id (bez kropki),
 * rozwija do wszystkich akcji modułu. Granularne pozostawia.
 */
export function normalizePermissions(raw: string[]): string[] {
  const out = new Set<string>();
  for (const p of raw ?? []) {
    if (!p) continue;
    if (p.includes('.')) {
      out.add(p);
    } else {
      const mod = PERMISSION_MODULES.find(m => m.id === p || m.pageId === p);
      if (mod) {
        for (const a of mod.actions) out.add(`${mod.id}.${a.id}`);
      } else {
        out.add(p);
      }
    }
  }
  return [...out];
}

export const ALL_PERMISSIONS = expandAllPerms;
