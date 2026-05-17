import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Login from './components/Login/Login';
import Sidebar, { Page } from './components/Sidebar/Sidebar';
import Dashboard from './components/Dashboard/Dashboard';
import Cameras from './components/Cameras/Cameras';
import Reservations from './components/Reservations/Reservations';
import Finances from './components/Finances/Finances';
import AdminPanel from './components/AdminPanel/AdminPanel';
import Radio from './components/Radio/Radio';
import Settings from './components/Settings/Settings';
import Chat from './components/Chat/Chat';
import Email from './components/Email/Email';
import Logs from './components/Logs/Logs';
import SyncManager from './components/Sync/SyncManager';
import FloatingRadioPanel from './components/Radio/FloatingRadioPanel';
import RadioFAB from './components/Radio/RadioFAB';
import { useRadioPlayer } from './components/Radio/useRadioPlayer';
import ShortcutsHelp from './components/shared/ShortcutsHelp';
import CommandPalette from './components/CommandPalette/CommandPalette';
import FloatingChatPanel from './components/Chat/FloatingChatPanel';
import ChatFAB from './components/Chat/ChatFAB';
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts';
import { startPolling, stopPolling, startChatPolling, stopChatPolling } from './lib/notifications';
import { scheduleDailyBackup } from './lib/backup';
import { logPageView, logLogout } from './lib/logger';
import { getStore } from './lib/store';
import { applyAccentColor, ACCENT_COLORS } from './components/Settings/Settings';
import { signOut, verifyCurrentPassword, changePassword } from './lib/auth';
import { getCurrentUser, setCurrentUser as setSessionUser, SUPERADMIN_EMAIL, normalizePermissions, type AppUser } from './lib/session';
import { checkPermission, expandAllPerms } from './lib/permissions';
import { useIdleLock } from './lib/idleLock';
import { getSupabaseClient } from './lib/supabase';
import { audit } from './lib/audit';
import { Lock, KeyRound, Check } from 'lucide-react';
import { Button, Input } from './components/shared/UI';
import './index.css';

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }
}

export default function App() {
  // sessionStorage zachowuje stan zalogowania przez HMR reloady (Vite dev)
  const [authenticated, setAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('parking_os_authed') === '1';
  });
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => getCurrentUser());
  const [page, setPage] = useState<Page>(() => {
    return (sessionStorage.getItem('parking_os_page') as Page) ?? 'dashboard';
  });
  const [reservationBadge, setReservationBadge] = useState(0);
  const [chatBadge, setChatBadge] = useState(0);
  const [theme, setTheme] = useState<Theme>('dark');
  const [pwaStatus, setPwaStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');

  const [cam1SnapshotUrl, setCam1SnapshotUrl] = useState<string | null>(null);
  const [cam1RtspUrl, setCam1RtspUrl] = useState<string | null>(null);
  const [cam1HlsUrl, setCam1HlsUrl] = useState<string | null>(null);
  const [cam2SnapshotUrl, setCam2SnapshotUrl] = useState<string | null>(null);
  const [cam2RtspUrl, setCam2RtspUrl] = useState<string | null>(null);
  const [cam2HlsUrl, setCam2HlsUrl] = useState<string | null>(null);
  const [cam3SnapshotUrl, setCam3SnapshotUrl] = useState<string | null>(null);
  const [cam3RtspUrl, setCam3RtspUrl] = useState<string | null>(null);
  const [cam3HlsUrl, setCam3HlsUrl] = useState<string | null>(null);
  const [cam4SnapshotUrl, setCam4SnapshotUrl] = useState<string | null>(null);
  const [cam4RtspUrl, setCam4RtspUrl] = useState<string | null>(null);
  const [cam4HlsUrl, setCam4HlsUrl] = useState<string | null>(null);

  const loadCameraUrls = useCallback(async () => {
    const store = await getStore();
    setCam1SnapshotUrl((await store.get<string>('cam1_snapshot_url')) || null);
    setCam1RtspUrl((await store.get<string>('cam1_rtsp_url')) || null);
    setCam1HlsUrl((await store.get<string>('cam1_hls_url')) || null);
    setCam2SnapshotUrl((await store.get<string>('cam2_snapshot_url')) || null);
    setCam2RtspUrl((await store.get<string>('cam2_rtsp_url')) || null);
    setCam2HlsUrl((await store.get<string>('cam2_hls_url')) || null);
    setCam3SnapshotUrl((await store.get<string>('cam3_snapshot_url')) || null);
    setCam3RtspUrl((await store.get<string>('cam3_rtsp_url')) || null);
    setCam3HlsUrl((await store.get<string>('cam3_hls_url')) || null);
    setCam4SnapshotUrl((await store.get<string>('cam4_snapshot_url')) || null);
    setCam4RtspUrl((await store.get<string>('cam4_rtsp_url')) || null);
    setCam4HlsUrl((await store.get<string>('cam4_hls_url')) || null);
  }, []);

  useEffect(() => {
    getStore().then(async store => {
      const savedTheme = await store.get<Theme>('theme');
      const t = savedTheme ?? 'dark';
      setTheme(t);
      applyTheme(t);
      // Accent color
      const ac = await store.get<string>('accent_color');
      if (ac) {
        const found = ACCENT_COLORS.find(c => c.id === ac);
        if (found) applyAccentColor(found.hex);
      }
    }).finally(() => {
      // Zamknij splash screen i pokaż główne okno po zakończeniu inicjalizacji
      invoke('close_splashscreen').catch(() => {
        // W trybie dev splashscreen nie istnieje — ignoruj błąd
      });
    });
    loadCameraUrls();
  }, [loadCameraUrls]);

  // Odtwórz currentUser z sesji Supabase gdy _user jest null (np. po hot-reload w dev
  // lub gdy sessionStorage zachował flagę authed ale moduł session.ts stracił stan).
  useEffect(() => {
    if (!authenticated || getCurrentUser()) return;
    getSupabaseClient().then(sb => sb.auth.getUser()).then(({ data }) => {
      if (!data.user) return;
      const isSA = data.user.email?.toLowerCase() === SUPERADMIN_EMAIL;
      const meta = (data.user.user_metadata ?? {}) as {
        permissions?: string[]; first_name?: string; last_name?: string;
        avatar_color?: string; must_change_password?: boolean;
      };
      const restored: AppUser = {
        id: data.user.id,
        email: data.user.email!,
        role: isSA ? 'superadmin' : 'operator',
        permissions: isSA ? expandAllPerms() : normalizePermissions(meta.permissions ?? ['dashboard.view', 'cameras.view']),
        firstName: meta.first_name,
        lastName: meta.last_name,
        avatarColor: meta.avatar_color,
        mustChangePassword: !!meta.must_change_password,
      };
      setSessionUser(restored);
      setCurrentUser(restored);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const handleThemeChange = async (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    const store = await getStore();
    await store.set('theme', t);
    await store.save();
  };

  const handleAuth = useCallback(() => {
    sessionStorage.setItem('parking_os_authed', '1');
    setAuthenticated(true);
    setCurrentUser(getCurrentUser());
    startPolling((_res) => {
      setReservationBadge(b => b + 1);
    });
    startChatPolling((_msg) => {
      setChatBadge(b => b + 1);
    });
    scheduleDailyBackup();
  }, []);

  const handleLogout = useCallback(async () => {
    logLogout(currentUser?.email);
    await signOut();
    sessionStorage.removeItem('parking_os_authed');
    stopPolling();
    stopChatPolling();
    setAuthenticated(false);
    setCurrentUser(null);
  }, []);

  const handleOpenPwa = useCallback(async () => {
    if (pwaStatus === 'starting') return;

    if (pwaStatus === 'running') {
      // Już działa — tylko otwieramy przeglądarkę
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl('http://localhost:3001');
      } catch { window.open('http://localhost:3001', '_blank'); }
      return;
    }

    // Uruchom serwer PWA
    setPwaStatus('starting');
    try {
      await invoke('spawn_pwa');
      // Czekaj aż Vite wstanie (max 10s, probe co 500ms)
      let ready = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const res = await fetch('http://localhost:3001', { signal: AbortSignal.timeout(400) });
          if (res.ok || res.status === 200) { ready = true; break; }
        } catch { /* jeszcze nie gotowy */ }
      }
      setPwaStatus('running');
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl('http://localhost:3001');
      } catch { window.open('http://localhost:3001', '_blank'); }
      if (!ready) console.warn('[pwa] Serwer może jeszcze nie być gotowy');
    } catch (err) {
      console.error('[pwa] spawn error:', err);
      setPwaStatus('stopped');
    }
  }, [pwaStatus]);

  const handleStopPwa = useCallback(async () => {
    try { await invoke('stop_pwa'); } catch { /* ignoruj */ }
    setPwaStatus('stopped');
  }, []);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNavigate = useCallback((p: Page) => {
    sessionStorage.setItem('parking_os_page', p);
    setPage(p);
    logPageView(p);
    if (p === 'reservations') setReservationBadge(0);
    if (p === 'chat') setChatBadge(0);
    setMobileNavOpen(false);
  }, []);

  // Globalne skróty klawiaturowe (Iter 9)
  useKeyboardShortcuts(handleNavigate);

  // Iter 13: Ctrl+O — Command Palette ("O" jak Orzeł)
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Iter 13: Ctrl+J — Pływający panel chat (à la Copilot)
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const canUseRadio = !!currentUser && (currentUser.role === 'superadmin' || checkPermission(currentUser.permissions, 'radio.use'));
  const radio = useRadioPlayer(canUseRadio);

  useEffect(() => {
    if (!authenticated) return;
    const onKey = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;
      // Używamy e.code (niezależne od layoutu klawiatury) + fallback na e.key
      const code = e.code; // 'KeyJ' / 'KeyO'
      const key = (e.key || '').toLowerCase();

      // Ctrl+O — paleta poleceń
      if (code === 'KeyO' || key === 'o') {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(s => !s);
        return;
      }
      // Ctrl+J — pływający chat Orzeł
      if (code === 'KeyJ' || key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        setChatPanelOpen(s => !s);
        return;
      }
    };
    // capture: true — łapiemy event PRZED handlerami komponentów i akceleratorami WebView
    window.addEventListener('keydown', onKey, { capture: true });
    const onToggle = () => setChatPanelOpen(s => !s);
    window.addEventListener('app:toggle-chat-panel', onToggle as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true } as any);
      window.removeEventListener('app:toggle-chat-panel', onToggle as EventListener);
    };
  }, [authenticated]);

  useEffect(() => {
    return () => { stopPolling(); stopChatPolling(); };
  }, []);;

  // ─── Idle lock + force-change-password ────────────────────────────────────
  const [locked, setLocked] = useState(false);
  const [idleTimeoutMin, setIdleTimeoutMin] = useState(5);

  useEffect(() => {
    void getStore().then(async store => {
      const v = await store.get<string | number>('session_idle_timeout_min');
      if (v != null) {
        const n = typeof v === 'number' ? v : parseInt(String(v), 10);
        if (!isNaN(n) && n >= 0 && n <= 120) setIdleTimeoutMin(n);
      }
    });
  }, []);

  useIdleLock({
    enabled: authenticated && !locked && idleTimeoutMin > 0,
    timeoutMs: idleTimeoutMin * 60_000,
    onLock: () => {
      setLocked(true);
      void audit('session', 'session_locked_idle', {
        description: `Sesja zablokowana po ${idleTimeoutMin} min nieaktywności`,
      });
    },
  });

  if (!authenticated) {
    return <Login onSuccess={handleAuth} />;
  }

  if (currentUser?.mustChangePassword) {
    return <ForceChangePasswordScreen user={currentUser} onDone={() => {
      setCurrentUser(getCurrentUser());
    }} onLogout={handleLogout} />;
  }

  return (
    <div className="flex h-screen overflow-hidden p-3 gap-3">
      {/* Mobile top bar — widoczny tylko < 768px */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-3 py-2 glass-strong border-b border-[var(--color-border)]/40">
        <button onClick={() => setMobileNavOpen(o => !o)}
          aria-label="Menu" className="p-2 rounded hover:bg-[var(--color-surface-2)]">
          <span className="block w-5 h-[2px] bg-[var(--color-text)] mb-1" />
          <span className="block w-5 h-[2px] bg-[var(--color-text)] mb-1" />
          <span className="block w-5 h-[2px] bg-[var(--color-text)]" />
        </button>
        <span className="text-sm font-bold flex-1 truncate">Parking.OS · {page}</span>
      </div>
      {/* Mobile drawer overlay */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)}>
          <div className="absolute top-0 left-0 bottom-0 w-72 max-w-[85vw] p-3" onClick={e => e.stopPropagation()}>
            <Sidebar
              current={page}
              onChange={handleNavigate}
              reservationBadge={reservationBadge}
              chatBadge={chatBadge}
              onOpenPwa={handleOpenPwa}
              onStopPwa={handleStopPwa}
              pwaStatus={pwaStatus}
              user={currentUser}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}
      {/* Desktop sidebar — ukryty < 768px */}
      <div className="hidden md:block">
        <Sidebar
          current={page}
          onChange={handleNavigate}
          reservationBadge={reservationBadge}
          chatBadge={chatBadge}
          onOpenPwa={handleOpenPwa}
          onStopPwa={handleStopPwa}
          pwaStatus={pwaStatus}
          user={currentUser}
          onLogout={handleLogout}
        />
      </div>
      <main className="flex-1 overflow-hidden relative glass-strong rounded-[var(--radius-xl)] animate-fadeIn">
        {page === 'dashboard' && (
          <Dashboard
            onNavigate={handleNavigate}
            newReservations={reservationBadge}
            cam1HlsUrl={cam1HlsUrl}
            cam2HlsUrl={cam2HlsUrl}
            cam3HlsUrl={cam3HlsUrl}
            cam4HlsUrl={cam4HlsUrl}
          />
        )}
        {page === 'cameras' && (
          <Cameras
            cam1SnapshotUrl={cam1SnapshotUrl}
            cam1RtspUrl={cam1RtspUrl}
            cam1HlsUrl={cam1HlsUrl}
            cam2SnapshotUrl={cam2SnapshotUrl}
            cam2RtspUrl={cam2RtspUrl}
            cam2HlsUrl={cam2HlsUrl}
            cam3SnapshotUrl={cam3SnapshotUrl}
            cam3RtspUrl={cam3RtspUrl}
            cam3HlsUrl={cam3HlsUrl}
            cam4SnapshotUrl={cam4SnapshotUrl}
            cam4RtspUrl={cam4RtspUrl}
            cam4HlsUrl={cam4HlsUrl}
          />
        )}
        {page === 'reservations' && (
          <Reservations onBadgeChange={setReservationBadge} />
        )}
        {page === 'finances' && (
          <Finances />
        )}
        {page === 'radio' && (
          <div className="absolute inset-0 overflow-y-auto p-6 custom-scroll">
            <Radio player={radio} />
          </div>
        )}
        {page === 'admin' && (
          <AdminPanel />
        )}
        {page === 'chat' && (
          <Chat />
        )}
        {page === 'email' && (
          <Email />
        )}
        {page === 'logs' && (
          <Logs />
        )}
        {page === 'sync' && (
          <div className="absolute inset-0 overflow-y-auto custom-scroll">
            <SyncManager />
          </div>
        )}
        {page === 'settings' && (
          <div className="absolute inset-0 overflow-y-auto p-6 custom-scroll">
            <Settings theme={theme} onThemeChange={handleThemeChange} onSettingsSaved={loadCameraUrls} user={currentUser} />
          </div>
        )}
      </main>

      {locked && currentUser && (
        <LockScreen user={currentUser} onUnlock={() => setLocked(false)} onLogout={handleLogout} />
      )}
      <ShortcutsHelp />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={handleNavigate}
      />
      {/* Iter 13: Pływający chat à la Copilot */}
      <FloatingChatPanel
        open={chatPanelOpen}
        onClose={() => setChatPanelOpen(false)}
        onMinimize={() => setChatPanelOpen(false)}
      />
      {authenticated && canUseRadio && radio.panelOpen && page !== 'radio' && (
        <FloatingRadioPanel
          player={radio}
          onClose={() => radio.setPanelOpen(false)}
          onOpenRadioPage={() => handleNavigate('radio')}
        />
      )}
      <RadioFAB
        visible={authenticated && canUseRadio && page !== 'radio' && !radio.panelOpen && (!!radio.currentStation || radio.isPlaying)}
        onClick={() => radio.setPanelOpen(true)}
        pulse={radio.isPlaying}
      />
      <ChatFAB visible={authenticated && !chatPanelOpen} onClick={() => setChatPanelOpen(true)} />
    </div>
  );
}

// ─── LockScreen — overlay po idle timeout ────────────────────────────────────
function LockScreen({ user, onUnlock, onLogout }: { user: AppUser; onUnlock: () => void; onLogout: () => void }) {
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const ok = await verifyCurrentPassword(pwd);
      if (!ok) { setErr('Nieprawidłowe hasło'); setBusy(false); return; }
      void audit('session', 'session_unlocked', { description: 'Sesja odblokowana hasłem' });
      onUnlock();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const initials = (user.firstName?.[0] ?? user.email[0] ?? '?').toUpperCase()
    + (user.lastName?.[0] ?? '');

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md flex items-center justify-center animate-fadeIn p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-accent flex items-center justify-center text-2xl font-bold text-[#1a1410] shadow-[var(--shadow-xl)] ring-glow mb-3">
            {initials}
          </div>
          <h2 className="text-xl font-bold text-white">{user.firstName ?? user.email}</h2>
          <p className="text-sm text-slate-400 mt-1 flex items-center justify-center gap-1.5">
            <Lock size={12} /> Sesja zablokowana — wpisz hasło
          </p>
        </div>
        <form onSubmit={submit} className="glass-strong rounded-[var(--radius-xl)] p-6 shadow-[var(--shadow-xl)] space-y-3">
          <Input label="Hasło" type="password" value={pwd} onChange={e => setPwd(e.target.value)} autoFocus required />
          {err && <p className="text-xs text-red-400 font-bold">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            <Check size={16} /> Odblokuj
          </Button>
          <button type="button" onClick={onLogout}
            className="w-full text-xs text-slate-400 hover:text-white py-2 transition-colors">
            Wyloguj na inne konto
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── ForceChangePasswordScreen — pierwsze logowanie po invite ────────────────
function ForceChangePasswordScreen({ user, onDone, onLogout }: {
  user: AppUser; onDone: () => void; onLogout: () => void;
}) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next.length < 8) { setErr('Hasło min. 8 znaków'); return; }
    if (next !== confirm) { setErr('Hasła nie są identyczne'); return; }
    setBusy(true);
    try {
      await changePassword(next);
      const sb = await getSupabaseClient();
      await sb.auth.updateUser({ data: { ...user, must_change_password: false } });
      const u = getCurrentUser();
      if (u) setSessionUser({ ...u, mustChangePassword: false });
      void audit('user', 'first_login_password_set', {
        entityType: 'user', entityId: user.id, severity: 'warning',
        description: 'Ustawiono nowe hasło przy pierwszym logowaniu',
      });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center mb-3">
            <KeyRound size={32} className="text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Zmień hasło tymczasowe</h1>
          <p className="text-sm text-slate-400 mt-1">Witaj {user.firstName ?? user.email}! Ustaw własne hasło, aby kontynuować.</p>
        </div>
        <form onSubmit={submit} className="glass-strong rounded-[var(--radius-xl)] p-6 shadow-[var(--shadow-xl)] space-y-3">
          <Input label="Nowe hasło (min. 8 znaków)" type="password" value={next}
            onChange={e => setNext(e.target.value)} autoFocus required minLength={8} autoComplete="new-password" />
          <Input label="Powtórz hasło" type="password" value={confirm}
            onChange={e => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
          {err && <p className="text-xs text-red-400 font-bold">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            <Check size={16} /> Ustaw hasło
          </Button>
          <button type="button" onClick={onLogout}
            className="w-full text-xs text-slate-400 hover:text-white py-2 transition-colors">
            Wyloguj się
          </button>
        </form>
      </div>
    </div>
  );
}

