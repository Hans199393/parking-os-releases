import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download, Check, Lock, Wallet, X, Banknote, CreditCard, Smartphone, Calendar, Coins, Vault, Car as CarIcon, Cloud, Thermometer } from 'lucide-react';
import {
  getMonthlyRevenue, upsertDailyRevenue, deleteDailyRevenue, DailyRevenue, DENOMS, BASE_DENOMS,
  getMonthlyInvoices, addInvoice, updateInvoice, deleteInvoice, Invoice,
  getTotalInvestments, getTotalRevenue,
} from '../../lib/database';
import { getReservationsForDate, setReservationStatus, type Reservation } from '../../lib/supabase';
import { exportMonthToExcel, exportOwnerToExcel } from '../../lib/excel';
import { logInvoiceAction, logExport } from '../../lib/logger';
import DailyReport from './DailyReport';
import MonthlyReport from './MonthlyReport';
import YearlyReport from './YearlyReport';
import AllTimeReport from './AllTimeReport';
import WeeklyReport from './WeeklyReport';
import ForecastReport from './ForecastReport';
import WeatherReport from './WeatherReport';
import SeasonCompare from './SeasonCompare';
import RecurringExpenses from './RecurringExpenses';
import FinanceKPI from './FinanceKPI';
import { verifyCurrentPassword } from '../../lib/auth';
import { getStore } from '../../lib/store';
import { Button, Input, Modal, Card, Spinner } from '../shared/UI';
import { usePerm } from '../../lib/usePerm';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const CATEGORIES = ['Usługi', 'Podatki', 'Materiały', 'Inwestycja'] as const;
const WEATHER_OPTIONS = [
  { value: 'sunny',  icon: '☀️', label: 'Słonecznie' },
  { value: 'cloudy', icon: '🌤️', label: 'Zachmurzenie' },
  { value: 'rainy',  icon: '🌧️', label: 'Deszcz' },
  { value: 'stormy', icon: '⛈️', label: 'Burza' },
];

function formatPLN(amount: number) {
  return amount.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

// Extracted outside RevenueForm to prevent remount on every render
// Mini-kalkulator: '5+3' → 8, '10 + 20 + 5' → 35. Akceptuje też zwykłe liczby.
function parseCalc(s: string): number {
  const t = (s ?? '').trim();
  if (!t) return 0;
  if (/^[\d+\s]+$/.test(t)) {
    return t.split('+').reduce((a, b) => a + (parseInt(b.trim(), 10) || 0), 0);
  }
  const n = parseInt(t, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

interface DenomRowProps {
  d: { key: string; value: number; label: string; type: string };
  qty: number;
  onChange: (n: number) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}
function DenomRow({ d, qty, onChange, inputRef }: DenomRowProps) {
  const isCoin = d.type === 'coin';
  const total = qty * d.value;
  const [raw, setRaw] = React.useState<string>(qty ? String(qty) : '');
  // Sync gdy parent zmieni qty (np. reset po zapisie)
  React.useEffect(() => {
    const cur = parseCalc(raw);
    if (cur !== qty) setRaw(qty ? String(qty) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-md transition-colors
      ${qty > 0 ? 'bg-[var(--color-accent-bg)]/40' : 'hover:bg-[var(--color-surface-2)]/40'}`}>
      <span className={`text-[11px] font-mono font-semibold w-10 flex-shrink-0 ${isCoin ? 'text-amber-400' : 'text-emerald-400'}`}>
        {d.value} zł
      </span>
      <input
        ref={inputRef}
        type="text" inputMode="numeric" pattern="[0-9+ ]*"
        value={raw} placeholder="0"
        onChange={e => {
          const v = e.target.value;
          if (v && !/^[\d+\s]*$/.test(v)) return;
          setRaw(v);
          onChange(parseCalc(v));
        }}
        onBlur={() => {
          const n = parseCalc(raw);
          setRaw(n ? String(n) : '');
        }}
        title="Możesz wpisać sumę: 5+3+2"
        className="flex-1 min-w-0 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] text-sm text-center focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none transition-all font-mono"
      />
      <span className={`text-right text-[11px] font-bold tabular-nums w-[72px] flex-shrink-0 ${qty > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] opacity-40'}`}>
        {total > 0 ? formatPLN(total) : '—'}
      </span>
    </div>
  );
}

// --- Daily Revenue Form ---
interface RevenueFormProps {
  date: string;
  initial: DailyRevenue | null;
  onSave: () => void;
  onClose: () => void;
}

const DOW_PL = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

function RevenueForm({ date, initial, onSave, onClose }: RevenueFormProps) {
  const [form, setForm] = useState({
    qty_1:   initial?.qty_1   ?? 0,
    qty_2:   initial?.qty_2   ?? 0,
    qty_5:   initial?.qty_5   ?? 0,
    qty_10:  initial?.qty_10  ?? 0,
    qty_20:  initial?.qty_20  ?? 0,
    qty_50:  initial?.qty_50  ?? 0,
    qty_100: initial?.qty_100 ?? 0,
    qty_200: initial?.qty_200 ?? 0,
    qty_500: initial?.qty_500 ?? 0,
    base_qty_1:   initial?.base_qty_1   ?? 0,
    base_qty_2:   initial?.base_qty_2   ?? 0,
    base_qty_5:   initial?.base_qty_5   ?? 0,
    base_qty_10:  initial?.base_qty_10  ?? 0,
    base_qty_20:  initial?.base_qty_20  ?? 0,
    base_qty_50:  initial?.base_qty_50  ?? 0,
    base_qty_100: initial?.base_qty_100 ?? 0,
    base_qty_200: initial?.base_qty_200 ?? 0,
    base_qty_500: initial?.base_qty_500 ?? 0,
    card:    initial?.card    ?? 0,
    blik:    initial?.blik    ?? 0,
    notes:   initial?.notes   ?? '',
    weather: initial?.weather ?? '',
    temperature: initial?.temperature != null ? String(initial.temperature) : '',
  });
  const [commissionRate, setCommissionRate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Iter 11: rezerwacje na ten dzień + odhaczanie czy klient się pojawił
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [resLoading, setResLoading] = useState(true);

  useEffect(() => {
    getStore().then(async store => {
      const rate = await store.get<number>('card_commission_rate');
      setCommissionRate(rate ?? 0);
    });
  }, []);

  // Załaduj rezerwacje na ten dzień
  useEffect(() => {
    let cancel = false;
    setResLoading(true);
    getReservationsForDate(date)
      .then(list => { if (!cancel) setReservations(list); })
      .catch(() => { if (!cancel) setReservations([]); })
      .finally(() => { if (!cancel) setResLoading(false); });
    return () => { cancel = true; };
  }, [date]);

  const updateResStatus = async (id: string, status: 'confirmed' | 'completed' | 'no_show') => {
    // optimistic update
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    try {
      await setReservationStatus(id, status);
    } catch (e) {
      console.error('[RevenueForm] setReservationStatus error:', e);
      // revert
      const fresh = await getReservationsForDate(date).catch(() => []);
      setReservations(fresh);
    }
  };

  const coins     = form.qty_1*1 + form.qty_2*2 + form.qty_5*5;
  const banknotes = form.qty_10*10 + form.qty_20*20 + form.qty_50*50 + form.qty_100*100 + form.qty_200*200 + form.qty_500*500;
  const cash      = coins + banknotes;
  const base_total = form.base_qty_1*1 + form.base_qty_2*2 + form.base_qty_5*5
                   + form.base_qty_10*10 + form.base_qty_20*20 + form.base_qty_50*50
                   + form.base_qty_100*100 + form.base_qty_200*200 + form.base_qty_500*500;
  const do_sejfu  = cash - base_total;
  const card_net  = form.card  * (1 - commissionRate / 100);
  const blik_net  = form.blik  * (1 - commissionRate / 100);
  const total     = cash + form.card + form.blik;
  const cars      = Math.round(total / 20);

  const setQty     = (key: string) => (n: number) =>
    setForm(f => ({ ...f, [key]: Math.max(0, n) }));
  const setBaseQty = (key: string) => (n: number) =>
    setForm(f => ({ ...f, [key]: Math.max(0, n) }));

  const coinDenoms     = DENOMS.filter(d => d.type === 'coin');
  const noteDenoms     = DENOMS.filter(d => d.type === 'note');
  const baseCoinDenoms = BASE_DENOMS.filter(d => d.type === 'coin');
  const baseNoteDenoms = BASE_DENOMS.filter(d => d.type === 'note');

  // Diff vs poprzedni dzień (Razem przychód)
  const [prevTotal, setPrevTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancel = false;
    const dt = new Date(date + 'T00:00:00');
    dt.setDate(dt.getDate() - 1);
    const prev = dt.toISOString().slice(0, 10);
    import('../../lib/database').then(m => m.getDailyRevenue(prev))
      .then(rev => {
        if (cancel || !rev) { if (!cancel) setPrevTotal(null); return; }
        const cash = (rev.qty_1 ?? 0) * 1 + (rev.qty_2 ?? 0) * 2 + (rev.qty_5 ?? 0) * 5
          + (rev.qty_10 ?? 0) * 10 + (rev.qty_20 ?? 0) * 20 + (rev.qty_50 ?? 0) * 50
          + (rev.qty_100 ?? 0) * 100 + (rev.qty_200 ?? 0) * 200 + (rev.qty_500 ?? 0) * 500;
        setPrevTotal(cash + (rev.card ?? 0) + (rev.blik ?? 0));
      })
      .catch(() => { if (!cancel) setPrevTotal(null); });
    return () => { cancel = true; };
  }, [date]);

  const diff = prevTotal != null ? total - prevTotal : null;

  // Auto-focus pierwsze puste pole monet (saszetka) po załadowaniu
  const firstCoinRef = React.useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (firstCoinRef.current && !form.qty_1) firstCoinRef.current.focus();
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await upsertDailyRevenue({
        date, ...form,
        temperature: form.temperature !== '' ? parseFloat(form.temperature) : undefined,
        weather: form.weather || undefined,
      });
      onSave();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  const dt = new Date(date + 'T00:00:00');
  const dayLabel = `${DOW_PL[dt.getDay()]}, ${dt.getDate()} ${MONTHS[dt.getMonth()].toLowerCase()} ${dt.getFullYear()}`;

  // Stepper: ile sekcji zaczęto (do progress)
  const stepDone = {
    sash:  cash > 0,
    base:  base_total > 0,
    cards: form.card > 0 || form.blik > 0 || !!form.weather || !!form.notes,
  };

  return (
    <div className="max-w-[960px] mx-auto space-y-4 pb-24">
      {/* HEADER — gradient TYLKO w headerze */}
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-gradient-accent px-6 py-4 shadow-[var(--shadow-md)] flex items-center gap-4 flex-wrap">
        <div className="w-12 h-12 rounded-[var(--radius-md)] bg-black/15 flex items-center justify-center flex-shrink-0">
          <Calendar size={22} className="text-[#1a1410]" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <p className="text-[11px] text-[#1a1410]/70 uppercase tracking-[0.18em] font-bold">Wpis dzienny</p>
          <h3 className="text-lg font-bold text-[#1a1410] leading-tight">{dayLabel}</h3>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[#1a1410]/70 uppercase tracking-wider font-bold">Razem</p>
          <p className="text-3xl font-bold text-[#1a1410] tabular-nums leading-none">{formatPLN(total)}</p>
          {diff != null && diff !== 0 && (
            <p className={`text-[11px] font-bold mt-0.5 tabular-nums ${diff >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
              {diff >= 0 ? '+' : ''}{formatPLN(diff)} vs wczoraj
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Zamknij"
          className="hidden absolute top-2 right-2 w-7 h-7 rounded-full bg-black/15 hover:bg-black/30 text-[#1a1410] items-center justify-center transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* TOP ROW — AUT + REZERWACJE */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
        <div className="glass-strong rounded-[var(--radius-md)] p-4 flex flex-col items-center justify-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)] font-bold mb-1 flex items-center gap-1">
            <CarIcon size={11} /> ~ aut
          </p>
          <p className="text-4xl font-bold text-[var(--color-text)] tabular-nums leading-none">{cars}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1 opacity-70">szac. {formatPLN(20)} / auto</p>
        </div>

        <div className="glass-strong rounded-[var(--radius-md)] p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <p className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider flex items-center gap-1.5">
              🎫 Rezerwacje na ten dzień
              {!resLoading && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent)] font-mono">
                  {reservations.length}
                </span>
              )}
            </p>
            {!resLoading && reservations.length > 0 && (
              <p className="text-[10px] text-[var(--color-text-muted)]">
                ✅ {reservations.filter(r => r.status === 'completed').length} ·
                ❌ {reservations.filter(r => r.status === 'no_show').length} ·
                ⏳ {reservations.filter(r => r.status === 'confirmed' || !r.status).length}
              </p>
            )}
          </div>
          {resLoading ? (
            <div className="flex justify-center py-2"><Spinner /></div>
          ) : reservations.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-2 italic">Brak rezerwacji na ten dzień</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[110px] overflow-y-auto pr-1">
              {reservations.map(r => {
                const status = r.status ?? 'confirmed';
                return (
                  <div key={r.id} className="flex items-center gap-2 bg-[var(--color-surface)] rounded-md p-1.5 border border-[var(--color-border)]">
                    <span className="font-mono font-bold text-xs text-[var(--color-text)] tracking-wider flex-1 truncate">{r.registration}</span>
                    <div className="flex gap-0.5">
                      <button type="button" onClick={() => updateResStatus(r.id, 'completed')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all
                          ${status === 'completed' ? 'bg-emerald-500 text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-emerald-500/20 hover:text-emerald-400'}`}
                        title="Klient był">✓</button>
                      <button type="button" onClick={() => updateResStatus(r.id, 'no_show')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all
                          ${status === 'no_show' ? 'bg-red-500 text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-red-500/20 hover:text-red-400'}`}
                        title="Nie pojawił się">✕</button>
                      <button type="button" onClick={() => updateResStatus(r.id, 'confirmed')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all
                          ${status === 'confirmed' ? 'bg-amber-500 text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-amber-500/20 hover:text-amber-400'}`}
                        title="Czeka">⏳</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* STEPPER 1→2→3 — progress indicator */}
      <div className="flex items-center gap-1 px-1">
        {([
          { id: 'sash', label: 'Saszetka', icon: <Coins size={14} />, done: stepDone.sash },
          { id: 'base', label: 'Baza',     icon: <Vault size={14} />, done: stepDone.base },
          { id: 'cards',label: 'Bezgot.',  icon: <CreditCard size={14} />, done: stepDone.cards },
        ] as const).map((s, i, arr) => (
          <React.Fragment key={s.id}>
            <div className="flex items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all
                ${s.done ? 'bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-sm)]' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'}`}>
                {s.done ? <Check size={12} /> : (i + 1)}
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-wider ${s.done ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                {s.label}
              </span>
            </div>
            {i < arr.length - 1 && <div className={`flex-1 h-0.5 ${s.done ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* 3 KOLUMNY — wszystko widoczne naraz */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* === SASZETKA === */}
        <div className="glass-strong rounded-[var(--radius-md)] p-4 space-y-3 animate-slideUp">
          <div className="flex items-center gap-2">
            <div className="w-1 h-6 bg-gradient-accent rounded-full" />
            <p className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider">📦 Saszetka — koniec zmiany</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                <Coins size={11} /> Monety
              </p>
              <span className="text-[11px] text-amber-400 font-bold tabular-nums">{formatPLN(coins)}</span>
            </div>
            <div className="bg-[var(--color-surface-2)]/30 rounded-md p-1 space-y-0.5">
              {coinDenoms.map((d, idx) => (
                <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number}
                  onChange={setQty(d.key)}
                  inputRef={idx === 0 ? firstCoinRef : undefined} />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Banknote size={11} /> Banknoty
              </p>
              <span className="text-[11px] text-emerald-400 font-bold tabular-nums">{formatPLN(banknotes)}</span>
            </div>
            <div className="bg-[var(--color-surface-2)]/30 rounded-md p-1 space-y-0.5">
              {noteDenoms.map(d => (
                <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setQty(d.key)} />
              ))}
            </div>
          </div>

          <div className="bg-gradient-accent rounded-md px-3 py-2.5 flex justify-between items-center shadow-[var(--shadow-md)]">
            <span className="text-[#1a1410] font-bold text-xs uppercase tracking-wider">Suma</span>
            <span className="text-[#1a1410] font-bold text-lg tabular-nums">{formatPLN(cash)}</span>
          </div>
        </div>

        {/* === BAZA === */}
        <div className="glass-strong rounded-[var(--radius-md)] p-4 space-y-3 animate-slideUp" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-2">
            <div className="w-1 h-6 bg-yellow-400 rounded-full" />
            <p className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider">💰 Baza na jutro</p>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] -mt-1">Co zostawiasz w saszetce jako resztę.</p>

          <div>
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">Monety</p>
            <div className="bg-[var(--color-surface-2)]/30 rounded-md p-1 space-y-0.5">
              {baseCoinDenoms.map(d => (
                <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setBaseQty(d.key)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5">Banknoty</p>
            <div className="bg-[var(--color-surface-2)]/30 rounded-md p-1 space-y-0.5">
              {baseNoteDenoms.map(d => (
                <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setBaseQty(d.key)} />
              ))}
            </div>
          </div>

          <div className="bg-yellow-500/15 border-2 border-yellow-500/40 rounded-md px-3 py-2.5 flex justify-between items-center">
            <span className="text-yellow-300 font-bold text-xs uppercase tracking-wider">Razem</span>
            <span className="text-yellow-200 font-bold text-lg tabular-nums">{formatPLN(base_total)}</span>
          </div>
        </div>

        {/* === BEZGOTÓWKOWE + KONTEKST === */}
        <div className="glass-strong rounded-[var(--radius-md)] p-4 space-y-3 animate-slideUp" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-2">
            <div className="w-1 h-6 bg-blue-400 rounded-full" />
            <p className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider">💳 Bezgotówkowe</p>
          </div>

          <label className="block">
            <span className="text-[11px] font-semibold text-blue-400 mb-1 flex items-center gap-1.5"><CreditCard size={12} /> Karta</span>
            <input type="number" min="0" step="0.01" value={form.card || ''} placeholder="0,00"
              onChange={e => setForm(f => ({ ...f, card: Math.max(0, parseFloat(e.target.value) || 0) }))}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2.5 py-1.5 text-[var(--color-text)] focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none font-mono text-sm" />
            {commissionRate > 0 && form.card > 0 && (
              <p className="text-[10px] text-emerald-400 mt-0.5">netto −{commissionRate}%: <span className="font-bold">{formatPLN(card_net)}</span></p>
            )}
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-purple-400 mb-1 flex items-center gap-1.5"><Smartphone size={12} /> BLIK</span>
            <input type="number" min="0" step="0.01" value={form.blik || ''} placeholder="0,00"
              onChange={e => setForm(f => ({ ...f, blik: Math.max(0, parseFloat(e.target.value) || 0) }))}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2.5 py-1.5 text-[var(--color-text)] focus:border-purple-400 focus:ring-1 focus:ring-purple-400 outline-none font-mono text-sm" />
            {commissionRate > 0 && form.blik > 0 && (
              <p className="text-[10px] text-emerald-400 mt-0.5">netto −{commissionRate}%: <span className="font-bold">{formatPLN(blik_net)}</span></p>
            )}
          </label>

          <div className="border-t border-[var(--color-border)] pt-2.5 space-y-2">
            <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
              <Cloud size={11} /> Kontekst dnia
            </p>
            <div className="grid grid-cols-4 gap-1">
              {WEATHER_OPTIONS.map(w => (
                <button key={w.value} type="button"
                  onClick={() => setForm(f => ({ ...f, weather: f.weather === w.value ? '' : w.value }))}
                  className={`flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-md border text-xs transition-all
                    ${form.weather === w.value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-text)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-accent-border)]'}`}
                  title={w.label}>
                  <span className="text-base leading-none">{w.icon}</span>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-[10px] font-semibold text-[var(--color-text-muted)] mb-0.5 flex items-center gap-1"><Thermometer size={11} /> Temp. (°C)</span>
              <input type="number" step="0.5" min="-30" max="50" value={form.temperature} placeholder="np. 22"
                onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none font-mono text-sm" />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-[var(--color-text-muted)] mb-0.5 block">📝 Notatki</span>
              <input type="text" value={form.notes} placeholder="Komentarz do dnia…"
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none text-sm" />
            </label>
          </div>
        </div>
      </div>

      {/* PODSUMOWANIE — sticky bottom (zostaje) */}
      <div className="glass-strong rounded-[var(--radius-md)] p-3 sticky bottom-0 border-2 border-[var(--color-accent-border)] shadow-[var(--shadow-xl)] backdrop-blur-md">
        <div className="grid grid-cols-4 gap-3 items-center">
          <div className="text-center">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Saszetka</p>
            <p className="text-sm font-bold text-amber-400 tabular-nums">{formatPLN(cash)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase">− Baza</p>
            <p className="text-sm font-bold text-yellow-400 tabular-nums">−{formatPLN(base_total)}</p>
          </div>
          <div className="text-center border-l-2 border-[var(--color-accent-border)] pl-2">
            <p className="text-[10px] text-[var(--color-accent)] uppercase font-bold flex items-center justify-center gap-1"><Vault size={10} /> Sejf</p>
            <p className="text-base font-bold text-[var(--color-accent)] tabular-nums">{formatPLN(do_sejfu)}</p>
          </div>
          <div className="text-right border-l-2 border-[var(--color-accent-border)] pl-2">
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Razem przychód {commissionRate > 0 && '(brutto)'}</p>
            <p className="text-2xl font-bold text-[var(--color-accent)] tabular-nums leading-none">{formatPLN(total)}</p>
            {diff != null && diff !== 0 && (
              <p className={`text-[10px] font-bold mt-0.5 tabular-nums ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {diff >= 0 ? '+' : ''}{formatPLN(diff)} vs wczoraj
              </p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2 flex items-center gap-2">
          <X size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      {/* FAB — Zapisz */}
      <button type="button" onClick={handleSave} disabled={saving}
        className="fixed bottom-8 right-8 z-50 inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full font-bold text-sm text-[#1a1410] shadow-[var(--shadow-xl)] hover:shadow-[var(--shadow-glow)] transition-all duration-300 hover:scale-105 active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-accent ring-glow">
        {saving ? (
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        ) : <Check size={16} />}
        <span>{saving ? 'Zapisuję…' : 'Zapisz zamknięcie dnia'}</span>
      </button>
    </div>
  );
}

// --- Invoice Form ---
interface InvoiceFormProps {
  initial: Invoice | null;
  defaultDate: string;
  onSave: () => void;
  onClose: () => void;
}

const CATEGORY_META: Record<typeof CATEGORIES[number], { icon: string; color: string }> = {
  'Usługi':     { icon: '🔧', color: 'teal' },
  'Podatki':    { icon: '🏛️', color: 'orange' },
  'Materiały':  { icon: '📦', color: 'yellow' },
  'Inwestycja': { icon: '🚀', color: 'purple' },
};

const PAYMENT_METHODS = [
  { value: 'gotówka', icon: '💵', label: 'Gotówka' },
  { value: 'karta',   icon: '💳', label: 'Karta' },
  { value: 'BLIK',    icon: '📱', label: 'BLIK' },
  { value: 'przelew', icon: '🏦', label: 'Przelew' },
] as const;

function InvoiceForm({ initial, defaultDate, onSave, onClose }: InvoiceFormProps) {
  const [form, setForm] = useState<Omit<Invoice, 'id' | 'created_at'>>({
    name: initial?.name ?? '',
    amount: initial?.amount ?? 0,
    date: initial?.date ?? defaultDate,
    category: initial?.category ?? 'Usługi',
    supplier: initial?.supplier ?? '',
    payment_method: initial?.payment_method ?? 'przelew',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.name.trim() || form.amount <= 0) {
      setError('Uzupełnij nazwę i kwotę.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (initial?.id) {
        await updateInvoice(initial.id, form);
        logInvoiceAction('update', String(initial.id), form.name);
      } else {
        await addInvoice(form);
        logInvoiceAction('add', '', form.name);
      }
      onSave();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto pr-1">
      {/* Kategoria — kafelki */}
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Kategoria</label>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES.map(c => {
            const meta = CATEGORY_META[c];
            const active = form.category === c;
            return (
              <button key={c} type="button"
                onClick={() => setForm(f => ({ ...f, category: c }))}
                className={`flex flex-col items-center gap-1 px-2 py-3 rounded-lg border text-xs transition-all
                  ${active
                    ? `border-${meta.color}-500 bg-${meta.color}-500/20 text-white scale-105`
                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'}`}
              >
                <span className="text-2xl leading-none">{meta.icon}</span>
                <span className="font-medium">{c}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nazwa + sprzedawca */}
      <Input label="Nazwa / opis faktury" type="text" value={form.name}
        placeholder="np. Faktura za prąd lipiec"
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      <Input label="Sprzedawca / kontrahent (opcjonalnie)" type="text" value={form.supplier ?? ''}
        placeholder="np. Energa SA, NIP 957..."
        onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />

      {/* Kwota + data */}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Kwota brutto (PLN)" type="number" min="0.01" step="0.01" value={form.amount}
          onChange={e => setForm(f => ({ ...f, amount: Math.max(0, parseFloat(e.target.value) || 0) }))} />
        <Input label="Data" type="date" value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
      </div>

      {/* Sposób płatności */}
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Sposób płatności</label>
        <div className="grid grid-cols-4 gap-2">
          {PAYMENT_METHODS.map(p => {
            const active = form.payment_method === p.value;
            return (
              <button key={p.value} type="button"
                onClick={() => setForm(f => ({ ...f, payment_method: p.value }))}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs transition-all
                  ${active ? 'border-teal-500 bg-teal-500/20 text-white' : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'}`}
              >
                <span className="text-lg leading-none">{p.icon}</span>
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Podgląd */}
      <div className="bg-slate-900/60 rounded-lg px-4 py-3 border border-teal-500/30 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {CATEGORY_META[form.category].icon} {form.category}
          {form.payment_method && <span className="ml-2 text-slate-500">• {form.payment_method}</span>}
        </div>
        <span className="text-2xl font-bold text-teal-300">{formatPLN(form.amount)}</span>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-3 mt-1">
        <Button variant="primary" onClick={handleSave} loading={saving} className="flex-1">
          <Check size={16} /> Zapisz
        </Button>
        <Button variant="ghost" onClick={onClose} className="flex-1">Anuluj</Button>
      </div>
    </div>
  );
}

// --- Main Finances ---
export default function Finances() {
  const perm = usePerm();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [revenues, setRevenues] = useState<DailyRevenue[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'revenues' | 'invoices' | 'stats' | 'raport-d' | 'raport-m' | 'raport-r' | 'all-time' | 'raport-w' | 'prognoza' | 'pogoda' | 'sezony' | 'kpi' | 'koszty-cykliczne'>('revenues');
  type TabGroup = 'wpisy' | 'raporty' | 'analizy' | 'koszty';
  const TAB_GROUPS: { group: TabGroup; label: string; tabs: [typeof tab, string][] }[] = [
    { group: 'wpisy', label: '📝 Wpisy', tabs: [['revenues', 'Przychody'], ['invoices', 'Faktury'], ['stats', 'Wykres']] },
    { group: 'koszty', label: '💸 Koszty', tabs: [['koszty-cykliczne', 'Cykliczne'], ['kpi', 'Dashboard KPI']] },
    { group: 'raporty', label: '📊 Raporty', tabs: [['raport-d', 'Dzień'], ['raport-w', 'Tydzień'], ['raport-m', 'Miesiąc'], ['raport-r', 'Rok'], ['all-time', 'Cały parking']] },
    { group: 'analizy', label: '🔬 Analizy', tabs: [['prognoza', 'Prognoza'], ['pogoda', 'Pogoda'], ['sezony', 'Sezony']] },
  ];
  const activeGroup = TAB_GROUPS.find(g => g.tabs.some(([t]) => t === tab))?.group ?? 'wpisy';
  const [weekOffset, setWeekOffset] = useState(0);
  // selectedDayDate used by DailyReport tab
  const [selectedDayDate, _setSelectedDayDate] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingOwner, setExportingOwner] = useState(false);
  const [commissionRateMain, setCommissionRateMain] = useState(0);

  useEffect(() => {
    getStore().then(async store => {
      const rate = await store.get<number>('card_commission_rate');
      setCommissionRateMain(rate ?? 0);
    });
  }, []);
  const [totalInvestments, setTotalInvestments] = useState(0);
  const [totalRevenueAllTime, setTotalRevenueAllTime] = useState(0);

  // Revenue modal
  const [revModalDate, setRevModalDate] = useState<string | null>(null);
  const [revModalInitial, setRevModalInitial] = useState<DailyRevenue | null>(null);

  // Invoice modal
  const [invModalOpen, setInvModalOpen] = useState(false);
  const [invEditItem, setInvEditItem] = useState<Invoice | null>(null);
  const [deleteInvId, setDeleteInvId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Revenue delete auth
  const [deleteRevDate, setDeleteRevDate] = useState<string | null>(null);
  const [deleteRevPwd, setDeleteRevPwd] = useState('');
  const [deleteRevError, setDeleteRevError] = useState('');
  const [deleteRevLoading, setDeleteRevLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const fail = (scope: string, error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${scope}: ${detail}`);
      };

      const rev = await getMonthlyRevenue(year, month).catch(error => fail('Przychody', error));
      const inv = await getMonthlyInvoices(year, month).catch(error => fail('Faktury', error));
      const totalInv = await getTotalInvestments().catch(error => fail('Inwestycje', error));
      const totalRev = await getTotalRevenue().catch(error => fail('Suma przychodów', error));

      setRevenues(rev);
      setInvoices(inv);
      setTotalInvestments(totalInv);
      setTotalRevenueAllTime(totalRev);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Błąd ładowania danych');
    } finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const totalRevenue = revenues.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalOperationalCosts = invoices.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const totalInvestmentCosts  = invoices.filter(i => i.category === 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const totalCosts = invoices.reduce((s, i) => s + i.amount, 0);
  const profit = totalRevenue - totalCosts;
  // totalCars available for future use
  void revenues.reduce((s, r) => s + (r.estimated_cars ?? 0), 0);
  const roiRemaining = Math.max(0, totalInvestments - totalRevenueAllTime);

  const chartData = revenues.map(r => ({
    date: r.date.split('-')[2],
    total: +(r.total ?? 0).toFixed(2),
  }));

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const openRevModal = async (date: string) => {
    const { getDailyRevenue } = await import('../../lib/database');
    const existing = await getDailyRevenue(date);
    // guard: edycja istniejącego = finances.edit, nowy = finances.add_income
    const needPerm = existing ? 'finances.edit' : 'finances.add_income';
    if (!perm.guard(needPerm, existing ? 'edycja wpisu dziennego' : 'dodanie wpisu dziennego')) return;
    setRevModalInitial(existing);
    setRevModalDate(date);
  };

  // Iter 13: nasłuch eventów z Command Palette (Ctrl+O → Akcje)
  useEffect(() => {
    const onRevenue = () => { void openRevModal(new Date().toISOString().slice(0, 10)); };
    const onInvoice = () => {
      if (!perm.guard('finances.add_invoice', 'dodanie faktury')) return;
      setInvEditItem(null);
      setInvModalOpen(true);
    };
    window.addEventListener('cmdpal:finances:revenue', onRevenue);
    window.addEventListener('cmdpal:finances:invoice', onInvoice);
    return () => {
      window.removeEventListener('cmdpal:finances:revenue', onRevenue);
      window.removeEventListener('cmdpal:finances:invoice', onInvoice);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteInvoice = async () => {
    if (!deleteInvId) return;
    if (!perm.guard('finances.delete', 'usunięcie faktury')) { setDeleteInvId(null); return; }
    setDeleting(true);
    try { await deleteInvoice(deleteInvId); logInvoiceAction('delete', String(deleteInvId)); setDeleteInvId(null); await load(); }
    finally { setDeleting(false); }
  };

  const handleDeleteRevenue = async () => {
    if (!deleteRevDate) return;
    if (!perm.guard('finances.delete', 'usunięcie wpisu przychodu')) { setDeleteRevDate(null); return; }
    setDeleteRevLoading(true);
    setDeleteRevError('');
    try {
      const ok = await verifyCurrentPassword(deleteRevPwd);
      if (!ok) {
        setDeleteRevError('Nieprawidlowe haslo.');
        return;
      }
      await deleteDailyRevenue(deleteRevDate);
      setDeleteRevDate(null);
      setDeleteRevPwd('');
      await load();
    } catch (e) {
      setDeleteRevError(e instanceof Error ? e.message : 'Błąd usuwania');
    } finally {
      setDeleteRevLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try { await exportMonthToExcel(year, month, revenues, invoices); logExport('month', year, month); }
    catch (e) { console.error(e); }
    finally { setExporting(false); }
  };

  const handleExportOwner = async () => {
    setExportingOwner(true);
    try { await exportOwnerToExcel(year, month, revenues, invoices, totalInvestments, commissionRateMain); logExport('owner', year, month); }
    catch (e) { console.error(e); }
    finally { setExportingOwner(false); }
  };

  const defaultDate = `${year}-${String(month).padStart(2, '0')}-01`;

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden max-w-[1600px] mx-auto w-full">
      {/* HERO HEADER */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0 animate-slideUp">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-[var(--radius-lg)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)] ring-glow">
            <Wallet size={28} className="text-[#1a1410]" />
          </div>
          <div>
            <h1 className="display-heading">Finanse</h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Utargi · faktury · koszty cykliczne · KPI — prywatny moduł CEO
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-strong rounded-[var(--radius-md)] flex items-center gap-1 px-2 py-1.5">
            <button onClick={prevMonth} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"><ChevronLeft size={18} /></button>
            <span className="text-sm font-semibold text-[var(--color-text)] min-w-[130px] text-center">{MONTHS[month - 1]} {year}</span>
            <button onClick={nextMonth} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"><ChevronRight size={18} /></button>
          </div>
          <Button variant="secondary" onClick={handleExport} loading={exporting} size="sm">
            <Download size={15} /> Eksportuj Excel
          </Button>
          <Button variant="secondary" onClick={handleExportOwner} loading={exportingOwner} size="sm">
            <Download size={15} /> Excel Właścicielski
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3 mb-5 flex-shrink-0">
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Przychody</p>
          <p className="text-xl font-bold text-teal-400">{formatPLN(totalRevenue)}</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Koszty oper.</p>
          <p className="text-xl font-bold text-orange-400">{formatPLN(totalOperationalCosts)}</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Inwestycje</p>
          <p className="text-xl font-bold text-purple-400">{formatPLN(totalInvestmentCosts)}</p>
        </Card>
        <Card className="text-center py-3 border border-green-500/20">
          <p className="text-slate-500 text-xs mb-1">Zysk na czysto</p>
          <p className={`text-xl font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPLN(profit)}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">po wszystkich kosztach</p>
        </Card>
        <Card className="text-center py-3 border border-purple-500/30">
          <p className="text-slate-500 text-xs mb-1">Do zwrotu inwest.</p>
          {totalInvestments === 0
            ? <p className="text-sm text-slate-600">Brak inwestycji</p>
            : roiRemaining === 0
              ? <p className="text-sm font-bold text-green-400">Spłacona! 🎉</p>
              : <p className="text-sm font-bold text-purple-400">{formatPLN(roiRemaining)}</p>
          }
        </Card>
      </div>

      {/* Tab Groups */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-3 mb-4 flex-shrink-0">
        {/* Main group buttons */}
        <div className="flex gap-1.5 mb-2">
          {TAB_GROUPS.map(g => (
            <button
              key={g.group}
              onClick={() => setTab(g.tabs[0][0])}
              className={`px-5 py-2.5 rounded-[var(--radius-md)] text-sm font-bold transition-all duration-200
                ${activeGroup === g.group
                  ? 'bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-md)] scale-[1.02]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        {/* Sub-tabs for active group */}
        <div className="flex gap-1 flex-wrap pl-1 pt-1 border-t border-[var(--color-border)]">
          {TAB_GROUPS.find(g => g.group === activeGroup)!.tabs.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors
                ${tab === t
                  ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)] border border-[var(--color-accent-border)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-red-400 text-sm">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={load}>Spróbuj ponownie</Button>
          </div>
        ) : tab === 'revenues' ? (
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-700">
                  <th className="text-left py-2 pl-2">Data</th>
                  <th className="text-right py-2">DO SEJFU</th>
                  <th className="text-right py-2">Karta</th>
                  <th className="text-right py-2">BLIK</th>
                  <th className="text-right py-2">Razem</th>
                  <th className="text-right py-2">Auta</th>
                  <th className="text-center py-2">Pogoda</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {revenues.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-slate-500 py-10">Brak danych za ten miesiąc</td></tr>
                ) : revenues.map(r => {
                  return (
                    <tr
                      key={r.date}
                      className="border-b border-slate-800 hover:bg-slate-800 cursor-pointer transition-colors group"
                      onClick={() => openRevModal(r.date)}
                    >
                      <td className="py-2.5 pl-2 text-white font-medium">{r.date}</td>
                      <td className="text-right py-2.5 text-teal-300 font-semibold">{formatPLN(r.do_sejfu ?? 0)}</td>
                      <td className="text-right py-2.5 text-slate-300">{formatPLN(r.card)}</td>
                      <td className="text-right py-2.5 text-slate-300">{formatPLN(r.blik)}</td>
                      <td className="text-right py-2.5 text-teal-400 font-semibold">{formatPLN(r.total ?? 0)}</td>
                      <td className="text-right py-2.5 text-yellow-400">{r.estimated_cars ?? 0}</td>
                      <td className="text-center py-2.5 text-base">
                        {r.weather === 'sunny' ? '☀️' : r.weather === 'cloudy' ? '🌤️' : r.weather === 'rainy' ? '🌧️' : r.weather === 'stormy' ? '⛈️' : ''}
                        {r.temperature != null ? <span className="text-xs text-slate-400 ml-1">{r.temperature}°</span> : null}
                      </td>
                      <td className="py-2.5 pr-1">
                        <div className="flex justify-end opacity-0 group-hover:opacity-100">
                          {perm.has('finances.delete') && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteRevDate(r.date); setDeleteRevPwd(''); setDeleteRevError(''); }}
                              className="text-slate-400 hover:text-red-400 p-1 rounded"
                              title="Usuń raport"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              onClick={() => {
                const lastDay = new Date(year, month, 0).getDate();
                const day = Math.min(new Date().getDate(), lastDay);
                openRevModal(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
              }}
              className="mt-4 w-full py-3 border border-dashed border-slate-700 text-slate-500 text-sm rounded-xl hover:border-teal-500/50 hover:text-teal-400 transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Dodaj/edytuj dzień
            </button>
          </div>
        ) : tab === 'raport-d' ? (
          <DailyReport
            revenues={revenues}
            invoices={invoices}
            selectedDate={selectedDayDate}
            commissionRate={commissionRateMain}
          />
        ) : tab === 'raport-w' ? (
          <WeeklyReport
            revenues={revenues}
            weekOffset={weekOffset}
            onOffsetChange={setWeekOffset}
          />
        ) : tab === 'raport-m' ? (
          <MonthlyReport
            revenues={revenues}
            invoices={invoices}
            year={year}
            month={month}
          />
        ) : tab === 'raport-r' ? (
          <YearlyReport
            year={year}
            totalInvestments={totalInvestments}
            totalRevenueAllTime={totalRevenueAllTime}
          />
        ) : tab === 'all-time' ? (
          <AllTimeReport />
        ) : tab === 'prognoza' ? (
          <ForecastReport currentYear={year} />
        ) : tab === 'pogoda' ? (
          <WeatherReport revenues={revenues} />
        ) : tab === 'sezony' ? (
          <SeasonCompare currentYear={year} />
        ) : tab === 'koszty-cykliczne' ? (
          <RecurringExpenses year={year} month={month} />
        ) : tab === 'kpi' ? (
          <FinanceKPI year={year} month={month} />
        ) : tab === 'invoices' ? (
          <div>
            <div className="flex justify-end mb-3">
              {perm.has('finances.add_expense') && (
                <Button variant="primary" size="sm" onClick={() => { setInvEditItem(null); setInvModalOpen(true); }}>
                  <Plus size={15} /> Dodaj fakturę
                </Button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-700">
                  <th className="text-left py-2 pl-2">Data</th>
                  <th className="text-left py-2">Nazwa</th>
                  <th className="text-left py-2">Kategoria</th>
                  <th className="text-right py-2 pr-2">Kwota</th>
                  <th className="py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-slate-500 py-10">Brak faktur za ten miesiąc</td></tr>
                ) : invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800 transition-colors group">
                    <td className="py-2.5 pl-2 text-slate-300">{inv.date}</td>
                    <td className="py-2.5 text-white font-medium">{inv.name}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                        ${inv.category === 'Podatki' ? 'bg-orange-500/20 text-orange-400' :
                          inv.category === 'Usługi' ? 'bg-teal-500/20 text-teal-400' :                          inv.category === 'Inwestycja' ? 'bg-purple-500/20 text-purple-400' :                          'bg-yellow-500/20 text-yellow-400'}`}>
                        {inv.category}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 text-right text-red-400 font-semibold">{formatPLN(inv.amount)}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 justify-end pr-1">
                        {perm.has('finances.edit') && (
                          <button onClick={() => { setInvEditItem(inv); setInvModalOpen(true); }} className="text-slate-400 hover:text-teal-400 p-1 rounded"><Pencil size={13} /></button>
                        )}
                        {perm.has('finances.delete') && (
                          <button onClick={() => setDeleteInvId(inv.id!)} className="text-slate-400 hover:text-red-400 p-1 rounded"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          // Chart tab
          <div className="h-full">
            <Card title="Przychody dzienne (PLN)" className="h-72">
              {chartData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">Brak danych za ten miesiąc</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v} zł`} />
                    <Tooltip
                      formatter={(value) => [formatPLN(Number(value)), 'Przychód']}
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Bar dataKey="total" fill="#4dbfbf" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Revenue Modal — szeroki panel (12.c) */}
      <Modal open={!!revModalDate} onClose={() => setRevModalDate(null)} title="Wpis dzienny" maxWidth="max-w-5xl">
        {revModalDate && (
          <RevenueForm
            date={revModalDate}
            initial={revModalInitial}
            onSave={load}
            onClose={() => setRevModalDate(null)}
          />
        )}
      </Modal>

      {/* Invoice Add/Edit Modal */}
      <Modal open={invModalOpen} onClose={() => setInvModalOpen(false)} title={invEditItem ? 'Edytuj fakturę' : 'Nowa faktura'}>
        <InvoiceForm
          initial={invEditItem}
          defaultDate={defaultDate}
          onSave={load}
          onClose={() => setInvModalOpen(false)}
        />
      </Modal>

      {/* Delete Invoice Modal */}
      <Modal open={!!deleteInvId} onClose={() => setDeleteInvId(null)} title="Usuń fakturę">
        <p className="text-slate-300 text-sm mb-5">Czy na pewno chcesz usunąć tę fakturę?</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDeleteInvoice} loading={deleting} className="flex-1"><Trash2 size={16} /> Usuń</Button>
          <Button variant="ghost" onClick={() => setDeleteInvId(null)} className="flex-1">Anuluj</Button>
        </div>
      </Modal>

      {/* Delete Revenue Auth Modal */}
      <Modal
        open={!!deleteRevDate}
        onClose={() => { setDeleteRevDate(null); setDeleteRevPwd(''); setDeleteRevError(''); }}
        title="Usuń raport dzienny"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
            <Trash2 size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-red-300 text-sm font-medium">Usuwasz wpis z dnia {deleteRevDate}</p>
              <p className="text-slate-400 text-xs mt-0.5">Tej operacji nie można cofnąć.</p>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Lock size={12} />
              <span className="uppercase tracking-wider font-medium">Wymagane potwierdzenie tożsamości</span>
            </div>
            <p className="text-slate-400 text-xs">Podaj hasło, którym logujesz się do <span className="text-white font-medium">Parking.OS</span> przy każdym uruchomieniu aplikacji.</p>
          </div>
          <Input
            label="Hasło Parking.OS"
            type="password"
            value={deleteRevPwd}
            onChange={e => { setDeleteRevPwd(e.target.value); setDeleteRevError(''); }}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') handleDeleteRevenue(); }}
            autoFocus
            placeholder="Wpisz hasło aplikacji..."
          />
          {deleteRevError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <p className="text-red-300 text-xs">{deleteRevError}</p>
              {deleteRevError === 'Nieprawidłowe hasło.' && (
                <p className="text-slate-500 text-xs mt-0.5">To hasło które wpisujesz przy starcie Parking.OS — możesz je zmienić w Ustawieniach.</p>
              )}
            </div>
          )}
          <div className="flex gap-3 mt-1">
            <Button variant="danger" onClick={handleDeleteRevenue} loading={deleteRevLoading} className="flex-1">
              <Trash2 size={16} /> Potwierdź i usuń
            </Button>
            <Button variant="ghost" onClick={() => { setDeleteRevDate(null); setDeleteRevPwd(''); setDeleteRevError(''); }} className="flex-1">Anuluj</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
