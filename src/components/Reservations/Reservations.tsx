import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X, Check,
  History, Ban, Calendar, AlertTriangle, ShieldOff, ShieldCheck, RotateCcw,
  ScrollText, RefreshCw, Search
} from 'lucide-react';
import {
  getReservationCountByMonth, getReservationsForDate,
  addReservation, updateReservation, deleteReservation,
  getFullHistory, setReservationStatus, markAsNoShow,
  getBannedVehicles, banVehicle, unbanVehicle, resetNoShowCount, deleteFromBanList,
  logEvent, getEvents,
  Reservation, NoShowBan, ParkingEvent, fromDbDate, isConfigured, NO_SHOW_BAN_THRESHOLD
} from '../../lib/supabase';
import { Button, Input, Modal, Spinner } from '../shared/UI';

// ---------------------------------------------------------------------------
// Pogoda — Open-Meteo (free, no API key)
// ---------------------------------------------------------------------------
const LAT = 54.3404;
const LON = 18.8865;

interface WeatherDay { code: number; maxTemp: number }

function weatherEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 49) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

async function fetchWeatherForMonth(year: number, month: number): Promise<Record<string, WeatherDay>> {
  const mm = String(month).padStart(2, '0');
  const daysInM = new Date(year, month, 0).getDate();
  const startDate = `${year}-${mm}-01`;
  const endDate = `${year}-${mm}-${String(daysInM).padStart(2, '0')}`;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Wybierz endpoint: archiwum dla przeszłości, forecast dla przyszłości/teraźniejszości
  let url: string;
  if (endDate < todayStr) {
    // cały miesiąc w przeszłości → archiwum
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${startDate}&end_date=${endDate}&daily=weather_code,temperature_2m_max&timezone=Europe%2FWarsaw`;
  } else {
    // przyszłość lub bieżący miesiąc → forecast z past_days
    const pastDays = Math.max(0, Math.floor((today.getTime() - new Date(startDate).getTime()) / 86400000) + 1);
    const futureDays = Math.max(1, Math.floor((new Date(endDate).getTime() - today.getTime()) / 86400000) + 1);
    url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weather_code,temperature_2m_max&timezone=Europe%2FWarsaw&past_days=${Math.min(pastDays, 92)}&forecast_days=${Math.min(futureDays, 16)}`;
  }

  const res = await fetch(url);
  if (!res.ok) return {};
  const json = await res.json();
  const dates: string[] = json.daily?.time ?? [];
  const codes: number[] = json.daily?.weather_code ?? [];
  const temps: number[] = json.daily?.temperature_2m_max ?? [];
  const result: Record<string, WeatherDay> = {};
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= startDate && dates[i] <= endDate) {
      result[dates[i]] = { code: codes[i], maxTemp: Math.round(temps[i]) };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Log event labels
// ---------------------------------------------------------------------------
const EVENT_LABELS: Record<string, string> = {
  reservation_added: '➕ Dodano rezerwację',
  reservation_updated: '✏️ Edytowano rezerwację',
  reservation_deleted: '🗑️ Usunięto rezerwację',
  reservation_no_show: '⚠️ No-show',
  reservation_restored: '↩️ Przywrócono status',
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const day = new Date(year, month - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

const DAYS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

type Tab = 'calendar' | 'history' | 'blacklist' | 'logs';

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'potwierdzona',
  cancelled: 'anulowana',
  no_show: 'nie stawił się',
};
const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-teal-500/20 text-teal-400',
  cancelled: 'bg-red-500/20 text-red-400',
  no_show: 'bg-orange-500/20 text-orange-400',
};

interface ReservationFormData {
  arrival_date: string;
  registration: string;
}

interface ReservationsProps {
  onBadgeChange?: (count: number) => void;
}

export default function Reservations({ onBadgeChange }: ReservationsProps) {
  const today = new Date();
  const [tab, setTab] = useState<Tab>('calendar');

  // --- Calendar state ---
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayReservations, setDayReservations] = useState<Reservation[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);

  // --- History state ---
  const [history, setHistory] = useState<Reservation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>('all');

  // --- Blacklist state ---
  const [bans, setBans] = useState<NoShowBan[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banForm, setBanForm] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banFormOpen, setBanFormOpen] = useState(false);
  const [banSaving, setBanSaving] = useState(false);

  // --- Modal state ---
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReservationFormData>({ arrival_date: '', registration: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Delete confirm ---
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Config check ---
  const [notConfigured, setNotConfigured] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // --- Weather ---
  const [weatherData, setWeatherData] = useState<Record<string, WeatherDay>>({});
  const weatherCache = useRef<Record<string, Record<string, WeatherDay>>>({});

  // --- Quick search ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Reservation[] | null>(null);
  const [searchBanned, setSearchBanned] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  // --- Event logs ---
  const [events, setEvents] = useState<ParkingEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    isConfigured().then(ok => setNotConfigured(!ok));
  }, []);

  // Pobierz pogodę dla wyświetlanego miesiąca (cache)
  useEffect(() => {
    const cacheKey = `${year}-${month}`;
    if (weatherCache.current[cacheKey]) {
      setWeatherData(weatherCache.current[cacheKey]);
      return;
    }
    fetchWeatherForMonth(year, month).then(data => {
      weatherCache.current[cacheKey] = data;
      setWeatherData(data);
    }).catch(() => setWeatherData({}));
  }, [year, month]);

  // Load month counts
  const loadMonthCounts = useCallback(async () => {
    if (notConfigured) return;
    setMonthLoading(true);
    try {
      const data = await getReservationCountByMonth(year, month);
      setCounts(data);
      const total = Object.values(data).reduce((s, c) => s + c, 0);
      onBadgeChange?.(total);
    } catch (err: unknown) {
      setCounts({});
      setConfigError(err instanceof Error ? err.message : 'Błąd połączenia z bazą danych');
    } finally {
      setMonthLoading(false);
    }
  }, [year, month, onBadgeChange, notConfigured]);

  useEffect(() => { loadMonthCounts(); }, [loadMonthCounts]);

  // Load history when tab switches
  const loadHistory = useCallback(async () => {
    if (notConfigured) return;
    setHistoryLoading(true);
    try {
      const data = await getFullHistory(historyFilter);
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFilter, notConfigured]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  // Load blacklist when tab switches
  const loadBans = useCallback(async () => {
    if (notConfigured) return;
    setBansLoading(true);
    try {
      const data = await getBannedVehicles();
      setBans(data);
    } catch {
      setBans([]);
    } finally {
      setBansLoading(false);
    }
  }, [notConfigured]);

  useEffect(() => {
    if (tab === 'blacklist' || tab === 'calendar') loadBans();
  }, [tab, loadBans]);

  // Load event logs when tab switches
  const loadEvents = useCallback(async () => {
    if (notConfigured) return;
    setEventsLoading(true);
    try {
      const data = await getEvents(100);
      setEvents(data);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [notConfigured]);

  useEffect(() => {
    if (tab === 'logs') loadEvents();
  }, [tab, loadEvents]);

  // --- Calendar helpers ---
  const selectDate = async (date: string) => {
    setSelectedDate(date);
    setDayLoading(true);
    try {
      const data = await getReservationsForDate(date);
      setDayReservations(data);
    } catch {
      setDayReservations([]);
    } finally {
      setDayLoading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ arrival_date: selectedDate ?? today.toISOString().split('T')[0], registration: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (r: Reservation) => {
    setEditingId(r.id);
    setForm({ arrival_date: fromDbDate(r.arrival_date), registration: r.registration });
    setFormError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.arrival_date || !form.registration.trim()) {
      setFormError('Uzupełnij wszystkie pola.');
      return;
    }
    const reg = form.registration.trim().toUpperCase();
    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await updateReservation(editingId, form.arrival_date, reg);
        await logEvent('reservation_updated', { date: form.arrival_date, registration: reg });
      } else {
        await addReservation(form.arrival_date, reg);
        await logEvent('reservation_added', { date: form.arrival_date, registration: reg });
      }
      setModalOpen(false);
      if (selectedDate === form.arrival_date) await selectDate(form.arrival_date);
      await loadMonthCounts();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteReservation(deleteId);
      await logEvent('reservation_deleted', { id: deleteId });
      setDeleteId(null);
      if (selectedDate) await selectDate(selectedDate);
      await loadMonthCounts();
      if (tab === 'history') await loadHistory();
    } catch {
      /* ignore */
    } finally {
      setDeleting(false);
    }
  };

  // --- History actions ---
  const handleMarkNoShow = async (r: Reservation) => {
    try {
      const { nowBanned } = await markAsNoShow(r.id, r.registration);
      await logEvent('reservation_no_show', { registration: r.registration, date: r.arrival_date, now_banned: nowBanned });
      await loadHistory();
      await loadBans();
      if (nowBanned) alert(`🚫 ${r.registration} został automatycznie zablokowany po ${NO_SHOW_BAN_THRESHOLD} niestawieniach.`);
    } catch (err: unknown) {
      alert('Błąd: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRestoreStatus = async (r: Reservation) => {
    try {
      await setReservationStatus(r.id, 'confirmed');
      await logEvent('reservation_restored', { registration: r.registration, date: r.arrival_date });
      await loadHistory();
    } catch (err: unknown) {
      alert('Błąd: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // --- Blacklist actions ---
  const handleManualBan = async () => {
    if (!banForm.trim()) return;
    setBanSaving(true);
    try {
      await banVehicle(banForm.trim(), banReason.trim() || undefined);
      setBanForm('');
      setBanReason('');
      setBanFormOpen(false);
      await loadBans();
    } catch (err: unknown) {
      alert('Błąd: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBanSaving(false);
    }
  };

  const handleUnban = async (reg: string) => {
    try {
      await unbanVehicle(reg);
      await loadBans();
    } catch (err: unknown) {
      alert('Błąd: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleResetCount = async (reg: string) => {
    try {
      await resetNoShowCount(reg);
      await loadBans();
    } catch (err: unknown) {
      alert('Błąd: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDeleteBan = async (reg: string) => {
    try {
      await deleteFromBanList(reg);
      await loadBans();
    } catch (err: unknown) {
      alert('Błąd: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleQuickSearch = async (query: string) => {
    const reg = query.trim().toUpperCase().replace(/\s+/g, '');
    if (!reg || reg.length < 2) { setSearchResults(null); setSearchBanned(false); return; }
    setSearchLoading(true);
    try {
      const [historyData, bansData] = await Promise.all([
        getFullHistory('all'),
        getBannedVehicles(),
      ]);
      const matches = historyData.filter(r => r.registration.includes(reg));
      const banned = bansData.some(b => b.registration === reg && b.is_banned);
      setSearchResults(matches);
      setSearchBanned(banned);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const clearSearch = () => { setSearchQuery(''); setSearchResults(null); setSearchBanned(false); };

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };

  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);
  const todayStr = today.toISOString().split('T')[0];
  const bannedCount = bans.filter(b => b.is_banned).length;

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0 gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)] flex-shrink-0">Rezerwacje</h1>

        {/* Quick search — widoczny tylko w zakładce Kalendarz */}
        {tab === 'calendar' && (
          <div className="flex-1 max-w-xs relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Szukaj tablicy… (np. GDA123)"
              value={searchQuery}
              onChange={e => {
                const v = e.target.value.toUpperCase().replace(/\s+/g, '');
                setSearchQuery(v);
                if (v.length >= 2) handleQuickSearch(v);
                else { setSearchResults(null); setSearchBanned(false); }
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-8 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono tracking-wider"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-shrink-0">
          {tab === 'calendar' && (
            <Button variant="primary" onClick={openAdd} size="sm">
              <Plus size={16} /> Dodaj rezerwację
            </Button>
          )}
          {tab === 'blacklist' && (
            <Button variant="primary" onClick={() => setBanFormOpen(true)} size="sm">
              <Ban size={16} /> Zablokuj pojazd
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-900 rounded-xl p-1 w-fit flex-shrink-0">
        <button
          onClick={() => setTab('calendar')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'calendar' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <Calendar size={14} /> Kalendarz
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'history' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <History size={14} /> Historia
        </button>
        <button
          onClick={() => { setTab('blacklist'); }}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'blacklist' ? 'bg-red-700 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <Ban size={14} /> Czarna lista
          {bannedCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{bannedCount}</span>
          )}
        </button>
        <button
          onClick={() => setTab('logs')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'logs' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <ScrollText size={14} /> Logi
        </button>
      </div>

      {/* Config warning */}
      {(notConfigured || configError) && (
        <div className="mb-4 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 flex items-start gap-3 flex-shrink-0">
          <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-semibold text-sm">
              {notConfigured ? 'Supabase nie jest skonfigurowany' : 'Błąd połączenia z bazą danych'}
            </p>
            <p className="text-slate-400 text-xs mt-0.5">
              {notConfigured ? 'Uzupełnij dane w Ustawieniach.' : configError}
            </p>
          </div>
        </div>
      )}

      {/* ===== QUICK SEARCH RESULTS ===== */}
      {tab === 'calendar' && searchResults !== null && (
        <div className="mb-4 bg-slate-900 border border-slate-700 rounded-xl p-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Search size={14} className="text-teal-400" />
              <span className="text-sm font-semibold text-white">Wyniki dla: <span className="font-mono tracking-wider text-teal-400">{searchQuery}</span></span>
              {searchBanned && (
                <span className="flex items-center gap-1 bg-red-500/20 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full">
                  <Ban size={10} /> ZBANOWANY
                </span>
              )}
              {!searchBanned && searchResults.length > 0 && (
                <span className="bg-teal-500/20 text-teal-400 text-xs font-bold px-2 py-0.5 rounded-full">✓ brak bana</span>
              )}
            </div>
            {searchLoading && <div className="w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />}
          </div>
          {searchResults.length === 0 ? (
            <p className="text-slate-500 text-sm">Brak rezerwacji w historii dla tej tablicy.</p>
          ) : (
            <div className="overflow-auto max-h-52">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-800">
                    <th className="text-left py-1.5 px-2 font-medium">Data</th>
                    <th className="text-left py-1.5 px-2 font-medium">Rejestracja</th>
                    <th className="text-left py-1.5 px-2 font-medium">Status</th>
                    <th className="text-left py-1.5 px-2 font-medium">Dodano</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map(r => (
                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/40">
                      <td className="py-1.5 px-2 text-slate-300">{fromDbDate(r.arrival_date)}</td>
                      <td className="py-1.5 px-2 font-mono font-bold text-white tracking-wider">{r.registration}</td>
                      <td className="py-1.5 px-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? 'bg-slate-700 text-slate-300'}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-slate-500 text-xs">
                        {new Date(r.created_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-600 text-center pt-2">{searchResults.length} wynik(ów)</p>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: KALENDARZ ===== */}
      {tab === 'calendar' && (
        <div className="flex gap-6 flex-1 min-h-0">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                <ChevronLeft size={20} />
              </button>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {MONTHS[month - 1]} {year}
                {monthLoading && <span className="ml-2 inline-block"><Spinner size="sm" /></span>}
              </h2>
              <button onClick={nextMonth} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => (
                <div key={d} className="text-center text-xs font-medium text-slate-500 py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const count = counts[dateStr] ?? 0;
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;
                return (
                  <button
                    key={day}
                    onClick={() => selectDate(dateStr)}
                    className={`relative flex flex-col items-center justify-center min-h-[60px] rounded-xl text-sm font-medium transition-all border
                      ${isSelected ? 'bg-teal-500 text-white border-teal-400'
                        : isToday ? 'bg-slate-700 text-teal-400 border-teal-500/50'
                        : count > 0 ? 'bg-teal-500/10 text-white border-teal-500/20 hover:bg-teal-500/20'
                        : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-white'}`}
                  >
                    {/* Pogoda — badge w prawym górnym rogu */}
                    {weatherData[dateStr] && (
                      <span className="absolute top-1 right-1.5 flex flex-col items-center gap-px leading-none">
                        <span className="text-[17px]">{weatherEmoji(weatherData[dateStr].code)}</span>
                        <span className={`text-[11px] font-medium leading-none ${isSelected ? 'text-white/80' : 'text-slate-300'}`}>
                          {weatherData[dateStr].maxTemp}°
                        </span>
                      </span>
                    )}
                    {/* Numer dnia — główny element */}
                    <span className="text-base font-semibold leading-none">{day}</span>
                    {/* Liczba rezerwacji */}
                    {count > 0 && (
                      <span className={`text-[10px] font-bold mt-1 ${isSelected ? 'text-white/80' : 'text-teal-400'}`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <div className="w-72 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--color-text)] text-sm">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}
                </h3>
                <button onClick={() => setSelectedDate(null)} className="text-slate-500 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              {dayLoading ? (
                <div className="flex-1 flex items-center justify-center"><Spinner /></div>
              ) : dayReservations.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <p className="text-slate-500 text-sm">Brak rezerwacji</p>
                  <button onClick={openAdd} className="mt-3 text-teal-400 text-xs hover:underline flex items-center gap-1">
                    <Plus size={12} /> Dodaj
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2">
                  {[...dayReservations]
                    .sort((a, b) => (a.status !== 'confirmed' ? 1 : 0) - (b.status !== 'confirmed' ? 1 : 0))
                    .map((r, idx) => (
                      <div key={r.id} className={`flex flex-col gap-1 rounded-lg px-3 py-2 border group transition-colors
                        ${r.status !== 'confirmed' ? 'bg-slate-900/50 border-slate-800 opacity-60' : 'bg-slate-900 border-slate-700 hover:border-slate-600'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-5 flex-shrink-0">{idx + 1}.</span>
                          <span className={`flex-1 text-sm font-mono font-semibold tracking-wider ${r.status !== 'confirmed' ? 'line-through text-slate-500' : 'text-white'}`}>
                            {r.registration}
                          </span>
                          {/* Badge zbanowany */}
                          {bans.some(b => b.registration === r.registration && b.is_banned) && (
                            <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 flex-shrink-0">
                              <Ban size={8} /> BAN
                            </span>
                          )}
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[r.status] ?? 'bg-slate-700 text-slate-300'}`}>
                            {STATUS_LABELS[r.status] ?? r.status}
                          </span>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(r)} className="text-slate-400 hover:text-teal-400 p-1 rounded"><Pencil size={13} /></button>
                            <button onClick={() => setDeleteId(r.id)} className="text-slate-400 hover:text-red-400 p-1 rounded"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  <button onClick={openAdd} className="w-full mt-2 py-2 border border-dashed border-slate-700 text-slate-500 text-xs rounded-lg hover:border-teal-500/50 hover:text-teal-400 transition-colors flex items-center justify-center gap-1">
                    <Plus size={12} /> Dodaj
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: HISTORIA ===== */}
      {tab === 'history' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Filter bar */}
          <div className="flex gap-2 mb-3 flex-shrink-0 flex-wrap">
            {(['all', 'confirmed', 'cancelled', 'no_show'] as const).map(f => (
              <button
                key={f}
                onClick={() => setHistoryFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors
                  ${historyFilter === f
                    ? f === 'all' ? 'bg-slate-600 text-white border-slate-500'
                      : f === 'confirmed' ? 'bg-teal-600 text-white border-teal-500'
                      : f === 'cancelled' ? 'bg-red-600 text-white border-red-500'
                      : 'bg-orange-600 text-white border-orange-500'
                    : 'bg-transparent text-slate-400 border-slate-700 hover:border-slate-500 hover:text-white'}`}
              >
                {f === 'all' ? 'Wszystkie' : STATUS_LABELS[f]}
              </button>
            ))}
            <button onClick={loadHistory} className="ml-auto text-xs text-slate-400 hover:text-teal-400 flex items-center gap-1">
              <RotateCcw size={12} /> Odśwież
            </button>
          </div>

          {historyLoading ? (
            <div className="flex-1 flex items-center justify-center"><Spinner /></div>
          ) : history.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-slate-500">Brak rezerwacji</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-bg)] z-10">
                  <tr className="text-xs text-slate-500 border-b border-slate-800">
                    <th className="text-left py-2 px-3 font-medium">Data przyjazdu</th>
                    <th className="text-left py-2 px-3 font-medium">Rejestracja</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Dodano</th>
                    <th className="text-right py-2 px-3 font-medium">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => (
                    <tr key={r.id} className="border-b border-slate-800/60 hover:bg-slate-800/30 group">
                      <td className="py-2 px-3 text-slate-300">{fromDbDate(r.arrival_date)}</td>
                      <td className="py-2 px-3 font-mono font-semibold text-white tracking-wider">{r.registration}</td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? 'bg-slate-700 text-slate-300'}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-xs">
                        {new Date(r.created_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          {r.status === 'confirmed' && (
                            <button
                              onClick={() => handleMarkNoShow(r)}
                              title="Oznacz jako nie stawił się"
                              className="text-orange-400 hover:text-orange-300 p-1 rounded hover:bg-orange-500/10 text-xs flex items-center gap-1"
                            >
                              <AlertTriangle size={13} /> no-show
                            </button>
                          )}
                          {r.status !== 'confirmed' && (
                            <button
                              onClick={() => handleRestoreStatus(r)}
                              title="Przywróć jako potwierdzona"
                              className="text-teal-400 hover:text-teal-300 p-1 rounded hover:bg-teal-500/10 text-xs flex items-center gap-1"
                            >
                              <RotateCcw size={13} /> przywróć
                            </button>
                          )}
                          <button onClick={() => setDeleteId(r.id)} title="Usuń" className="text-slate-400 hover:text-red-400 p-1 rounded hover:bg-red-500/10">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-600 text-center py-3">{history.length} rekordów</p>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: CZARNA LISTA ===== */}
      {tab === 'blacklist' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="mb-3 flex-shrink-0">
            <p className="text-slate-400 text-xs">
              Pojazdy z ≥{NO_SHOW_BAN_THRESHOLD} niestawieniami są automatycznie blokowane przez bota.
              Możesz też ręcznie zablokować lub odblokować dowolny pojazd.
            </p>
          </div>

          {bansLoading ? (
            <div className="flex-1 flex items-center justify-center"><Spinner /></div>
          ) : bans.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-slate-500 text-sm">Brak pojazdów na czarnej liście</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-bg)] z-10">
                  <tr className="text-xs text-slate-500 border-b border-slate-800">
                    <th className="text-left py-2 px-3 font-medium">Rejestracja</th>
                    <th className="text-center py-2 px-3 font-medium">No-show</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Powód banu</th>
                    <th className="text-left py-2 px-3 font-medium">Ostatni no-show</th>
                    <th className="text-right py-2 px-3 font-medium">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {bans.map(b => (
                    <tr key={b.registration} className={`border-b border-slate-800/60 hover:bg-slate-800/30 group ${b.is_banned ? 'bg-red-950/20' : ''}`}>
                      <td className="py-2 px-3 font-mono font-bold text-white tracking-wider">{b.registration}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`font-bold text-sm ${b.no_show_count >= NO_SHOW_BAN_THRESHOLD ? 'text-red-400' : b.no_show_count >= 2 ? 'text-orange-400' : 'text-slate-300'}`}>
                          {b.no_show_count}
                        </span>
                        <span className="text-slate-600 text-xs">/{NO_SHOW_BAN_THRESHOLD}</span>
                      </td>
                      <td className="py-2 px-3">
                        {b.is_banned ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 flex items-center gap-1 w-fit">
                            <Ban size={10} /> zablokowany
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 w-fit block">
                            obserwowany
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-xs max-w-[200px] truncate">{b.ban_reason ?? '–'}</td>
                      <td className="py-2 px-3 text-slate-500 text-xs">
                        {b.last_no_show ? new Date(b.last_no_show).toLocaleDateString('pl-PL') : '–'}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          {b.is_banned ? (
                            <button
                              onClick={() => handleUnban(b.registration)}
                              title="Odblokuj pojazd"
                              className="text-teal-400 hover:text-teal-300 p-1 rounded hover:bg-teal-500/10 text-xs flex items-center gap-1"
                            >
                              <ShieldCheck size={13} /> odblokuj
                            </button>
                          ) : (
                            <button
                              onClick={() => banVehicle(b.registration).then(loadBans)}
                              title="Zablokuj pojazd"
                              className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 text-xs flex items-center gap-1"
                            >
                              <ShieldOff size={13} /> zablokuj
                            </button>
                          )}
                          <button
                            onClick={() => handleResetCount(b.registration)}
                            title="Wyzeruj licznik no-show"
                            className="text-orange-400 hover:text-orange-300 p-1 rounded hover:bg-orange-500/10 text-xs flex items-center gap-1"
                          >
                            <RotateCcw size={13} /> wyzeruj
                          </button>
                          <button
                            onClick={() => handleDeleteBan(b.registration)}
                            title="Usuń z listy"
                            className="text-slate-400 hover:text-red-400 p-1 rounded hover:bg-red-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: LOGI ===== */}
      {tab === 'logs' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-slate-400 text-xs">Ostatnie 100 zdarzeń w systemie.</p>
            <button onClick={loadEvents} className="text-xs text-slate-400 hover:text-teal-400 flex items-center gap-1">
              <RefreshCw size={12} /> Odśwież
            </button>
          </div>
          {eventsLoading ? (
            <div className="flex-1 flex items-center justify-center"><Spinner /></div>
          ) : events.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-slate-500 text-sm">Brak zdarzeń</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-bg)] z-10">
                  <tr className="text-xs text-slate-500 border-b border-slate-800">
                    <th className="text-left py-2 px-3 font-medium">Czas</th>
                    <th className="text-left py-2 px-3 font-medium">Zdarzenie</th>
                    <th className="text-left py-2 px-3 font-medium">Szczegóły</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="py-2 px-3 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-2 px-3 text-slate-300 text-sm whitespace-nowrap">
                        {EVENT_LABELS[e.event_type] ?? e.event_type}
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-xs font-mono">
                        {e.details ? (
                          <span>
                            {e.details.registration && <span className="text-white font-semibold tracking-wider mr-2">{String(e.details.registration)}</span>}
                            {e.details.date && <span className="mr-2">{String(e.details.date)}</span>}
                            {e.details.now_banned && <span className="text-red-400 font-bold">→ ZABLOKOWANY</span>}
                          </span>
                        ) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-600 text-center py-3">{events.length} wpisów</p>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edytuj rezerwację' : 'Nowa rezerwacja'}>
        <div className="flex flex-col gap-4">
          <Input label="Data przyjazdu" type="date" value={form.arrival_date}
            onChange={e => setForm(f => ({ ...f, arrival_date: e.target.value }))} />
          <Input label="Numer rejestracyjny" type="text" placeholder="np. GD12345"
            value={form.registration}
            onChange={e => setForm(f => ({ ...f, registration: e.target.value.toUpperCase() }))}
            error={formError} />
          <div className="flex gap-3 mt-2">
            <Button variant="primary" onClick={handleSave} loading={saving} className="flex-1">
              <Check size={16} /> Zapisz
            </Button>
            <Button variant="ghost" onClick={() => setModalOpen(false)} className="flex-1">Anuluj</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm Modal */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Usuń rezerwację">
        <p className="text-slate-300 text-sm mb-5">Czy na pewno chcesz usunąć tę rezerwację?</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete} loading={deleting} className="flex-1">
            <Trash2 size={16} /> Usuń
          </Button>
          <Button variant="ghost" onClick={() => setDeleteId(null)} className="flex-1">Anuluj</Button>
        </div>
      </Modal>

      {/* Manual ban Modal */}
      <Modal open={banFormOpen} onClose={() => setBanFormOpen(false)} title="Ręczne zablokowanie pojazdu">
        <div className="flex flex-col gap-4">
          <Input label="Numer rejestracyjny" type="text" placeholder="np. GD12345"
            value={banForm}
            onChange={e => setBanForm(e.target.value.toUpperCase())} />
          <Input label="Powód (opcjonalnie)" type="text" placeholder="np. Wielokrotne nieuiszczenie opłaty"
            value={banReason}
            onChange={e => setBanReason(e.target.value)} />
          <div className="flex gap-3 mt-2">
            <Button variant="danger" onClick={handleManualBan} loading={banSaving} className="flex-1">
              <Ban size={16} /> Zablokuj
            </Button>
            <Button variant="ghost" onClick={() => setBanFormOpen(false)} className="flex-1">Anuluj</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

