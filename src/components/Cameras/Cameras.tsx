import { useState, useEffect, useRef, useCallback } from 'react';
import RTSPPlayer from './RTSPPlayer';
import { invoke } from '@tauri-apps/api/core';
import { Maximize2, Minimize2, RefreshCw, Copy, Play, Image, Move, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Home } from 'lucide-react';

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
        bg-slate-800/90 hover:bg-slate-700 active:bg-teal-600 active:scale-95
        text-slate-300 hover:text-white border border-slate-600/40 ${className}`}
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
    <div className="bg-slate-950/95 backdrop-blur-md rounded-2xl border border-slate-700/60 p-3 shadow-2xl select-none">
      {/* Title */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">PTZ</span>
        {ptzError && <span className="text-[10px] text-red-400">Błąd!</span>}
      </div>

      {/* D-pad */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        <span />
        <PTZBtn onClick={() => send('move', 0, 0.7, 0)}><ChevronUp size={15} /></PTZBtn>
        <span />
        <PTZBtn onClick={() => send('move', -0.7, 0, 0)}><ChevronLeft size={15} /></PTZBtn>
        <PTZBtn onClick={home} className="bg-teal-900/80 hover:bg-teal-700 border-teal-600/50 text-teal-300">
          <Home size={13} />
        </PTZBtn>
        <PTZBtn onClick={() => send('move', 0.7, 0, 0)}><ChevronRight size={15} /></PTZBtn>
        <span />
        <PTZBtn onClick={() => send('move', 0, -0.7, 0)}><ChevronDown size={15} /></PTZBtn>
        <span />
      </div>

      {/* Zoom */}
      <div className="flex gap-1 border-t border-slate-700/50 pt-2">
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
}

function CameraFeed({ name, camId, ptzEnabled = false, snapshotUrl, rtspUrl, hlsUrl, fullscreen, onFullscreen, onExitFullscreen }: CameraFeedProps) {
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
    <div className={`relative bg-black rounded-xl overflow-hidden border border-slate-700 group ${fullscreen ? 'h-full' : 'aspect-video'}`}>
      {/* Label + status */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : loading ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-xs text-white bg-black/60 px-2 py-0.5 rounded font-medium">{name}</span>
      </div>

      {/* Controls */}
      <div className={`absolute top-2 right-2 z-10 flex gap-1 transition-opacity ${ptzOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {/* Mode toggle */}
        {snapshotUrl && hlsUrl && (
          <button
            onClick={() => setMode(m => m === 'snapshot' ? 'hls' : 'snapshot')}
            className="bg-black/60 text-white p-1.5 rounded hover:bg-black/80"
            title={mode === 'snapshot' ? 'Przełącz na HLS Live' : 'Przełącz na Snapshot'}
          >
            {mode === 'snapshot' ? <Play size={14} /> : <Image size={14} />}
          </button>
        )}
        {mode === 'snapshot' && snapshotUrl && (
          <button onClick={refresh} className="bg-black/60 text-white p-1.5 rounded hover:bg-black/80" title="Odśwież">
            <RefreshCw size={14} />
          </button>
        )}
        {ptzEnabled && (
          <button
            onClick={() => setPtzOpen(p => !p)}
            className={`p-1.5 rounded hover:bg-black/80 transition-colors ${ptzOpen ? 'bg-teal-600/90 text-white' : 'bg-black/60 text-white'}`}
            title="Sterowanie PTZ"
          >
            <Move size={14} />
          </button>
        )}
        <button
          onClick={fullscreen ? onExitFullscreen : onFullscreen}
          className="bg-black/60 text-white p-1.5 rounded hover:bg-black/80"
          title={fullscreen ? 'Zmniejsz' : 'Pełny ekran'}
        >
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
        <RTSPPlayer streamUrl={hlsUrl} />
      )}

      {/* Snapshot Mode — image */}
      {mode === 'snapshot' && imgData && !error && (
        <img
          src={imgData}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setError('Kamera zwróciła nieprawidłowy obraz. Sprawdź Snapshot URL w Ustawieniach.')}
        />
      )}

      {/* No source configured */}
      {!hasAnySource && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-3xl">📷</div>
          <p className="text-slate-400 text-sm font-medium">{name}</p>
          {rtspUrl ? (
            <div className="max-w-xs">
              <p className="text-amber-400 text-xs font-semibold mb-1">Skonfiguruj kamerę w Ustawieniach</p>
              <p className="text-slate-500 text-xs mb-2">Wpisz Snapshot HTTP URL lub HLS URL (po uruchomieniu proxy ffmpeg).</p>
              <div className="bg-slate-800 rounded px-2 py-1 flex items-center gap-1 justify-between">
                <span className="text-slate-400 text-xs truncate max-w-[160px]">{rtspUrl}</span>
                <button onClick={copyRtsp} className="text-teal-400 hover:text-teal-300 flex-shrink-0" title="Kopiuj RTSP do VLC">
                  <Copy size={12} />
                </button>
              </div>
              {copied && <p className="text-teal-400 text-xs mt-1">Skopiowano do schowka</p>}
            </div>
          ) : (
            <p className="text-slate-600 text-xs">Wpisz URL kamery w Ustawieniach</p>
          )}
        </div>
      )}

      {/* Snapshot loading */}
      {mode === 'snapshot' && snapshotUrl && loading && !imgData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-xs">Łączenie z kamerą...</p>
        </div>
      )}

      {/* Snapshot error */}
      {mode === 'snapshot' && snapshotUrl && error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="text-slate-400 text-sm">Brak odpowiedzi kamery</p>
          <p className="text-slate-600 text-xs break-all max-w-xs">{error}</p>
          <button onClick={refresh} className="mt-1 text-xs text-teal-400 hover:underline">Spróbuj ponownie</button>
          {hlsUrl && (
            <button onClick={() => setMode('hls')} className="mt-1 text-xs text-amber-400 hover:underline">Przełącz na HLS Live →</button>
          )}
        </div>
      )}
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

  const cameras = [
    { name: 'CAM 1 — IMOU', camId: 'cam1', ptzEnabled: false, snapshotUrl: cam1SnapshotUrl, rtspUrl: cam1RtspUrl, hlsUrl: cam1HlsUrl },
    { name: 'CAM 2 — YCC365Plus #1', camId: 'cam2', ptzEnabled: true, snapshotUrl: cam2SnapshotUrl, rtspUrl: cam2RtspUrl, hlsUrl: cam2HlsUrl },
    { name: 'CAM 3 — YCC365Plus #2', camId: 'cam3', ptzEnabled: true, snapshotUrl: cam3SnapshotUrl, rtspUrl: cam3RtspUrl, hlsUrl: cam3HlsUrl },
    { name: 'CAM 4', camId: 'cam4', ptzEnabled: false, snapshotUrl: cam4SnapshotUrl, rtspUrl: cam4RtspUrl, hlsUrl: cam4HlsUrl },
  ];

  const anyConfigured = cameras.some(c => c.snapshotUrl || c.hlsUrl || c.rtspUrl);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Kamery</h1>
        <p className="text-[var(--color-text-muted)] text-sm mt-1">
          {anyConfigured
            ? 'Podgląd na żywo — Snapshot (~1,5 kl/s) lub HLS (pełny live)'
            : 'Skonfiguruj adresy kamer w Ustawieniach'}
        </p>
      </div>

      {/* Setup instructions if no cameras configured */}
      {!anyConfigured && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="text-amber-400 font-semibold text-sm mb-3">Jak uruchomić podgląd kamer?</h3>
          <div className="text-slate-400 text-xs space-y-2">
            <p><strong className="text-slate-300">Opcja 1 — Snapshot HTTP (najprostsze):</strong></p>
            <p className="pl-4">Jeśli kamera obsługuje HTTP snapshot, wpisz URL w Ustawieniach (np. <code className="text-slate-300">http://admin:haslo@IP/cgi-bin/snapshot.cgi</code>).</p>
            <p className="mt-2"><strong className="text-slate-300">Opcja 2 — HLS Live stream (wymaga ffmpeg):</strong></p>
            <ol className="pl-4 space-y-1 list-decimal list-inside">
              <li>Zainstaluj <code className="text-slate-300">ffmpeg</code> (dodaj do PATH)</li>
              <li>W folderze <code className="text-slate-300">parking_os/rtsp-proxy</code> uruchom: <code className="text-slate-300">npm install &amp;&amp; node server.js</code></li>
              <li>W Ustawieniach wpisz HLS URL: <code className="text-slate-300">http://localhost:8888/stream/cam1.m3u8</code></li>
            </ol>
            <p className="mt-2"><strong className="text-slate-300">Opcja 3 — VLC (niezależnie):</strong></p>
            <p className="pl-4">Skopiuj RTSP URL z ustawień i otwórz w VLC: <code className="text-slate-300">rtsp://admin:haslo@IP:554/cam/realmonitor...</code></p>
          </div>
        </div>
      )}

      {fullscreenCam !== null ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <CameraFeed
            name={cameras[fullscreenCam].name}
            camId={cameras[fullscreenCam].camId}
            ptzEnabled={cameras[fullscreenCam].ptzEnabled}
            snapshotUrl={cameras[fullscreenCam].snapshotUrl}
            rtspUrl={cameras[fullscreenCam].rtspUrl}
            hlsUrl={cameras[fullscreenCam].hlsUrl}
            fullscreen={true}
            onFullscreen={() => {}}
            onExitFullscreen={() => setFullscreenCam(null)}
          />
          <div className="flex gap-2 mt-3 flex-shrink-0">
            {cameras.map((cam, i) => (
              <button
                key={i}
                onClick={() => setFullscreenCam(i)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border
                  ${fullscreenCam === i
                    ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                  }`}
              >
                {cam.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-4 min-h-0">
          {cameras.map((cam, i) => (
            <div key={i}>
              <CameraFeed
                name={cam.name}
                camId={cam.camId}
                ptzEnabled={cam.ptzEnabled}
                snapshotUrl={cam.snapshotUrl}
                rtspUrl={cam.rtspUrl}
                hlsUrl={cam.hlsUrl}
                fullscreen={false}
                onFullscreen={() => setFullscreenCam(i)}
                onExitFullscreen={() => setFullscreenCam(null)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
