import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { Play, Square, Car, ArrowDownCircle, ArrowUpCircle, Activity, AlertTriangle, SlidersHorizontal, X, Check, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { getStore } from '../../lib/store';
import RTSPPlayer from './RTSPPlayer';
import { logAction } from '../../lib/audit';

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

// ROI jako ułamki klatki 0.0–1.0
export interface Roi { x1: number; y1: number; x2: number; y2: number }
const DEFAULT_ROI: Roi  = { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.65 };
const DEFAULT_LINE       = 0.6; // pozycja linii wewnątrz ROI (0=góra, 1=dół)

// ── Wizualny edytor ROI ───────────────────────────────────────────────────────
type DragMode =
  | { type: 'move'; startRoi: Roi; startX: number; startY: number }
  | { type: 'corner'; corner: 'tl'|'tr'|'bl'|'br'; startRoi: Roi; startX: number; startY: number }
  | { type: 'line'; startLine: number; startY: number; roiY1: number; roiH: number }
  | { type: 'pan'; startPanX: number; startPanY: number; startCX: number; startCY: number; cW: number; cH: number }
  | null;

function RoiEditor({
  hlsUrl, snapshotUrl,
  roi, onRoiChange,
  line, onLineChange,
  onSave, onCancel,
}: {
  hlsUrl: string | null;
  snapshotUrl: string | null;
  roi: Roi; onRoiChange: (r: Roi) => void;
  line: number; onLineChange: (l: number) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const dragRef      = useRef<DragMode>(null);
  const viewRef      = useRef({ zoom: 1, panX: 0, panY: 0 });
  const W = 640; const H = 360;

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Trzymaj ref zsynchronizowany (potrzebne w passive wheel handler)
  useEffect(() => { viewRef.current = { zoom, panX, panY }; }, [zoom, panX, panY]);

  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Wheel — passive:false żeby można było e.preventDefault()
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom: z, panX: px, panY: py } = viewRef.current;
      const rect = el.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top)  / rect.height;
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      const nz = cl(z * factor, 1, 8);
      const npx = cl(px + mx * (1/z - 1/nz), 0, Math.max(0, 1 - 1/nz));
      const npy = cl(py + my * (1/z - 1/nz), 0, Math.max(0, 1 - 1/nz));
      setZoom(nz); setPanX(npx); setPanY(npy);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Coords myszy w SVG-world — getScreenCTM() uwzględnia CSS transform/sizing
  function svgCoords(e: React.MouseEvent) {
    const svg = svgRef.current!;
    const pt  = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }

  function toSvg(frac: number, axis: 'x'|'y') { return frac * (axis === 'x' ? W : H); }
  function toFrac(px: number, axis: 'x'|'y')  { return cl(px / (axis === 'x' ? W : H), 0, 1); }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    e.preventDefault();
    const { x, y } = svgCoords(e);
    // HIT w SVG-world: stały rozmiar na ekranie ~12px
    const HIT = 12 / zoom;
    const rx1 = toSvg(roi.x1,'x'), ry1 = toSvg(roi.y1,'y');
    const rx2 = toSvg(roi.x2,'x'), ry2 = toSvg(roi.y2,'y');
    const lineAbsY = ry1 + line * (ry2 - ry1);

    for (const [corner, cx, cy] of [['tl',rx1,ry1],['tr',rx2,ry1],['bl',rx1,ry2],['br',rx2,ry2]] as const) {
      if (Math.hypot(x - cx, y - cy) < HIT * 1.5) {
        dragRef.current = { type: 'corner', corner, startRoi: {...roi}, startX: x, startY: y };
        return;
      }
    }
    if (Math.abs(y - lineAbsY) < HIT && x > rx1 - HIT && x < rx2 + HIT) {
      dragRef.current = { type: 'line', startLine: line, startY: y, roiY1: ry1, roiH: ry2-ry1 };
      return;
    }
    if (x > rx1 && x < rx2 && y > ry1 && y < ry2) {
      dragRef.current = { type: 'move', startRoi: {...roi}, startX: x, startY: y };
      return;
    }
    // Puste tło → pan
    const cr = containerRef.current!.getBoundingClientRect();
    dragRef.current = { type: 'pan', startPanX: panX, startPanY: panY,
      startCX: e.clientX, startCY: e.clientY, cW: cr.width, cH: cr.height };
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const dm = dragRef.current;
    if (!dm) return;

    if (dm.type === 'pan') {
      const maxP = Math.max(0, 1 - 1/zoom);
      setPanX(cl(dm.startPanX - (e.clientX - dm.startCX) / (dm.cW * zoom), 0, maxP));
      setPanY(cl(dm.startPanY - (e.clientY - dm.startCY) / (dm.cH * zoom), 0, maxP));
      return;
    }

    const { x, y } = svgCoords(e);
    const MIN = 0.05;
    if (dm.type === 'move') {
      const dx = toFrac(x - dm.startX,'x'), dy = toFrac(y - dm.startY,'y');
      const w = dm.startRoi.x2 - dm.startRoi.x1, h = dm.startRoi.y2 - dm.startRoi.y1;
      onRoiChange({ x1: cl(dm.startRoi.x1+dx,0,1-w), y1: cl(dm.startRoi.y1+dy,0,1-h),
                    x2: cl(dm.startRoi.x1+dx,0,1-w)+w, y2: cl(dm.startRoi.y1+dy,0,1-h)+h });
    } else if (dm.type === 'corner') {
      const fx = toFrac(x,'x'), fy = toFrac(y,'y');
      let r = {...dm.startRoi};
      if (dm.corner==='tl'){ r.x1=cl(fx,0,r.x2-MIN); r.y1=cl(fy,0,r.y2-MIN); }
      if (dm.corner==='tr'){ r.x2=cl(fx,r.x1+MIN,1); r.y1=cl(fy,0,r.y2-MIN); }
      if (dm.corner==='bl'){ r.x1=cl(fx,0,r.x2-MIN); r.y2=cl(fy,r.y1+MIN,1); }
      if (dm.corner==='br'){ r.x2=cl(fx,r.x1+MIN,1); r.y2=cl(fy,r.y1+MIN,1); }
      onRoiChange(r);
    } else if (dm.type === 'line') {
      onLineChange(cl(dm.startLine + (y - dm.startY) / dm.roiH, 0.05, 0.95));
    }
  }

  function onMouseUp() { dragRef.current = null; }

  function applyZoom(factor: number) {
    const nz = cl(zoom * factor, 1, 8);
    const maxP = Math.max(0, 1 - 1/nz);
    // zoom do środka aktualnego widoku
    setPanX(cl(panX + 0.5*(1/zoom - 1/nz), 0, maxP));
    setPanY(cl(panY + 0.5*(1/zoom - 1/nz), 0, maxP));
    setZoom(nz);
  }
  function resetZoom() { setZoom(1); setPanX(0); setPanY(0); }

  const rx1 = toSvg(roi.x1,'x'), ry1 = toSvg(roi.y1,'y');
  const rx2 = toSvg(roi.x2,'x'), ry2 = toSvg(roi.y2,'y');
  const roiW = rx2-rx1, roiH = ry2-ry1;
  const lineY = ry1 + line * roiH;
  // Uchwyty skalowane odwrotnie do zoom → stały rozmiar na ekranie
  const hr = 6/zoom, hs = 12/zoom, sw = 2/zoom;

  const isPanning = dragRef.current?.type === 'pan';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <span className="font-semibold text-sm text-[var(--color-text)]">Edycja obszaru detekcji — CAM 1</span>
          <button onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>

        {/* Canvas — overflow:hidden, wewnętrzny div CSS-skalowany (obraz + overlay razem) */}
        <div ref={containerRef} className="relative bg-black overflow-hidden" style={{ aspectRatio: '16/9' }}>
          {/* Skalowany wewnętrzny kontener — CSS zoom/pan */}
          <div style={{
            position: 'absolute',
            width:  `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            left:   `${-panX * zoom * 100}%`,
            top:    `${-panY * zoom * 100}%`,
          }}>
            {/* Tło: obraz/wideo */}
            {hlsUrl
              ? <div className="absolute inset-0 pointer-events-none"><RTSPPlayer streamUrl={hlsUrl} fill /></div>
              : snapshotUrl
                ? <SnapshotBg url={snapshotUrl} />
                : <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                    Brak podglądu — ustaw HLS lub Snapshot URL w Ustawieniach
                  </div>
            }
            {/* SVG overlay — pełny rozmiar wewnętrznego diva */}
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid slice"
              className="absolute inset-0 w-full h-full select-none"
              style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            >
              {/* Ciemna maska poza ROI */}
              <path fillRule="evenodd" fill="rgba(0,0,0,0.55)"
                d={`M0 0 H${W} V${H} H0 Z M${rx1} ${ry1} H${rx2} V${ry2} H${rx1} Z`} />
              {/* ROI ramka */}
              <rect x={rx1} y={ry1} width={roiW} height={roiH}
                fill="none" stroke="#22d3ee" strokeWidth={sw} strokeDasharray={`${6/zoom} ${3/zoom}`} />
              {/* Linia detekcji */}
              <line x1={rx1} y1={lineY} x2={rx2} y2={lineY} stroke="#f59e0b" strokeWidth={sw*1.25} />
              <text x={(rx1+rx2)/2} y={lineY - 5/zoom}
                fill="#f59e0b" fontSize={11/zoom} textAnchor="middle" fontFamily="sans-serif">linia detekcji</text>
              {/* Uchwyt linii */}
              <circle cx={(rx1+rx2)/2} cy={lineY} r={hr}
                fill="#f59e0b" stroke="white" strokeWidth={1.5/zoom} style={{ cursor: 'ns-resize' }} />
              {/* Narożniki ROI */}
              {([['tl',rx1,ry1],['tr',rx2,ry1],['bl',rx1,ry2],['br',rx2,ry2]] as const).map(([,cx,cy]) => (
                <rect key={`${cx}-${cy}`} x={cx-hs/2} y={cy-hs/2} width={hs} height={hs}
                  fill="#22d3ee" stroke="white" strokeWidth={1.5/zoom} rx={2/zoom}
                  style={{ cursor: 'nwse-resize' }} />
              ))}
              <text x={rx1+4/zoom} y={ry1-4/zoom}
                fill="#22d3ee" fontSize={10/zoom} fontFamily="sans-serif">obszar nadzoru</text>
            </svg>
          </div>

          {/* Kontrolki zoom */}
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 rounded-lg px-1.5 py-1 backdrop-blur-sm z-10">
            <button onClick={() => applyZoom(1/1.5)} title="Oddal"
              className="text-slate-300 hover:text-white p-0.5 transition-colors"><ZoomOut size={14} /></button>
            <button onClick={resetZoom} title="Resetuj zoom"
              className="text-slate-400 hover:text-white text-[10px] font-mono px-1 min-w-[36px] text-center transition-colors">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => applyZoom(1.5)} title="Przybliż"
              className="text-slate-300 hover:text-white p-0.5 transition-colors"><ZoomIn size={14} /></button>
            {zoom > 1 && (
              <button onClick={resetZoom} title="Pełny widok"
                className="text-slate-400 hover:text-white p-0.5 ml-0.5 transition-colors"><Maximize2 size={12} /></button>
            )}
          </div>
        </div>

        {/* Legenda + przyciski */}
        <div className="px-4 py-3 flex items-center justify-between border-t border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)] space-y-0.5">
            <div><span className="text-cyan-400">■</span> Przeciągnij narożniki — zmień obszar nadzoru</div>
            <div><span className="text-amber-400">●</span> Przeciągnij linię — kierunek wjazd/wyjazd</div>
            <div className="text-slate-500">Scroll = lupa · przeciągnij tło = przesuń widok</div>
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
              Anuluj
            </button>
            <button onClick={onSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--color-accent-bg)] text-[var(--color-accent)] border border-[var(--color-accent-border)] hover:opacity-90 transition-colors">
              <Check size={13} /> Zapisz
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Fallback: snapshot polling gdy brak HLS
function SnapshotBg({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const cancelRef = useRef(false);
  useEffect(() => {
    cancelRef.current = false;
    async function loop() {
      while (!cancelRef.current) {
        try {
          const data = await invoke<string>('fetch_snapshot', { url });
          if (!cancelRef.current) setSrc(data);
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    loop();
    return () => { cancelRef.current = true; };
  }, [url]);
  return src
    ? <img src={src} className="w-full h-full object-cover" alt="snapshot" style={{ objectFit: 'cover' }} />
    : <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">Łączenie z kamerą...</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
interface DetectorPanelProps {
  cam1RtspUrl: string | null;
  cam1SnapshotUrl?: string | null;
  cam1HlsUrl?: string | null;
  onRoiUpdate?: (roi: Roi, line: number) => void;
  /** Tryb wbudowany w kartę kamery — renderuje kompaktowy pasek zamiast pełnego bloku */
  compact?: boolean;
}

export default function DetectorPanel({ cam1RtspUrl, cam1SnapshotUrl, cam1HlsUrl, onRoiUpdate, compact = false }: DetectorPanelProps) {
  const [active, setActive]       = useState(false);
  const [status, setStatus]       = useState<DetectorStatus | null>(null);
  const [starting, setStarting]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // ROI state — ładowane ze store przy montowaniu
  const [roi, setRoi]       = useState<Roi>(DEFAULT_ROI);
  const [linePos, setLinePos] = useState(DEFAULT_LINE);
  // Stan tymczasowy podczas edycji (żeby nie zapisywać od razu)
  const [editRoi, setEditRoi]     = useState<Roi>(DEFAULT_ROI);
  const [editLine, setEditLine]   = useState(DEFAULT_LINE);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Załaduj ROI ze store
  useEffect(() => {
    getStore().then(async s => {
      const savedRoi  = await s.get<string>('detector_roi');
      const savedLine = await s.get<number>('detector_line');
      let loadedRoi  = DEFAULT_ROI;
      let loadedLine = DEFAULT_LINE;
      if (savedRoi) {
        const [x1, y1, x2, y2] = savedRoi.split(',').map(Number);
        if ([x1,y1,x2,y2].every(n => !isNaN(n) && n >= 0 && n <= 1) && x1 < x2 && y1 < y2) {
          loadedRoi = { x1, y1, x2, y2 }; setRoi(loadedRoi);
        }
      }
      if (savedLine !== null && savedLine !== undefined) { loadedLine = savedLine as number; setLinePos(loadedLine); }
      onRoiUpdate?.(loadedRoi, loadedLine);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sprawdź czy detektor już działa (po zamontowaniu)
  useEffect(() => {
    invoke<boolean>('detector_is_running').then(running => {
      if (running) { setActive(true); startPolling(); }
    }).catch(() => {});
    return () => stopPolling();
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${DETECTOR_PORT}/status`);
      if (res.ok) { setStatus(await res.json()); setError(null); }
    } catch { /* detektor jeszcze nie wystartował lub padł */ }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL);
    fetchStatus();
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const handleStart = async () => {
    if (!cam1RtspUrl) { setError('Brak RTSP URL kamery CAM 1. Ustaw go w Ustawieniach.'); return; }
    setStarting(true); setError(null);
    try {
      const dataDir = await appDataDir();
      const dbPath  = dataDir.replace(/\\/g, '/') + 'detection.db';
      const roiStr  = `${roi.x1},${roi.y1},${roi.x2},${roi.y2}`;
      await invoke('spawn_detector', { rtspUrl: cam1RtspUrl, dbPath, roi: roiStr, line: linePos });
      await logAction('detector_start', { rtspUrl: cam1RtspUrl });
      setActive(true);
      setTimeout(() => { startPolling(); setStarting(false); }, 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try { await invoke('stop_detector'); } catch { /* ignore */ }
    await logAction('detector_stop');
    setActive(false); setStatus(null); stopPolling();
  };

  const openEditor = () => {
    setEditRoi({ ...roi }); setEditLine(linePos); setShowEditor(true);
  };

  const saveRoi = async () => {
    setRoi(editRoi); setLinePos(editLine); setShowEditor(false);
    try {
      const s = await getStore();
      await s.set('detector_roi',  `${editRoi.x1},${editRoi.y1},${editRoi.x2},${editRoi.y2}`);
      await s.set('detector_line', editLine);
      await s.save();
      setRoi(editRoi); setLinePos(editLine);
      onRoiUpdate?.(editRoi, editLine);
      await logAction('roi_saved', { roi: editRoi, line: editLine });
    } catch { /* ignore */ }
    setShowEditor(false);
  };

  const onParking = status?.on_parking ?? 0;
  const todayIn   = status?.today_in   ?? 0;
  const todayOut  = status?.today_out  ?? 0;

  return (
    <>
      {showEditor && (
        <RoiEditor
          hlsUrl={cam1HlsUrl ?? null}
          snapshotUrl={cam1SnapshotUrl ?? null}
          roi={editRoi}    onRoiChange={setEditRoi}
          line={editLine}  onLineChange={setEditLine}
          onSave={saveRoi} onCancel={() => setShowEditor(false)}
        />
      )}

      {compact ? (
        /* ── Tryb kompaktowy — pasek wbudowany w kartę CAM 1 ── */
        <div className="flex items-center gap-2 px-2 py-1.5 bg-black/70 backdrop-blur-sm border-t border-white/10 text-xs flex-wrap">
          {/* Status */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {active && status && !status.error ? (
              <span className="flex items-center gap-1 text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                {status.fps}fps
              </span>
            ) : active && status?.error ? (
              <span className="text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> Błąd</span>
            ) : active ? (
              <span className="text-yellow-400">⏳</span>
            ) : (
              <span className="text-slate-500">Detekcja</span>
            )}
          </div>

          {/* Liczniki */}
          <div className="flex items-center gap-2 text-slate-300 flex-shrink-0">
            <span className="flex items-center gap-0.5 text-green-400"><ArrowDownCircle size={11} />{todayIn}</span>
            <span className="flex items-center gap-0.5 text-[var(--color-accent)]"><Car size={11} />{onParking}</span>
            <span className="flex items-center gap-0.5 text-orange-400"><ArrowUpCircle size={11} />{todayOut}</span>
          </div>

          {/* Ostatnie zdarzenie */}
          {status?.last_event && (
            <span className="text-slate-500 text-[10px] flex-shrink-0">
              {status.last_event.direction === 'in' ? '↓' : '↑'} {new Date(status.last_event.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Przyciski */}
          <button onClick={openEditor} disabled={active} title={active ? 'Zatrzymaj detektor aby edytować ROI' : 'Edytuj ROI'}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors flex-shrink-0 ${active ? 'text-slate-600 border-white/5 cursor-not-allowed' : 'text-slate-400 hover:text-[var(--color-accent)] border-white/10 hover:border-[var(--color-accent-border)]'}`}>
            <SlidersHorizontal size={10} /> ROI
          </button>
          {!active ? (
            <button onClick={handleStart} disabled={starting || !cam1RtspUrl}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-accent-bg)] text-[var(--color-accent)] border border-[var(--color-accent-border)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
              {starting ? <span className="w-2.5 h-2.5 border border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" /> : <Play size={10} />}
              {starting ? 'Start...' : 'Start'}
            </button>
          ) : (
            <button onClick={handleStop}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors flex-shrink-0">
              <Square size={10} /> Stop
            </button>
          )}
        </div>
      ) : (
        /* ── Tryb pełny — blok nad kamerami ── */
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 mb-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-[var(--color-accent)]" />
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
                <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">Uruchamianie...</span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={openEditor} disabled={active} title={active ? 'Zatrzymaj detektor aby edytować ROI' : 'Edytuj obszar detekcji'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${active ? 'border-[var(--color-border)] text-slate-600 cursor-not-allowed' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-accent)]'}`}>
                <SlidersHorizontal size={12} /> ROI
              </button>
              {!active ? (
                <button onClick={handleStart} disabled={starting || !cam1RtspUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--color-accent-bg)] text-[var(--color-accent)] border border-[var(--color-accent-border)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {starting ? <span className="w-3 h-3 border border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" /> : <Play size={12} />}
                  {starting ? 'Uruchamianie...' : 'Uruchom detektor'}
                </button>
              ) : (
                <button onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors">
                  <Square size={12} /> Zatrzymaj
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
              <Car size={18} className="mx-auto mb-1 text-[var(--color-accent)]" />
              <div className={`text-2xl font-bold ${onParking > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>{onParking}</div>
              <div className="text-xs text-[var(--color-text-muted)]">Na parkingu</div>
            </div>
            <div className="bg-[var(--color-bg)] rounded-lg p-3 text-center border border-[var(--color-border)]">
              <ArrowUpCircle size={18} className="mx-auto mb-1 text-orange-400" />
              <div className="text-2xl font-bold text-[var(--color-text)]">{todayOut}</div>
              <div className="text-xs text-[var(--color-text-muted)]">Wyjazdy dziś</div>
            </div>
          </div>

          {status?.last_event && (
            <div className="mt-3 text-xs text-[var(--color-text-muted)] text-center">
              Ostatnie: {status.last_event.direction === 'in' ? '↓ Wjazd' : '↑ Wyjazd'}
              {' · '}{new Date(status.last_event.ts).toLocaleTimeString('pl-PL')}
            </div>
          )}
          {error && (
            <div className="mt-2 text-xs text-red-400 bg-red-400/10 rounded px-3 py-2 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
          {!active && !error && (
            <p className="text-xs text-[var(--color-text-muted)] text-center mt-2">
              {cam1RtspUrl
                ? 'Uruchom detektor aby zliczać pojazdy przez bramę (YOLO v8n)'
                : 'Ustaw RTSP URL dla CAM 1 w Ustawieniach aby włączyć detekcję'}
            </p>
          )}
        </div>
      )}
    </>
  );
}
