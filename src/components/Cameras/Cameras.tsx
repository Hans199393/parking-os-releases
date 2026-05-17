import { useState, useEffect, useRef, useCallback } from 'react';
import RTSPPlayer from './RTSPPlayer';
import { invoke } from '@tauri-apps/api/core';
import DetectorPanel, { type Roi } from './DetectorPanel';
import { Maximize2, Minimize2, RefreshCw, Copy, Play, Image, Move, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Home, LayoutGrid, LayoutPanelLeft, List } from 'lucide-react';
import { getStore } from '../../lib/store';

type CameraMode = 'snapshot' | 'hls';

// ─── PTZ Controls ─────────────────────────────────────────────────────────────
function PTZBtn({ onClick, children, className = '' }: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all select-none touch-none
        bg-[var(--color-surface-2)]/90 hover:bg-[var(--color-surface-3)] active:bg-[var(--color-accent)] active:scale-95
        text-[var(--color-text)] hover:text-white border border-[var(--color-border)] ${className}`}
      draggable={false}
    >
      {children}
    </button>
  );
}

function PTZControls({ camId }: { camId: string }) {
  const [ptzError, setPtzError] = useState(false);

  const send = useCallback(async (action: string, x = 0, y = 0, z = 0) => {
    try {
      const res = await fetch(`http://localhost:8888/ptz/${camId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, x, y, z }),
      });
      if (!res.ok) {
        setPtzError(true);
        setTimeout(() => setPtzError(false), 3000);
      } else {
        setPtzError(false);
      }
    } catch {
      setPtzError(true);
      setTimeout(() => setPtzError(false), 3000);
    }
  }, [camId]);

  const home = useCallback(() => send('home'), [send]);

  return (
    <div className="glass-strong rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 shadow-glow select-none">
      {/* Title */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">PTZ</span>
        {ptzError && <span className="text-[10px] text-red-400">Błąd!</span>}
      </div>

      {/* D-pad */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        <span />
        <PTZBtn onClick={() => send('move', 0, 0.7, 0)}><ChevronUp size={15} /></PTZBtn>
        <span />
        <PTZBtn onClick={() => send('move', -0.7, 0, 0)}><ChevronLeft size={15} /></PTZBtn>
        <PTZBtn onClick={home} className="bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/40 border-[var(--color-accent)]/50 text-[var(--color-accent)]">
          <Home size={13} />
        </PTZBtn>
        <PTZBtn onClick={() => send('move', 0.7, 0, 0)}><ChevronRight size={15} /></PTZBtn>
        <span />
        <PTZBtn onClick={() => send('move', 0, -0.7, 0)}><ChevronDown size={15} /></PTZBtn>
        <span />
      </div>

      {/* Zoom */}
      <div className="flex gap-1 border-t border-[var(--color-border)] pt-2">
        <PTZBtn onClick={() => send('move', 0, 0, -0.5)} className="flex-1 gap-1">
          <ZoomOut size={13} /><span className="text-[10px] font-medium">OUT</span>
        </PTZBtn>
        <PTZBtn onClick={() => send('move', 0, 0, 0.5)} className="flex-1 gap-1">
          <ZoomIn size={13} /><span className="text-[10px] font-medium">IN</span>
        </PTZBtn>
      </div>
    </div>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

interface CameraFeedProps {
  name: string;
  camId: string;
  ptzEnabled?: boolean;
  snapshotUrl: string | null;
  rtspUrl: string | null;
  hlsUrl: string | null;
  fullscreen: boolean;
  onFullscreen: () => void;
  onExitFullscreen: () => void;
  roiOverlay?: { roi: Roi; line: number } | null;
  /** Slot renderowany jako pasek u dołu karty (tryb compact DetectorPanel) */
  bottomBar?: React.ReactNode;
}

function CameraFeed({ name, camId, ptzEnabled = false, snapshotUrl, rtspUrl, hlsUrl, fullscreen, onFullscreen, onExitFullscreen, roiOverlay, bottomBar }: CameraFeedProps) {
  const [imgData, setImgData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<CameraMode>(hlsUrl ? 'hls' : 'snapshot');
  const cancelRef = useRef(false);

  const [ptzOpen, setPtzOpen] = useState(false);

  // Snapshot polling loop
  useEffect(() => {
    if (mode !== 'snapshot' || !snapshotUrl) { setImgData(null); setError(null); return; }
    cancelRef.current = false;
    setError(null);
    setLoading(true);

    async function loop() {
      while (!cancelRef.current) {
        try {
          const data = await invoke<string>('fetch_snapshot', { url: snapshotUrl });
          if (!cancelRef.current) {
            setImgData(data);
            setError(null);
            setLoading(false);
          }
        } catch (e: unknown) {
          if (!cancelRef.current) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    loop();
    return () => { cancelRef.current = true; };
  }, [snapshotUrl, mode]);

  const refresh = () => {
    if (!snapshotUrl || mode !== 'snapshot') return;
    setError(null);
    setLoading(true);
    invoke<string>('fetch_snapshot', { url: snapshotUrl })
      .then(data => { setImgData(data); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const copyRtsp = () => {
    if (!rtspUrl) return;
    navigator.clipboard.writeText(rtspUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasAnySource = !!(snapshotUrl || hlsUrl);
  const connected = mode === 'snapshot' ? (!!imgData && !error) : !!hlsUrl;

  return (
    <div className={`flex flex-col bg-black rounded-[var(--radius-lg)] overflow-hidden border border-[var(--color-border)] group absolute inset-0 ring-1 ring-white/5 hover:ring-[var(--color-accent)]/30 transition-all`}>
      {/* Video area — flex-1 fills remaining height */}
      <div className="relative flex-1 min-h-0">
        {/* Label + status — nowy badge glass-strong */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 glass-strong rounded-full pl-1.5 pr-2.5 py-0.5 border border-white/10">
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : loading ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-[11px] text-white font-semibold tracking-wide">{name}</span>
          {connected && (
            <span className="text-[9px] uppercase tracking-wider px-1 py-px rounded ml-0.5 bg-emerald-500/20 text-emerald-300">{mode === 'hls' ? 'live' : 'snap'}</span>
          )}
        </div>

        {/* Controls */}
        <div className={`absolute top-2 right-2 z-10 flex gap-1 transition-opacity ${ptzOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {snapshotUrl && hlsUrl && (
            <button onClick={() => setMode(m => m === 'snapshot' ? 'hls' : 'snapshot')}
              className="glass-strong text-white p-1.5 rounded-md hover:bg-white/10 border border-white/10"
              title={mode === 'snapshot' ? 'Przełącz na HLS Live' : 'Przełącz na Snapshot'}>
              {mode === 'snapshot' ? <Play size={14} /> : <Image size={14} />}
            </button>
          )}
          {mode === 'snapshot' && snapshotUrl && (
            <button onClick={refresh} className="glass-strong text-white p-1.5 rounded-md hover:bg-white/10 border border-white/10" title="Odśwież">
              <RefreshCw size={14} />
            </button>
          )}
          {ptzEnabled && (
            <button onClick={() => setPtzOpen(p => !p)}
              className={`p-1.5 rounded-md border transition-colors ${ptzOpen ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'glass-strong text-white border-white/10 hover:bg-white/10'}`}
              title="Sterowanie PTZ">
              <Move size={14} />
            </button>
          )}
          <button onClick={fullscreen ? onExitFullscreen : onFullscreen}
            className="glass-strong text-white p-1.5 rounded-md hover:bg-white/10 border border-white/10"
            title={fullscreen ? 'Zmniejsz' : 'Pełny ekran'}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>

        {/* PTZ Panel */}
        {ptzEnabled && ptzOpen && (
          <div className="absolute bottom-2 right-2 z-20">
            <PTZControls camId={camId} />
          </div>
        )}

        {/* HLS Mode */}
        {mode === 'hls' && hlsUrl && (
          <div className="absolute inset-0">
            <RTSPPlayer streamUrl={hlsUrl} fill />
          </div>
        )}

        {/* Snapshot Mode */}
        {mode === 'snapshot' && imgData && !error && (
          <img
            src={imgData}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setError('Kamera zwrocila nieprawidlowy obraz. Sprawdz Snapshot URL w Ustawieniach.')}
          />
        )}

        {/* ROI overlay — viewBox matches editor's 640×360 canonical space;
             preserveAspectRatio=xMidYMid slice mirrors CSS object-cover exactly */}
        {roiOverlay && (() => {
          const { roi, line } = roiOverlay;
          const W = 640, H = 360;
          const rx1 = roi.x1 * W, ry1 = roi.y1 * H;
          const rx2 = roi.x2 * W, ry2 = roi.y2 * H;
          const lineY = ry1 + line * (ry2 - ry1);
          return (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid slice"
            >
              <rect
                x={rx1} y={ry1} width={rx2 - rx1} height={ry2 - ry1}
                fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.85)"
                strokeWidth={2} strokeDasharray="8 4"
              />
              <line
                x1={rx1} y1={lineY} x2={rx2} y2={lineY}
                stroke="rgba(251,191,36,0.9)" strokeWidth={2}
              />
              <text
                x={rx1 + 6} y={Math.max(ry1 - 5, 14)}
                fill="rgba(239,68,68,0.9)" fontSize={13} fontFamily="sans-serif" fontWeight="600"
              >ROI</text>
            </svg>
          );
        })()}

        {/* No source configured */}
        {!hasAnySource && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-gradient-to-br from-[var(--color-surface)]/40 to-black/60">
            <div className="text-3xl">📷</div>
            <p className="text-[var(--color-text-muted)] text-sm font-medium">{name}</p>
            {rtspUrl ? (
              <div className="max-w-xs">
                <p className="text-amber-400 text-xs font-semibold mb-1">Skonfiguruj kamere w Ustawieniach</p>
                <p className="text-[var(--color-text-muted)] text-xs mb-2">Wpisz Snapshot HTTP URL lub HLS URL.</p>
                <div className="glass-strong rounded-md px-2 py-1 flex items-center gap-1 justify-between border border-white/10">
                  <span className="text-slate-300 text-xs truncate max-w-[160px]">{rtspUrl}</span>
                  <button onClick={copyRtsp} className="text-[var(--color-accent)] hover:opacity-80 flex-shrink-0" title="Kopiuj RTSP">
                    <Copy size={12} />
                  </button>
                </div>
                {copied && <p className="text-[var(--color-accent)] text-xs mt-1">Skopiowano do schowka</p>}
              </div>
            ) : (
              <p className="text-slate-600 text-xs">Wpisz URL kamery w Ustawieniach</p>
            )}
          </div>
        )}

        {/* Snapshot loading */}
        {mode === 'snapshot' && snapshotUrl && loading && !imgData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
            <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-[var(--color-text-muted)] text-xs">Łączenie z kamerą...</p>
          </div>
        )}

        {/* Snapshot error */}
        {mode === 'snapshot' && snapshotUrl && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-gradient-to-br from-red-950/30 to-black/60">
            <div className="text-3xl">⚠️</div>
            <p className="text-[var(--color-text-muted)] text-sm">Brak odpowiedzi kamery</p>
            <p className="text-slate-600 text-xs break-all max-w-xs">{error}</p>
            <button onClick={refresh} className="mt-1 text-xs text-[var(--color-accent)] hover:underline">Spróbuj ponownie</button>
            {hlsUrl && (
              <button onClick={() => setMode('hls')} className="mt-1 text-xs text-amber-400 hover:underline">Przełącz na HLS Live →</button>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar slot — np. DetectorPanel compact */}
      {bottomBar}
    </div>
  );
}

interface CamerasProps {
  cam1SnapshotUrl: string | null;
  cam1RtspUrl: string | null;
  cam1HlsUrl: string | null;
  cam2SnapshotUrl: string | null;
  cam2RtspUrl: string | null;
  cam2HlsUrl: string | null;
  cam3SnapshotUrl: string | null;
  cam3RtspUrl: string | null;
  cam3HlsUrl: string | null;
  cam4SnapshotUrl: string | null;
  cam4RtspUrl: string | null;
  cam4HlsUrl: string | null;
}

export default function Cameras({ cam1SnapshotUrl, cam1RtspUrl, cam1HlsUrl, cam2SnapshotUrl, cam2RtspUrl, cam2HlsUrl, cam3SnapshotUrl, cam3RtspUrl, cam3HlsUrl, cam4SnapshotUrl, cam4RtspUrl, cam4HlsUrl }: CamerasProps) {
  const [fullscreenCam, setFullscreenCam] = useState<number | null>(null);
  const [roiOverlay, setRoiOverlay] = useState<{ roi: Roi; line: number } | null>(null);
  const [showRoiOverlay, setShowRoiOverlay] = useState(true);

  // Wczytaj ustawienie show_roi_overlay ze store
  useEffect(() => {
    getStore().then(async s => {
      const v = await s.get<string>('show_roi_overlay');
      setShowRoiOverlay(v !== 'false');
    }).catch(() => {});
  }, []);

  // layout: 'grid2x2' | 'big1' | 'list'
  const [layout, setLayout] = useState<'grid2x2' | 'big1' | 'list'>(() => {
    return (sessionStorage.getItem('cam_layout') as 'grid2x2' | 'big1' | 'list') ?? 'grid2x2';
  });

  const setLayoutSave = (l: 'grid2x2' | 'big1' | 'list') => {
    setLayout(l);
    sessionStorage.setItem('cam_layout', l);
  };

  const cameras = [
    { name: 'CAM 1 — IMOU', camId: 'cam1', ptzEnabled: false, snapshotUrl: cam1SnapshotUrl, rtspUrl: cam1RtspUrl, hlsUrl: cam1HlsUrl },
    { name: 'CAM 2 — YCC365Plus #1', camId: 'cam2', ptzEnabled: true, snapshotUrl: cam2SnapshotUrl, rtspUrl: cam2RtspUrl, hlsUrl: cam2HlsUrl },
    { name: 'CAM 3 — YCC365Plus #2', camId: 'cam3', ptzEnabled: true, snapshotUrl: cam3SnapshotUrl, rtspUrl: cam3RtspUrl, hlsUrl: cam3HlsUrl },
    { name: 'CAM 4', camId: 'cam4', ptzEnabled: false, snapshotUrl: cam4SnapshotUrl, rtspUrl: cam4RtspUrl, hlsUrl: cam4HlsUrl },
  ];

  const anyConfigured = cameras.some(c => c.snapshotUrl || c.hlsUrl || c.rtspUrl);

  // DetectorPanel kompaktowy — do wbudowania w kartę CAM 1
  const detectorBar = (
    <DetectorPanel compact
      cam1RtspUrl={cam1RtspUrl}
      cam1SnapshotUrl={cam1SnapshotUrl}
      cam1HlsUrl={cam1HlsUrl}
      onRoiUpdate={(roi, line) => setRoiOverlay({ roi, line })}
    />
  );

  function renderCamera(cam: typeof cameras[0], i: number, fs: boolean) {
    return (
      <CameraFeed
        key={cam.camId}
        name={cam.name}
        camId={cam.camId}
        ptzEnabled={cam.ptzEnabled}
        snapshotUrl={cam.snapshotUrl}
        rtspUrl={cam.rtspUrl}
        hlsUrl={cam.hlsUrl}
        fullscreen={fs}
        onFullscreen={() => setFullscreenCam(i)}
        onExitFullscreen={() => setFullscreenCam(null)}
        roiOverlay={i === 0 && showRoiOverlay ? roiOverlay : null}
        bottomBar={i === 0 ? detectorBar : undefined}
      />
    );
  }

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      {/* Nagłówek */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] tracking-tight">Kamery</h1>
          <p className="text-[var(--color-text-muted)] text-xs mt-0.5 flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${anyConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {anyConfigured
              ? `${cameras.filter(c => c.snapshotUrl || c.hlsUrl).length}/${cameras.length} kamer aktywnych · snapshot ~1,5 kl/s lub HLS live`
              : 'Skonfiguruj adresy kamer w Ustawieniach'}
          </p>
        </div>
        {/* Przełączniki layoutu */}
        {fullscreenCam === null && (
          <div className="flex items-center gap-1 glass-strong border border-[var(--color-border)] rounded-[var(--radius-md)] p-1">
            <button onClick={() => setLayoutSave('grid2x2')} title="Siatka 2×2"
              className={`p-1.5 rounded transition-colors ${layout === 'grid2x2' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              <LayoutGrid size={15} />
            </button>
            <button onClick={() => setLayoutSave('big1')} title="1 duży + 3 małe"
              className={`p-1.5 rounded transition-colors ${layout === 'big1' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              <LayoutPanelLeft size={15} />
            </button>
            <button onClick={() => setLayoutSave('list')} title="Lista pozioma"
              className={`p-1.5 rounded transition-colors ${layout === 'list' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              <List size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Instrukcja gdy brak kamer */}
      {!anyConfigured && (
        <div className="glass-strong border border-amber-500/30 rounded-[var(--radius-lg)] p-4 flex-shrink-0 ring-1 ring-amber-500/10">
          <h3 className="text-amber-300 font-semibold text-xs mb-2 uppercase tracking-wider">Jak uruchomić podgląd kamer?</h3>
          <div className="text-[var(--color-text-muted)] text-xs space-y-1">
            <p><strong className="text-[var(--color-text)]">Opcja 1 — Snapshot HTTP:</strong> Wpisz URL w Ustawieniach (np. <code className="text-[var(--color-text)] bg-black/30 px-1 rounded">http://admin:haslo@IP/snapshot.cgi</code>)</p>
            <p><strong className="text-[var(--color-text)]">Opcja 2 — HLS:</strong> Uruchom proxy ffmpeg w <code className="text-[var(--color-text)] bg-black/30 px-1 rounded">rtsp-proxy/</code>, wpisz <code className="text-[var(--color-text)] bg-black/30 px-1 rounded">http://localhost:8888/stream/cam1.m3u8</code></p>
            <p><strong className="text-[var(--color-text)]">Opcja 3 — VLC:</strong> Skopiuj RTSP URL z Ustawień i otwórz w VLC</p>
          </div>
        </div>
      )}

      {/* FULLSCREEN */}
      {fullscreenCam !== null ? (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0 relative">
            {renderCamera(cameras[fullscreenCam], fullscreenCam, true)}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {cameras.map((cam, i) => (
              <button key={i} onClick={() => setFullscreenCam(i)}
                className={`flex-1 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-all border
                  ${fullscreenCam === i ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/50 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30' : 'glass-strong border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
                {cam.name}
              </button>
            ))}
          </div>
        </div>

      /* GRID 2×2 */
      ) : layout === 'grid2x2' ? (
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 min-h-0">
          {cameras.map((cam, i) => (
            <div key={i} className="relative min-h-0">
              {renderCamera(cam, i, false)}
            </div>
          ))}
        </div>

      /* 1 DUŻY + 3 MAŁE */
      ) : layout === 'big1' ? (
        <div className="flex-1 flex gap-3 min-h-0">
          <div className="flex-1 min-w-0 min-h-0 relative">
            {renderCamera(cameras[0], 0, false)}
          </div>
          <div className="w-56 flex flex-col gap-3 flex-shrink-0">
            {cameras.slice(1).map((cam, i) => (
              <div key={i} className="flex-1 min-h-0 relative">
                {renderCamera(cam, i + 1, false)}
              </div>
            ))}
          </div>
        </div>

      /* LISTA (2 kolumny, scroll) */
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0 overflow-y-auto">
          {cameras.map((cam, i) => (
            <div key={i} style={{ aspectRatio: '16/9' }} className="w-full relative">
              {renderCamera(cam, i, false)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
