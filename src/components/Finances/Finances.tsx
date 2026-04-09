import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download, Check } from 'lucide-react';
import {
  getMonthlyRevenue, upsertDailyRevenue, DailyRevenue, DENOMS,
  getMonthlyInvoices, addInvoice, updateInvoice, deleteInvoice, Invoice
} from '../../lib/database';
import { exportMonthToExcel } from '../../lib/excel';
import { Button, Input, Select, Modal, Card, Spinner } from '../shared/UI';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const CATEGORIES = ['Usługi', 'Podatki', 'Materiały'] as const;

function formatPLN(amount: number) {
  return amount.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
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
    card:    initial?.card    ?? 0,
    blik:    initial?.blik    ?? 0,
    notes:   initial?.notes   ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const coins     = form.qty_1*1 + form.qty_2*2 + form.qty_5*5;
  const banknotes = form.qty_10*10 + form.qty_20*20 + form.qty_50*50 + form.qty_100*100 + form.qty_200*200 + form.qty_500*500;
  const cash  = coins + banknotes;
  const total = cash + form.card + form.blik;
  const cars  = Math.round(total / 20);

  const setQty = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: Math.max(0, parseInt(e.target.value) || 0) }));

  const coinDenoms = DENOMS.filter(d => d.type === 'coin');
  const noteDenoms = DENOMS.filter(d => d.type === 'note');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await upsertDailyRevenue({ date, ...form });
      onSave();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  const DenomRow = ({ d }: { d: typeof DENOMS[number] }) => {
    const qty = form[d.key as keyof typeof form] as number;
    return (
      <div className="grid grid-cols-3 gap-2 items-center mb-1">
        <span className="text-sm text-white pl-1">{d.label}</span>
        <input
          type="number" min="0" step="1" value={qty}
          onChange={setQty(d.key)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm text-center w-full focus:border-teal-500 outline-none"
        />
        <span className="text-right text-sm text-teal-300 font-medium">{formatPLN(qty * d.value)}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 max-h-[72vh] overflow-y-auto pr-1">
      <p className="text-slate-400 text-sm">Data: <span className="text-white font-medium">{date}</span></p>

      {/* Column headers */}
      <div className="grid grid-cols-3 gap-2 text-xs text-slate-500 px-1">
        <span>Nominał</span><span className="text-center">Ilość (szt.)</span><span className="text-right">Wartość</span>
      </div>

      {/* Coins */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Monety</p>
        {coinDenoms.map(d => <DenomRow key={d.key} d={d} />)}
        <div className="flex justify-between text-xs bg-slate-900 rounded px-2 py-1.5 mt-1 border border-slate-700/50">
          <span className="text-slate-400">Razem monety</span>
          <span className="text-teal-400 font-semibold">{formatPLN(coins)}</span>
        </div>
      </div>

      {/* Banknotes */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Banknoty</p>
        {noteDenoms.map(d => <DenomRow key={d.key} d={d} />)}
        <div className="flex justify-between text-xs bg-slate-900 rounded px-2 py-1.5 mt-1 border border-slate-700/50">
          <span className="text-slate-400">Razem banknoty</span>
          <span className="text-teal-400 font-semibold">{formatPLN(banknotes)}</span>
        </div>
      </div>

      {/* Electronic */}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Karta (PLN)" type="number" min="0" step="0.01" value={form.card}
          onChange={e => setForm(f => ({ ...f, card: Math.max(0, parseFloat(e.target.value) || 0) }))} />
        <Input label="BLIK (PLN)" type="number" min="0" step="0.01" value={form.blik}
          onChange={e => setForm(f => ({ ...f, blik: Math.max(0, parseFloat(e.target.value) || 0) }))} />
      </div>

      {/* Summary */}
      <div className="bg-slate-900 rounded-lg px-4 py-3 border border-slate-700 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Gotówka (monety + banknoty):</span>
          <span className="text-slate-300">{formatPLN(cash)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Karta:</span>
          <span className="text-slate-300">{formatPLN(form.card)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">BLIK:</span>
          <span className="text-slate-300">{formatPLN(form.blik)}</span>
        </div>
        <div className="border-t border-slate-700 pt-1.5 flex justify-between">
          <span className="text-slate-300 font-medium">RAZEM:</span>
          <span className="text-teal-400 font-bold text-lg">{formatPLN(total)}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Szac. liczba aut (po 20 zł):</span>
          <span className="text-yellow-400 font-semibold">{cars}</span>
        </div>
      </div>

      <Input label="Notatki (opcjonalnie)" type="text" value={form.notes}
        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-3">
        <Button variant="primary" onClick={handleSave} loading={saving} className="flex-1">
          <Check size={16} /> Zapisz
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
  const [tab, setTab] = useState<'revenues' | 'invoices' | 'stats'>('revenues');
  const [exporting, setExporting] = useState(false);

  // Revenue modal
  const [revModalDate, setRevModalDate] = useState<string | null>(null);
  const [revModalInitial, setRevModalInitial] = useState<DailyRevenue | null>(null);

  // Invoice modal
  const [invModalOpen, setInvModalOpen] = useState(false);
  const [invEditItem, setInvEditItem] = useState<Invoice | null>(null);
  const [deleteInvId, setDeleteInvId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rev, inv] = await Promise.all([
        getMonthlyRevenue(year, month),
        getMonthlyInvoices(year, month),
      ]);
      setRevenues(rev);
      setInvoices(inv);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const totalRevenue = revenues.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalCosts = invoices.reduce((s, i) => s + i.amount, 0);
  const profit = totalRevenue - totalCosts;
  const totalCars = revenues.reduce((s, r) => s + (r.estimated_cars ?? 0), 0);

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

  const handleExport = async () => {
    setExporting(true);
    try { await exportMonthToExcel(year, month, revenues, invoices); }
    catch (e) { console.error(e); }
    finally { setExporting(false); }
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
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {[
          { label: 'Przychody', value: formatPLN(totalRevenue), color: 'text-teal-400' },
          { label: 'Koszty', value: formatPLN(totalCosts), color: 'text-orange-400' },
          { label: 'Zysk/Strata', value: formatPLN(profit), color: profit >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'Szac. auta', value: String(totalCars), color: 'text-yellow-400' },
        ].map(s => (
          <Card key={s.label} className="text-center py-3">
            <p className="text-slate-500 text-xs mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 flex-shrink-0">
        {(['revenues', 'invoices', 'stats'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t ? 'bg-teal-500/20 text-teal-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            {t === 'revenues' ? 'Przychody' : t === 'invoices' ? 'Faktury kosztowe' : 'Wykres'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : tab === 'revenues' ? (
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-700">
                  <th className="text-left py-2 pl-2">Data</th>
                  <th className="text-right py-2">Monety</th>
                  <th className="text-right py-2">Banknoty</th>
                  <th className="text-right py-2">Karta</th>
                  <th className="text-right py-2">BLIK</th>
                  <th className="text-right py-2">Razem</th>
                  <th className="text-right py-2 pr-2">Auta</th>
                </tr>
              </thead>
              <tbody>
                {revenues.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-slate-500 py-10">Brak danych za ten miesiąc</td></tr>
                ) : revenues.map(r => {
                  return (
                    <tr
                      key={r.date}
                      className="border-b border-slate-800 hover:bg-slate-800 cursor-pointer transition-colors"
                      onClick={() => openRevModal(r.date)}
                    >
                      <td className="py-2.5 pl-2 text-white font-medium">{r.date}</td>
                      <td className="text-right py-2.5 text-slate-300">{formatPLN(r.coins ?? 0)}</td>
                      <td className="text-right py-2.5 text-slate-300">{formatPLN(r.banknotes ?? 0)}</td>
                      <td className="text-right py-2.5 text-slate-300">{formatPLN(r.card)}</td>
                      <td className="text-right py-2.5 text-slate-300">{formatPLN(r.blik)}</td>
                      <td className="text-right py-2.5 text-teal-400 font-semibold">{formatPLN(r.total ?? 0)}</td>
                      <td className="text-right py-2.5 pr-2 text-yellow-400">{r.estimated_cars ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              onClick={() => openRevModal(`${year}-${String(month).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`)}
              className="mt-4 w-full py-3 border border-dashed border-slate-700 text-slate-500 text-sm rounded-xl hover:border-teal-500/50 hover:text-teal-400 transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Dodaj/edytuj dzień
            </button>
          </div>
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
                          inv.category === 'Usługi' ? 'bg-teal-500/20 text-teal-400' :
                          'bg-yellow-500/20 text-yellow-400'}`}>
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
    </div>
  );
}
