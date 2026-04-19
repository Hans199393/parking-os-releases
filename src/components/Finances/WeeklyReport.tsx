import React from 'react';
import { DailyRevenue } from '../../lib/database';
import { Card } from '../shared/UI';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

function formatPLN(v: number) {
  return v.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getSundayOfWeek(monday: Date): Date {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  return d;
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function parseRevDate(dateStr: string): Date {
  // dateStr format: YYYY-MM-DD or DD.MM.YYYY
  if (dateStr.includes('-')) {
    return new Date(dateStr + 'T00:00:00');
  }
  const [d, m, y] = dateStr.split('.').map(Number);
  return new Date(y, m - 1, d);
}

const DOW_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];

interface Props {
  revenues: DailyRevenue[];
  weekOffset: number; // 0 = bieżący tydzień, -1 = poprzedni, etc.
  onOffsetChange: (offset: number) => void;
}

export default function WeeklyReport({ revenues, weekOffset, onOffsetChange }: Props) {
  const today = new Date();
  const baseMonday = getMondayOfWeek(today);
  baseMonday.setDate(baseMonday.getDate() + weekOffset * 7);
  const baseSunday = getSundayOfWeek(baseMonday);

  const mondayStr = formatDate(baseMonday);
  const sundayStr = formatDate(baseSunday);

  // Filter revenues for this week
  const weekRevenues = revenues.filter(r => {
    const d = parseRevDate(r.date);
    return d >= baseMonday && d <= baseSunday;
  });

  const totalRevenue = weekRevenues.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalCars = weekRevenues.reduce((s, r) => s + (r.estimated_cars ?? 0), 0);
  const workDays = weekRevenues.length;
  const avgRevPerDay = workDays > 0 ? totalRevenue / workDays : 0;
  const bestDay = weekRevenues.length > 0
    ? weekRevenues.reduce((a, b) => (b.total ?? 0) > (a.total ?? 0) ? b : a)
    : null;

  // Chart data — one bar per revenue day this week
  const chartData = weekRevenues
    .map(r => {
      const d = parseRevDate(r.date);
      return {
        label: `${DOW_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}`,
        przychód: r.total ?? 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const weekLabel = weekOffset === 0
    ? 'Bieżący tydzień'
    : weekOffset === -1
      ? 'Poprzedni tydzień'
      : `${Math.abs(weekOffset)} tyg. temu`;

  return (
    <div className="flex flex-col gap-4">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onOffsetChange(weekOffset - 1)}
          className="text-slate-400 hover:text-white px-3 py-1 rounded transition"
        >← Wcześniej</button>
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">{weekLabel}</h2>
          <p className="text-xs text-slate-500">{mondayStr} – {sundayStr}</p>
        </div>
        <button
          onClick={() => onOffsetChange(weekOffset + 1)}
          disabled={weekOffset >= 0}
          className="text-slate-400 hover:text-white px-3 py-1 rounded transition disabled:opacity-30"
        >Później →</button>
      </div>

      {weekRevenues.length === 0 ? (
        <Card className="text-center py-8">
          <p className="text-slate-500">Brak danych dla tego tygodnia.</p>
        </Card>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Przychody</p>
              <p className="text-xl font-bold text-teal-400">{formatPLN(totalRevenue)}</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Dni robocze</p>
              <p className="text-xl font-bold text-white">{workDays}</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Śr. dziennie</p>
              <p className="text-xl font-bold text-amber-400">{formatPLN(avgRevPerDay)}</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-slate-500 text-xs mb-1">Auta (est.)</p>
              <p className="text-xl font-bold text-blue-400">{totalCars}</p>
            </Card>
          </div>

          {/* Best day */}
          {bestDay && (
            <Card className="flex items-center gap-4 px-4 py-3">
              <span className="text-2xl">🏆</span>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Najlepszy dzień tygodnia</p>
                <p className="text-white font-semibold">
                  {(() => {
                    const d = parseRevDate(bestDay.date);
                    return `${DOW_SHORT[d.getDay()]}, ${formatDate(d)}`;
                  })()} — <span className="text-teal-400">{formatPLN(bestDay.total ?? 0)}</span>
                  {bestDay.weather ? ` · ${bestDay.weather === 'sunny' ? '☀️' : bestDay.weather === 'cloudy' ? '🌤️' : bestDay.weather === 'rainy' ? '🌧️' : '⛈️'}` : ''}
                </p>
              </div>
            </Card>
          )}

          {/* Bar chart */}
          {chartData.length > 0 && (
            <Card className="p-4">
              <p className="text-xs text-slate-500 mb-3">Przychody dzień po dniu</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${v} zł`} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(v) => [formatPLN(Number(v)), 'Przychód'] as [string, string]}
                  />
                  <Bar dataKey="przychód" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Day breakdown */}
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-700">
                  <th className="text-left pb-2 pl-2">Dzień</th>
                  <th className="text-right pb-2">Przychód</th>
                  <th className="text-right pb-2">Auta (est.)</th>
                  <th className="text-right pb-2 pr-2">Pogoda</th>
                </tr>
              </thead>
              <tbody>
                {weekRevenues
                  .slice()
                  .sort((a, b) => parseRevDate(a.date).getTime() - parseRevDate(b.date).getTime())
                  .map(r => {
                    const d = parseRevDate(r.date);
                    return (
                      <tr key={r.date} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pl-2 text-white">
                          {DOW_SHORT[d.getDay()]} {formatDate(d)}
                        </td>
                        <td className="py-2 text-right text-teal-400 font-medium">{formatPLN(r.total ?? 0)}</td>
                        <td className="py-2 text-right text-slate-400">{r.estimated_cars ?? '—'}</td>
                        <td className="py-2 pr-2 text-right">
                          {r.weather === 'sunny' ? '☀️' : r.weather === 'cloudy' ? '🌤️' : r.weather === 'rainy' ? '🌧️' : r.weather === 'stormy' ? '⛈️' : '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-600">
                  <td className="pt-2 pl-2 text-slate-400 font-semibold text-xs">SUMA</td>
                  <td className="pt-2 text-right text-teal-400 font-bold">{formatPLN(totalRevenue)}</td>
                  <td className="pt-2 text-right text-slate-400 font-bold">{totalCars}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
