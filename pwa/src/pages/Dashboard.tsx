import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search as SearchIcon, X, LogOut, Ban } from 'lucide-react';
import {
  getTodayReservations,
  getSpotsAvailable,
  setSpotsAvailable,
  searchPlate,
  CAM_BASE_URL,
  type Reservation,
} from '../supabase';

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'ok',
  cancelled: 'anulowana',
  no_show: 'no-show',
};
const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-teal-500/20 text-teal-400',
  cancelled: 'bg-slate-700 text-slate-400',
  no_show: 'bg-red-500/20 text-red-400',
};

export default function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  // --- Today ---
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [todayDate, setTodayDate] = useState('');
  const [spotsAvail, setSpotsAvail] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [toggling, setToggling] = useState(false);

  // --- Search ---
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Reservation[] | null>(null);
  const [searchBanned, setSearchBanned] = useState(false);
  const [searchNoShow, setSearchNoShow] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTodayDate, setSearchTodayDate] = useState('');

  // --- Camera ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camKey, setCamKey] = useState(0);
  const [camError, setCamError] = useState(false);
  const [camVisible, setCamVisible] = useState(false);

  const load = useCallback(async () => {
    setLoadingData(true);
    try {
      const [res, spots] = await Promise.all([getTodayReservations(), getSpotsAvailable()]);
      setReservations(res.reservations);
      setTodayDate(res.date);
      setSpotsAvail(spots);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Camera HLS setup
  useEffect(() => {
    if (!camVisible) return;
    const video = videoRef.current;
    if (!video) return;
    setCamError(false);
    const hlsUrl = `${CAM_BASE_URL}/stream/cam1.m3u8`;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.load();
      video.play().catch(() => {});
      return;
    }
    // Non-Safari fallback
    let hlsInstance: import('hls.js').default | null = null;
    import('hls.js').then(({ default: Hls }) => {
      if (!Hls.isSupported()) { setCamError(true); return; }
      hlsInstance = new Hls({ liveSyncDurationCount: 2 });
      hlsInstance.loadSource(hlsUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setCamError(true); });
    });
    return () => { hlsInstance?.destroy(); };
  }, [camVisible, camKey]);

  async function handleToggle() {
    setToggling(true);
    try {
      const newVal = !spotsAvail;
      await setSpotsAvailable(newVal);
      setSpotsAvail(newVal);
    } finally {
      setToggling(false);
    }
  }

  async function handleSearch(value: string) {
    const raw = value.toUpperCase().replace(/\s+/g, '');
    setQuery(raw);
    if (raw.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    try {
      const res = await searchPlate(raw);
      setSearchResults(res.reservations);
      setSearchBanned(res.isBanned);
      setSearchNoShow(res.noShowCount);
      setSearchTodayDate(res.todayDate);
    } finally {
      setSearchLoading(false);
    }
  }

  const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
  const weekday = todayDate ? (() => {
    const [dd, mm, yyyy] = todayDate.split('.').map(Number);
    return WEEKDAYS[new Date(yyyy, mm - 1, dd).getDay()];
  })() : '';

  const hasSearchToday = searchResults?.some(r => r.arrival_date === searchTodayDate && r.status === 'confirmed');

  return (
    <div className="min-h-[100dvh] bg-slate-900 text-white pb-8">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div>
          <span className="font-bold text-white">🅿️ Parking MK</span>
          {todayDate && <span className="text-xs text-slate-500 ml-2">{weekday}, {todayDate}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loadingData} className="p-1.5 text-slate-400 active:text-white">
            <RefreshCw size={18} className={loadingData ? 'animate-spin' : ''} />
          </button>
          <button onClick={onSignOut} className="p-1.5 text-slate-500 active:text-red-400">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-5">

        {/* ── Toggle miejsc ── */}
        <button
          onClick={handleToggle}
          disabled={toggling || loadingData}
          className={`w-full flex items-center justify-between rounded-2xl px-5 py-4 border-2 transition-all active:scale-[0.98] disabled:opacity-60 ${
            spotsAvail ? 'bg-green-500/10 border-green-500/50' : 'bg-red-500/10 border-red-500/50'
          }`}
        >
          <div>
            <p className={`text-lg font-bold ${spotsAvail ? 'text-green-400' : 'text-red-400'}`}>
              {spotsAvail ? '✅ Miejsca wolne' : '🚫 Brak miejsc'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{toggling ? 'Zapisuję…' : 'Dotknij aby zmienić'}</p>
          </div>
          <span className="text-3xl">{spotsAvail ? '🟢' : '🔴'}</span>
        </button>

        {/* ── Szukaj tablicy ── */}
        <div>
          <div className="relative">
            <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              placeholder="Szukaj tablicy… np. GDA12345"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-9 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono tracking-wider text-sm"
            />
            {query ? (
              <button onClick={() => { setQuery(''); setSearchResults(null); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                <X size={16} />
              </button>
            ) : searchLoading ? (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            ) : null}
          </div>

          {/* Wyniki szukania */}
          {searchResults !== null && !searchLoading && (
            <div className="mt-2 bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              {/* Status banner */}
              <div className={`px-4 py-3 border-b border-slate-700 flex items-center gap-3 ${
                searchBanned ? 'bg-red-500/10' : hasSearchToday ? 'bg-teal-500/10' : ''
              }`}>
                <span className="text-2xl">{searchBanned ? '⛔' : hasSearchToday ? '✅' : '❌'}</span>
                <div>
                  <p className={`font-bold text-sm ${searchBanned ? 'text-red-400' : hasSearchToday ? 'text-teal-400' : 'text-slate-300'}`}>
                    {searchBanned ? 'ZBANOWANY' : hasSearchToday ? 'Ma rezerwację na dziś' : 'Brak rezerwacji na dziś'}
                  </p>
                  {searchNoShow > 0 && (
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Ban size={10} /> No-show: {searchNoShow}x
                    </p>
                  )}
                </div>
              </div>
              {/* Historia */}
              {searchResults.length === 0 ? (
                <p className="text-center text-slate-500 text-sm py-4">Brak w historii</p>
              ) : (
                <div className="divide-y divide-slate-700/60 max-h-52 overflow-y-auto">
                  {searchResults.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1 font-mono font-bold text-white text-sm tracking-wider">{r.registration}</span>
                      <span className="text-xs text-slate-500">{r.arrival_date}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? 'bg-slate-700 text-slate-400'}`}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Rezerwacje na dziś ── */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Rezerwacje na dziś {!loadingData && `(${reservations.length})`}
          </p>
          {loadingData ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-7 h-7 border-4 border-teal-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : reservations.length === 0 ? (
            <p className="text-center text-slate-600 py-6 text-sm">Brak rezerwacji na dziś</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {reservations.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50">
                  <span className="text-slate-600 text-xs w-5 text-right flex-shrink-0">{i + 1}.</span>
                  <span className="flex-1 font-mono font-bold text-white tracking-wider">{r.registration}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-400 flex-shrink-0">✓ ok</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Kamera ── */}
        <div>
          <button
            onClick={() => setCamVisible(v => !v)}
            className="w-full text-left text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2"
          >
            <span>📷 Kamera 1</span>
            <span className="text-slate-600">{camVisible ? '▲ ukryj' : '▼ pokaż'}</span>
          </button>

          {camVisible && (
            <div className="relative bg-slate-800 rounded-2xl overflow-hidden border border-slate-700" style={{ aspectRatio: '16/9' }}>
              {!camError ? (
                <video
                  key={camKey}
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  controls
                  className="w-full h-full object-contain"
                  onError={() => setCamError(true)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
                  <span className="text-3xl opacity-40">📷</span>
                  <p className="text-sm">Brak sygnału kamery</p>
                  <button
                    onClick={() => { setCamKey(k => k + 1); setCamError(false); }}
                    className="text-xs bg-slate-700 px-4 py-2 rounded-xl"
                  >
                    Odśwież
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
