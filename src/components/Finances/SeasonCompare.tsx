import { useState, useEffect } from 'react';
import { getYearlyRevenue, DailyRevenue } from '../../lib/database';
import { Card } from '../shared/UI';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts';

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
const SEASON_MONTHS = [6, 7, 8];
const YEAR_COLORS = ['#94a3b8', '#f59e0b', '#14b8a6', '#818cf8'];

function formatPLN(n: number) {
  return n.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

interface Props {
  currentYear: number;
}

export default function SeasonCompare({ currentYear }: Props) {
  const [allData, setAllData] = useState<Map<number, DailyRevenue[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState<number[]>([currentYear - 2, currentYear - 1, currentYear]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const results = await Promise.all(years.map(async y => {
          const data = await getYearlyRevenue(y).catch(() => [] as DailyRevenue[]);
          return [y, data] as [number, DailyRevenue[]];
        }));
        setAllData(new Map(results));
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
  }, [years]);

  if (loading) return <div className="text-center text-slate-400 py-10">Ładowanie danych sezonów…</div>;

  // Monthly totals per year
  const monthlyByYear: Record<number, Record<number, number>> = {};
  for (const [y, data] of allData.entries()) {
    monthlyByYear[y] = {};
    for (const r of data) {
      const m = new Date(r.date).getMonth() + 1;
      if (!SEASON_MONTHS.includes(m)) continue;
      monthlyByYear[y][m] = (monthlyByYear[y][m] ?? 0) + (r.total ?? 0);
    }
  }

  // Chart data: one row per month
  const chartData = SEASON_MONTHS.map(m => {
    const row: Record<string, number | string> = { month: MONTHS[m - 1] };
    for (const y of years) {
      row[String(y)] = Math.round(monthlyByYear[y]?.[m] ?? 0);
    }
    return row;
  });

  // Season totals
  const seasonTotals = years.map(y => ({
    year: y,
    total: SEASON_MONTHS.reduce((s, m) => s + (monthlyByYear[y]?.[m] ?? 0), 0),
    months: SEASON_MONTHS.map(m => monthlyByYear[y]?.[m] ?? 0),
  }));

  // Daily averages per season
  const dailyByYear: Record<number, { avg: number; days: number }> = {};
  for (const [y, data] of allData.entries()) {
    const seasonDays = data.filter(r => {
      const m = new Date(r.date).getMonth() + 1;
      return SEASON_MONTHS.includes(m) && (r.total ?? 0) > 0;
    });
    dailyByYear[y] = {
      days: seasonDays.length,
      avg: seasonDays.length > 0
        ? seasonDays.reduce((s, r) => s + (r.total ?? 0), 0) / seasonDays.length
        : 0,
    };
  }

  const bestYear = seasonTotals.reduce((best, cur) => cur.total > best.total ? cur : best, seasonTotals[0]);

  return (
    <div className="space-y-4">
      {/* Year selector */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-bold text-white">📊 Porównanie sezonów</h3>
          <div className="ml-auto flex gap-1">
            {[currentYear - 3, currentYear - 2, currentYear - 1, currentYear].map(y => (
              <button
                key={y}
                onClick={() => setYears(prev =>
                  prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort()
                )}
                className={`px-2 py-1 rounded text-xs font-semibold transition ${
                  years.includes(y)
                    ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {seasonTotals.map((s, i) => (
            <div
              key={s.year}
              className={`rounded-xl p-3 text-center ${
                s.year === bestYear.year
                  ? 'bg-teal-500/15 border border-teal-500/30'
                  : 'bg-slate-800'
              }`}
            >
              <div className="text-xs text-slate-400 mb-0.5 flex items-center justify-center gap-1">
                {s.year === bestYear.year && <span className="text-amber-400">★</span>}
                {s.year}
              </div>
              <div className="text-base font-bold" style={{ color: YEAR_COLORS[i + 1] }}>
                {formatPLN(s.total)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {dailyByYear[s.year]?.days ?? 0} dni · śr. {formatPLN(Math.round(dailyByYear[s.year]?.avg ?? 0))}/dzień
              </div>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(v: unknown) => [formatPLN(Number(v)), '']}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            {years.map((y, i) => (
              <Bar
                key={y}
                dataKey={String(y)}
                name={String(y)}
                fill={YEAR_COLORS[(i + 1) % YEAR_COLORS.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Detailed table */}
      <Card>
        <h3 className="text-sm font-bold text-white mb-2">Szczegóły</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="text-left py-1.5 pl-2">Miesiąc</th>
              {years.map(y => <th key={y} className="text-right py-1.5">{y}</th>)}
              {years.length >= 2 && <th className="text-right py-1.5 pr-2">Zmiana</th>}
            </tr>
          </thead>
          <tbody>
            {SEASON_MONTHS.map(m => {
              const vals = years.map(y => monthlyByYear[y]?.[m] ?? 0);
              const change = years.length >= 2
                ? vals[vals.length - 1] - vals[vals.length - 2]
                : null;
              return (
                <tr key={m} className="border-b border-slate-800 hover:bg-slate-800">
                  <td className="py-1.5 pl-2 text-white font-medium">{MONTHS[m - 1]}</td>
                  {vals.map((v, i) => (
                    <td key={i} className="py-1.5 text-right text-slate-300">
                      {v > 0 ? formatPLN(v) : '—'}
                    </td>
                  ))}
                  {change !== null && (
                    <td className={`py-1.5 pr-2 text-right font-semibold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {change >= 0 ? '+' : ''}{formatPLN(change)}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t border-slate-600 font-bold">
              <td className="py-2 pl-2 text-white">Łącznie sezon</td>
              {seasonTotals.map((s, i) => (
                <td key={i} className="py-2 text-right" style={{ color: YEAR_COLORS[(i + 1) % YEAR_COLORS.length] }}>
                  {formatPLN(s.total)}
                </td>
              ))}
              {years.length >= 2 && (() => {
                const last = seasonTotals[seasonTotals.length - 1]?.total ?? 0;
                const prev = seasonTotals[seasonTotals.length - 2]?.total ?? 0;
                const diff = last - prev;
                return (
                  <td className={`py-2 pr-2 text-right font-semibold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {diff >= 0 ? '+' : ''}{formatPLN(diff)}
                  </td>
                );
              })()}
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
