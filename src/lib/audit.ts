import { getSupabaseClient } from './supabase';
import { getCurrentUser } from './session';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'settings_saved'
  | 'detector_start'
  | 'detector_stop'
  | 'roi_saved'
  | 'reservation_create'
  | 'reservation_update'
  | 'reservation_delete'
  | 'finance_save'
  | 'user_create'
  | 'user_delete'
  | 'user_update_permissions'
  | 'password_change';

/**
 * Write an audit log entry to Supabase.
 * Silent — never throws. Call it anywhere without try/catch.
 */
export async function logAction(
  action: AuditAction | string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const user = getCurrentUser();
    if (!user) return;
    const sb = await getSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb as any).from('audit_log').insert({
      user_email: user.email,
      user_id: user.id,
      action,
      details: details ?? null,
    });
  } catch {
    // Audit failures must NEVER break the main flow — swallow silently
  }
}
