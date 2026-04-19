import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download, Check, Lock } from 'lucide-react';
import {
  getMonthlyRevenue, upsertDailyRevenue, deleteDailyRevenue, DailyRevenue, DENOMS, BASE_DENOMS,
  getMonthlyInvoices, addInvoice, updateInvoice, deleteInvoice, Invoice,
  getTotalInvestments, getTotalRevenue,
} from '../../lib/database';
import { exportMonthToExcel, exportOwnerToExcel } from '../../lib/excel';
import DailyReport from './DailyReport';
import MonthlyReport from './MonthlyReport';
import YearlyReport from './YearlyReport';
import AllTimeReport from './AllTimeReport';
import WeeklyReport from './WeeklyReport';
import ForecastReport from './ForecastReport';
import WeatherReport from './WeatherReport';
import SeasonCompare from './SeasonCompare';
import { verifyPassword } from '../../lib/auth';
import { getStore } from '../../lib/store';
import { Button, Input, Select, Modal, Card, Spinner } from '../shared/UI';
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
interface DenomRowProps {
  d: { key: string; value: number; label: string; type: string };
  qty: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
function DenomRow({ d, qty, onChange }: DenomRowProps) {
  return (
    <div className="grid grid-cols-3 gap-2 items-center mb-1">
      <span className="text-sm text-white pl-1">{d.label}</span>
      <input
        type="number" min="0" step="1" value={qty}
        onChange={onChange}
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm text-center w-full focus:border-teal-500 outline-none"
      />
      <span className="text-right text-sm text-teal-300 font-medium">{formatPLN(qty * d.value)}</span>
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

  useEffect(() => {
    getStore().then(async store => {
      const rate = await store.get<number>('card_commission_rate');
      setCommissionRate(rate ?? 0);
    });
  }, []);

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

  const setQty     = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: Math.max(0, parseInt(e.target.value) || 0) }));
  const setBaseQty = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: Math.max(0, parseInt(e.target.value) || 0) }));

  const coinDenoms     = DENOMS.filter(d => d.type === 'coin');
  const noteDenoms     = DENOMS.filter(d => d.type === 'note');
  const baseCoinDenoms = BASE_DENOMS.filter(d => d.type === 'coin');
  const baseNoteDenoms = BASE_DENOMS.filter(d => d.type === 'note');

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

  return (
    <div className="flex flex-col gap-3 max-h-[80vh] overflow-y-auto pr-1">
      <p className="text-slate-400 text-sm">Data: <span className="text-white font-medium">{date}</span></p>
      <div className="grid grid-cols-3 gap-2 text-xs text-slate-500 px-1">
        <span>Nominał</span><span className="text-center">Ilość (szt.)</span><span className="text-right">Wartość</span>
      </div>

      {/* KROK 1 — Stan saszetki */}
      <div className="bg-slate-800/50 rounded-lg p-3 border border-teal-700/40">
        <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-2">📦 Krok 1 — Stan saszetki (koniec zmiany)</p>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Monety</p>
        {coinDenoms.map(d => <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setQty(d.key)} />)}
        <div className="flex justify-between text-xs bg-slate-900 rounded px-2 py-1.5 mt-1 border border-slate-700/50">
          <span className="text-slate-400">Razem monety</span>
          <span className="text-teal-400 font-semibold">{formatPLN(coins)}</span>
        </div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-2 mb-1">Banknoty</p>
        {noteDenoms.map(d => <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setQty(d.key)} />)}
        <div className="flex justify-between text-xs bg-slate-900 rounded px-2 py-1.5 mt-1 border border-slate-700/50">
          <span className="text-slate-400">Razem banknoty</span>
          <span className="text-teal-400 font-semibold">{formatPLN(banknotes)}</span>
        </div>
        <div className="flex justify-between text-sm bg-teal-500/10 rounded px-2 py-2 mt-2 border border-teal-500/30">
          <span className="text-slate-300 font-medium">SUMA W SASZETCE:</span>
          <span className="text-teal-300 font-bold">{formatPLN(cash)}</span>
        </div>
      </div>

      {/* KROK 2 — Baza na jutro */}
      <div className="bg-slate-800/50 rounded-lg p-3 border border-yellow-700/40">
        <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1">💰 Krok 2 — Zostaje w saszetce (baza na jutro)</p>
        <p className="text-xs text-slate-500 mb-2">Zaznacz nominały, które zostawiasz na następny dzień jako resztę.</p>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Monety</p>
        {baseCoinDenoms.map(d => <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setBaseQty(d.key)} />)}
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-2 mb-1">Banknoty</p>
        {baseNoteDenoms.map(d => <DenomRow key={d.key} d={d} qty={form[d.key as keyof typeof form] as number} onChange={setBaseQty(d.key)} />)}
        <div className="flex justify-between text-sm bg-yellow-500/10 rounded px-2 py-2 mt-2 border border-yellow-500/30">
          <span className="text-slate-300 font-medium">BAZA NA JUTRO:</span>
          <span className="text-yellow-300 font-bold">{formatPLN(base_total)}</span>
        </div>
      </div>

      {/* Bezgotówkowe */}
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">💳 Płatności bezgotówkowe</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Karta (PLN)" type="number" min="0" step="0.01" value={form.card}
            onChange={e => setForm(f => ({ ...f, card: Math.max(0, parseFloat(e.target.value) || 0) }))} />
          <Input label="BLIK (PLN)" type="number" min="0" step="0.01" value={form.blik}
            onChange={e => setForm(f => ({ ...f, blik: Math.max(0, parseFloat(e.target.value) || 0) }))} />
        </div>
        {commissionRate > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-900 rounded px-2 py-1.5 flex justify-between border border-slate-700/50">
              <span className="text-slate-500">Karta netto ({commissionRate}%):</span>
              <span className="text-green-400 font-semibold">{formatPLN(card_net)}</span>
            </div>
            <div className="bg-slate-900 rounded px-2 py-1.5 flex justify-between border border-slate-700/50">
              <span className="text-slate-500">BLIK netto ({commissionRate}%):</span>
              <span className="text-green-400 font-semibold">{formatPLN(blik_net)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Kontekst dnia */}
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">🌤️ Kontekst dnia</p>
        <div className="flex gap-2 mb-3 flex-wrap">
          {WEATHER_OPTIONS.map(w => (
            <button key={w.value} type="button"
              onClick={() => setForm(f => ({ ...f, weather: f.weather === w.value ? '' : w.value }))}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg border text-xs transition-colors
                ${form.weather === w.value
                  ? 'border-teal-500 bg-teal-500/20 text-white'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'}`}
              title={w.label}
            >
              <span className="text-lg leading-none">{w.icon}</span>
              <span>{w.label}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Temperatura (°C)"
            type="number" step="0.5" min="-30" max="50"
            value={form.temperature}
            onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))}
            placeholder="np. 22"
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--color-text)]">Notatki</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent placeholder-[var(--color-muted)] resize-none"
              placeholder="Komentarz do dnia..."
            />
          </div>
        </div>
      </div>

      {/* Podsumowanie */}
      <div className="bg-slate-900 rounded-lg px-4 py-3 border border-teal-500/30 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Suma w saszetce (gotówka):</span>
          <span className="text-slate-300">{formatPLN(cash)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">— Baza na jutro:</span>
          <span className="text-yellow-400">− {formatPLN(base_total)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold border-t border-slate-700 pt-1.5">
          <span className="text-white">🔵 DO SEJFU:</span>
          <span className="text-teal-300 text-lg font-bold">{formatPLN(do_sejfu)}</span>
        </div>
        <div className="flex justify-between text-sm pt-0.5">
          <span className="text-slate-400">Karta + BLIK{commissionRate > 0 ? ` (netto ${commissionRate}%)` : ''}:</span>
          <span className="text-slate-300">{formatPLN(commissionRate > 0 ? card_net + blik_net : form.card + form.blik)}</span>
        </div>
        <div className="border-t border-slate-700 pt-1.5 flex justify-between">
          <span className="text-slate-300 font-medium">RAZEM PRZYCHÓD:</span>
          <span className="text-teal-400 font-bold text-lg">{formatPLN(total)}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Szac. liczba aut (po 20 zł):</span>
          <span className="text-yellow-400 font-semibold">{cars}</span>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-3">
        <Button variant="primary" onClick={handleSave} loading={saving} className="flex-1">
          <Check size={16} /> Zapisz zamknięcie dnia
        </Button>
        <Button variant="ghost" onClick={onClose} className="flex-1">Anuluj</Button>
      </div>
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

function InvoiceForm({ initial, defaultDate, onSave, onClose }: InvoiceFormProps) {
  const [form, setForm] = useState<Omit<Invoice, 'id' | 'created_at'>>({
    name: initial?.name ?? '',
    amount: initial?.amount ?? 0,
    date: initial?.date ?? defaultDate,
    category: initial?.category ?? 'Usługi',
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
      } else {
        await addInvoice(form);
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
    <div className="flex flex-col gap-4">
      <Input label="Nazwa / opis" type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      <Input label="Kwota (PLN)" type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: Math.max(0, parseFloat(e.target.value) || 0) }))} />
      <Input label="Data" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
      <Select label="Kategoria" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as Invoice['category'] }))}>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </Select>
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
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [revenues, setRevenues] = useState<DailyRevenue[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'revenues' | 'invoices' | 'stats' | 'raport-d' | 'raport-m' | 'raport-r' | 'all-time' | 'raport-w' | 'prognoza' | 'pogoda' | 'sezony'>('revenues');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
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
      const [rev, inv, totalInv, totalRev] = await Promise.all([
        getMonthlyRevenue(year, month),
        getMonthlyInvoices(year, month),
        getTotalInvestments(),
        getTotalRevenue(),
      ]);
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
  const totalCars = revenues.reduce((s, r) => s + (r.estimated_cars ?? 0), 0);
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
    setRevModalInitial(existing);
    setRevModalDate(date);
  };

  const handleDeleteInvoice = async () => {
    if (!deleteInvId) return;
    setDeleting(true);
    try { await deleteInvoice(deleteInvId); setDeleteInvId(null); await load(); }
    finally { setDeleting(false); }
  };

  const handleDeleteRevenue = async () => {
    if (!deleteRevDate) return;
    setDeleteRevLoading(true);
    setDeleteRevError('');
    try {
      const result = await verifyPassword(deleteRevPwd);
      if (result.lockout) {
        setDeleteRevError(`Zbyt wiele błędnych prób. Poczekaj ${result.lockout}s.`);
        return;
      }
      if (!result.ok) {
        setDeleteRevError('Nieprawidłowe hasło.');
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
    try { await exportMonthToExcel(year, month, revenues, invoices); }
    catch (e) { console.error(e); }
    finally { setExporting(false); }
  };

  const handleExportOwner = async () => {
    setExportingOwner(true);
    try { await exportOwnerToExcel(year, month, revenues, invoices, totalInvestments, commissionRateMain); }
    catch (e) { console.error(e); }
    finally { setExportingOwner(false); }
  };

  const defaultDate = `${year}-${String(month).padStart(2, '0')}-01`;

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Finanse</h1>
          <p className="text-[var(--color-text-muted)] text-sm mt-1">Utargi, faktury i statystyki</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"><ChevronLeft size={18} /></button>
            <span className="text-sm font-semibold text-white min-w-[130px] text-center">{MONTHS[month - 1]} {year}</span>
            <button onClick={nextMonth} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"><ChevronRight size={18} /></button>
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

      {/* Tabs */}
      <div className="flex gap-1 mb-4 flex-shrink-0 flex-wrap">
        {([
          ['revenues', 'Przychody'],
          ['invoices', 'Faktury'],
          ['stats', 'Wykres'],
          ['raport-d', 'Raport dnia'],
          ['raport-w', '📅 Tydzień'],
          ['raport-m', 'Raport mies.'],
          ['raport-r', 'Raport roczny'],
          ['all-time', '★ Parking cały'],
          ['prognoza', '📈 Prognoza'],
          ['pogoda', '🌤️ Pogoda'],
          ['sezony', '📊 Sezony'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
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
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteRevDate(r.date); setDeleteRevPwd(''); setDeleteRevError(''); }}
                            className="text-slate-400 hover:text-red-400 p-1 rounded"
                            title="Usuń raport"
                          >
                            <Trash2 size={13} />
                          </button>
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
        ) : tab === 'invoices' ? (
          <div>
            <div className="flex justify-end mb-3">
              <Button variant="primary" size="sm" onClick={() => { setInvEditItem(null); setInvModalOpen(true); }}>
                <Plus size={15} /> Dodaj fakturę
              </Button>
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
                        <button onClick={() => { setInvEditItem(inv); setInvModalOpen(true); }} className="text-slate-400 hover:text-teal-400 p-1 rounded"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteInvId(inv.id!)} className="text-slate-400 hover:text-red-400 p-1 rounded"><Trash2 size={13} /></button>
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

      {/* Revenue Modal */}
      <Modal open={!!revModalDate} onClose={() => setRevModalDate(null)} title="Wpis dzienny">
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
