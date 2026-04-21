import { useState, useEffect } from 'react';
import { getSupabaseClient } from '../../lib/supabase';
import { logAction } from '../../lib/audit';
import { Button, Input, Card } from '../shared/UI';
import { Check, Trash2, UserPlus, RefreshCw, Shield, User } from 'lucide-react';

const ALL_PAGES = [
  { id: 'dashboard',    label: 'Dashboard' },
  { id: 'cameras',      label: 'Kamery' },
  { id: 'reservations', label: 'Rezerwacje' },
  { id: 'finances',     label: 'Finanse' },
  { id: 'admin',        label: 'Panel WWW' },
  { id: 'chat',         label: 'Czat Orzel' },
  { id: 'email',        label: 'Skrzynka' },
  { id: 'settings',     label: 'Ustawienia' },
];

interface SupaUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string;
  user_metadata: { permissions?: string[] };
}

export default function AccountManager() {
  const [users, setUsers] = useState<SupaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // New user form
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass]   = useState('');
  const [newPerms, setNewPerms] = useState<string[]>(['dashboard', 'cameras']);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createOk, setCreateOk] = useState(false);

  // Edit permissions
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: e } = await (sb.auth as any).admin.listUsers();
      if (e) throw new Error(e.message);
      setUsers((data?.users ?? []) as SupaUser[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newEmail.trim() || !newPass) { setCreateError('Podaj e-mail i haslo.'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (sb.auth as any).admin.createUser({
        email: newEmail.trim().toLowerCase(),
        password: newPass,
        email_confirm: true,
        user_metadata: { permissions: newPerms },
      });
      if (e) throw new Error(e.message);
      await logAction('user_create', { email: newEmail.trim().toLowerCase(), permissions: newPerms });
      setNewEmail(''); setNewPass(''); setNewPerms(['dashboard', 'cameras']);
      setCreateOk(true);
      setTimeout(() => setCreateOk(false), 3000);
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleSavePerms = async (userId: string) => {
    setSavingPerms(true);
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (sb.auth as any).admin.updateUserById(userId, {
        user_metadata: { permissions: editPerms },
      });
      if (e) throw new Error(e.message);
      const u = users.find(u => u.id === userId);
      await logAction('user_update_permissions', { email: u?.email, permissions: editPerms });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPerms(false);
    }
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`Usunac konto ${email}? Tej operacji nie mozna cofnac.`)) return;
    setDeletingId(userId);
    try {
      const sb = await getSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (sb.auth as any).admin.deleteUser(userId);
      if (e) throw new Error(e.message);
      await logAction('user_delete', { email });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const toggleNewPerm = (p: string) =>
    setNewPerms(ps => ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]);

  const toggleEditPerm = (p: string) =>
    setEditPerms(ps => ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]);

  return (
    <div className="space-y-5">
      {/* User list */}
      <Card title="Konta uzytkownikow">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[var(--color-text-muted)]">{users.length} kont w systemie</p>
          <button onClick={load} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title="Odswiez">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

        <div className="space-y-2">
          {users.map(u => {
            const isSA = u.email === 'klosekmichal@gmail.com';
            const isEditing = editingId === u.id;
            const perms = u.user_metadata?.permissions ?? [];

            return (
              <div key={u.id} className="bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isSA
                      ? <Shield size={14} className="text-[var(--color-accent)] flex-shrink-0" />
                      : <User size={14} className="text-slate-400 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{u.email}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {isSA ? 'Superadmin — pelny dostep' : `Operator · ${perms.length} zakl.`}
                        {u.last_sign_in_at && ` · Ostatnie logowanie: ${new Date(u.last_sign_in_at).toLocaleDateString('pl-PL')}`}
                      </p>
                    </div>
                  </div>
                  {!isSA && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setEditingId(u.id); setEditPerms([...perms]); }}
                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] px-2 py-1 rounded border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
                      >
                        Uprawnienia
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, u.email)}
                        disabled={deletingId === u.id}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                        title="Usun konto"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Permission editor */}
                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                    <p className="text-xs font-medium text-[var(--color-text)] mb-2">Dostep do zakladek:</p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {ALL_PAGES.map(p => (
                        <button
                          key={p.id}
                          onClick={() => toggleEditPerm(p.id)}
                          className={`px-2 py-1 rounded text-xs border transition-all
                            ${editPerms.includes(p.id)
                              ? 'bg-[var(--color-accent-bg)] border-[var(--color-accent)] text-[var(--color-accent)]'
                              : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" onClick={() => handleSavePerms(u.id)} loading={savingPerms}>
                        <Check size={13} /> Zapisz
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Anuluj</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Create user */}
      <Card title="Dodaj nowe konto">
        <div className="space-y-4 max-w-md">
          <Input label="Adres e-mail" type="email" value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="pracownik@parkingsobieszewo.pl" />
          <Input label="Haslo tymczasowe" type="password" value={newPass}
            onChange={e => setNewPass(e.target.value)}
            placeholder="Min. 8 znakow"
            error={createError} />

          <div>
            <p className="text-sm font-medium text-[var(--color-text)] mb-2">Dostep do zakladek:</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_PAGES.map(p => (
                <button
                  key={p.id}
                  onClick={() => toggleNewPerm(p.id)}
                  className={`px-2 py-1 rounded text-xs border transition-all
                    ${newPerms.includes(p.id)
                      ? 'bg-[var(--color-accent-bg)] border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
              Zaznaczone zakladki beda widoczne dla tego uzytkownika.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={handleCreate} loading={creating}>
              <UserPlus size={14} /> Utworz konto
            </Button>
            {createOk && <span className="text-green-400 text-sm font-medium">Konto utworzone</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}
