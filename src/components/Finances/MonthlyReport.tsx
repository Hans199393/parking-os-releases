import { DailyRevenue, Invoice } from '../../lib/database';
import { Card } from '../shared/UI';

const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

function formatPLN(v: number) {
  return v.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

interface Props {
  revenues: DailyRevenue[];
  invoices: Invoice[];
  year: number;
  month: number;
}

export default function MonthlyReport({ revenues, invoices, year, month }: Props) {
  const totalRevenue = revenues.reduce((s, r) => s + (r.total ?? 0), 0);
  const operCosts = invoices.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const investCosts = invoices.filter(i => i.category === 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const operProfit = totalRevenue - operCosts;
  const totalProfit = totalRevenue - operCosts - investCosts;
  const totalCars = revenues.reduce((s, r) => s + (r.estimated_cars ?? 0), 0);
  const avgRevenue = revenues.length > 0 ? totalRevenue / revenues.length : 0;
  const bestDay = revenues.length > 0
    ? revenues.reduce((a, b) => (b.total ?? 0) > (a.total ?? 0) ? b : a)
    : null;

  // Cost by category
  const catGroups: Record<string, number> = {};
  for (const inv of invoices) {
    catGroups[inv.category] = (catGroups[inv.category] ?? 0) + inv.amount;
  }
  const totalCatCosts = Object.values(catGroups).reduce((a, b) => a + b, 0);

  const CAT_COLORS: Record<string, string> = {
    Usługi: 'bg-teal-500',
    Podatki: 'bg-orange-500',
    Materiały: 'bg-yellow-500',
    Inwestycja: 'bg-purple-500',
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-white">{MONTHS[month - 1]} {year}</h2>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Przychody</p>
          <p className="text-xl font-bold text-teal-400">{formatPLN(totalRevenue)}</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Koszty oper.</p>
          <p className="text-xl font-bold text-orange-400">{formatPLN(operCosts)}</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Zysk oper.</p>
          <p className={`text-lg font-semibold ${operProfit >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
            {formatPLN(operProfit)}
          </p>
          <p className="text-[10px] text-slate-600 mt-0.5">bez inwest.</p>
        </Card>
        <Card className="text-center py-3 border border-green-500/30">
          <p className="text-slate-500 text-xs mb-1">Zysk na czysto</p>
          <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatPLN(totalProfit)}
          </p>
          <p className="text-[10px] text-slate-600 mt-0.5">po wszystkich kosztach</p>
        </Card>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Dni robocze</p>
          <p className="text-lg font-bold text-white">{revenues.length}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Szac. auta</p>
          <p className="text-lg font-bold text-yellow-400">{totalCars}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Avg / dzień</p>
          <p className="text-base font-bold text-slate-300">{revenues.length > 0 ? formatPLN(avgRevenue) : '—'}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Najlepszy dzień</p>
          <p className="text-sm font-bold text-teal-300">
            {bestDay
              ? `${bestDay.date.split('-')[2]} → ${formatPLN(bestDay.total ?? 0)}`
              : '—'}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Cost breakdown */}
        <Card title="Koszty wg kategorii">
          {Object.keys(catGroups).length === 0 ? (
            <p className="text-slate-500 text-sm">Brak faktur</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(catGroups).map(([cat, amt]) => (
                <div key={cat}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300 font-medium">{cat}</span>
                    <span className="text-red-400 font-medium">{formatPLN(amt)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${CAT_COLORS[cat] ?? 'bg-slate-500'}`}
                      style={{ width: `${Math.min(100, (amt / (totalCatCosts || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-slate-700 pt-2 mt-1">
                <span className="text-white">Łącznie:</span>
                <span className="text-red-400">{formatPLN(totalCatCosts)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* Daily revenue list */}
        <Card title="Przychody dzienne">
          {revenues.length === 0 ? (
            <p className="text-slate-500 text-sm">Brak danych</p>
          ) : (
            <div className="space-y-0 max-h-64 overflow-y-auto">
              {revenues.map(r => (
                <div key={r.date} className="flex justify-between text-sm py-1.5 border-b border-slate-800 last:border-0 hover:bg-slate-800/40 rounded px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-medium w-6">{r.date.split('-')[2]}</span>
                    <span className="text-xs">
                      {r.weather === 'sunny' ? '☀️' : r.weather === 'cloudy' ? '🌤️' : r.weather === 'rainy' ? '🌧️' : r.weather === 'stormy' ? '⛈️' : ''}
                    </span>
                    {r.temperature != null && (
                      <span className="text-xs text-slate-600">{r.temperature}°</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 text-xs">{r.estimated_cars ?? 0} aut</span>
                    <span className="text-teal-300 font-semibold">{formatPLN(r.total ?? 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
