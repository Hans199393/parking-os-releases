/**
 * DevicesTab — Kamery + Detekcja w jednym miejscu (4 karty + 2 sekcje).
 * Visual: glass-strong, gradient-accent na ikonach, hero numbers dla parametrów.
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Camera, Cpu, Zap, Eye, Activity, Lock, RefreshCw, Play, RotateCcw, FileText, Copy, Server } from 'lucide-react';
import { usePerm } from '../../lib/usePerm';

interface Props {
  values: Record<string, string>;
  set: (key: string, val: string) => void;
}

interface CameraRuntimeStatus {
  server_js_exists: boolean;
  bundled_node_exists: boolean;
  bundled_ffmpeg_exists: boolean;
  proxy_process_running: boolean;
  proxy_health_ok: boolean;
  issue: string | null;
}

interface CameraProxyLog {
  path: string;
  exists: boolean;
  tail: string;
}

const CAM_DEFAULTS = [
  { id: 'cam1', defaultName: 'CAM 1 — IMOU', accent: true },
  { id: 'cam2', defaultName: 'CAM 2 — YCC365Plus #1' },
  { id: 'cam3', defaultName: 'CAM 3 — YCC365Plus #2' },
  { id: 'cam4', defaultName: 'CAM 4' },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none
          ${checked ? 'bg-gradient-accent shadow-[var(--shadow-glow)]' : 'bg-slate-600'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
      {label && <span className="text-sm text-[var(--color-text)]">{label}</span>}
    </label>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm font-mono transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]" />
    </div>
  );
}

export default function DevicesTab({ values, set }: Props) {
  const perm = usePerm();
  const canEdit = perm.has('settings.edit_devices');
  const [proxyStatus, setProxyStatus] = useState<CameraRuntimeStatus | null>(null);
  const [proxyLog, setProxyLog] = useState<CameraProxyLog | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [showProxyLog, setShowProxyLog] = useState(false);
  const [isRefreshingProxy, setIsRefreshingProxy] = useState(false);
  const [proxyActionBusy, setProxyActionBusy] = useState<'start' | 'restart' | null>(null);
  const [copiedLog, setCopiedLog] = useState(false);
  const setG = (k: string, v: string) => {
    if (!perm.guard('settings.edit_devices', 'edycja kamer/detektora')) return;
    set(k, v);
  };
  const bool = (k: string) => values[k] === 'true';

  const conf = parseFloat(values.detection_confidence ?? '0.5');
  const rtspConfiguredCount = CAM_DEFAULTS.filter(cam => !!values[`${cam.id}_rtsp_url`]?.trim()).length;

  const refreshProxyState = useCallback(async (showSpinner = true) => {
    if (showSpinner) setIsRefreshingProxy(true);
    try {
      const [status, log] = await Promise.all([
        invoke<CameraRuntimeStatus>('camera_runtime_status'),
        invoke<CameraProxyLog>('camera_proxy_read_log'),
      ]);
      setProxyStatus(status);
      setProxyLog(log);
      setProxyError(null);
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : String(error));
    } finally {
      if (showSpinner) setIsRefreshingProxy(false);
    }
  }, []);

  useEffect(() => {
    void refreshProxyState();
  }, [refreshProxyState]);

  const runProxyAction = useCallback(async (action: 'camera_proxy_start' | 'camera_proxy_restart', kind: 'start' | 'restart') => {
    setProxyActionBusy(kind);
    setProxyError(null);
    try {
      await invoke(action);
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : String(error));
    } finally {
      await new Promise(resolve => setTimeout(resolve, 900));
      await refreshProxyState(false);
      setProxyActionBusy(null);
    }
  }, [refreshProxyState]);

  const copyProxyLog = useCallback(async () => {
    if (!proxyLog) return;
    try {
      await navigator.clipboard.writeText(`Plik: ${proxyLog.path}\n\n${proxyLog.tail}`.trim());
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 1800);
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : String(error));
    }
  }, [proxyLog]);

  const proxyStateLabel = proxyStatus?.proxy_health_ok
    ? 'Działa'
    : proxyStatus?.proxy_process_running
      ? 'Startuje / zawiesił się'
      : 'Nie działa';

  const proxyStateTone = proxyStatus?.proxy_health_ok
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    : proxyStatus?.proxy_process_running
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
      : 'bg-red-500/15 text-red-300 border-red-500/40';

  return <>
    {!canEdit && (
      <div className="glass-strong rounded-[var(--radius-lg)] p-4 mb-5 flex items-center gap-3 border-2 border-[var(--color-warning)]/40 animate-slideUp">
        <Lock size={20} className="text-[var(--color-warning)] flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">Tryb tylko do odczytu</p>
          <p className="text-xs text-[var(--color-text-muted)]">Brak uprawnienia <code>settings.edit_devices</code> — zmiany nie zostaną zapisane.</p>
        </div>
      </div>
    )}
    {/* ─── Kamery — 4 karty w grid 2×2 ─── */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {CAM_DEFAULTS.map((cam, idx) => {
        const name = values[`${cam.id}_name`] || cam.defaultName;
        const hasUrl = !!values[`${cam.id}_snapshot_url`];
        return (
          <div key={cam.id}
            className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5"
            style={{ animationDelay: `${idx * 50}ms` }}>
            <div className="flex items-start justify-between mb-5 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center shadow-[var(--shadow-md)] flex-shrink-0
                  ${cam.accent ? 'bg-gradient-accent' : 'bg-[var(--color-surface-2)]'}`}>
                  <Camera size={22} className={cam.accent ? 'text-[#1a1410]' : 'text-[var(--color-text-muted)]'} />
                </div>
                <div className="min-w-0">
                  <input type="text" value={values[`${cam.id}_name`] ?? ''}
                    onChange={e => setG(`${cam.id}_name`, e.target.value)} placeholder={cam.defaultName}
                    className="text-lg font-bold text-[var(--color-text)] bg-transparent border-0 outline-none w-full truncate hover:bg-white/5 px-1 py-0.5 rounded transition-colors"
                    title={name} />
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {cam.accent ? 'Kamera detekcji ROI · YOLO' : 'Podgląd live'}
                  </p>
                </div>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border
                ${hasUrl ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-500/10 text-slate-400 border-slate-500/30'}`}>
                {hasUrl ? '● skonfigurowana' : '○ nie ustawiona'}
              </span>
            </div>
            <div className="space-y-3">
              <Field label="Snapshot HTTP URL" value={values[`${cam.id}_snapshot_url`] ?? ''}
                onChange={v => setG(`${cam.id}_snapshot_url`, v)}
                placeholder={idx === 0 ? 'http://admin:HASLO@192.168.0.50/cgi-bin/snapshot.cgi' : 'http://admin:HASLO@IP/snapshot'} />
              <Field label="HLS Live URL (po uruchomieniu proxy)" value={values[`${cam.id}_hls_url`] ?? ''}
                onChange={v => setG(`${cam.id}_hls_url`, v)}
                placeholder={`http://localhost:8888/stream/${cam.id}.m3u8`} />
              <Field label="RTSP URL (tylko do VLC)" value={values[`${cam.id}_rtsp_url`] ?? ''}
                onChange={v => setG(`${cam.id}_rtsp_url`, v)}
                placeholder={idx === 0 ? 'rtsp://admin:HASLO@192.168.0.50:554/cam/realmonitor?channel=1&subtype=0' : 'rtsp://admin:HASLO@IP:554/...'} />
            </div>
          </div>
        );
      })}
    </div>

    {/* ─── Proxy kamer ─── */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 mt-5 animate-slideUp" style={{ animationDelay: '225ms' }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)] flex-shrink-0">
            <Server size={22} className="text-[#1a1410]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-[var(--color-text)]">Lokalny proxy RTSP → HLS</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              localhost:8888 · RTSP skonfigurowane: {rtspConfiguredCount}/4 · log zapisuje się do pliku
            </p>
          </div>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${proxyStateTone}`}>
          {isRefreshingProxy ? '● sprawdzanie' : `● ${proxyStateLabel}`}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {[
          { label: 'server.js', ok: !!proxyStatus?.server_js_exists },
          { label: 'node runtime', ok: !!proxyStatus?.bundled_node_exists },
          { label: 'ffmpeg runtime', ok: !!proxyStatus?.bundled_ffmpeg_exists },
        ].map(item => (
          <div key={item.label} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-black/15 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">{item.label}</span>
              <span className={`text-[10px] font-bold ${item.ok ? 'text-emerald-300' : 'text-red-300'}`}>{item.ok ? 'OK' : 'BRAK'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-black/15 px-4 py-3 mb-4">
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {proxyError ?? proxyStatus?.issue ?? 'Proxy odpowiada prawidłowo na http://localhost:8888/.'}
        </p>
        {proxyLog?.path && (
          <p className="text-[11px] text-[var(--color-text-muted)] mt-2 break-all">
            Plik logu: <span className="font-mono text-[var(--color-text)]">{proxyLog.path}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void refreshProxyState()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-xs font-semibold bg-white/6 hover:bg-white/10 text-white border border-white/10 transition-colors"
          disabled={isRefreshingProxy || !!proxyActionBusy}
        >
          <RefreshCw size={13} className={isRefreshingProxy ? 'animate-spin' : ''} />
          Odśwież status
        </button>
        <button
          onClick={() => void runProxyAction('camera_proxy_start', 'start')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/30 transition-colors"
          disabled={!!proxyActionBusy}
        >
          <Play size={13} className={proxyActionBusy === 'start' ? 'animate-pulse' : ''} />
          Włącz proxy
        </button>
        <button
          onClick={() => void runProxyAction('camera_proxy_restart', 'restart')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30 transition-colors"
          disabled={!!proxyActionBusy}
        >
          <RotateCcw size={13} className={proxyActionBusy === 'restart' ? 'animate-spin' : ''} />
          Restart proxy
        </button>
        <button
          onClick={() => setShowProxyLog(v => !v)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-xs font-semibold bg-white/6 hover:bg-white/10 text-white border border-white/10 transition-colors"
        >
          <FileText size={13} />
          {showProxyLog ? 'Ukryj log' : 'Pokaż log'}
        </button>
        <button
          onClick={() => void copyProxyLog()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-xs font-semibold bg-white/6 hover:bg-white/10 text-white border border-white/10 transition-colors"
          disabled={!proxyLog}
        >
          <Copy size={13} />
          {copiedLog ? 'Skopiowano' : 'Kopiuj log'}
        </button>
      </div>

      {showProxyLog && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)]/40">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-2">Ostatnie wpisy logu proxy</p>
          <pre className="max-h-64 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-black/30 px-3 py-3 text-[11px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap break-all">{proxyLog?.tail || 'Brak wpisów w logu proxy.'}</pre>
        </div>
      )}
    </div>

    {/* ─── Opcje podglądu ─── */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 mt-5 animate-slideUp" style={{ animationDelay: '250ms' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
          <Eye size={22} className="text-[#1a1410]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text)]">Opcje podglądu</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Częstotliwość i overlay</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Interwał snapshot</p>
          <select value={values.snapshot_interval ?? '1500'} onChange={e => setG('snapshot_interval', e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]">
            <option value="500">0,5 s — bardzo szybki (~2 kl/s)</option>
            <option value="1000">1 s</option>
            <option value="1500">1,5 s — domyślny</option>
            <option value="3000">3 s — oszczędny</option>
          </select>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Overlay ROI na CAM 1</p>
          <Toggle checked={bool('show_roi_overlay')} onChange={v => setG('show_roi_overlay', String(v))}
            label={bool('show_roi_overlay') ? 'Widoczny — czerwona ramka + linia detekcji' : 'Ukryty'} />
        </div>
      </div>
    </div>

    {/* ─── Detektor YOLO ─── */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 mt-5 animate-slideUp" style={{ animationDelay: '300ms' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
          <Cpu size={22} className="text-[#1a1410]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text)]">Detektor YOLOv8n</h3>
          <p className="text-xs text-[var(--color-text-muted)]">~6 MB · wykrywa pojazdy w obszarze ROI na CAM 1</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Confidence — slider z hero number */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">Próg pewności</p>
            <div className="flex items-baseline gap-1">
              <span className="hero-number" style={{ fontSize: 'clamp(1.5rem,3vw,2rem)' }}>{conf.toFixed(2)}</span>
            </div>
          </div>
          <input type="range" min="0.1" max="0.9" step="0.05"
            value={values.detection_confidence ?? '0.5'}
            onChange={e => setG('detection_confidence', e.target.value)}
            className="w-full accent-[var(--color-accent)]" />
          <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-1 opacity-60">
            <span>0.1 — czuły</span><span>0.9 — pewny</span>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Interwał próbkowania</p>
          <select value={values.detection_interval ?? '330'} onChange={e => setG('detection_interval', e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]">
            <option value="200">5 fps — szybki (mocne CPU)</option>
            <option value="330">3 fps — zalecany</option>
            <option value="500">2 fps — umiarkowany</option>
            <option value="1000">1 fps — oszczędny</option>
          </select>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-[var(--color-border)]/40">
        <div className="flex items-center gap-3 mb-2">
          <Zap size={16} className="text-[var(--color-accent)]" />
          <p className="text-sm font-bold text-[var(--color-text)]">Auto-start przy uruchomieniu aplikacji</p>
        </div>
        <Toggle checked={bool('detector_autostart')} onChange={v => setG('detector_autostart', String(v))}
          label={bool('detector_autostart') ? 'Włączony — wymaga RTSP URL dla CAM 1' : 'Wyłączony'} />
      </div>
    </div>

    {/* ─── Info ─── */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-5 mt-5 animate-slideUp opacity-80" style={{ animationDelay: '350ms' }}>
      <div className="flex items-start gap-3">
        <Activity size={18} className="text-[var(--color-accent)] mt-0.5 flex-shrink-0" />
        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
          <strong className="text-[var(--color-text)]">YOLO v8n</strong> wykrywa <strong>samochody, autobusy, ciężarówki</strong> przekraczające
          linię w obszarze ROI na <strong>CAM 1</strong>. Linia ROI ustawiana jest w widoku <em>Kamery → Edytor ROI</em>.
        </p>
      </div>
    </div>
  </>;
}
