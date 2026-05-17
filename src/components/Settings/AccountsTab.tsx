/**
 * AccountsTab — zmiana hasła + (jeśli superadmin) zarządzanie kontami.
 */

import { useState } from 'react';
import { Lock, Eye, EyeOff, Check } from 'lucide-react';
import { Button, Input } from '../shared/UI';
import { verifyCurrentPassword, changePassword } from '../../lib/auth';
import { audit } from '../../lib/audit';
import AccountManager from './AccountManager';
import type { AppUser } from '../../lib/session';

interface Props {
  user?: AppUser | null;
}

export default function AccountsTab({ user }: Props) {
  const isSuperAdmin = user?.role === 'superadmin';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (next.length < 8) {
      setResult({ ok: false, msg: 'Nowe hasło musi mieć co najmniej 8 znaków' }); return;
    }
    if (next !== confirm) {
      setResult({ ok: false, msg: 'Hasła nie są identyczne' }); return;
    }
    setBusy(true);
    try {
      const ok = await verifyCurrentPassword(current);
      if (!ok) { setResult({ ok: false, msg: 'Aktualne hasło jest nieprawidłowe' }); setBusy(false); return; }
      await changePassword(next);
      void audit('user', 'password_changed', { description: 'Zmieniono hasło konta', severity: 'warning' });
      setResult({ ok: true, msg: 'Hasło zmienione pomyślnie' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };

  return <>
    {/* HERO — info o koncie */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 mb-5 animate-slideUp">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)] text-2xl font-bold text-[#1a1410]">
          {(user?.email ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)] mb-1">Zalogowany jako</p>
          <h2 className="display-heading text-2xl truncate">{user?.email ?? '(brak)'}</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Rola: <span className="font-bold text-[var(--color-accent)]">{user?.role ?? '—'}</span>
          </p>
        </div>
      </div>
    </div>

    {/* ZMIANA HASŁA */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp" style={{ animationDelay: '50ms' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
          <Lock size={22} className="text-[#1a1410]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text)]">Zmiana hasła</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Min. 8 znaków · zmiana logowana w <em>Logach</em></p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div className="relative">
          <Input label="Aktualne hasło" type={showCurrent ? 'text' : 'password'}
            value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" />
          <button type="button" onClick={() => setShowCurrent(s => !s)}
            className="absolute right-3 top-9 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <div className="relative">
          <Input label="Nowe hasło" type={showNext ? 'text' : 'password'}
            value={next} onChange={e => setNext(e.target.value)} required autoComplete="new-password" minLength={8} />
          <button type="button" onClick={() => setShowNext(s => !s)}
            className="absolute right-3 top-9 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {showNext ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <Input label="Powtórz nowe hasło" type={showNext ? 'text' : 'password'}
          value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" minLength={8} />
        {result && (
          <div className={`px-4 py-2.5 rounded-[var(--radius-md)] text-sm font-bold animate-fadeIn
            ${result.ok ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'bg-red-500/15 text-red-300 border border-red-500/40'}`}>
            {result.ok ? <Check size={14} className="inline mr-1.5 -mt-0.5" /> : '✕ '}{result.msg}
          </div>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!current || !next || !confirm}>
          Zmień hasło
        </Button>
      </form>
    </div>

    {/* MENADŻER KONT (tylko superadmin) */}
    {isSuperAdmin && (
      <div className="mt-5 animate-slideUp" style={{ animationDelay: '100ms' }}>
        <AccountManager />
      </div>
    )}
  </>;
}
