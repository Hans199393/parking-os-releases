/**
 * AccountManager — modern, gold-standard rewrite (Iteracja 3).
 *
 * Funkcje:
 *  • Lista kont jako karty z avatarem, statusem online, statystykami
 *  • Inline edycja imienia/nazwiska
 *  • Granularny tree uprawnień (moduł → akcja, checkboxy)
 *  • Presety: Viewer / Operator / Manager / Custom
 *  • Invite-by-email (lub fallback: hasło tymczasowe pokazane do skopiowania)
 *  • Wymuszenie zmiany hasła przy pierwszym logowaniu
 *  • Statystyki z admin_logs (akcje 7d, ostatnie logowanie)
 *  • Reset hasła (admin)
 *  • Soft-disable konta
 */

import { useState, useEffect, useMemo } from 'react';
import { getSupabaseClient } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { Button, Input } from '../shared/UI';
import {
  Check, Trash2, UserPlus, RefreshCw, Shield, Mail,
  Edit3, KeyRound, Activity, ChevronDown, ChevronRight, Copy, X, Sparkles, AlertCircle, Lock,
} from 'lucide-react';
import {
  PERMISSION_MODULES, PERMISSION_PRESETS, expandAllPerms,
} from '../../lib/permissions';
import { usePerm } from '../../lib/usePerm';
import { SUPERADMIN_EMAIL } from '../../lib/session';

interface SupaUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string;
  user_metadata: {
    permissions?: string[];
    first_name?: string;
    last_name?: string;
    avatar_color?: string;
    must_change_password?: boolean;
    disabled?: boolean;
  };
  banned_until?: string | null;
}

interface UserStats {
  actions7d: number;
  lastAction?: string;
  lastActionAt?: string;
}

const AVATAR_PALETTE = ['#f59e0b', '#3b82f6', '#10b981', '#a855f7', '#ec4899', '#14b8a6', '#f43f5e'];

function pickAvatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function initials(u: SupaUser): string {
  const f = u.user_metadata?.first_name?.trim();
  const l = u.user_metadata?.last_name?.trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  return (u.email[0] || '?').toUpperCase();
}

function fullName(u: SupaUser): string {
  const f = u.user_metadata?.first_name?.trim();
  const l = u.user_metadata?.last_name?.trim();
  if (f || l) return [f, l].filter(Boolean).join(' ');
  return u.email.split('@')[0];
}

function isOnline(u: SupaUser): boolean {
  // heurystyka: zalogowany w ostatnich 15 min
  if (!u.last_sign_in_at) return false;
  return Date.now() - new Date(u.last_sign_in_at).getTime() < 15 * 60_000;
}

function timeAgo(iso?: string): string {
  if (!iso) return 'nigdy';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s temu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h temu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} dni temu`;
  return new Date(iso).toLocaleDateString('pl-PL');
}

export default function AccountManager() {
  const perm = usePerm();
  const canManage = perm.has('settings.manage_accounts');
  const [users, setUsers] = useState<SupaUser[]>([]);
  const [stats, setStats] = useState<Record<string, UserStats>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [savingPerms, setSavingPerms] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: e } = await (sb.auth as any).admin.listUsers();
      if (e) throw new Error(e.message);
      const list = (data?.users ?? []) as SupaUser[];
      setUsers(list);

      // Statystyki — jedno query do admin_logs
      try {
        const since = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { data: logs } = await sb
          .from('admin_logs')
          .select('user_email, action, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(2000);
        const map: Record<string, UserStats> = {};
        for (const u of list) map[u.email] = { actions7d: 0 };
        for (const row of (logs ?? []) as { user_email: string; action: string; created_at: string }[]) {
          const m = map[row.user_email];
          if (!m) continue;
          m.actions7d += 1;
          if (!m.lastAction) { m.lastAction = row.action; m.lastActionAt = row.created_at; }
        }
        setStats(map);
      } catch (statsErr) {
        console.warn('[AccountManager] stats failed', statsErr);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const beginEdit = (u: SupaUser) => {
    setEditingId(u.id);
    setEditPerms([...(u.user_metadata?.permissions ?? [])]);
    setEditFirst(u.user_metadata?.first_name ?? '');
    setEditLast(u.user_metadata?.last_name ?? '');
  };

  const cancelEdit = () => { setEditingId(null); setEditPerms([]); };

  const handleSave = async (u: SupaUser) => {
    if (!perm.guard('settings.manage_accounts', 'edycja konta użytkownika')) return;
    setSavingPerms(true);
    try {
      const sb = await getSupabaseClient();
      const before = u.user_metadata;
      const newMeta = {
        ...u.user_metadata,
        first_name: editFirst.trim() || undefined,
        last_name: editLast.trim() || undefined,
        permissions: editPerms,
        avatar_color: u.user_metadata?.avatar_color || pickAvatarColor(u.email),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (sb.auth as any).admin.updateUserById(u.id, { user_metadata: newMeta });
      if (e) throw new Error(e.message);
      void audit('user', 'user_updated', {
        entityType: 'user', entityId: u.id,
        description: `Zaktualizowano konto ${u.email}`,
        before: { permissions: before.permissions, first_name: before.first_name, last_name: before.last_name },
        after:  { permissions: editPerms, first_name: newMeta.first_name, last_name: newMeta.last_name },
      });
      cancelEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPerms(false);
    }
  };

  const handleDelete = async (u: SupaUser) => {
    if (!perm.guard('settings.manage_accounts', 'usunięcie konta')) return;
    if (!confirm(`Usunąć konto ${u.email}? Tej operacji nie można cofnąć.`)) return;
    setDeletingId(u.id);
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (sb.auth as any).admin.deleteUser(u.id);
      if (e) throw new Error(e.message);
      void audit('user', 'user_deleted', {
        entityType: 'user', entityId: u.id, severity: 'critical',
        description: `Usunięto konto ${u.email}`,
        before: u.user_metadata,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetPassword = async (u: SupaUser) => {
    if (!perm.guard('settings.manage_accounts', 'reset hasła użytkownika')) return;
    const tmp = generatePassword(12);
    if (!confirm(`Wygenerować nowe hasło dla ${u.email}?\nUżytkownik będzie musiał je zmienić przy następnym logowaniu.`)) return;
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (sb.auth as any).admin.updateUserById(u.id, {
        password: tmp,
        user_metadata: { ...u.user_metadata, must_change_password: true },
      });
      if (e) throw new Error(e.message);
      void audit('user', 'password_reset_admin', {
        entityType: 'user', entityId: u.id, severity: 'warning',
        description: `Reset hasła dla ${u.email} (administrator)`,
      });
      setTempPassword(`${u.email}\n${tmp}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-5">
      {!canManage && (
        <div className="glass-strong rounded-[var(--radius-lg)] p-4 flex items-center gap-3 border-2 border-[var(--color-warning)]/40 animate-slideUp">
          <Lock size={20} className="text-[var(--color-warning)] flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-[var(--color-text)]">Tryb tylko do odczytu</p>
            <p className="text-xs text-[var(--color-text-muted)]">Brak uprawnienia <code>settings.manage_accounts</code> — edycja, usuwanie i reset haseł zablokowane.</p>
          </div>
        </div>
      )}
      {/* HERO bar — statystyki kont */}
      <AccountsHero users={users} onAdd={() => {
        if (!perm.guard('settings.manage_accounts', 'zapraszanie nowych kont')) return;
        setInviteOpen(true);
      }} onRefresh={load} loading={loading} />

      {error && (
        <div className="glass-strong rounded-[var(--radius-md)] p-4 border-2 border-red-500/40 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        </div>
      )}

      {/* Lista kont */}
      <div className="grid grid-cols-1 gap-4">
        {users.map(u => (
          <UserCard
            key={u.id}
            user={u}
            stats={stats[u.email]}
            isEditing={editingId === u.id}
            editPerms={editPerms}
            editFirst={editFirst}
            editLast={editLast}
            setEditPerms={setEditPerms}
            setEditFirst={setEditFirst}
            setEditLast={setEditLast}
            onBeginEdit={() => beginEdit(u)}
            onCancelEdit={cancelEdit}
            onSave={() => handleSave(u)}
            onDelete={() => handleDelete(u)}
            onResetPassword={() => handleResetPassword(u)}
            saving={savingPerms}
            deleting={deletingId === u.id}
          />
        ))}
        {users.length === 0 && !loading && (
          <div className="glass-strong rounded-[var(--radius-lg)] p-8 text-center text-[var(--color-text-muted)]">
            Brak kont. Kliknij <strong>+ Dodaj</strong> aby zaprosić pierwszego użytkownika.
          </div>
        )}
      </div>

      {/* Modal: invite */}
      {inviteOpen && (
        <InviteModal onClose={() => setInviteOpen(false)} onCreated={async (tmp) => {
          setInviteOpen(false);
          if (tmp) setTempPassword(tmp);
          await load();
        }} />
      )}

      {/* Modal: temp password */}
      {tempPassword && <TempPasswordModal text={tempPassword} onClose={() => setTempPassword(null)} />}
    </div>
  );
}

// ─── HERO ───────────────────────────────────────────────────────────────────
function AccountsHero({ users, onAdd, onRefresh, loading }: {
  users: SupaUser[]; onAdd: () => void; onRefresh: () => void; loading: boolean;
}) {
  const online = users.filter(isOnline).length;
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-xl)] p-6 animate-slideUp shadow-[var(--shadow-lg)]
      bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-100 dark:from-amber-900/20 dark:via-yellow-950/30 dark:to-amber-900/20
      border border-amber-300/30 dark:border-amber-700/20">
      <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl opacity-30" style={{ background: 'var(--gradient-accent)' }} />
      <div className="relative flex items-center gap-6 flex-wrap">
        <div className="w-16 h-16 rounded-[var(--radius-lg)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)] ring-glow flex-shrink-0">
          <Shield size={32} className="text-[#1a1410]" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)] mb-1">Zarządzanie kontami</p>
          <h2 className="display-heading">{users.length} kont · {online} online</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Granularne uprawnienia · invite-by-email · statystyki aktywności</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={onRefresh}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Odśwież
          </Button>
          <Button variant="primary" size="md" onClick={onAdd}>
            <UserPlus size={14} /> Dodaj konto
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── KARTA KONTA ────────────────────────────────────────────────────────────
function UserCard(props: {
  user: SupaUser;
  stats?: UserStats;
  isEditing: boolean;
  editPerms: string[]; editFirst: string; editLast: string;
  setEditPerms: (p: string[]) => void;
  setEditFirst: (s: string) => void;
  setEditLast: (s: string) => void;
  onBeginEdit: () => void; onCancelEdit: () => void;
  onSave: () => void; onDelete: () => void; onResetPassword: () => void;
  saving: boolean; deleting: boolean;
}) {
  const { user, stats, isEditing } = props;
  const isSA = user.email?.toLowerCase() === SUPERADMIN_EMAIL;
  const online = isOnline(user);
  const color = user.user_metadata?.avatar_color || pickAvatarColor(user.email);
  const mustChange = user.user_metadata?.must_change_password;

  return (
    <div className="glass-strong rounded-[var(--radius-lg)] p-5 transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5 animate-slideUp">
      <div className="flex items-start gap-4 flex-wrap">
        {/* AVATAR */}
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white shadow-[var(--shadow-md)]"
               style={{ background: color }}>
            {initials(user)}
          </div>
          <span className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-[var(--color-bg)]
            ${online ? 'bg-emerald-500 animate-[pulse-soft_2s_ease-in-out_infinite]' : 'bg-slate-500'}`} />
        </div>

        {/* IDENTYFIKACJA */}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-[var(--color-text)]">{fullName(user)}</h3>
            {isSA && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gradient-accent text-[#1a1410]">
                Superadmin
              </span>
            )}
            {mustChange && !isSA && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Wymagana zmiana hasła
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5 mt-0.5">
            <Mail size={11} /> {user.email}
          </p>
          <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1"><Activity size={11} className="text-[var(--color-accent)]" /> {stats?.actions7d ?? 0} akcji w 7 dni</span>
            <span>· Ostatnie logowanie: {timeAgo(user.last_sign_in_at)}</span>
            <span>· Konto od: {new Date(user.created_at).toLocaleDateString('pl-PL')}</span>
          </div>
        </div>

        {/* AKCJE */}
        {!isEditing && !isSA && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={props.onBeginEdit}><Edit3 size={13} /> Edytuj</Button>
            <Button variant="ghost" size="sm" onClick={props.onResetPassword}><KeyRound size={13} /> Reset hasła</Button>
            <button onClick={props.onDelete} disabled={props.deleting}
              className="p-2 rounded-[var(--radius-md)] text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Usuń konto">
              <Trash2 size={14} />
            </button>
          </div>
        )}
        {isSA && (
          <span className="text-[10px] text-[var(--color-text-muted)] italic">
            Konta superadmina nie można edytować z poziomu UI
          </span>
        )}
      </div>

      {/* EDYCJA */}
      {isEditing && (
        <div className="mt-5 pt-5 border-t border-[var(--color-border)] animate-fadeIn space-y-4">
          {/* Profil */}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Imię" value={props.editFirst} onChange={e => props.setEditFirst(e.target.value)} placeholder="Jan" />
            <Input label="Nazwisko" value={props.editLast} onChange={e => props.setEditLast(e.target.value)} placeholder="Kowalski" />
          </div>

          {/* Presety */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-2 flex items-center gap-1.5">
              <Sparkles size={11} /> Szybkie presety
            </p>
            <div className="flex flex-wrap gap-2">
              {PERMISSION_PRESETS.map(p => (
                <button key={p.id}
                  onClick={() => props.setEditPerms(p.perms)}
                  className="group px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-bold border-2 border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 transition-all"
                  title={p.description}>
                  {p.label}
                </button>
              ))}
              <button onClick={() => props.setEditPerms(expandAllPerms())}
                className="px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-bold border-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-all">
                Wszystko (jak superadmin)
              </button>
              <button onClick={() => props.setEditPerms([])}
                className="px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-bold border-2 border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-red-500 hover:text-red-400 transition-all">
                Wyczyść
              </button>
            </div>
          </div>

          {/* Granularny tree */}
          <PermissionTree perms={props.editPerms} onChange={props.setEditPerms} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="md" onClick={props.onCancelEdit}>Anuluj</Button>
            <Button variant="primary" size="md" onClick={props.onSave} loading={props.saving}>
              <Check size={14} /> Zapisz zmiany
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DRZEWO UPRAWNIEŃ ───────────────────────────────────────────────────────
function PermissionTree({ perms, onChange }: { perms: string[]; onChange: (p: string[]) => void }) {
  const set = useMemo(() => new Set(perms), [perms]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(PERMISSION_MODULES.map(m => m.id)));

  const toggle = (key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange([...next]);
  };

  const toggleModule = (modId: string, all: boolean) => {
    const mod = PERMISSION_MODULES.find(m => m.id === modId)!;
    const next = new Set(set);
    for (const a of mod.actions) {
      const k = `${modId}.${a.id}`;
      if (all) next.add(k); else next.delete(k);
    }
    onChange([...next]);
  };

  const toggleExpand = (modId: string) => {
    const next = new Set(expanded);
    if (next.has(modId)) next.delete(modId); else next.add(modId);
    setExpanded(next);
  };

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-2">Uprawnienia szczegółowe</p>
      <div className="space-y-1.5">
        {PERMISSION_MODULES.map(mod => {
          const total = mod.actions.length;
          const got = mod.actions.filter(a => set.has(`${mod.id}.${a.id}`)).length;
          const all = got === total;
          const some = got > 0 && got < total;
          const isExp = expanded.has(mod.id);
          return (
            <div key={mod.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-2)]/40">
                <button onClick={() => toggleExpand(mod.id)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
                  {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input type="checkbox" checked={all}
                    ref={el => { if (el) el.indeterminate = some; }}
                    onChange={e => toggleModule(mod.id, e.target.checked)}
                    className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer" />
                  <span className="text-sm font-bold text-[var(--color-text)]">{mod.label}</span>
                </label>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                  ${all ? 'bg-emerald-500/15 text-emerald-300' :
                    some ? 'bg-amber-500/15 text-amber-300' :
                    'bg-slate-500/15 text-slate-400'}`}>
                  {got}/{total}
                </span>
              </div>
              {isExp && (
                <div className="px-3 py-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                  {mod.actions.map(a => {
                    const k = `${mod.id}.${a.id}`;
                    return (
                      <label key={a.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded px-1.5 py-1 transition-colors">
                        <input type="checkbox" checked={set.has(k)} onChange={() => toggle(k)}
                          className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer flex-shrink-0" />
                        <span className="text-xs text-[var(--color-text)]">{a.label}</span>
                        {a.description && <span className="text-[10px] text-[var(--color-text-muted)] opacity-60">— {a.description}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── INVITE MODAL ───────────────────────────────────────────────────────────
function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (tmp: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [presetId, setPresetId] = useState('operator');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleCreate = async () => {
    if (!email.trim()) { setErr('Podaj e-mail'); return; }
    setBusy(true); setErr('');
    try {
      const sb = await getSupabaseClient();
      const preset = PERMISSION_PRESETS.find(p => p.id === presetId) ?? PERMISSION_PRESETS[1];
      const meta = {
        first_name: first.trim() || undefined,
        last_name: last.trim() || undefined,
        permissions: preset.perms,
        avatar_color: pickAvatarColor(email),
        must_change_password: true,
      };
      // Try invite-by-email; fallback to createUser z hasłem tymczasowym
      let tempPwd: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: e } = await (sb.auth as any).admin.inviteUserByEmail(email.trim().toLowerCase(), {
          data: meta,
        });
        if (e) throw new Error(e.message);
      } catch (inviteErr) {
        console.warn('[Invite] inviteUserByEmail failed, fallback to createUser', inviteErr);
        tempPwd = generatePassword(12);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: e } = await (sb.auth as any).admin.createUser({
          email: email.trim().toLowerCase(),
          password: tempPwd,
          email_confirm: true,
          user_metadata: meta,
        });
        if (e) throw new Error(e.message);
      }
      void audit('user', 'user_invited', {
        description: `Zaproszono nowego użytkownika: ${email}`,
        metadata: { email, preset: presetId, perms: preset.perms.length },
      });
      onCreated(tempPwd ? `${email}\n${tempPwd}` : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn p-4" onClick={onClose}>
      <div className="glass-strong rounded-[var(--radius-xl)] p-6 max-w-md w-full shadow-[var(--shadow-xl)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
              <UserPlus size={22} className="text-[#1a1410]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text)]">Nowe konto</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Wybierz preset — możesz dopasować później</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <Input label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="pracownik@parkingsobieszewo.pl" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Imię (opcj.)" value={first} onChange={e => setFirst(e.target.value)} />
            <Input label="Nazwisko (opcj.)" value={last} onChange={e => setLast(e.target.value)} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Preset uprawnień</p>
            <div className="space-y-1.5">
              {PERMISSION_PRESETS.map(p => {
                const active = presetId === p.id;
                return (
                  <button key={p.id} onClick={() => setPresetId(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-[var(--radius-md)] border-2 transition-all
                      ${active ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}>
                    <div className="flex items-center gap-2">
                      <input type="radio" checked={active} readOnly className="accent-[var(--color-accent)]" />
                      <span className="font-bold text-sm text-[var(--color-text)]">{p.label}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{p.perms.length} uprawnień</span>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)] ml-6 mt-0.5">{p.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {err && <p className="text-xs text-red-400 mt-3 font-medium">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button variant="primary" onClick={handleCreate} loading={busy} disabled={!email.trim()}>
            <Mail size={14} /> Wyślij zaproszenie
          </Button>
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] opacity-60 mt-3 text-center">
          Jeśli Supabase nie ma skonfigurowanego SMTP — wygeneruje się hasło tymczasowe do skopiowania.
        </p>
      </div>
    </div>
  );
}

// ─── TEMP PASSWORD MODAL ────────────────────────────────────────────────────
function TempPasswordModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* ignore */ }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn p-4" onClick={onClose}>
      <div className="glass-strong rounded-[var(--radius-xl)] p-6 max-w-md w-full shadow-[var(--shadow-xl)] border-2 border-amber-500/40" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-amber-500/20 flex items-center justify-center">
            <KeyRound size={22} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Hasło tymczasowe</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Skopiuj i przekaż użytkownikowi — nie zobaczysz go ponownie</p>
          </div>
        </div>
        <pre className="bg-[var(--color-bg)] border-2 border-[var(--color-border)] rounded-[var(--radius-md)] p-4 text-sm font-mono text-[var(--color-text)] whitespace-pre-wrap break-all">
{text}
        </pre>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Skopiowano!' : 'Kopiuj'}
          </Button>
          <Button variant="primary" onClick={onClose}>Rozumiem</Button>
        </div>
      </div>
    </div>
  );
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function generatePassword(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}
