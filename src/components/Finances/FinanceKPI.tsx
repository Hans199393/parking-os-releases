import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Car, Calendar, Percent, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  getMonthlyRevenue, getMonthlyInvoices, getRecurringMonthlyTotal,
  DailyRevenue,
} from '../../lib/database';
import { Spinner } from '../shared/UI';
import { getStore } from '../../lib/store';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';

const MONTHS = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];

function formatPLN(amount: number): string {
  return amount.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

function totalRevenue(r: DailyRevenue, commissionRate: number): number {
  const cash = (r.qty_1 ?? 0) + (r.qty_2 ?? 0) * 2 + (r.qty_5 ?? 0) * 5
    + (r.qty_10 ?? 0) * 10 + (r.qty_20 ?? 0) * 20 + (r.qty_50 ?? 0) * 50
    + (r.qty_100 ?? 0) * 100 + (r.qty_200 ?? 0) * 200 + (r.qty_500 ?? 0) * 500;
  const cardNet = (r.card ?? 0) * (1 - commissionRate / 100);
  const blikNet = (r.blik ?? 0) * (1 - commissionRate / 100);
  return cash + cardNet + blikNet;
}

interface KPIProps {
  year: number;
  month: number;
}

interface KPIData {
  revenue: number;
  revenuePrev: number;
  oneTimeCosts: number;
  recurringCosts: number;
  totalCosts: number;
  margin: number;
  marginPct: number;
  estimatedCars: number;
  avgTicket: number;
  daysWithRevenue: number;
  bestDay: { date: string; total: number } | null;
  worstDay: { date: string; total: number } | null;
  cashShare: number;
  cardShare: number;
  blikShare: number;
  costsByCategory: { name: string; value: number }[];
}

const PIE_COLORS = ['#14b8a6', '#f59e0b', '#a855f7', '#ef4444', '#3b82f6', '#10b981'];

export default function FinanceKPI({ year, month }: KPIProps) {
  const [data, setData] = useState<KPIData | null>(null);
  const [trend, setTrend] = useState<{ month: string; revenue: number; costs: number; margin: number }[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const store = await getStore();
      const commissionRate = (await store.get<number>('card_commission_rate')) ?? 0;

      // bieżący msc
      const [revs, invs, recurring] = await Promise.all([
        getMonthlyRevenue(year, month),
        getMonthlyInvoices(year, month),
        getRecurringMonthlyTotal(year, month),
      ]);

      // poprzedni msc dla trendu
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const revsPrev = await getMonthlyRevenue(prevYear, prevMonth);
      const revenuePrev = revsPrev.reduce((s, r) => s + totalRevenue(r, commissionRate), 0);

      const revenue = revs.reduce((s, r) => s + totalRevenue(r, commissionRate), 0);
      const oneTimeCosts = invs
        .filter(i => i.category !== 'Inwestycja')
        .reduce((s, i) => s + i.amount, 0);
      const recurringCosts = recurring.total;
      const totalCosts = oneTimeCosts + recurringCosts;
      const margin = revenue - totalCosts;
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

      // dzień najlepszy / najgorszy (z przychodem)
      const withRevenue = revs.map(r => ({ date: r.date, total: totalRevenue(r, commissionRate) })).filter(d => d.total > 0);
      const bestDay = withRevenue.length > 0 ? withRevenue.reduce((a, b) => a.total > b.total ? a : b) : null;
      const worstDay = withRevenue.length > 0 ? withRevenue.reduce((a, b) => a.total < b.total ? a : b) : null;

      // szacowane auta (po 20 zł)
      const estimatedCars = Math.round(revenue / 20);
      const avgTicket = withRevenue.length > 0 ? revenue / Math.max(estimatedCars, 1) : 0;

      // share gotówka/karta/blik
      const totalCash = revs.reduce((s, r) => s
        + (r.qty_1 ?? 0) + (r.qty_2 ?? 0) * 2 + (r.qty_5 ?? 0) * 5
        + (r.qty_10 ?? 0) * 10 + (r.qty_20 ?? 0) * 20 + (r.qty_50 ?? 0) * 50
        + (r.qty_100 ?? 0) * 100 + (r.qty_200 ?? 0) * 200 + (r.qty_500 ?? 0) * 500, 0);
      const totalCard = revs.reduce((s, r) => s + (r.card ?? 0) * (1 - commissionRate / 100), 0);
      const totalBlik = revs.reduce((s, r) => s + (r.blik ?? 0) * (1 - commissionRate / 100), 0);
      const totalAll = totalCash + totalCard + totalBlik;

      // koszty wg kategorii
      const byCategory: Record<string, number> = {};
      for (const i of invs) {
        byCategory[i.category] = (byCategory[i.category] ?? 0) + i.amount;
      }
      if (recurringCosts > 0) byCategory['Cykliczne'] = recurringCosts;
      const costsByCategory = Object.entries(byCategory).map(([name, value]) => ({ name, value }));

      setData({
        revenue, revenuePrev,
        oneTimeCosts, recurringCosts, totalCosts,
        margin, marginPct,
        estimatedCars,
        avgTicket,
        daysWithRevenue: withRevenue.length,
        bestDay,
        worstDay,
        cashShare: totalAll > 0 ? (totalCash / totalAll) * 100 : 0,
        cardShare: totalAll > 0 ? (totalCard / totalAll) * 100 : 0,
        blikShare: totalAll > 0 ? (totalBlik / totalAll) * 100 : 0,
        costsByCategory,
      });

      // 12-miesięczny trend (rok)
      const trendArr: { month: string; revenue: number; costs: number; margin: number }[] = [];
      for (let m = 1; m <= 12; m++) {
        try {
          const [rs, is, rc] = await Promise.all([
            getMonthlyRevenue(year, m),
            getMonthlyInvoices(year, m),
            getRecurringMonthlyTotal(year, m),
          ]);
          const rev = rs.reduce((s, r) => s + totalRevenue(r, commissionRate), 0);
          const cs = is.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0) + rc.total;
          trendArr.push({ month: MONTHS[m - 1], revenue: Math.round(rev), costs: Math.round(cs), margin: Math.round(rev - cs) });
        } catch { /* skip */ }
      }
      setTrend(trendArr);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="flex items-center justify-center py-8"><Spinner /></div>;
  }

  const revChange = data.revenuePrev > 0 ? ((data.revenue - data.revenuePrev) / data.revenuePrev) * 100 : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Główne KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<DollarSign size={18} />}
          label="Przychód msc"
          value={formatPLN(data.revenue)}
          delta={revChange}
          color="teal"
        />
        <KpiCard
          icon={<TrendingDown size={18} />}
          label="Koszty msc"
          value={formatPLN(data.totalCosts)}
          sub={`${formatPLN(data.oneTimeCosts)} jednorazowe + ${formatPLN(data.recurringCosts)} cykliczne`}
          color="amber"
        />
        <KpiCard
          icon={<TrendingUp size={18} />}
          label="Marża"
          value={formatPLN(data.margin)}
          sub={`${data.marginPct.toFixed(1)}%`}
          color={data.margin >= 0 ? 'green' : 'red'}
        />
        <KpiCard
          icon={<Car size={18} />}
          label="Szac. auta"
          value={String(data.estimatedCars)}
          sub={`avg ticket ${formatPLN(data.avgTicket)}`}
          color="blue"
        />
      </div>

      {/* Mniejsze metryki */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SmallMetric label="Dni z przychodem" value={`${data.daysWithRevenue} / ${new Date(year, month, 0).getDate()}`} icon={<Calendar size={14} />} />
        <SmallMetric label="Najlepszy dzień" value={data.bestDay ? `${data.bestDay.date.slice(8, 10)}.${data.bestDay.date.slice(5, 7)}` : '–'} sub={data.bestDay ? formatPLN(data.bestDay.total) : ''} icon={<ArrowUpRight size={14} />} color="green" />
        <SmallMetric label="Najsłabszy dzień" value={data.worstDay ? `${data.worstDay.date.slice(8, 10)}.${data.worstDay.date.slice(5, 7)}` : '–'} sub={data.worstDay ? formatPLN(data.worstDay.total) : ''} icon={<ArrowDownRight size={14} />} color="red" />
        <SmallMetric label="Marża %" value={`${data.marginPct.toFixed(1)}%`} icon={<Percent size={14} />} color={data.marginPct >= 30 ? 'green' : data.marginPct >= 0 ? 'amber' : 'red'} />
      </div>

      {/* Trend roczny */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <h4 className="text-sm font-semibold text-white mb-3">📈 Trend miesięczny — {year}</h4>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => formatPLN(Number(v))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" stroke="#14b8a6" strokeWidth={2} name="Przychód" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="costs" stroke="#f59e0b" strokeWidth={2} name="Koszty" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="margin" stroke="#a855f7" strokeWidth={2} name="Marża" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Struktura płatności */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
          <h4 className="text-sm font-semibold text-white mb-3">💳 Struktura płatności</h4>
          <div className="space-y-2">
            <ShareBar label="Gotówka" pct={data.cashShare} color="bg-teal-500" />
            <ShareBar label="Karta (netto)" pct={data.cardShare} color="bg-blue-500" />
            <ShareBar label="BLIK (netto)" pct={data.blikShare} color="bg-purple-500" />
          </div>
        </div>

        {/* Koszty wg kategorii */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
          <h4 className="text-sm font-semibold text-white mb-3">📊 Koszty wg kategorii</h4>
          {data.costsByCategory.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">Brak kosztów w tym miesiącu</p>
          ) : (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.costsByCategory}
                    dataKey="value"
                    nameKey="name"
                    cx="50%" cy="50%"
                    innerRadius={45} outerRadius={75}
                    paddingAngle={2}
                    label={(entry: { name?: string; percent?: number }) => `${entry.name ?? ''} ${((entry.percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                    style={{ fontSize: 11 }}
                  >
                    {data.costsByCategory.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => formatPLN(Number(v))}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Słupki przychód vs koszty miesięczny */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <h4 className="text-sm font-semibold text-white mb-3">📊 Przychód vs koszty (miesięcznie {year})</h4>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => formatPLN(Number(v))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" fill="#14b8a6" name="Przychód" />
              <Bar dataKey="costs" fill="#f59e0b" name="Koszty" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

interface KpiCardProps { icon: React.ReactNode; label: string; value: string; sub?: string; delta?: number; color: 'teal' | 'amber' | 'green' | 'red' | 'blue'; }
function KpiCard({ icon, label, value, sub, delta, color }: KpiCardProps) {
  const colorMap = {
    teal: 'border-teal-500/30 bg-teal-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    green: 'border-green-500/30 bg-green-500/10',
    red: 'border-red-500/30 bg-red-500/10',
    blue: 'border-blue-500/30 bg-blue-500/10',
  };
  return (
    <div className={`border rounded-lg p-3 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">
        {icon} {label}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      {delta !== undefined && Math.abs(delta) > 0.1 && (
        <div className={`text-xs font-semibold mt-1 ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}% vs poprz. msc
        </div>
      )}
    </div>
  );
}

interface SmallMetricProps { label: string; value: string; sub?: string; icon?: React.ReactNode; color?: 'green' | 'red' | 'amber'; }
function SmallMetric({ label, value, sub, icon, color }: SmallMetricProps) {
  const cMap = { green: 'text-green-400', red: 'text-red-400', amber: 'text-amber-400' };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        {icon} {label}
      </div>
      <div className={`text-lg font-semibold text-white ${color ? cMap[color] : ''}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

interface ShareBarProps { label: string; pct: number; color: string; }
function ShareBar({ label, pct, color }: ShareBarProps) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span className="text-slate-300">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
