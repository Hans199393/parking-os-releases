import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { Play, Square, Car, ArrowDownCircle, ArrowUpCircle, Activity, AlertTriangle } from 'lucide-react';

interface DetectorStatus {
  running: boolean;
  today_in: number;
  today_out: number;
  on_parking: number;
  last_event: { direction: 'in' | 'out'; ts: string } | null;
  fps: number;
  error: string | null;
}

const DETECTOR_PORT = 8890;
const POLL_INTERVAL = 3000; // ms

interface DetectorPanelProps {
  cam1RtspUrl: string | null;
}

export default function DetectorPanel({ cam1RtspUrl }: DetectorPanelProps) {
  const [active, setActive]     = useState(false);
  const [status, setStatus]     = useState<DetectorStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sprawdź czy detektor już działa (po zamontowaniu)
  useEffect(() => {
    invoke<boolean>('detector_is_running').then(running => {
      if (running) {
        setActive(true);
        startPolling();
      }
    }).catch(() => {});
    return () => stopPolling();
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${DETECTOR_PORT}/status`);
      if (res.ok) {
        const data: DetectorStatus = await res.json();
        setStatus(data);
        setError(null);
      }
    } catch {
      // detektor jeszcze nie wystartował lub padł
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL);
    fetchStatus();
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleStart = async () => {
    if (!cam1RtspUrl) {
      setError('Brak RTSP URL kamery CAM 1. Ustaw go w Ustawieniach.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const dataDir = await appDataDir();
      const dbPath  = dataDir.replace(/\\/g, '/') + 'detection.db';
      await invoke('spawn_detector', {
        rtspUrl: cam1RtspUrl,
        dbPath,
      });
      setActive(true);
      // Poczekaj chwilę aż Python się uruchomi
      setTimeout(() => {
        startPolling();
        setStarting(false);
      }, 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await invoke('stop_detector');
    } catch { /* ignore */ }
    setActive(false);
    setStatus(null);
    stopPolling();
  };

  const onParking = status?.on_parking ?? 0;
  const todayIn   = status?.today_in   ?? 0;
  const todayOut  = status?.today_out  ?? 0;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 mb-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-teal-400" />
          <span className="font-semibold text-sm text-[var(--color-text)]">Detekcja pojazdów — CAM 1</span>
          {active && status && !status.error && (
            <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
              Aktywna · {status.fps} fps
            </span>
          )}
          {active && status?.error && (
            <span className="text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
              <AlertTriangle size={10} /> {status.error}
            </span>
          )}
          {active && !status && (
            <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
              Uruchamianie...
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {!active ? (
            <button
              onClick={handleStart}
              disabled={starting || !cam1RtspUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {starting ? (
                <span className="w-3 h-3 border border-teal-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play size={12} />
              )}
              {starting ? 'Uruchamianie...' : 'Uruchom detektor'}
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              <Square size={12} />
              Zatrzymaj
            </button>
          )}
        </div>
      </div>

      {/* Liczniki */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--color-bg)] rounded-lg p-3 text-center border border-[var(--color-border)]">
          <ArrowDownCircle size={18} className="mx-auto mb-1 text-green-400" />
          <div className="text-2xl font-bold text-[var(--color-text)]">{todayIn}</div>
          <div className="text-xs text-[var(--color-text-muted)]">Wjazdy dziś</div>
        </div>
        <div className="bg-[var(--color-bg)] rounded-lg p-3 text-center border border-[var(--color-border)]">
          <Car size={18} className="mx-auto mb-1 text-teal-400" />
          <div className={`text-2xl font-bold ${onParking > 0 ? 'text-teal-300' : 'text-[var(--color-text)]'}`}>
            {onParking}
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">Na parkingu</div>
        </div>
        <div className="bg-[var(--color-bg)] rounded-lg p-3 text-center border border-[var(--color-border)]">
          <ArrowUpCircle size={18} className="mx-auto mb-1 text-orange-400" />
          <div className="text-2xl font-bold text-[var(--color-text)]">{todayOut}</div>
          <div className="text-xs text-[var(--color-text-muted)]">Wyjazdy dziś</div>
        </div>
      </div>

      {/* Ostatnie zdarzenie */}
      {status?.last_event && (
        <div className="mt-3 text-xs text-[var(--color-text-muted)] text-center">
          Ostatnie: {status.last_event.direction === 'in' ? '↓ Wjazd' : '↑ Wyjazd'}{' '}
          · {new Date(status.last_event.ts).toLocaleTimeString('pl-PL')}
        </div>
      )}

      {/* Błąd */}
      {error && (
        <div className="mt-2 text-xs text-red-400 bg-red-400/10 rounded px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {/* Info gdy nieaktywny */}
      {!active && !error && (
        <p className="text-xs text-[var(--color-text-muted)] text-center mt-2">
          {cam1RtspUrl
            ? 'Uruchom detektor aby zliczać pojazdy przez bramę (YOLO v8n)'
            : 'Ustaw RTSP URL dla CAM 1 w Ustawieniach aby włączyć detekcję'}
        </p>
      )}
    </div>
  );
}
