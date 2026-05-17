import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import {
  getAllRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
  getRecurringMonthlyTotal,
  RecurringExpense, RecurringKind,
} from '../../lib/database';
import { Button, Input, Modal, Spinner } from '../shared/UI';

const KIND_META: Record<RecurringKind, { icon: string; label: string; color: string; description: string }> = {
  fixed:        { icon: '🔁', label: 'Stały',        color: 'teal',   description: 'Co miesiąc ta sama kwota (np. ZUS, księgowa, internet)' },
  variable:     { icon: '📊', label: 'Zmienny',      color: 'amber',  description: 'Zmienna kwota lub tylko w sezonie (np. prąd, woda, śmieci)' },
  amortization: { icon: '📉', label: 'Amortyzacja',  color: 'purple', description: 'Inwestycja rozłożona na miesiące (kamery, asfalt, brama)' },
};

const MONTHS = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];
const SEASON_PRESET = '5,6,7,8,9';
const FULL_YEAR_PRESET = '1,2,3,4,5,6,7,8,9,10,11,12';

function formatPLN(amount: number): string {
  return amount.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

interface ExpenseFormProps {
  initial: RecurringExpense | null;
  onSave: () => void;
  onClose: () => void;
}

function ExpenseForm({ initial, onSave, onClose }: ExpenseFormProps) {
  const [form, setForm] = useState<Omit<RecurringExpense, 'id' | 'created_at'>>({
    name: initial?.name ?? '',
    amount: initial?.amount ?? 0,
    kind: initial?.kind ?? 'fixed',
    active_months: initial?.active_months ?? FULL_YEAR_PRESET,
    start_date: initial?.start_date ?? null,
    end_date: initial?.end_date ?? null,
    notes: initial?.notes ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const monthSet = new Set(form.active_months.split(',').filter(Boolean));
  const toggleMonth = (m: number) => {
    const ms = String(m);
    const next = new Set(monthSet);
    if (next.has(ms)) next.delete(ms);
    else next.add(ms);
    const sorted = [...next].map(Number).sort((a, b) => a - b).join(',');
    setForm(f => ({ ...f, active_months: sorted }));
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.amount <= 0 || !form.active_months) {
      setError('Wypełnij nazwę, kwotę i wybierz przynajmniej jeden miesiąc.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (initial?.id) await updateRecurringExpense(initial.id, form);
      else await addRecurringExpense(form);
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  const meta = KIND_META[form.kind];

  return (
    <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto pr-1">
      {/* Typ */}
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Typ kosztu</label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KIND_META) as RecurringKind[]).map(k => {
            const m = KIND_META[k];
            const active = form.kind === k;
            return (
              <button key={k} type="button"
                onClick={() => setForm(f => ({ ...f, kind: k }))}
                className={`flex flex-col items-center gap-1 px-2 py-3 rounded-lg border text-xs transition-all
                  ${active ? `border-${m.color}-500 bg-${m.color}-500/20 text-white scale-105` : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'}`}>
                <span className="text-2xl leading-none">{m.icon}</span>
                <span className="font-medium">{m.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-2">{meta.description}</p>
      </div>

      <Input label="Nazwa kosztu" type="text" value={form.name}
        placeholder={form.kind === 'fixed' ? 'np. ZUS' : form.kind === 'variable' ? 'np. Prąd (sezon)' : 'np. Kamery LPR (amortyzacja 36 m-cy)'}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

      <Input label="Kwota miesięczna (PLN)" type="number" step="0.01" min="0" value={form.amount}
        onChange={e => setForm(f => ({ ...f, amount: Math.max(0, parseFloat(e.target.value) || 0) }))} />

      {/* Miesiące aktywności */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aktywny w miesiącach</label>
          <div className="flex gap-1">
            <button type="button" onClick={() => setForm(f => ({ ...f, active_months: FULL_YEAR_PRESET }))} className="text-xs text-teal-400 hover:underline">Cały rok</button>
            <span className="text-slate-600">·</span>
            <button type="button" onClick={() => setForm(f => ({ ...f, active_months: SEASON_PRESET }))} className="text-xs text-amber-400 hover:underline">Sezon (V–IX)</button>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {MONTHS.map((label, i) => {
            const m = i + 1;
            const active = monthSet.has(String(m));
            return (
              <button key={m} type="button" onClick={() => toggleMonth(m)}
                className={`px-2 py-1.5 rounded text-xs font-medium border transition
                  ${active ? 'bg-teal-600 text-white border-teal-500' : 'bg-slate-900 text-slate-500 border-slate-700 hover:bg-slate-800'}`}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Daty obowiązywania */}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Obowiązuje od (opcjonalnie)" type="date" value={form.start_date ?? ''}
          onChange={e => setForm(f => ({ ...f, start_date: e.target.value || null }))} />
        <Input label="Obowiązuje do (opcjonalnie)" type="date" value={form.end_date ?? ''}
          onChange={e => setForm(f => ({ ...f, end_date: e.target.value || null }))} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--color-text)]">Notatki</label>
        <textarea value={form.notes ?? ''} rows={2}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))}
          className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 placeholder-[var(--color-muted)] resize-none"
          placeholder="np. Faktura nr ENG/2026/05, do końca roku" />
      </div>

      {/* Podgląd rocznego kosztu */}
      <div className="bg-slate-900/60 rounded-lg px-4 py-3 border border-teal-500/30">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Aktywny w {monthSet.size} {monthSet.size === 1 ? 'miesiącu' : monthSet.size < 5 ? 'miesiącach' : 'miesiącach'}</span>
          <span>Roczny koszt:</span>
        </div>
        <div className="text-right text-2xl font-bold text-teal-300">{formatPLN(form.amount * monthSet.size)}</div>
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

interface RecurringExpensesProps {
  year: number;
  month: number;
}

export default function RecurringExpenses({ year, month }: RecurringExpensesProps) {
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [totals, setTotals] = useState<{ fixed: number; variable: number; amortization: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, t] = await Promise.all([
        getAllRecurringExpenses(),
        getRecurringMonthlyTotal(year, month),
      ]);
      setItems(list);
      setTotals(t);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (deleteId == null) return;
    try { await deleteRecurringExpense(deleteId); } catch { /* ignore */ }
    setDeleteId(null);
    await load();
  };

  const isActiveInCurrent = (e: RecurringExpense) =>
    e.active_months.split(',').includes(String(month));

  return (
    <div className="flex flex-col gap-4">
      {/* Nagłówek + akcja */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold text-white">💸 Koszty cykliczne</h3>
          <p className="text-xs text-slate-500 mt-1">Stałe miesięczne, sezonowe i amortyzacja inwestycji.</p>
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <Plus size={16} /> Dodaj koszt cykliczny
        </Button>
      </div>

      {/* Karty podsumowań */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3">
            <p className="text-xs text-teal-400 font-medium uppercase tracking-wider">Stały (msc)</p>
            <p className="text-xl font-bold text-white mt-1">{formatPLN(totals.fixed)}</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-xs text-amber-400 font-medium uppercase tracking-wider">Zmienny (msc)</p>
            <p className="text-xl font-bold text-white mt-1">{formatPLN(totals.variable)}</p>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
            <p className="text-xs text-purple-400 font-medium uppercase tracking-wider">Amortyzacja</p>
            <p className="text-xl font-bold text-white mt-1">{formatPLN(totals.amortization)}</p>
          </div>
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-3">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">RAZEM (msc)</p>
            <p className="text-xl font-bold text-white mt-1">{formatPLN(totals.total)}</p>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-border)] rounded-xl p-10 text-center">
          <p className="text-slate-500 text-sm">Brak zdefiniowanych kosztów cyklicznych.</p>
          <p className="text-slate-600 text-xs mt-1">Kliknij „Dodaj koszt cykliczny" żeby zacząć.</p>
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/50 border-b border-slate-800">
              <tr className="text-left text-xs text-slate-400 uppercase">
                <th className="py-2 px-3">Typ</th>
                <th className="py-2 px-3">Nazwa</th>
                <th className="py-2 px-3 text-right">Kwota / msc</th>
                <th className="py-2 px-3">Aktywne msc</th>
                <th className="py-2 px-3">Status (bieżący msc)</th>
                <th className="py-2 px-3 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {items.map(e => {
                const meta = KIND_META[e.kind];
                const months = e.active_months.split(',');
                const isActive = isActiveInCurrent(e);
                return (
                  <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-${meta.color}-500/20 text-${meta.color}-400`}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-white text-sm font-medium">
                      {e.name}
                      {e.notes && <div className="text-slate-500 text-xs mt-0.5">{e.notes}</div>}
                    </td>
                    <td className="py-2 px-3 text-right text-teal-300 font-semibold">{formatPLN(e.amount)}</td>
                    <td className="py-2 px-3 text-xs text-slate-400">
                      {months.length === 12 ? <span className="text-slate-500">cały rok</span> :
                        months.map(m => MONTHS[parseInt(m, 10) - 1]).join(', ')}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                        {isActive ? 'AKTYWNY' : 'nieaktywny'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setEditing(e); setModalOpen(true); }} className="text-slate-400 hover:text-teal-400 p-1 rounded"><Pencil size={14} /></button>
                        <button onClick={() => setDeleteId(e.id ?? null)} className="text-slate-400 hover:text-red-400 p-1 rounded"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edytuj koszt cykliczny' : 'Nowy koszt cykliczny'}>
        <ExpenseForm initial={editing} onSave={load} onClose={() => setModalOpen(false)} />
      </Modal>

      <Modal open={deleteId != null} onClose={() => setDeleteId(null)} title="Usuń koszt cykliczny">
        <p className="text-slate-300 text-sm mb-5">Na pewno usunąć ten koszt? Historyczne raporty zostaną nieprzeliczone (operacja nie usuwa wpisów z `invoices`).</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete} className="flex-1"><Trash2 size={16} /> Usuń</Button>
          <Button variant="ghost" onClick={() => setDeleteId(null)} className="flex-1">Anuluj</Button>
        </div>
      </Modal>

      {/* X-icon zaimportowany na potrzeby Modal */}
      <span className="hidden"><X size={0} /></span>
    </div>
  );
}
