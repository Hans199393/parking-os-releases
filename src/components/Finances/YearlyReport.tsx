import { useState, useEffect } from 'react';
import { getYearlyRevenue, getYearlyInvoices, DailyRevenue, Invoice } from '../../lib/database';
import { Card, Spinner } from '../shared/UI';

const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

function formatPLN(v: number) {
  return v.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

interface Props {
  year: number;
  totalInvestments: number;
  totalRevenueAllTime: number;
}

interface MonthData {
  month: number;
  days: number;
  revenue: number;
  operCosts: number;
  investCosts: number;
  cars: number;
}

export default function YearlyReport({ year, totalInvestments, totalRevenueAllTime }: Props) {
  const [revenues, setRevenues] = useState<DailyRevenue[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getYearlyRevenue(year), getYearlyInvoices(year)]).then(([rev, inv]) => {
      setRevenues(rev);
      setInvoices(inv);
      setLoading(false);
    });
  }, [year]);

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  const monthlyData: MonthData[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    days: 0,
    revenue: 0,
    operCosts: 0,
    investCosts: 0,
    cars: 0,
  }));

  for (const r of revenues) {
    const m = parseInt(r.date.split('-')[1]) - 1;
    monthlyData[m].days++;
    monthlyData[m].revenue += r.total ?? 0;
    monthlyData[m].cars += r.estimated_cars ?? 0;
  }

  for (const inv of invoices) {
    const m = parseInt(inv.date.split('-')[1]) - 1;
    if (inv.category === 'Inwestycja') monthlyData[m].investCosts += inv.amount;
    else monthlyData[m].operCosts += inv.amount;
  }

  const activeMonths = monthlyData.filter(m => m.days > 0 || m.operCosts > 0 || m.investCosts > 0);
  const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0);
  const totalOperCosts = monthlyData.reduce((s, m) => s + m.operCosts, 0);
  const totalInvestCosts = monthlyData.reduce((s, m) => s + m.investCosts, 0);
  const totalProfit = totalRevenue - totalOperCosts - totalInvestCosts;
  const totalCars = monthlyData.reduce((s, m) => s + m.cars, 0);
  const totalDays = monthlyData.reduce((s, m) => s + m.days, 0);
  const taxBase = totalRevenue - totalOperCosts;

  const roiRemaining = Math.max(0, totalInvestments - totalRevenueAllTime);
  const roiPct = totalInvestments > 0
    ? Math.min(100, (totalRevenueAllTime / totalInvestments) * 100)
    : 0;

  const bestMonth = activeMonths.filter(m => m.days > 0).length > 0
    ? activeMonths.filter(m => m.days > 0).reduce((a, b) => b.revenue > a.revenue ? b : a)
    : null;
  const worstMonth = activeMonths.filter(m => m.days > 0).length > 1
    ? activeMonths.filter(m => m.days > 0).reduce((a, b) => b.revenue < a.revenue ? b : a)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-white">Rok {year}</h2>

      {activeMonths.length === 0 ? (
        <div className="text-center text-slate-500 py-10 text-sm">Brak danych za {year} rok</div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Przychód roczny</p>
              <p className="text-xl font-bold text-teal-400">{formatPLN(totalRevenue)}</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Koszty oper.</p>
              <p className="text-xl font-bold text-orange-400">{formatPLN(totalOperCosts)}</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Zysk całkowity</p>
              <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatPLN(totalProfit)}
              </p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Podstawa PIT</p>
              <p className="text-xl font-bold text-yellow-400">{formatPLN(taxBase)}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">przych. − koszty op.</p>
            </Card>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="text-center py-2.5">
              <p className="text-slate-500 text-xs mb-1">Dni robocze</p>
              <p className="text-lg font-bold text-white">{totalDays}</p>
            </Card>
            <Card className="text-center py-2.5">
              <p className="text-slate-500 text-xs mb-1">Szac. auta łącznie</p>
              <p className="text-lg font-bold text-yellow-400">{totalCars}</p>
            </Card>
            <Card className="text-center py-2.5">
              <p className="text-slate-500 text-xs mb-1">Najlepszy miesiąc</p>
              <p className="text-sm font-bold text-teal-300">
                {bestMonth ? `${MONTHS[bestMonth.month - 1]}` : '—'}
              </p>
              <p className="text-xs text-slate-500">{bestMonth ? formatPLN(bestMonth.revenue) : ''}</p>
            </Card>
            <Card className="text-center py-2.5">
              <p className="text-slate-500 text-xs mb-1">Najgorszy miesiąc</p>
              <p className="text-sm font-bold text-orange-400">
                {worstMonth && worstMonth !== bestMonth ? `${MONTHS[worstMonth.month - 1]}` : '—'}
              </p>
              <p className="text-xs text-slate-500">
                {worstMonth && worstMonth !== bestMonth ? formatPLN(worstMonth.revenue) : ''}
              </p>
            </Card>
          </div>

          {/* Monthly table */}
          <Card title="Zestawienie miesięczne">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-700">
                    <th className="text-left py-2">Miesiąc</th>
                    <th className="text-right py-2">Dni</th>
                    <th className="text-right py-2">Przychód</th>
                    <th className="text-right py-2">Koszty op.</th>
                    <th className="text-right py-2">Inwest.</th>
                    <th className="text-right py-2">Zysk n.c.</th>
                    <th className="text-right py-2">Auta</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMonths.map(m => {
                    const net = m.revenue - m.operCosts - m.investCosts;
                    return (
                      <tr key={m.month} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                        <td className="py-2 text-white font-medium">{MONTHS[m.month - 1]}</td>
                        <td className="py-2 text-right text-slate-400">{m.days > 0 ? m.days : '—'}</td>
                        <td className="py-2 text-right text-teal-300 font-semibold">{m.revenue > 0 ? formatPLN(m.revenue) : '—'}</td>
                        <td className="py-2 text-right text-orange-400">{m.operCosts > 0 ? formatPLN(m.operCosts) : '—'}</td>
                        <td className="py-2 text-right text-purple-400">{m.investCosts > 0 ? formatPLN(m.investCosts) : '—'}</td>
                        <td className={`py-2 text-right font-medium ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {m.days > 0 || m.operCosts > 0 || m.investCosts > 0 ? formatPLN(net) : '—'}
                        </td>
                        <td className="py-2 text-right text-yellow-400">{m.cars > 0 ? m.cars : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-600 bg-slate-800/30 font-bold">
                    <td className="py-2.5 text-white">RAZEM {year}</td>
                    <td className="py-2.5 text-right text-white">{totalDays}</td>
                    <td className="py-2.5 text-right text-teal-300">{formatPLN(totalRevenue)}</td>
                    <td className="py-2.5 text-right text-orange-400">{formatPLN(totalOperCosts)}</td>
                    <td className="py-2.5 text-right text-purple-400">{totalInvestCosts > 0 ? formatPLN(totalInvestCosts) : '—'}</td>
                    <td className={`py-2.5 text-right ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPLN(totalProfit)}
                    </td>
                    <td className="py-2.5 text-right text-yellow-400">{totalCars}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* ROI tracker */}
          {totalInvestments > 0 && (
            <Card title="ROI Tracker" className="border border-purple-500/20">
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Łączne inwestycje</p>
                    <p className="text-purple-400 font-bold">{formatPLN(totalInvestments)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Łączny przychód (wszystkie lata)</p>
                    <p className="text-teal-300 font-bold">{formatPLN(totalRevenueAllTime)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Pozostało do zwrotu</p>
                    <p className={`font-bold ${roiRemaining === 0 ? 'text-green-400' : 'text-purple-400'}`}>
                      {roiRemaining === 0 ? '✅ Spłacone!' : formatPLN(roiRemaining)}
                    </p>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Postęp zwrotu inwestycji</span>
                    <span>{roiPct.toFixed(1)}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${roiPct >= 100 ? 'bg-green-500' : 'bg-purple-500'}`}
                      style={{ width: `${roiPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Tax summary */}
          <Card title="Podsumowanie podatkowe">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Przychód (do PIT)</p>
                <p className="text-white font-semibold">{formatPLN(totalRevenue)}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Koszty operacyjne</p>
                <p className="text-orange-400 font-semibold">− {formatPLN(totalOperCosts)}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Podstawa opodatkowania</p>
                <p className="text-yellow-400 font-bold text-base">{formatPLN(taxBase)}</p>
              </div>
            </div>
            <p className="text-slate-600 text-xs mt-3">
              * Inwestycje ({formatPLN(totalInvestCosts)}) mogą być amortyzowane — skonsultuj z księgowym.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
