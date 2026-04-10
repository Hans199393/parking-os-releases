import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Login from './components/Login/Login';
import Sidebar, { Page } from './components/Sidebar/Sidebar';
import Dashboard from './components/Dashboard/Dashboard';
import Cameras from './components/Cameras/Cameras';
import Reservations from './components/Reservations/Reservations';
import Finances from './components/Finances/Finances';
import AdminPanel from './components/AdminPanel/AdminPanel';
import Settings from './components/Settings/Settings';
import Chat from './components/Chat/Chat';
import Email from './components/Email/Email';
import { startPolling, stopPolling } from './lib/notifications';
import { scheduleDailyBackup } from './lib/backup';
import { getStore } from './lib/store';
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
  const [page, setPage] = useState<Page>(() => {
    return (sessionStorage.getItem('parking_os_page') as Page) ?? 'dashboard';
  });
  const [reservationBadge, setReservationBadge] = useState(0);
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
    });
    loadCameraUrls();
  }, [loadCameraUrls]);

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
    startPolling((_res) => {
      setReservationBadge(b => b + 1);
    });
    scheduleDailyBackup();
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

  const handleNavigate = (p: Page) => {
    sessionStorage.setItem('parking_os_page', p);
    setPage(p);
    if (p === 'reservations') setReservationBadge(0);
  };

  useEffect(() => {
    return () => { stopPolling(); };
  }, []);

  if (!authenticated) {
    return <Login onSuccess={handleAuth} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        current={page}
        onChange={handleNavigate}
        reservationBadge={reservationBadge}
        onOpenPwa={handleOpenPwa}
        onStopPwa={handleStopPwa}
        pwaStatus={pwaStatus}
      />
      <main className="flex-1 overflow-hidden relative backdrop-blur-md bg-[var(--color-bg)]">
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
        {page === 'admin' && (
          <AdminPanel />
        )}
        {page === 'chat' && (
          <Chat />
        )}
        {page === 'email' && (
          <Email />
        )}
        {page === 'settings' && (
          <Settings theme={theme} onThemeChange={handleThemeChange} onSettingsSaved={loadCameraUrls} />
        )}
      </main>
    </div>
  );
}

