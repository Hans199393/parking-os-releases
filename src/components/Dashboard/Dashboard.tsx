import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Camera, CalendarDays, Bell, Car, AlertTriangle, X,
  Plus, Wallet, ScrollText, TrendingUp, Sparkles, Activity, CloudSun,
} from 'lucide-react';
import {
  getReservationsForDate, getExtraOpenDays, getBotAlerts, resolveBotAlert,
  getReservationCountByMonth, getBannedVehicles, getAdminLogs,
  type BotAlert, type AdminLog,
} from '../../lib/supabase';
import { getMonthlyRevenue } from '../../lib/database';
import { usePerm } from '../../lib/usePerm';
import { Spinner } from '../shared/UI';
import { Page } from '../Sidebar/Sidebar';
import RTSPPlayer from '../Cameras/RTSPPlayer';

const LAT = 54.3404;
const LON = 18.8865;

interface WeatherInfo {
  date: string;       // YYYY-MM-DD
  label: string;      // "Dziś" / "pt 12.06"
  emoji: string;
  maxTemp: number;
  description: string;
}

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

function weatherDesc(code: number): string {
  if (code === 0) return 'Bezchmurnie';
  if (code <= 2) return 'Częściowe zachmurzenie';
  if (code === 3) return 'Zachmurzenie';
  if (code <= 49) return 'Mgła';
  if (code <= 57) return 'Mżawka';
  if (code <= 67) return 'Deszcz';
  if (code <= 77) return 'Śnieg';
  if (code <= 82) return 'Przelotny deszcz';
  if (code <= 86) return 'Opady śniegu';
  return 'Burza';
}

// Szuka najbliższego dnia otwartego parkingu (jutro wzwyż)
// Standardowe: pt(5)/sb(6)/nd(0) w VI-VIII
// Extra: lista dat z Supabase (format DD.MM.YYYY)
function findNextOpenDay(extraDayDates: Set<string>): string | null {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1); // od jutra
  for (let i = 0; i < 120; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const [y, m, day] = iso.split('-');
    const ddmmyyyy = `${day}.${m}.${y}`;
    const month = d.getMonth() + 1;
    const dow = d.getDay();
    const isStandard = [6, 7, 8].includes(month) && [0, 5, 6].includes(dow);
    if (isStandard || extraDayDates.has(ddmmyyyy)) return iso;
  }
  return null;
}

async function fetchWeatherForDates(dates: string[]): Promise<Record<string, { code: number; maxTemp: number }>> {
  if (dates.length === 0) return {};
  const sorted = [...dates].sort();
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];
  const today = new Date().toISOString().split('T')[0];
  let url: string;
  if (endDate < today) {
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${startDate}&end_date=${endDate}&daily=weather_code,temperature_2m_max&timezone=Europe%2FWarsaw`;
  } else {
    const pastDays = Math.max(0, Math.floor((new Date().getTime() - new Date(startDate).getTime()) / 86400000) + 1);
    const futureDays = Math.max(1, Math.floor((new Date(endDate).getTime() - new Date().getTime()) / 86400000) + 2);
    url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weather_code,temperature_2m_max&timezone=Europe%2FWarsaw&past_days=${Math.min(pastDays, 92)}&forecast_days=${Math.min(futureDays, 16)}`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = await res.json();
    const result: Record<string, { code: number; maxTemp: number }> = {};
    const times: string[] = json.daily?.time ?? [];
    const codes: number[] = json.daily?.weather_code ?? [];
    const temps: number[] = json.daily?.temperature_2m_max ?? [];
    for (let i = 0; i < times.length; i++) {
      if (dates.includes(times[i])) {
        result[times[i]] = { code: codes[i], maxTemp: Math.round(temps[i]) };
      }
    }
    return result;
  } catch {
    return {};
  }
}

interface DashboardProps {
  onNavigate: (page: Page) => void;
  newReservations: number;
  cam1HlsUrl: string | null;
  cam2HlsUrl: string | null;
  cam3HlsUrl: string | null;
  cam4HlsUrl: string | null;
}

export default function Dashboard({ onNavigate, newReservations, cam1HlsUrl, cam2HlsUrl, cam3HlsUrl, cam4HlsUrl }: DashboardProps) {
  const perm = usePerm();
  const today = new Date().toISOString().split('T')[0];
  const [todayRes, setTodayRes] = useState<{ registration: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [weatherWidgets, setWeatherWidgets] = useState<WeatherInfo[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [onParking, setOnParking] = useState<number | null>(null);
  const [todayIn, setTodayIn]   = useState<number | null>(null);
  const [botAlerts, setBotAlerts] = useState<BotAlert[]>([]);
  // Iter 7: KPI / sparkline / orzeł historia
  const [monthRevenue, setMonthRevenue] = useState<number | null>(null);
  const [weekCounts, setWeekCounts] = useState<number[]>([]); // ostatnie 7 dni (od najstarszego)
  const [bansActive, setBansActive] = useState<number | null>(null);
  const [orzelLogs, setOrzelLogs] = useState<AdminLog[]>([]);
  const detectorOk = onParking !== null;
  const detectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling statusu detektora
  useEffect(() => {
    async function fetchDetector() {
      try {
        const res = await fetch('http://127.0.0.1:8890/status');
        if (res.ok) {
          const data = await res.json();
          setOnParking(data.on_parking ?? 0);
          setTodayIn(data.today_in ?? 0);
        }
      } catch { /* detektor nie działa — nic nie pokazuj */ }
    }
    fetchDetector();
    detectorPollRef.current = setInterval(fetchDetector, 5000);
    return () => { if (detectorPollRef.current) clearInterval(detectorPollRef.current); };
  }, []);

  // Polling bot_alerts (co 60s)
  useEffect(() => {
    async function fetchAlerts() {
      try {
        const alerts = await getBotAlerts(true);
        setBotAlerts(alerts);
      } catch { /* ignore */ }
    }
    fetchAlerts();
    alertPollRef.current = setInterval(fetchAlerts, 60000);
    return () => { if (alertPollRef.current) clearInterval(alertPollRef.current); };
  }, []);

  const cameras = [
    { label: 'CAM 1', url: cam1HlsUrl },
    { label: 'CAM 2', url: cam2HlsUrl },
    { label: 'CAM 3', url: cam3HlsUrl },
    { label: 'CAM 4', url: cam4HlsUrl },
  ];

  useEffect(() => {
    getReservationsForDate(today)
      .then(setTodayRes)
      .catch(() => setTodayRes([]))
      .finally(() => setLoading(false));
  }, [today, newReservations]);

  // Iter 7: KPI snapshot — przychód miesiąca, 7 dni rezerwacji, bany, ostatnie logi
  useEffect(() => {
    let cancelled = false;
    async function loadKpi() {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      try {
        const [revs, monthCounts, bans, logs] = await Promise.all([
          getMonthlyRevenue(year, month).catch(() => []),
          getReservationCountByMonth(year, month).catch(() => ({} as Record<string, number>)),
          getBannedVehicles().catch(() => []),
          // Pobieramy 30 ostatnich logów kategorii 'chat' i filtrujemy po stronie klienta
          getAdminLogs('chat', 30).catch(() => []),
        ]);
        if (cancelled) return;
        const total = revs.reduce((s, r) => s + (r.total ?? 0), 0);
        setMonthRevenue(total);
        const counts: number[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const iso = d.toISOString().split('T')[0];
          counts.push(monthCounts[iso] ?? 0);
        }
        setWeekCounts(counts);
        setBansActive(bans.filter(b => b.is_banned).length);
        setOrzelLogs(logs.filter(l => l.action === 'orzel_turn').slice(0, 5));
      } catch { /* noop */ }
    }
    void loadKpi();
    const iv = setInterval(loadKpi, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [newReservations]);

  useEffect(() => {
    async function loadWeather() {
      setWeatherLoading(true);
      try {
        // Zbierz extra dni z Supabase
        const extraDays = await getExtraOpenDays().catch(() => []);
        const extraSet = new Set(extraDays.filter(d => d.active).map(d => d.date));
        const nextOpen = findNextOpenDay(extraSet);
        const datesToFetch = [today, ...(nextOpen ? [nextOpen] : [])];
        const weatherData = await fetchWeatherForDates(datesToFetch);

        const widgets: WeatherInfo[] = [];

        // Widget 1: Dziś
        const todayW = weatherData[today];
        if (todayW) {
          widgets.push({
            date: today,
            label: 'Dziś',
            emoji: weatherEmoji(todayW.code),
            maxTemp: todayW.maxTemp,
            description: weatherDesc(todayW.code),
          });
        }

        // Widget 2: Najbliższy dzień otwarty
        if (nextOpen && weatherData[nextOpen]) {
          const w = weatherData[nextOpen];
          const d = new Date(nextOpen + 'T12:00:00');
          const dayName = d.toLocaleDateString('pl-PL', { weekday: 'short' });
          const dayNum = d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' });
          widgets.push({
            date: nextOpen,
            label: `${dayName} ${dayNum}`,
            emoji: weatherEmoji(w.code),
            maxTemp: w.maxTemp,
            description: weatherDesc(w.code),
          });
        }

        setWeatherWidgets(widgets);
      } catch {
        setWeatherWidgets([]);
      } finally {
        setWeatherLoading(false);
      }
    }
    loadWeather();
  }, [today]);

  const dateLabel = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Iter 7: agregaty + sparkline
  const week7Total = useMemo(() => weekCounts.reduce((a, b) => a + b, 0), [weekCounts]);
  const week7Max   = useMemo(() => Math.max(1, ...weekCounts), [weekCounts]);
  const fmtPLN = (v: number) => v.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
  const monthLabel = new Date().toLocaleDateString('pl-PL', { month: 'long' });

  const QUICK_ACTIONS: { perm: string; label: string; icon: React.ReactNode; page: Page; accent: string; onBefore?: () => void }[] = [
    { perm: 'reservations.create', label: 'Nowa rezerwacja', icon: <Plus size={14} />,           page: 'reservations', accent: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-300' },
    { perm: 'finances.add_income', label: 'Wpisz przychód',  icon: <Wallet size={14} />,         page: 'finances',     accent: 'from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-300' },
    { perm: 'chat.use',            label: 'Zapytaj Orła',    icon: <Sparkles size={14} />,       page: 'chat',         accent: 'from-violet-500/20 to-violet-500/5 border-violet-500/30 text-violet-300', onBefore: () => sessionStorage.setItem('chat_initial_tab', 'asystent') },
    { perm: 'logs.view',           label: 'Zobacz logi',     icon: <ScrollText size={14} />,    page: 'logs',         accent: 'from-blue-500/20 to-blue-500/5 border-blue-500/30 text-blue-300' },
  ];
  const visibleActions = QUICK_ACTIONS.filter(a => perm.has(a.perm));

  return (
    <div className="p-4 h-full flex flex-col overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Dashboard</h1>
          <p className="text-[var(--color-text-muted)] text-xs capitalize">{dateLabel}</p>
        </div>
        {newReservations > 0 && (
          <div
            className="flex items-center gap-2 bg-teal-500/10 border border-teal-500/40 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-teal-500/20 transition-colors"
            onClick={() => onNavigate('reservations')}
          >
            <Bell size={14} className="text-teal-400" />
            <span className="text-teal-300 font-semibold text-xs">
              {newReservations} nowa rezerwacja{newReservations > 1 ? (newReservations < 5 ? 'e' : '') : ''}!
            </span>
          </div>
        )}
      </div>

      {/* Iter 7: KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 flex-shrink-0">
        {/* KPI 1: Wjazdy dziś (z detektora) */}
        <button
          onClick={() => onNavigate('cameras')}
          className="glass-strong rounded-[var(--radius-lg)] p-3 text-left animate-slideUp hover:scale-[1.02] transition-transform"
          title="Liczba pojazdów wykrytych przez detektor dzisiaj"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">Wjazdy dziś</span>
            <Car size={14} className="text-teal-400 opacity-70" />
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="hero-number text-2xl font-bold leading-none">{todayIn ?? '…'}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] pb-0.5">na parkingu: <span className="text-teal-300 font-bold">{onParking ?? '—'}</span></div>
          </div>
        </button>

        <button
          onClick={() => perm.has('finances.view') && onNavigate('finances')}
          disabled={!perm.has('finances.view')}
          className="glass-strong rounded-[var(--radius-lg)] p-3 text-left animate-slideUp hover:scale-[1.02] transition-transform disabled:opacity-60 disabled:hover:scale-100"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold capitalize">Przychód · {monthLabel}</span>
            <Wallet size={14} className="text-amber-400 opacity-70" />
          </div>
          <div className="hero-number text-2xl font-bold leading-none">{monthRevenue == null ? '…' : fmtPLN(monthRevenue)}</div>
        </button>

        <button
          onClick={() => onNavigate('reservations')}
          className="glass-strong rounded-[var(--radius-lg)] p-3 text-left animate-slideUp hover:scale-[1.02] transition-transform"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">Ostatnie 7 dni · rezerwacje</span>
            <TrendingUp size={14} className="text-blue-400 opacity-70" />
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="hero-number text-2xl font-bold leading-none">{week7Total}</div>
            {weekCounts.length === 7 && (
              <div className="flex items-end gap-[2px] h-7 flex-shrink-0" title={weekCounts.map((c, i) => {
                const d = new Date(); d.setDate(d.getDate() - (6 - i));
                return `${d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric' })}: ${c}`;
              }).join(' • ')}>
                {weekCounts.map((c, i) => (
                  <div
                    key={i}
                    className={`w-2 rounded-sm ${i === 6 ? 'bg-[var(--color-accent)]' : 'bg-blue-500/60'}`}
                    style={{ height: `${Math.max(8, (c / week7Max) * 28)}px` }}
                  />
                ))}
              </div>
            )}
          </div>
        </button>

        {/* KPI 4: Pogoda jutro / najbliższy dzień otwarty (info na nadchodzący dzień) */}
        <div
          className="glass-strong rounded-[var(--radius-lg)] p-3 animate-slideUp"
          title="Prognoza dla najbliższego dnia otwarcia parkingu"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">
              {weatherWidgets[1] ? `Prognoza · ${weatherWidgets[1].label}` : 'Pogoda — następny otwarty'}
            </span>
            <CloudSun size={14} className="text-sky-400 opacity-70" />
          </div>
          {weatherWidgets[1] ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-3xl leading-none">{weatherWidgets[1].emoji}</span>
                <div className="hero-number text-2xl font-bold leading-none">{weatherWidgets[1].maxTemp}°C</div>
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] text-right max-w-[100px] truncate">{weatherWidgets[1].description}</div>
            </div>
          ) : (
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Brak prognozy</div>
          )}
        </div>
      </div>

      {/* Iter 7: Quick Actions */}
      {visibleActions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
          {visibleActions.map(a => (
            <button
              key={a.label}
              onClick={() => { a.onBefore?.(); onNavigate(a.page); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] border bg-gradient-to-br ${a.accent} text-xs font-semibold hover:scale-[1.04] transition-transform`}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Weather widgets + detektor */}
      {(weatherLoading || weatherWidgets.length > 0 || onParking !== null || botAlerts.length > 0) && (
        <div className="flex gap-3 mb-3 flex-shrink-0 flex-wrap">
          {weatherLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-xs"><Spinner size="sm" /> Ładowanie pogody…</div>
          ) : (
            weatherWidgets.map(w => (
              <div key={w.date} className="flex items-center gap-3 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2.5 min-w-[160px]">
                <span className="text-3xl leading-none">{w.emoji}</span>
                <div>
                  <p className="text-xs text-slate-400 font-medium">{w.label}</p>
                  <p className="text-xl font-bold text-white leading-tight">{w.maxTemp}°C</p>
                  <p className="text-[11px] text-slate-500">{w.description}</p>
                </div>
              </div>
            ))
          )}
          {onParking !== null && (
            <div
              className="flex items-center gap-3 bg-teal-900/30 border border-teal-600/40 rounded-xl px-4 py-2.5 min-w-[160px] cursor-pointer hover:bg-teal-900/50 transition-colors"
              onClick={() => onNavigate('cameras')}
              title="Przejdź do kamer / detektora"
            >
              <Car size={28} className="text-teal-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-teal-400 font-medium">Na parkingu</p>
                <p className="text-xl font-bold text-white leading-tight">{onParking}</p>
                <p className="text-[11px] text-slate-400">Wjazdy dziś: {todayIn ?? 0}</p>
              </div>
            </div>
          )}

          {/* Iter 7 fix: Status systemu — wypełnia pas po prawej */}
          <div className="flex items-center gap-4 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2.5 min-w-[260px] flex-1">
            <Activity size={22} className="text-[var(--color-accent)] flex-shrink-0" />
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${cameras.filter(c => c.url).length === 4 ? 'bg-emerald-400' : cameras.filter(c => c.url).length > 0 ? 'bg-amber-400' : 'bg-red-400'}`} />
                <span className="text-slate-400">Kamery:</span>
                <span className="font-bold text-white">{cameras.filter(c => c.url).length}/4</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${detectorOk ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                <span className="text-slate-400">Detektor:</span>
                <span className="font-bold text-white">{detectorOk ? 'online' : 'offline'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${botAlerts.length === 0 ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-slate-400">Bot:</span>
                <span className="font-bold text-white">{botAlerts.length === 0 ? 'OK' : `${botAlerts.length} ⚠`}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${(bansActive ?? 0) === 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-slate-400">Bany:</span>
                <span className="font-bold text-white">{bansActive ?? '…'}</span>
              </div>
            </div>
          </div>
          {botAlerts.map(alert => {
            const labelMap: Record<string, string> = {
              groq_tpd_limit: 'TPD — dzienny limit tokenów',
              groq_rpm_limit: 'RPM — minutowy limit zapytań',
              groq_timeout:   'Timeout — brak odpowiedzi AI',
              groq_error:     'Błąd API AI',
              groq_rate_limit: 'Limit tokenów (legacy)',
            };
            const label = labelMap[alert.type] ?? alert.type;
            return (
              <div
                key={alert.id}
                className="flex items-center gap-3 bg-red-900/30 border border-red-600/40 rounded-xl px-4 py-2.5 min-w-[200px] max-w-[340px]"
                title={alert.message ?? alert.type}
              >
                <AlertTriangle size={24} className="text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-red-400 font-semibold">⚠️ Bot — usterka</p>
                  <p className="text-sm text-white font-medium truncate">{label}</p>
                  <p className="text-[11px] text-slate-400">
                    {new Date(alert.created_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}
                  </p>
                </div>
                <button
                  className="text-slate-500 hover:text-red-300 transition-colors flex-shrink-0 ml-1"
                  title="Oznacz jako rozwiązane"
                  onClick={async () => {
                    await resolveBotAlert(alert.id);
                    setBotAlerts(prev => prev.filter(a => a.id !== alert.id));
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main content — cameras left, reservations right */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* 4 cameras in 2×2 grid */}
        <div className="flex flex-col gap-2 flex-1 min-h-0 min-w-0">
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Camera size={14} className="text-teal-400" />
              <span className="font-semibold text-sm text-[var(--color-text)]">Kamery na żywo</span>
            </div>
            <button className="text-xs text-teal-400 hover:underline" onClick={() => onNavigate('cameras')}>
              Pełny ekran →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
            {cameras.map((cam, i) => (
              <div key={i} className="cursor-pointer min-h-0" style={{ aspectRatio: '16/9' }} onClick={() => onNavigate('cameras')}>
                {cam.url ? (
                  <div className="h-full rounded-xl overflow-hidden bg-black">
                    <RTSPPlayer streamUrl={cam.url} label={cam.label} fill />
                  </div>
                ) : (
                  <div className="h-full bg-slate-900 rounded-xl border border-slate-700 flex items-center justify-center">
                    <div className="text-center">
                      <Camera size={18} className="text-slate-600 mx-auto mb-1" />
                      <p className="text-slate-500 text-xs">{cam.label} — brak</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Reservations — fixed width sidebar */}
        <div className="w-72 flex-shrink-0 flex flex-col min-h-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <CalendarDays size={14} className="text-teal-400" />
              <span className="font-semibold text-sm text-[var(--color-text)]">Rezerwacje dziś</span>
            </div>
            <button className="text-xs text-teal-400 hover:underline" onClick={() => onNavigate('reservations')}>
              Otwórz →
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : todayRes.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-slate-400 text-sm">Brak rezerwacji na dziś</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="text-2xl font-bold text-teal-400 mb-2">{todayRes.length}</div>
                {todayRes.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-900 rounded-lg px-2.5 py-1.5 border border-slate-700">
                    <span className="text-xs text-slate-500 w-4">{i + 1}.</span>
                    <span className="text-sm font-mono font-semibold text-white tracking-wider">{r.registration}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Iter 7 fix: Ostatnie pytania do Orła (zamiast ogólnych zdarzeń) */}
          {perm.has('chat.use') && orzelLogs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={12} className="text-violet-400" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)]">Ostatnie pytania do Orła</span>
                </div>
                <button
                  onClick={() => { sessionStorage.setItem('chat_initial_tab', 'asystent'); onNavigate('chat'); }}
                  className="text-[10px] text-violet-400 hover:underline"
                >Otwórz →</button>
              </div>
              <div className="space-y-1">
                {orzelLogs.slice(0, 5).map(l => {
                  const meta = l.metadata as Record<string, unknown> | null;
                  const q = (meta?.question as string) ?? l.description?.replace(/^Q:\s*/, '') ?? l.action;
                  return (
                    <button
                      key={l.id}
                      onClick={() => { sessionStorage.setItem('chat_initial_tab', 'asystent'); onNavigate('chat'); }}
                      className="w-full text-left px-2 py-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
                      title={q}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-400" />
                        <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">
                          {new Date(l.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[11px] truncate text-[var(--color-text)]">{q}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
