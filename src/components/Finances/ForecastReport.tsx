import { useState, useEffect } from 'react';
import { getYearlyRevenue, DailyRevenue } from '../../lib/database';
import { Card } from '../shared/UI';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine
} from 'recharts';

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
const SEASON_MONTHS = [6, 7, 8]; // czerwiec, lipiec, sierpień

function formatPLN(n: number) {
  return n.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

// Simple linear regression
function linearRegression(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return { slope: 0, intercept: 0 };
  const n = pts.length;
  const sumX = pts.reduce((s, p) => s + p.x, 0);
  const sumY = pts.reduce((s, p) => s + p.y, 0);
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

interface Props {
  currentYear: number;
}

interface MonthlyTotals {
  year: number;
  month: number;
  total: number;
  days: number;
}

export default function ForecastReport({ currentYear }: Props) {
  const [allData, setAllData] = useState<DailyRevenue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const years = [currentYear - 2, currentYear - 1, currentYear];
        const results = await Promise.all(years.map(y => getYearlyRevenue(y).catch(() => [])));
        setAllData(results.flat());
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
  }, [currentYear]);

  if (loading) return <div className="text-center text-slate-400 py-10">Ładowanie prognozy…</div>;

  // Group by year+month, only season months
  const monthMap = new Map<string, MonthlyTotals>();
  for (const r of allData) {
    const d = new Date(r.date);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (!SEASON_MONTHS.includes(m)) continue;
    const key = `${y}-${m}`;
    const existing = monthMap.get(key) || { year: y, month: m, total: 0, days: 0 };
    monthMap.set(key, {
      ...existing,
      total: existing.total + (r.total ?? 0),
      days: existing.days + 1,
    });
  }

  const monthlyData = Array.from(monthMap.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );

  // Regression per season month
  const forecasts = SEASON_MONTHS.map(m => {
    const pts = monthlyData
      .filter(d => d.month === m)
      .map(d => ({ x: d.year, y: d.total }));
    const reg = linearRegression(pts);
    const forecasted = reg.slope * currentYear + reg.intercept;
    return { month: m, forecasted: Math.max(0, Math.round(forecasted)), pts, reg };
  });

  const totalForecast = forecasts.reduce((s, f) => s + f.forecasted, 0);

  // Build chart data: for each year, actual + forecast
  const years = Array.from(new Set(monthlyData.map(d => d.year))).sort();
  const chartData = years.map(y => {
    const row: Record<string, number | string> = { year: String(y) };
    for (const m of SEASON_MONTHS) {
      const actual = monthlyData.find(d => d.year === y && d.month === m);
      row[`${MONTHS[m - 1]}_actual`] = actual ? actual.total : 0;
    }
    return row;
  });

  // Add forecast row for currentYear if not already there
  const forecastRow: Record<string, number | string> = { year: `${currentYear} (prognoza)` };
  for (const f of forecasts) {
    forecastRow[`${MONTHS[f.month - 1]}_forecast`] = f.forecasted;
  }
  chartData.push(forecastRow);

  const COLORS = ['#14b8a6', '#f59e0b', '#818cf8'];
  const FORECAST_COLORS = ['#5eead4', '#fcd34d', '#a5b4fc'];

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-bold text-white mb-1">📈 Prognoza przychodów — sezon {currentYear}</h3>
        <p className="text-xs text-slate-400 mb-4">Regresja liniowa na podstawie sezonów {currentYear - 2}–{currentYear - 1}</p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {forecasts.map((f, i) => (
            <div key={f.month} className="bg-slate-800 rounded-xl p-3 text-center">
              <div className="text-slate-400 text-xs mb-1">{MONTHS[f.month - 1]}</div>
              <div className="text-lg font-bold" style={{ color: FORECAST_COLORS[i] }}>
                {formatPLN(f.forecasted)}
              </div>
              {f.pts.length >= 2 && (
                <div className="text-[10px] text-slate-500 mt-0.5">
                  trend: {f.reg.slope >= 0 ? '+' : ''}{formatPLN(Math.round(f.reg.slope))}/rok
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-3 text-center mb-4">
          <div className="text-xs text-slate-400 mb-0.5">Prognoza łączna sezon {currentYear}</div>
          <div className="text-2xl font-bold text-teal-400">{formatPLN(totalForecast)}</div>
          {monthlyData.length === 0 && (
            <div className="text-xs text-amber-400 mt-1">⚠️ Brak danych historycznych — wprowadź przychody za poprzednie sezony</div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(v: unknown) => [formatPLN(Number(v)), '']}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            {SEASON_MONTHS.map((m, i) => (
              <Line
                key={m}
                type="monotone"
                dataKey={`${MONTHS[m - 1]}_actual`}
                name={`${MONTHS[m - 1]} (rzeczywiste)`}
                stroke={COLORS[i]}
                strokeWidth={2}
                dot={{ r: 4 }}
                connectNulls
              />
            ))}
            {SEASON_MONTHS.map((m, i) => (
              <Line
                key={`f${m}`}
                type="monotone"
                dataKey={`${MONTHS[m - 1]}_forecast`}
                name={`${MONTHS[m - 1]} (prognoza)`}
                stroke={FORECAST_COLORS[i]}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 5, fill: FORECAST_COLORS[i] }}
                connectNulls
              />
            ))}
            <ReferenceLine x={String(currentYear)} stroke="#f59e0b" strokeDasharray="3 3" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <h3 className="text-sm font-bold text-white mb-2">Dane historyczne (sezon)</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="text-left py-1.5 pl-2">Rok</th>
              {SEASON_MONTHS.map(m => <th key={m} className="text-right py-1.5">{MONTHS[m - 1]}</th>)}
              <th className="text-right py-1.5 pr-2">Łącznie sezon</th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => {
              const seasonTotal = SEASON_MONTHS.reduce((s, m) => {
                const d = monthlyData.find(x => x.year === y && x.month === m);
                return s + (d?.total ?? 0);
              }, 0);
              return (
                <tr key={y} className="border-b border-slate-800 hover:bg-slate-800">
                  <td className="py-2 pl-2 font-semibold text-white">{y}</td>
                  {SEASON_MONTHS.map(m => {
                    const d = monthlyData.find(x => x.year === y && x.month === m);
                    return (
                      <td key={m} className="py-2 text-right text-slate-300">
                        {d ? formatPLN(d.total) : '—'}
                      </td>
                    );
                  })}
                  <td className="py-2 pr-2 text-right font-semibold text-teal-400">{formatPLN(seasonTotal)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-600">
              <td className="py-2 pl-2 font-bold text-amber-400">{currentYear} (prognoza)</td>
              {forecasts.map((f, i) => (
                <td key={f.month} className="py-2 text-right font-semibold" style={{ color: FORECAST_COLORS[i] }}>
                  {formatPLN(f.forecasted)}
                </td>
              ))}
              <td className="py-2 pr-2 text-right font-bold text-amber-400">{formatPLN(totalForecast)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
