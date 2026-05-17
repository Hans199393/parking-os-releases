/**
 * ParkingTab — odpowiednik dawnego tab='parking' w Settings.tsx.
 *
 * Visual style — gold standard dla całego programu:
 * gradient-accent, glass-strong, hero numbers, animowane kafelki.
 */

import { useEffect, useState } from 'react';
import { Banknote, MapPin, Clock, CalendarPlus, Megaphone, Car, Cloud, Check, Lock } from 'lucide-react';
import { Input, Button } from '../shared/UI';
import { getConfigs, setConfigs, getExtraOpenDays, addExtraOpenDay, deleteExtraOpenDay } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { usePerm } from '../../lib/usePerm';

interface Props {
  values: Record<string, string>;
  set: (key: string, val: string) => void;
  patch: (next: Record<string, string>) => void;
}

type ExtraDay = { id?: number; date: string; note?: string | null; active?: boolean };

const PARKING_CLOUD_KEYS = [
  'rate_basic', 'rate_reservation', 'rate_after_hours',
  'open_from', 'open_to', 'open_days',
  'spots_available', 'komunikat',
  'owner_phone', 'owner_email', 'parking_address', 'parking_name', 'parking_nip',
  'parking_capacity',
];

const isoToPlDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};
const plToIsoDate = (pl: string) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(pl);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : pl;
};

export default function ParkingTab({ values, set, patch }: Props) {
  const perm = usePerm();
  const canEdit = perm.has('settings.edit_parking');
  const [extraDays, setExtraDays] = useState<ExtraDay[]>([]);
  const [extraDayInput, setExtraDayInput] = useState('');
  const [extraDayBusy, setExtraDayBusy] = useState(false);
  const [extraDaysLoading, setExtraDaysLoading] = useState(false);
  const [extraDaysError, setExtraDaysError] = useState<string | null>(null);

  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudResult, setCloudResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Auto-fetch z chmury (Supabase) przy wejściu — żeby pokazać prawdziwy stan
  useEffect(() => {
    if (!values.supabase_url || !values.supabase_key) return;
    let cancelled = false;
    (async () => {
      try {
        const cloud = await getConfigs(PARKING_CLOUD_KEYS);
        if (!cancelled) patch(cloud);
      } catch (e) {
        console.warn('[ParkingTab] cloud fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.supabase_url, values.supabase_key]);

  // Auto-fetch dni dodatkowych
  useEffect(() => {
    if (values.supabase_url && values.supabase_key) void fetchExtraDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.supabase_url, values.supabase_key]);

  const fetchExtraDays = async () => {
    if (!values.supabase_url || !values.supabase_key) return;
    setExtraDaysLoading(true);
    setExtraDaysError(null);
    try {
      const days = await getExtraOpenDays();
      setExtraDays(days.filter(day => day.active !== false));
    } catch (e) {
      setExtraDaysError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtraDaysLoading(false);
    }
  };

  const addExtraDay = async () => {
    if (!extraDayInput) return;
    if (!perm.guard('settings.edit_parking', 'dodanie dnia dodatkowego')) return;
    setExtraDaysError(null);
    setExtraDayBusy(true);
    try {
      await addExtraOpenDay(isoToPlDate(extraDayInput));
      void audit('action', 'extra_day_added', { metadata: { date: extraDayInput }, description: `Dodano dzień otwarty: ${extraDayInput}` });
      setExtraDayInput('');
      await fetchExtraDays();
    } catch (e) {
      setExtraDaysError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtraDayBusy(false);
    }
  };

  const removeExtraDay = async (id: number, date: string) => {
    if (!perm.guard('settings.edit_parking', 'usunięcie dnia dodatkowego')) return;
    setExtraDaysError(null);
    try {
      await deleteExtraOpenDay(id);
      void audit('action', 'extra_day_removed', { metadata: { id, date }, description: `Usunięto dzień otwarty: ${date}`, severity: 'warning' });
      await fetchExtraDays();
    } catch (e) {
      setExtraDaysError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCloudSave = async () => {
    if (!perm.guard('settings.edit_parking', 'zapis ustawień parkingu')) return;
    setCloudSaving(true);
    setCloudResult(null);
    try {
      const settings: Record<string, string> = {};
      for (const k of PARKING_CLOUD_KEYS) {
        if (values[k] != null && values[k] !== '') settings[k] = values[k];
      }
      if (Object.keys(settings).length === 0) throw new Error('Brak danych parkingu do synchronizacji');
      await setConfigs(settings);
      void audit('action', 'parking_settings_cloud_save', {
        description: 'Zsynchronizowano ustawienia parkingu z chmurą',
        metadata: { keys: Object.keys(settings) },
      });
      setCloudResult({ ok: true });
      window.setTimeout(() => setCloudResult(null), 3000);
    } catch (e) {
      setCloudResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCloudSaving(false);
    }
  };

  const isAvailable = (values.spots_available ?? 'true') !== 'false';
  let kom: { tytul?: string; tresc?: string; od?: string; do?: string; aktywny?: boolean } = {};
  try { kom = JSON.parse(values.komunikat ?? '{}'); } catch { /* empty */ }
  const updateKom = (p: Partial<typeof kom>) => set('komunikat', JSON.stringify({ ...kom, ...p }));
  const days = [
    { v: '1', l: 'Pn' }, { v: '2', l: 'Wt' }, { v: '3', l: 'Śr' },
    { v: '4', l: 'Cz' }, { v: '5', l: 'Pt' }, { v: '6', l: 'Sb' }, { v: '0', l: 'Nd' },
  ];
  const csv = (values.open_days ?? '0,5,6').split(',').map(s => s.trim()).filter(Boolean);

  // wrapper na set() — sprawdza uprawnienie i blokuje zmianę pola
  const setGuarded = (k: string, v: string) => {
    if (!perm.guard('settings.edit_parking', 'edycja parkingu')) return;
    set(k, v);
  };

  return <>
    {/* READ-ONLY BANNER */}
    {!canEdit && (
      <div className="glass-strong rounded-[var(--radius-lg)] p-4 mb-5 flex items-center gap-3 border-2 border-[var(--color-warning)]/40 animate-slideUp">
        <Lock size={20} className="text-[var(--color-warning)] flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">Tryb tylko do odczytu</p>
          <p className="text-xs text-[var(--color-text-muted)]">Brak uprawnienia <code>settings.edit_parking</code> — zmiany nie zostaną zapisane.</p>
        </div>
      </div>
    )}
    {/* HERO STATUS BANNER */}
    <div className={`relative overflow-hidden rounded-[var(--radius-xl)] p-7 mb-6 animate-slideUp shadow-[var(--shadow-lg)]
      ${isAvailable
        ? 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:via-emerald-950/40 dark:to-emerald-900/30 border border-emerald-300/40 dark:border-emerald-700/30'
        : 'bg-gradient-to-br from-red-100 via-red-50 to-red-100 dark:from-red-900/30 dark:via-red-950/40 dark:to-red-900/30 border border-red-300/40 dark:border-red-700/30'}`}>
      <div className={`absolute -top-20 -right-20 w-64 h-64 rounded-full blur-3xl opacity-40 animate-[pulse-soft_4s_ease-in-out_infinite]
        ${isAvailable ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full blur-3xl opacity-25" style={{ background: 'var(--gradient-accent)' }} />
      <div className="relative flex items-center gap-6 flex-wrap">
        <div className={`w-20 h-20 rounded-[var(--radius-lg)] flex items-center justify-center shadow-[var(--shadow-md)] flex-shrink-0
          ${isAvailable ? 'bg-[var(--color-success)] ring-glow' : 'bg-[var(--color-danger)]'}`}>
          <Car size={40} className="text-white" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)] mb-1">Status parkingu (walk-in)</p>
          <h2 className={`display-heading ${isAvailable ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
            {isAvailable ? 'WOLNE MIEJSCA' : 'PARKING PEŁNY'}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAvailable ? 'Klienci mogą przyjechać bez rezerwacji' : 'Bot odpowiada „brak miejsc", strona pokazuje czerwony pasek'}
          </p>
        </div>
        <div className="flex flex-col gap-2 ml-auto">
          <button onClick={() => setGuarded('spots_available', 'true')}
            className={`px-5 py-2.5 rounded-[var(--radius-md)] font-bold text-sm transition-all duration-200 border-2
              ${isAvailable
                ? 'bg-[var(--color-success)] border-[var(--color-success)] text-white shadow-[var(--shadow-md)] cursor-default'
                : 'border-emerald-400/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500'}`}>
            ✓ Otwórz
          </button>
          <button onClick={() => setGuarded('spots_available', 'false')}
            className={`px-5 py-2.5 rounded-[var(--radius-md)] font-bold text-sm transition-all duration-200 border-2
              ${!isAvailable
                ? 'bg-[var(--color-danger)] border-[var(--color-danger)] text-white shadow-[var(--shadow-md)] cursor-default'
                : 'border-red-400/50 text-red-700 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500'}`}>
            ✕ Zamknij
          </button>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* CENNIK */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5" style={{ animationDelay: '50ms' }}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
              <Banknote size={22} className="text-[#1a1410]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text)]">Cennik</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Stawki widoczne na stronie i w czacie bota</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1">Walk-in</p>
            <div className="flex items-baseline gap-1">
              <input type="text" value={values.rate_basic ?? ''}
                onChange={e => set('rate_basic', e.target.value)} placeholder="20"
                className="hero-number bg-transparent border-0 outline-none w-full p-0 leading-none"
                style={{ fontSize: 'clamp(2.2rem,5vw,3.5rem)' }} />
              <span className="text-lg font-bold text-[var(--color-text-muted)]">zł</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">/ dobę bez rezerwacji</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-accent)] mb-1">Z rezerwacją ★</p>
            <div className="flex items-baseline gap-1">
              <input type="text" value={values.rate_reservation ?? ''}
                onChange={e => set('rate_reservation', e.target.value)} placeholder="25"
                className="hero-number bg-transparent border-0 outline-none w-full p-0 leading-none"
                style={{ fontSize: 'clamp(2.2rem,5vw,3.5rem)' }} />
              <span className="text-lg font-bold text-[var(--color-text-muted)]">zł</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">/ dobę online</p>
          </div>
        </div>
      </div>

      {/* POJEMNOŚĆ */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5" style={{ animationDelay: '100ms' }}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
              <MapPin size={22} className="text-[#1a1410]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text)]">Pojemność online</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Reszta klientów przyjeżdża walk-in</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center py-4">
          <div className="flex items-baseline gap-3">
            <input type="number" value={values.parking_capacity ?? ''}
              onChange={e => set('parking_capacity', e.target.value)} placeholder="10"
              className="hero-number bg-transparent border-0 outline-none p-0 leading-none w-32 text-center" />
            <span className="text-xl font-bold text-[var(--color-text-muted)]">miejsc</span>
          </div>
        </div>
      </div>

      {/* GODZINY */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5" style={{ animationDelay: '150ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <Clock size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Godziny otwarcia</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Codziennie obowiązujące</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Otwarcie</p>
            <input type="time" value={values.open_from ?? ''}
              onChange={e => set('open_from', e.target.value)}
              className="w-full text-2xl font-bold text-[var(--color-text)] bg-transparent border-2 border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-2 hover:border-[var(--color-accent)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Zamknięcie</p>
            <input type="time" value={values.open_to ?? ''}
              onChange={e => set('open_to', e.target.value)}
              className="w-full text-2xl font-bold text-[var(--color-text)] bg-transparent border-2 border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-2 hover:border-[var(--color-accent)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
          </div>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-2">Dni pracujące</p>
        <div className="flex flex-wrap gap-1.5">
          {days.map(({ v, l }) => {
            const active = csv.includes(v);
            return (
              <button key={v}
                onClick={() => {
                  const next = active ? csv.filter(x => x !== v) : [...csv, v];
                  next.sort();
                  set('open_days', next.join(','));
                }}
                className={`w-12 h-12 rounded-[var(--radius-md)] text-sm font-bold transition-all duration-200 relative overflow-hidden
                  ${active
                    ? 'text-[#1a1410] shadow-[var(--shadow-md)] scale-105'
                    : 'border-2 border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'}`}>
                {active && <span className="absolute inset-0 bg-gradient-accent" aria-hidden="true" />}
                <span className="relative z-10">{l}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* DNI DODATKOWE */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <CalendarPlus size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Dni dodatkowe</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Jednorazowe wyjątki — święto, długi weekend</p>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          <input type="date" value={extraDayInput} onChange={e => setExtraDayInput(e.target.value)}
            className="flex-1 px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]" />
          <Button size="sm" variant="primary" onClick={addExtraDay} disabled={!extraDayInput || extraDaysLoading || extraDayBusy} loading={extraDayBusy}>+ Dodaj</Button>
          <Button size="sm" variant="ghost" onClick={fetchExtraDays} disabled={extraDaysLoading} title="Odśwież">⟳</Button>
        </div>
        {extraDaysError && <p className="text-xs text-[var(--color-danger)] mb-2 font-medium">Błąd: {extraDaysError}</p>}
        {extraDaysLoading && <p className="text-xs text-[var(--color-text-muted)] mb-2">Ładowanie...</p>}
        <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
          {extraDays.length === 0 && !extraDaysLoading && (
            <span className="text-xs text-[var(--color-text-muted)] opacity-60 italic py-2">brak dodatkowych dni</span>
          )}
          {extraDays.map(d => (
            <span key={d.id ?? d.date}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-sm)] animate-fadeIn">
              {plToIsoDate(d.date)}
              <button onClick={() => d.id != null && removeExtraDay(d.id, d.date)}
                className="ml-0.5 w-4 h-4 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
                aria-label={`Usuń ${d.date}`}>×</button>
            </span>
          ))}
        </div>
      </div>
    </div>

    {/* KOMUNIKAT */}
    <div className={`relative overflow-hidden rounded-[var(--radius-lg)] p-6 mt-5 animate-slideUp transition-all
      ${kom.aktywny
        ? 'bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-100 dark:from-amber-900/30 dark:via-yellow-950/30 dark:to-amber-900/30 border-2 border-amber-400/50 shadow-[var(--shadow-glow)]'
        : 'glass-strong'}`}
         style={{ animationDelay: '250ms' }}>
      {kom.aktywny && <div className="absolute top-0 left-0 w-full h-1 shimmer-bg" />}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center shadow-[var(--shadow-md)]
            ${kom.aktywny ? 'bg-gradient-accent animate-[pulse-soft_2s_ease-in-out_infinite]' : 'bg-[var(--color-surface-2)]'}`}>
            <Megaphone size={22} className={kom.aktywny ? 'text-[#1a1410]' : 'text-[var(--color-text-muted)]'} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Komunikat na stronie WWW</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Żółty baner — np. zmiana godzin, majówka, awaria</p>
          </div>
        </div>
        <button onClick={() => updateKom({ aktywny: !kom.aktywny })}
          className={`px-4 py-2 rounded-full font-bold text-xs transition-all
            ${kom.aktywny
              ? 'bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-md)]'
              : 'border-2 border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-warning)] hover:text-[var(--color-warning)]'}`}>
          {kom.aktywny ? '● AKTYWNY' : '○ nieaktywny'}
        </button>
      </div>
      <div className="space-y-3">
        <Input label="Tytuł" value={kom.tytul ?? ''} onChange={e => updateKom({ tytul: e.target.value })}
          placeholder="np. Zmiana godzin otwarcia – Majówka" />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Treść</label>
          <textarea value={kom.tresc ?? ''} onChange={e => updateKom({ tresc: e.target.value })} rows={3}
            placeholder="Treść komunikatu widoczna na stronie..."
            className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm resize-none transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Widoczny od" type="datetime-local" value={kom.od ?? ''} onChange={e => updateKom({ od: e.target.value })} />
          <Input label="Widoczny do" type="datetime-local" value={kom.do ?? ''} onChange={e => updateKom({ do: e.target.value })} />
        </div>
      </div>
    </div>

    <div className="h-24" />

    {/* FLOATING SAVE — sync do chmury (lokalny zapis dzieje się auto) */}
    <div className="fixed bottom-8 right-8 z-50 animate-slideUp">
      <button onClick={handleCloudSave} disabled={cloudSaving}
        className="group relative inline-flex items-center gap-3 px-7 py-4 rounded-full font-bold text-base text-[#1a1410] shadow-[var(--shadow-xl)] hover:shadow-[var(--shadow-glow)] transition-all duration-300 hover:scale-105 active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-accent">
        {cloudSaving ? (
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        ) : cloudResult?.ok ? <Check size={20} /> : <Cloud size={20} />}
        <span>{cloudSaving ? 'Wysyłam...' : cloudResult?.ok ? 'Zapisano w chmurze!' : 'Zapisz w chmurze'}</span>
        {!cloudSaving && !cloudResult?.ok && (
          <span className="absolute inset-0 rounded-full ring-glow pointer-events-none" aria-hidden="true" />
        )}
      </button>
      {cloudResult && !cloudResult.ok && (
        <div className="mt-2 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-danger)] text-white text-xs font-bold shadow-[var(--shadow-md)] max-w-xs animate-fadeIn">
          ✕ {cloudResult.error}
        </div>
      )}
    </div>
  </>;
}
