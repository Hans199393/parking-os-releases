export interface AppUser {
  id: string;
  email: string;
  role: 'superadmin' | 'operator';
  permissions: string[]; // page ids the user can access
}

export const SUPERADMIN_EMAIL = 'klosekmichal@gmail.com';

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

export function hasPermission(page: string): boolean {
  if (!_user) return false;
  if (_user.role === 'superadmin') return true;
  return _user.permissions.includes(page);
}
