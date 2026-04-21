import { getSupabaseClient } from './supabase';
import { setCurrentUser, getCurrentUser, SUPERADMIN_EMAIL, ALL_PAGES } from './session';
import { logAction } from './audit';

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = await getSupabaseClient();
    const { data, error } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { ok: false, error: error.message };

    const user = data.user!;
    const isSA = user.email?.toLowerCase() === SUPERADMIN_EMAIL;
    const meta = (user.user_metadata ?? {}) as { permissions?: string[] };

    setCurrentUser({
      id: user.id,
      email: user.email!,
      role: isSA ? 'superadmin' : 'operator',
      permissions: isSA ? [...ALL_PAGES] : (meta.permissions ?? ['dashboard', 'cameras']),
    });

    await logAction('login', { email: user.email });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Blad polaczenia z Supabase' };
  }
}

export async function signOut(): Promise<void> {
  await logAction('logout');
  try {
    const sb = await getSupabaseClient();
    await sb.auth.signOut();
  } catch { /* ignore */ }
  setCurrentUser(null);
}

/**
 * Verify the current user's password by attempting re-authentication.
 * Used before allowing a password change.
 */
export async function verifyCurrentPassword(password: string): Promise<boolean> {
  try {
    const user = getCurrentUser();
    if (!user) return false;
    const sb = await getSupabaseClient();
    const { error } = await sb.auth.signInWithPassword({
      email: user.email,
      password,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function changePassword(newPassword: string): Promise<void> {
  const sb = await getSupabaseClient();
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
  await logAction('password_change');
}

