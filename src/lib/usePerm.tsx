/**
 * usePerm — hook do egzekwowania uprawnień granularnych w UI.
 *
 * Wzorzec użycia w komponencie:
 *   const perm = usePerm();
 *
 *   // 1. Ukrywanie elementu UI:
 *   {perm.has('finances.delete') && <button onClick={...}>Usuń</button>}
 *
 *   // 2. Walidacja w handlerze (gdy nie da się ukryć):
 *   const handleDelete = async () => {
 *     if (!perm.guard('finances.delete', 'usunięcie faktury')) return;
 *     await deleteInvoice(id);
 *   };
 *
 *   // 3. Wrapper komponent:
 *   <PermissionGate perm="finances.delete"><Button>...</Button></PermissionGate>
 *
 * Superadmin omija wszystkie sprawdzenia.
 * Brak zalogowanego usera = brak dostępu (zwraca false).
 *
 * UWAGA: To jest tylko warstwa UI. Realny enforcement musi być na poziomie
 * backendu (Supabase RLS). Tu chronimy operatora przed PRZYPADKOWYM wykonaniem
 * akcji których nie wolno, oraz ukrywamy nieaktywne kontrolki.
 */

import { useCallback, useMemo } from 'react';
import { getCurrentUser } from './session';
import { checkPermission } from './permissions';
import { audit } from './audit';

let toastFn: ((msg: string, kind?: 'error' | 'info') => void) | null = null;
/** Wstrzykuje globalną funkcję toast (z App.tsx) — żeby guard mógł pokazać komunikat. */
export function setPermToastSink(fn: typeof toastFn) {
  toastFn = fn;
}

/** Fallback toast — DOM injection, gdy aplikacja nie podpięła własnego sink'a. */
function fallbackToast(msg: string, kind: 'error' | 'info' = 'error') {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('__perm_toast_host__');
  if (!host) {
    host = document.createElement('div');
    host.id = '__perm_toast_host__';
    host.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;font-family:system-ui,sans-serif';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  const bg = kind === 'error' ? 'rgba(220,38,38,0.95)' : 'rgba(59,130,246,0.95)';
  el.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-size:14px;font-weight:600;max-width:380px;animation:slideIn 0.25s ease-out;pointer-events:auto;cursor:pointer`;
  el.textContent = msg;
  el.onclick = () => el.remove();
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 3500);
  setTimeout(() => el.remove(), 3900);
}

export function usePerm() {
  // Czytamy bieżącego usera z globalnego state. Nie jest reaktywne, ale to OK —
  // user nie zmienia się podczas sesji (zmiana = ponowny login = remount drzewa).
  const user = getCurrentUser();
  const isSuper = user?.role === 'superadmin';

  const has = useCallback((key: string): boolean => {
    if (!user) return false;
    if (isSuper) return true;
    return checkPermission(user.permissions, key);
  }, [user, isSuper]);

  const guard = useCallback((key: string, label?: string): boolean => {
    if (has(key)) return true;
    const msg = `🔒 Brak uprawnień: ${label ?? key}`;
    if (toastFn) toastFn(msg, 'error');
    else fallbackToast(msg, 'error');
    void audit('user', 'permission_denied', { metadata: { key, label, user: user?.email } });
    return false;
  }, [has, user]);

  return useMemo(() => ({ has, guard, isSuper, user }), [has, guard, isSuper, user]);
}

/** Komponent wrapper: renderuje children tylko gdy user ma uprawnienie. */
export function PermissionGate({ perm, fallback, children }: {
  perm: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { has } = usePerm();
  if (!has(perm)) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
