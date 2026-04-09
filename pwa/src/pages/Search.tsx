import { useState, useRef } from 'react';
import { Search as SearchIcon, X, Ban } from 'lucide-react';
import { searchPlate, type Reservation } from '../supabase';

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'potwierdzona',
  cancelled: 'anulowana',
  no_show: 'no-show',
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-teal-500/15 text-teal-400',
  cancelled:  'bg-slate-700/60 text-slate-400',
  no_show:    'bg-red-500/15 text-red-400',
};

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Reservation[] | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [noShowCount, setNoShowCount] = useState(0);
  const [todayDate, setTodayDate] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSearch(value: string) {
    const q = value.trim().toUpperCase().replace(/\s+/g, '');
    setQuery(value.toUpperCase());
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await searchPlate(q);
      setResults(res.reservations);
      setIsBanned(res.isBanned);
      setNoShowCount(res.noShowCount);
      setTodayDate(res.todayDate);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setQuery('');
    setResults(null);
    setIsBanned(false);
    setNoShowCount(0);
    inputRef.current?.focus();
  }

  const hasResult = results !== null;
  const hasToday = results?.some(r => r.arrival_date === todayDate && r.status === 'confirmed');

  return (
    <div className="px-4 pt-5 pb-4">
      <h2 className="text-xl font-bold text-white mb-4">Weryfikacja tablicy</h2>

      {/* Search input */}
      <div className="relative mb-4">
        <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          placeholder="Wpisz tablicę np. GDA12345"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded-2xl pl-11 pr-11 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono text-base tracking-wider"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 active:text-white"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-7 h-7 border-4 border-teal-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && hasResult && (
        <>
          {/* Status banner */}
          <div className={`rounded-2xl px-4 py-4 mb-4 border-2 ${
            isBanned
              ? 'bg-red-500/10 border-red-500/40'
              : hasToday
                ? 'bg-teal-500/10 border-teal-500/40'
                : 'bg-slate-800 border-slate-600'
          }`}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">
                {isBanned ? '⛔' : hasToday ? '✅' : '❌'}
              </span>
              <div>
                <p className={`font-bold text-base ${
                  isBanned ? 'text-red-400' : hasToday ? 'text-teal-400' : 'text-slate-300'
                }`}>
                  {isBanned
                    ? 'ZBANOWANY'
                    : hasToday
                      ? 'Ma rezerwację na dziś'
                      : 'Brak rezerwacji na dziś'}
                </p>
                {noShowCount > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <Ban size={11} /> No-show: {noShowCount}x
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* History */}
          {results.length === 0 ? (
            <p className="text-center text-slate-500 py-6">Brak rezerwacji w historii</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Historia ({results.length})
              </p>
              <div className="flex flex-col gap-2">
                {results.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-slate-800 rounded-2xl px-4 py-3 border border-slate-700/60">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-white tracking-wider">{r.registration}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{r.arrival_date}</p>
                    </div>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${STATUS_COLORS[r.status] ?? 'bg-slate-700 text-slate-400'}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!loading && !hasResult && !query && (
        <div className="text-center py-16 text-slate-600">
          <SearchIcon size={48} className="mx-auto mb-3 opacity-30" />
          <p>Wpisz numer rejestracyjny</p>
        </div>
      )}
    </div>
  );
}
