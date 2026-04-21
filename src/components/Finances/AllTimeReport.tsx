import { useState, useEffect } from 'react';
import { getAllRevenues, getAllInvoices, DailyRevenue, Invoice } from '../../lib/database';
import { Card, Spinner } from '../shared/UI';
import { Trophy, TrendingUp, TrendingDown, ArrowLeft, ExternalLink } from 'lucide-react';

const MONTHS_FULL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DAYS_PL = ['Niedz','Pon','Wt','Śr','Czw','Pt','Sob'];
const DAYS_FULL = ['Niedziela','Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota'];
const WEATHER_ICONS: Record<string, string> = { sunny: '☀️', cloudy: '🌤️', rainy: '🌧️', stormy: '⛈️' };

function formatPLN(v: number) {
  return v.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

function pct(part: number, total: number) {
  return total > 0 ? ((part / total) * 100).toFixed(1) + '%' : '—';
}

// Payment breakdown mini-bar
function PaymentBar({ cash, card, blik }: { cash: number; card: number; blik: number }) {
  const total = cash + card + blik;
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-800 mt-1">
      {cash > 0 && <div className="bg-teal-500" style={{ width: `${(cash / total) * 100}%` }} />}
      {card > 0 && <div className="bg-blue-500" style={{ width: `${(card / total) * 100}%` }} />}
      {blik > 0 && <div className="bg-purple-500" style={{ width: `${(blik / total) * 100}%` }} />}
    </div>
  );
}

// Payment legend
function PaymentLegend() {
  return (
    <div className="flex gap-4 text-[10px] text-slate-500">
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-500 inline-block" /> Gotówka</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Karta</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> BLIK</span>
    </div>
  );
}

// "Szczegóły" link button
function DetailLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-teal-400 transition-colors mt-2 pt-2 border-t border-slate-700/50">
      <ExternalLink size={12} /> Szczegóły
    </button>
  );
}

type DetailView = null | 'years' | 'months' | 'dow' | 'top' | 'bottom' | 'distribution' | 'trends';

interface YearData {
  year: number; days: number; revenue: number; cash: number; card: number; blik: number;
  operCosts: number; investCosts: number; cars: number;
}

export default function AllTimeReport() {
  const [revenues, setRevenues] = useState<DailyRevenue[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailView>(null);

  useEffect(() => {
    Promise.all([getAllRevenues(), getAllInvoices()]).then(([rev, inv]) => {
      setRevenues(rev);
      setInvoices(inv);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (revenues.length === 0) return <div className="text-center text-slate-500 py-16 text-sm">Brak danych</div>;

  // ===== AGGREGATIONS =====

  // --- by year ---
  const yearMap: Record<number, YearData> = {};
  for (const r of revenues) {
    const y = parseInt(r.date.split('-')[0]);
    if (!yearMap[y]) yearMap[y] = { year: y, days: 0, revenue: 0, cash: 0, card: 0, blik: 0, operCosts: 0, investCosts: 0, cars: 0 };
    yearMap[y].days++;
    yearMap[y].revenue += r.total ?? 0;
    yearMap[y].cash += r.cash ?? 0;
    yearMap[y].card += r.card ?? 0;
    yearMap[y].blik += r.blik ?? 0;
    yearMap[y].cars += r.estimated_cars ?? 0;
  }
  for (const inv of invoices) {
    const y = parseInt(inv.date.split('-')[0]);
    if (!yearMap[y]) yearMap[y] = { year: y, days: 0, revenue: 0, cash: 0, card: 0, blik: 0, operCosts: 0, investCosts: 0, cars: 0 };
    if (inv.category === 'Inwestycja') yearMap[y].investCosts += inv.amount;
    else yearMap[y].operCosts += inv.amount;
  }
  const years = Object.values(yearMap).sort((a, b) => a.year - b.year);

  // --- totals ---
  const totalRevenue = revenues.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalCash = revenues.reduce((s, r) => s + (r.cash ?? 0), 0);
  const totalCard = revenues.reduce((s, r) => s + (r.card ?? 0), 0);
  const totalBlik = revenues.reduce((s, r) => s + (r.blik ?? 0), 0);
  const totalOperCosts = invoices.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const totalInvestCosts = invoices.filter(i => i.category === 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const totalProfit = totalRevenue - totalOperCosts - totalInvestCosts;
  const totalCars = revenues.reduce((s, r) => s + (r.estimated_cars ?? 0), 0);
  const bestYear = years.reduce((a, b) => b.revenue > a.revenue ? b : a, years[0]);
  const worstYear = years.length > 1 ? years.reduce((a, b) => b.revenue < a.revenue ? b : a, years[0]) : null;

  // --- by month-of-year ---
  const monthMap: Record<number, { revenue: number; cash: number; card: number; blik: number; days: number; yearSet: Set<number>; cars: number }> = {};
  for (let m = 1; m <= 12; m++) monthMap[m] = { revenue: 0, cash: 0, card: 0, blik: 0, days: 0, yearSet: new Set(), cars: 0 };
  for (const r of revenues) {
    const m = parseInt(r.date.split('-')[1]);
    const y = parseInt(r.date.split('-')[0]);
    monthMap[m].revenue += r.total ?? 0;
    monthMap[m].cash += r.cash ?? 0;
    monthMap[m].card += r.card ?? 0;
    monthMap[m].blik += r.blik ?? 0;
    monthMap[m].days++;
    monthMap[m].yearSet.add(y);
    monthMap[m].cars += r.estimated_cars ?? 0;
  }
  const monthStats = Object.entries(monthMap)
    .filter(([, v]) => v.days > 0)
    .map(([m, v]) => ({ month: parseInt(m), ...v, avgPerDay: v.days > 0 ? v.revenue / v.days : 0, years: v.yearSet.size }))
    .sort((a, b) => b.avgPerDay - a.avgPerDay);

  // --- by day-of-week ---
  const dowMap = Array.from({ length: 7 }, (_, i) => ({ dow: i, revenue: 0, cash: 0, card: 0, blik: 0, count: 0, cars: 0 }));
  for (const r of revenues) {
    const dow = new Date(r.date).getDay();
    dowMap[dow].revenue += r.total ?? 0;
    dowMap[dow].cash += r.cash ?? 0;
    dowMap[dow].card += r.card ?? 0;
    dowMap[dow].blik += r.blik ?? 0;
    dowMap[dow].count++;
    dowMap[dow].cars += r.estimated_cars ?? 0;
  }
  const dowWithData = dowMap.filter(d => d.count > 0);
  const maxDowAvg = Math.max(...dowWithData.map(d => d.count > 0 ? d.revenue / d.count : 0));

  // --- sorted days ---
  const sortedDesc = [...revenues].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const sortedAsc = sortedDesc.filter(r => (r.total ?? 0) > 0).reverse();
  const record = sortedDesc[0];

  // --- median ---
  const allTotals = revenues.map(r => r.total ?? 0).sort((a, b) => a - b);
  const median = allTotals.length > 0
    ? allTotals.length % 2 === 0
      ? (allTotals[allTotals.length / 2 - 1] + allTotals[allTotals.length / 2]) / 2
      : allTotals[Math.floor(allTotals.length / 2)]
    : 0;

  // --- distribution ---
  const buckets = [
    { label: '0–200 zł', min: 0, max: 200, days: [] as DailyRevenue[], color: 'bg-red-500' },
    { label: '200–500 zł', min: 200, max: 500, days: [] as DailyRevenue[], color: 'bg-orange-500' },
    { label: '500–1 000 zł', min: 500, max: 1000, days: [] as DailyRevenue[], color: 'bg-yellow-500' },
    { label: '1 000–2 000 zł', min: 1000, max: 2000, days: [] as DailyRevenue[], color: 'bg-teal-500' },
    { label: '2 000+ zł', min: 2000, max: Infinity, days: [] as DailyRevenue[], color: 'bg-green-500' },
  ];
  for (const r of revenues) {
    const t = r.total ?? 0;
    for (const b of buckets) { if (t >= b.min && t < b.max) { b.days.push(r); break; } }
  }
  const maxBucket = Math.max(...buckets.map(b => b.days.length), 1);

  // --- YoY trends ---
  const yoyTrends = years.slice(1).map((y, i) => {
    const prev = years[i];
    const change = prev.revenue > 0 ? ((y.revenue - prev.revenue) / prev.revenue) * 100 : 0;
    return { ...y, from: prev.year, to: y.year, change, prevRevenue: prev.revenue, prevCash: prev.cash, prevCard: prev.card, prevBlik: prev.blik };
  });

  // ===== DETAIL VIEWS =====

  const backButton = (
    <button onClick={() => setDetail(null)} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-4">
      <ArrowLeft size={16} /> Wróć do podsumowania
    </button>
  );

  if (detail === 'years') {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <h2 className="text-lg font-bold text-white">Zestawienie roczne — szczegóły płatności</h2>
        <PaymentLegend />
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left py-2">Rok</th>
                <th className="text-right py-2">Dni</th>
                <th className="text-right py-2">Gotówka</th>
                <th className="text-right py-2">Karta</th>
                <th className="text-right py-2">BLIK</th>
                <th className="text-right py-2">Razem</th>
                <th className="text-right py-2">Koszty op.</th>
                <th className="text-right py-2">Zysk n.c.</th>
                <th className="text-right py-2">Auta</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const net = y.revenue - y.operCosts - y.investCosts;
                return (
                  <tr key={y.year} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 font-bold text-white">{y.year}</td>
                    <td className="py-2 text-right text-slate-400">{y.days}</td>
                    <td className="py-2 text-right text-teal-300">{formatPLN(y.cash)} <span className="text-slate-600 text-[10px]">{pct(y.cash, y.revenue)}</span></td>
                    <td className="py-2 text-right text-blue-300">{formatPLN(y.card)} <span className="text-slate-600 text-[10px]">{pct(y.card, y.revenue)}</span></td>
                    <td className="py-2 text-right text-purple-300">{formatPLN(y.blik)} <span className="text-slate-600 text-[10px]">{pct(y.blik, y.revenue)}</span></td>
                    <td className="py-2 text-right text-white font-semibold">{formatPLN(y.revenue)}</td>
                    <td className="py-2 text-right text-orange-400">{y.operCosts > 0 ? formatPLN(y.operCosts) : '—'}</td>
                    <td className={`py-2 text-right font-semibold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPLN(net)}</td>
                    <td className="py-2 text-right text-yellow-400">{y.cars}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-600 bg-slate-800/30 font-bold">
                <td className="py-2.5 text-white">RAZEM</td>
                <td className="py-2.5 text-right text-white">{revenues.length}</td>
                <td className="py-2.5 text-right text-teal-300">{formatPLN(totalCash)}</td>
                <td className="py-2.5 text-right text-blue-300">{formatPLN(totalCard)}</td>
                <td className="py-2.5 text-right text-purple-300">{formatPLN(totalBlik)}</td>
                <td className="py-2.5 text-right text-white">{formatPLN(totalRevenue)}</td>
                <td className="py-2.5 text-right text-orange-400">{formatPLN(totalOperCosts)}</td>
                <td className={`py-2.5 text-right ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPLN(totalProfit)}</td>
                <td className="py-2.5 text-right text-yellow-400">{totalCars}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        {/* Per-year payment share cards */}
        <div className="grid grid-cols-3 gap-3">
          {years.map(y => (
            <Card key={y.year} className="py-3">
              <p className="text-white font-bold text-sm mb-2">{y.year} <span className="text-slate-500 font-normal">({y.days} dni)</span></p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-teal-400">Gotówka</span><span className="text-white">{formatPLN(y.cash)} ({pct(y.cash, y.revenue)})</span></div>
                <div className="flex justify-between"><span className="text-blue-400">Karta</span><span className="text-white">{formatPLN(y.card)} ({pct(y.card, y.revenue)})</span></div>
                <div className="flex justify-between"><span className="text-purple-400">BLIK</span><span className="text-white">{formatPLN(y.blik)} ({pct(y.blik, y.revenue)})</span></div>
              </div>
              <PaymentBar cash={y.cash} card={y.card} blik={y.blik} />
              <div className="flex justify-between text-xs mt-2 pt-2 border-t border-slate-700">
                <span className="text-slate-500">Avg/dzień</span>
                <span className="text-teal-300 font-semibold">{formatPLN(y.days > 0 ? y.revenue / y.days : 0)}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (detail === 'months') {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <h2 className="text-lg font-bold text-white">Wydajność miesięcy — szczegóły</h2>
        <PaymentLegend />
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left py-2">Miesiąc</th>
                <th className="text-right py-2">Dni</th>
                <th className="text-right py-2">Sezony</th>
                <th className="text-right py-2">Gotówka</th>
                <th className="text-right py-2">Karta</th>
                <th className="text-right py-2">BLIK</th>
                <th className="text-right py-2">Razem</th>
                <th className="text-right py-2">Avg/dzień</th>
                <th className="text-right py-2">Auta</th>
              </tr>
            </thead>
            <tbody>
              {monthStats.map(ms => (
                <tr key={ms.month} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 text-white font-medium">{MONTHS_FULL[ms.month - 1]}</td>
                  <td className="py-2 text-right text-slate-400">{ms.days}</td>
                  <td className="py-2 text-right text-slate-500">{ms.years}×</td>
                  <td className="py-2 text-right text-teal-300">{formatPLN(ms.cash)} <span className="text-slate-600 text-[10px]">{pct(ms.cash, ms.revenue)}</span></td>
                  <td className="py-2 text-right text-blue-300">{formatPLN(ms.card)} <span className="text-slate-600 text-[10px]">{pct(ms.card, ms.revenue)}</span></td>
                  <td className="py-2 text-right text-purple-300">{formatPLN(ms.blik)} <span className="text-slate-600 text-[10px]">{pct(ms.blik, ms.revenue)}</span></td>
                  <td className="py-2 text-right text-white font-semibold">{formatPLN(ms.revenue)}</td>
                  <td className="py-2 text-right text-teal-400 font-semibold">{formatPLN(ms.avgPerDay)}</td>
                  <td className="py-2 text-right text-yellow-400">{ms.cars}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Per-month cards */}
        <div className="grid grid-cols-3 gap-3">
          {monthStats.map(ms => (
            <Card key={ms.month} className="py-3">
              <p className="text-white font-bold text-sm mb-2">{MONTHS_FULL[ms.month - 1]}</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-teal-400">Gotówka avg/d</span><span>{formatPLN(ms.days > 0 ? ms.cash / ms.days : 0)}</span></div>
                <div className="flex justify-between"><span className="text-blue-400">Karta avg/d</span><span>{formatPLN(ms.days > 0 ? ms.card / ms.days : 0)}</span></div>
                <div className="flex justify-between"><span className="text-purple-400">BLIK avg/d</span><span>{formatPLN(ms.days > 0 ? ms.blik / ms.days : 0)}</span></div>
              </div>
              <PaymentBar cash={ms.cash} card={ms.card} blik={ms.blik} />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (detail === 'dow') {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <h2 className="text-lg font-bold text-white">Przychód wg dnia tygodnia — szczegóły</h2>
        <PaymentLegend />
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left py-2">Dzień</th>
                <th className="text-right py-2">Występ.</th>
                <th className="text-right py-2">Gotówka</th>
                <th className="text-right py-2">Karta</th>
                <th className="text-right py-2">BLIK</th>
                <th className="text-right py-2">Razem</th>
                <th className="text-right py-2">Avg/dzień</th>
                <th className="text-right py-2">Avg auta</th>
              </tr>
            </thead>
            <tbody>
              {dowWithData.map(d => {
                const avg = d.count > 0 ? d.revenue / d.count : 0;
                return (
                  <tr key={d.dow} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 text-white font-medium">{DAYS_FULL[d.dow]}</td>
                    <td className="py-2 text-right text-slate-400">{d.count}×</td>
                    <td className="py-2 text-right text-teal-300">{formatPLN(d.cash)} <span className="text-slate-600 text-[10px]">{pct(d.cash, d.revenue)}</span></td>
                    <td className="py-2 text-right text-blue-300">{formatPLN(d.card)} <span className="text-slate-600 text-[10px]">{pct(d.card, d.revenue)}</span></td>
                    <td className="py-2 text-right text-purple-300">{formatPLN(d.blik)} <span className="text-slate-600 text-[10px]">{pct(d.blik, d.revenue)}</span></td>
                    <td className="py-2 text-right text-white font-semibold">{formatPLN(d.revenue)}</td>
                    <td className="py-2 text-right text-yellow-300 font-semibold">{formatPLN(avg)}</td>
                    <td className="py-2 text-right text-yellow-400">{d.count > 0 ? (d.cars / d.count).toFixed(1) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <div className="grid grid-cols-4 gap-3">
          {dowWithData.map(d => (
            <Card key={d.dow} className="py-3">
              <p className="text-white font-bold text-sm mb-2">{DAYS_FULL[d.dow]} <span className="text-slate-500 font-normal text-xs">({d.count}×)</span></p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-teal-400">Got. avg</span><span>{formatPLN(d.count > 0 ? d.cash / d.count : 0)}</span></div>
                <div className="flex justify-between"><span className="text-blue-400">Karta avg</span><span>{formatPLN(d.count > 0 ? d.card / d.count : 0)}</span></div>
                <div className="flex justify-between"><span className="text-purple-400">BLIK avg</span><span>{formatPLN(d.count > 0 ? d.blik / d.count : 0)}</span></div>
              </div>
              <PaymentBar cash={d.cash} card={d.card} blik={d.blik} />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (detail === 'top' || detail === 'bottom') {
    const isTop = detail === 'top';
    const list = isTop ? sortedDesc : sortedAsc;
    const title = isTop ? 'Ranking najlepszych dni' : 'Ranking najsłabszych dni';
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <h2 className="text-lg font-bold text-white">{title} — szczegóły ({list.length} dni)</h2>
        <PaymentLegend />
        <Card>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-slate-500 text-xs border-b border-slate-700">
                  <th className="text-left py-2 pl-2">#</th>
                  <th className="text-left py-2">Data</th>
                  <th className="text-center py-2">Dzień tyg.</th>
                  <th className="text-center py-2">Pogoda</th>
                  <th className="text-right py-2">Gotówka</th>
                  <th className="text-right py-2">Karta</th>
                  <th className="text-right py-2">BLIK</th>
                  <th className="text-right py-2">Razem</th>
                  <th className="text-right py-2">Auta</th>
                  <th className="py-2 w-20">Udział</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const dow = new Date(r.date).getDay();
                  return (
                    <tr key={r.date} className={`border-b border-slate-800 hover:bg-slate-800/40 ${i === 0 && isTop ? 'bg-teal-900/20' : ''}`}>
                      <td className="py-2 pl-2 text-slate-500 text-xs">{i === 0 && isTop ? '🏆' : i + 1}</td>
                      <td className="py-2 text-white font-medium">{r.date}</td>
                      <td className="py-2 text-center text-slate-400 text-xs">{DAYS_PL[dow]}</td>
                      <td className="py-2 text-center">
                        {r.weather ? WEATHER_ICONS[r.weather] ?? '' : ''}
                        {r.temperature != null && <span className="text-[10px] text-slate-500 ml-0.5">{r.temperature}°</span>}
                      </td>
                      <td className="py-2 text-right text-teal-300">{formatPLN(r.cash ?? 0)}</td>
                      <td className="py-2 text-right text-blue-300">{formatPLN(r.card ?? 0)}</td>
                      <td className="py-2 text-right text-purple-300">{formatPLN(r.blik ?? 0)}</td>
                      <td className={`py-2 text-right font-semibold ${isTop ? 'text-teal-400' : 'text-orange-400'}`}>{formatPLN(r.total ?? 0)}</td>
                      <td className="py-2 text-right text-yellow-400 text-xs">{r.estimated_cars ?? 0}</td>
                      <td className="py-2 px-1"><PaymentBar cash={r.cash ?? 0} card={r.card ?? 0} blik={r.blik ?? 0} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  if (detail === 'distribution') {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <h2 className="text-lg font-bold text-white">Rozkład przychodów — szczegóły</h2>
        <PaymentLegend />
        {buckets.map(b => (
          <Card key={b.label}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-bold text-sm">{b.label}</p>
              <span className="text-slate-400 text-xs">{b.days.length} dni ({revenues.length > 0 ? ((b.days.length / revenues.length) * 100).toFixed(0) : 0}%)</span>
            </div>
            {b.days.length === 0 ? (
              <p className="text-slate-600 text-xs">Brak dni w tym zakresie</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                  <div className="bg-slate-800/50 rounded p-2">
                    <p className="text-slate-500 mb-0.5">Avg gotówka</p>
                    <p className="text-teal-300 font-semibold">{formatPLN(b.days.reduce((s, r) => s + (r.cash ?? 0), 0) / b.days.length)}</p>
                  </div>
                  <div className="bg-slate-800/50 rounded p-2">
                    <p className="text-slate-500 mb-0.5">Avg karta</p>
                    <p className="text-blue-300 font-semibold">{formatPLN(b.days.reduce((s, r) => s + (r.card ?? 0), 0) / b.days.length)}</p>
                  </div>
                  <div className="bg-slate-800/50 rounded p-2">
                    <p className="text-slate-500 mb-0.5">Avg BLIK</p>
                    <p className="text-purple-300 font-semibold">{formatPLN(b.days.reduce((s, r) => s + (r.blik ?? 0), 0) / b.days.length)}</p>
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="text-left py-1">Data</th>
                      <th className="text-right py-1">Gotówka</th>
                      <th className="text-right py-1">Karta</th>
                      <th className="text-right py-1">BLIK</th>
                      <th className="text-right py-1">Razem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...b.days].sort((a, bb) => (bb.total ?? 0) - (a.total ?? 0)).map(r => (
                      <tr key={r.date} className="border-b border-slate-800/50">
                        <td className="py-1 text-slate-400">{r.date}</td>
                        <td className="py-1 text-right text-teal-300">{formatPLN(r.cash ?? 0)}</td>
                        <td className="py-1 text-right text-blue-300">{formatPLN(r.card ?? 0)}</td>
                        <td className="py-1 text-right text-purple-300">{formatPLN(r.blik ?? 0)}</td>
                        <td className="py-1 text-right text-white font-medium">{formatPLN(r.total ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        ))}
      </div>
    );
  }

  if (detail === 'trends') {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <h2 className="text-lg font-bold text-white">Trend rok-do-roku — szczegóły</h2>
        <PaymentLegend />
        {yoyTrends.map(t => (
          <Card key={t.to}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-white font-bold text-sm">{t.from} → {t.to}</span>
              <div className="flex items-center gap-1">
                {t.change >= 0 ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                <span className={`text-sm font-bold ${t.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {t.change >= 0 ? '+' : ''}{t.change.toFixed(1)}%
                </span>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-700">
                  <th className="text-left py-1"></th>
                  <th className="text-right py-1">{t.from}</th>
                  <th className="text-right py-1">{t.to}</th>
                  <th className="text-right py-1">Zmiana</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800">
                  <td className="py-1.5 text-teal-400">Gotówka</td>
                  <td className="py-1.5 text-right text-slate-300">{formatPLN(t.prevCash)}</td>
                  <td className="py-1.5 text-right text-white">{formatPLN(t.cash)}</td>
                  <td className={`py-1.5 text-right font-semibold ${t.cash >= t.prevCash ? 'text-green-400' : 'text-red-400'}`}>
                    {t.prevCash > 0 ? `${((t.cash - t.prevCash) / t.prevCash * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                <tr className="border-b border-slate-800">
                  <td className="py-1.5 text-blue-400">Karta</td>
                  <td className="py-1.5 text-right text-slate-300">{formatPLN(t.prevCard)}</td>
                  <td className="py-1.5 text-right text-white">{formatPLN(t.card)}</td>
                  <td className={`py-1.5 text-right font-semibold ${t.card >= t.prevCard ? 'text-green-400' : 'text-red-400'}`}>
                    {t.prevCard > 0 ? `${((t.card - t.prevCard) / t.prevCard * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                <tr className="border-b border-slate-800">
                  <td className="py-1.5 text-purple-400">BLIK</td>
                  <td className="py-1.5 text-right text-slate-300">{formatPLN(t.prevBlik)}</td>
                  <td className="py-1.5 text-right text-white">{formatPLN(t.blik)}</td>
                  <td className={`py-1.5 text-right font-semibold ${t.blik >= t.prevBlik ? 'text-green-400' : 'text-red-400'}`}>
                    {t.prevBlik > 0 ? `${((t.blik - t.prevBlik) / t.prevBlik * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                <tr className="border-t border-slate-600 font-bold">
                  <td className="py-1.5 text-white">Razem</td>
                  <td className="py-1.5 text-right text-slate-300">{formatPLN(t.prevRevenue)}</td>
                  <td className="py-1.5 text-right text-white">{formatPLN(t.revenue)}</td>
                  <td className={`py-1.5 text-right ${t.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {t.change >= 0 ? '+' : ''}{t.change.toFixed(1)}%
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2">
              <PaymentBar cash={t.cash} card={t.card} blik={t.blik} />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // ===== MAIN OVERVIEW =====

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-white">Parking — wszystkie lata</h2>

      {/* Top KPIs */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Łączny przychód</p>
          <p className="text-xl font-bold text-teal-400">{formatPLN(totalRevenue)}</p>
          <PaymentBar cash={totalCash} card={totalCard} blik={totalBlik} />
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Koszty oper.</p>
          <p className="text-xl font-bold text-orange-400">{formatPLN(totalOperCosts)}</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Inwestycje</p>
          <p className="text-xl font-bold text-purple-400">{formatPLN(totalInvestCosts)}</p>
        </Card>
        <Card className="text-center py-3 border border-green-500/20">
          <p className="text-slate-500 text-xs mb-1">Zysk na czysto</p>
          <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPLN(totalProfit)}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">po wszystkich kosztach</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-slate-500 text-xs mb-1">Szac. auta łącznie</p>
          <p className="text-xl font-bold text-yellow-400">{totalCars.toLocaleString('pl-PL')}</p>
        </Card>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Sezony</p>
          <p className="text-lg font-bold text-white">{years.length}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Dni roboczych</p>
          <p className="text-lg font-bold text-white">{revenues.length}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Avg / dzień</p>
          <p className="text-base font-bold text-teal-300">{formatPLN(revenues.length > 0 ? totalRevenue / revenues.length : 0)}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Mediana / dzień</p>
          <p className="text-base font-bold text-blue-300">{formatPLN(median)}</p>
        </Card>
        <Card className="text-center py-2.5">
          <p className="text-slate-500 text-xs mb-1">Avg auto / dzień</p>
          <p className="text-base font-bold text-yellow-300">
            {revenues.length > 0 ? (totalCars / revenues.length).toFixed(1) : '—'}
          </p>
        </Card>
      </div>

      {/* Record */}
      {record && (
        <Card className="border border-teal-500/30 bg-gradient-to-r from-teal-900/20 to-slate-800/50">
          <div className="flex items-center gap-3 py-1">
            <Trophy className="text-yellow-400" size={22} />
            <div className="flex-1">
              <p className="text-xs text-slate-500">Rekord — najlepszy dzień w historii</p>
              <p className="text-lg font-bold text-teal-300">{formatPLN(record.total ?? 0)} <span className="text-sm text-slate-400 font-normal">({record.date})</span></p>
              <div className="flex gap-4 text-xs mt-1">
                <span className="text-teal-400">Got.: {formatPLN(record.cash ?? 0)}</span>
                <span className="text-blue-400">Karta: {formatPLN(record.card ?? 0)}</span>
                <span className="text-purple-400">BLIK: {formatPLN(record.blik ?? 0)}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Year-by-year table */}
        <Card title="Zestawienie roczne">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left py-2">Rok</th>
                <th className="text-right py-2">Dni</th>
                <th className="text-right py-2">Przychód</th>
                <th className="text-right py-2">Koszty op.</th>
                <th className="text-right py-2">Zysk n.c.</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const net = y.revenue - y.operCosts - y.investCosts;
                const isBest = bestYear && y.year === bestYear.year;
                return (
                  <tr key={y.year} className={`border-b border-slate-800 ${isBest ? 'bg-teal-900/20' : 'hover:bg-slate-800/40'}`}>
                    <td className={`py-2 font-bold ${isBest ? 'text-teal-300' : 'text-white'}`}>{y.year}</td>
                    <td className="py-2 text-right text-slate-400">{y.days}</td>
                    <td className="py-2 text-right text-teal-300 font-semibold">{formatPLN(y.revenue)}</td>
                    <td className="py-2 text-right text-orange-400">{y.operCosts > 0 ? formatPLN(y.operCosts) : '—'}</td>
                    <td className={`py-2 text-right font-semibold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPLN(net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {bestYear && (
            <div className="mt-2 pt-2 border-t border-slate-700 flex gap-6 text-xs">
              <span className="text-slate-500">Najlepszy: <span className="text-teal-300 font-semibold">{bestYear.year}</span></span>
              {worstYear && worstYear.year !== bestYear.year && (
                <span className="text-slate-500">Najsłabszy: <span className="text-orange-400 font-semibold">{worstYear.year}</span></span>
              )}
            </div>
          )}
          <DetailLink onClick={() => setDetail('years')} />
        </Card>

        {/* Month performance */}
        <Card title="Wydajność miesięcy (avg/dzień)">
          {monthStats.length === 0 ? <p className="text-slate-500 text-sm">Brak danych</p> : (
            <div className="space-y-2">
              {monthStats.map(ms => {
                const maxAvg = monthStats[0].avgPerDay;
                return (
                  <div key={ms.month}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 font-medium w-20">{MONTHS_FULL[ms.month - 1]}</span>
                      <span className="text-slate-500 mr-auto">{ms.days} dni / {ms.years}× sezon</span>
                      <span className="text-teal-300 font-semibold">{formatPLN(ms.avgPerDay)}/d</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(ms.avgPerDay / (maxAvg || 1)) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DetailLink onClick={() => setDetail('months')} />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Day-of-week */}
        <Card title="Avg przychód wg dnia tygodnia">
          {dowWithData.length === 0 ? <p className="text-slate-500 text-sm">Brak danych</p> : (
            <div className="space-y-2">
              {dowWithData.map(d => {
                const avg = d.count > 0 ? d.revenue / d.count : 0;
                return (
                  <div key={d.dow}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 font-medium w-12">{DAYS_PL[d.dow]}</span>
                      <span className="text-slate-500 mr-auto">{d.count} dni</span>
                      <span className="text-yellow-300 font-semibold">{formatPLN(avg)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${maxDowAvg > 0 ? (avg / maxDowAvg) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DetailLink onClick={() => setDetail('dow')} />
        </Card>

        {/* Top / Bottom days */}
        <div className="flex flex-col gap-3">
          <Card title="Top 5 — najlepsze dni">
            <div className="space-y-1 text-xs">
              {sortedDesc.slice(0, 5).map((r, i) => (
                <div key={r.date} className={`flex justify-between ${i === 0 ? 'text-sm' : ''}`}>
                  <span className={i === 0 ? 'text-yellow-400 font-semibold' : 'text-slate-500'}>{i === 0 && '🏆 '}{i + 1}. {r.date}</span>
                  <span className="text-teal-300 font-semibold">{formatPLN(r.total ?? 0)}</span>
                </div>
              ))}
            </div>
            <DetailLink onClick={() => setDetail('top')} />
          </Card>
          <Card title="Najsłabsze dni">
            <div className="space-y-1 text-xs">
              {sortedAsc.slice(0, 5).map((r, i) => (
                <div key={r.date} className="flex justify-between">
                  <span className="text-slate-500">{i + 1}. {r.date}</span>
                  <span className="text-orange-400 font-semibold">{formatPLN(r.total ?? 0)}</span>
                </div>
              ))}
            </div>
            <DetailLink onClick={() => setDetail('bottom')} />
          </Card>
        </div>
      </div>

      {/* Distribution + Trends */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Rozkład przychodów dziennych">
          <div className="space-y-2">
            {buckets.map(b => (
              <div key={b.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 font-medium">{b.label}</span>
                  <span className="text-slate-400">{b.days.length} dni ({revenues.length > 0 ? ((b.days.length / revenues.length) * 100).toFixed(0) : 0}%)</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full ${b.color} rounded-full`} style={{ width: `${(b.days.length / maxBucket) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <DetailLink onClick={() => setDetail('distribution')} />
        </Card>

        {yoyTrends.length > 0 ? (
          <Card title="Trend rok-do-roku">
            <div className="space-y-3">
              {yoyTrends.map(t => (
                <div key={t.to} className="flex items-center gap-3">
                  <span className="text-slate-400 text-sm w-24">{t.from} → {t.to}</span>
                  <div className="flex items-center gap-1.5 flex-1">
                    {t.change >= 0 ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                    <span className={`text-sm font-bold ${t.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.change >= 0 ? '+' : ''}{t.change.toFixed(1)}%
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">{formatPLN(t.prevRevenue)} → {formatPLN(t.revenue)}</span>
                </div>
              ))}
            </div>
            <DetailLink onClick={() => setDetail('trends')} />
          </Card>
        ) : (
          <Card title="Trend rok-do-roku">
            <p className="text-slate-500 text-sm">Za mało sezonów</p>
          </Card>
        )}
      </div>

      <PaymentLegend />
    </div>
  );
}
