import { DailyRevenue } from '../../lib/database';
import { Card } from '../shared/UI';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Label
} from 'recharts';

const WEATHER_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  sunny:  { icon: '☀️', label: 'Słonecznie', color: '#f59e0b' },
  cloudy: { icon: '🌤️', label: 'Zachmurzenie', color: '#94a3b8' },
  rainy:  { icon: '🌧️', label: 'Deszcz', color: '#60a5fa' },
  stormy: { icon: '⛈️', label: 'Burza', color: '#818cf8' },
};

function formatPLN(n: number) {
  return n.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

interface Props {
  revenues: DailyRevenue[];
}

export default function WeatherReport({ revenues }: Props) {
  const withWeather = revenues.filter(r => r.weather && (r.total ?? 0) > 0);

  if (withWeather.length === 0) {
    return (
      <Card>
        <div className="text-center py-10">
          <div className="text-4xl mb-3">🌤️</div>
          <p className="text-slate-400 text-sm">Brak danych pogodowych za ten miesiąc.</p>
          <p className="text-slate-500 text-xs mt-1">Przy wprowadzaniu przychodów wybierz pogodę danego dnia.</p>
        </div>
      </Card>
    );
  }

  // Group by weather type
  const groups = Object.keys(WEATHER_LABELS).map(key => {
    const days = withWeather.filter(r => r.weather === key);
    const avg = days.length > 0 ? days.reduce((s, r) => s + (r.total ?? 0), 0) / days.length : 0;
    const max = days.length > 0 ? Math.max(...days.map(r => r.total ?? 0)) : 0;
    const min = days.length > 0 ? Math.min(...days.map(r => r.total ?? 0)) : 0;
    return { key, days: days.length, avg, max, min, ...WEATHER_LABELS[key] };
  }).filter(g => g.days > 0).sort((a, b) => b.avg - a.avg);

  // Scatter data: temperature vs total
  const tempData = withWeather
    .filter(r => r.temperature != null)
    .map(r => ({
      temp: r.temperature as number,
      total: r.total ?? 0,
      weather: r.weather,
      date: r.date,
    }));

  const bestWeather = groups[0];

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-bold text-white mb-4">🌤️ Pogoda vs Utarg</h3>

        {bestWeather && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 flex items-center gap-3">
            <span className="text-3xl">{bestWeather.icon}</span>
            <div>
              <div className="text-sm font-semibold text-white">
                Najlepszy wynik: <span className="text-amber-400">{bestWeather.label}</span>
              </div>
              <div className="text-xs text-slate-400">
                Średni utarg {formatPLN(bestWeather.avg)} · {bestWeather.days} {bestWeather.days === 1 ? 'dzień' : 'dni'}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          {groups.map(g => (
            <div key={g.key} className="bg-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xl">{g.icon}</span>
                <span className="text-sm font-medium text-white">{g.label}</span>
                <span className="ml-auto text-[10px] text-slate-500">{g.days} {g.days === 1 ? 'dzień' : 'dni'}</span>
              </div>
              <div className="text-lg font-bold text-teal-400">{formatPLN(g.avg)}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                min {formatPLN(g.min)} · max {formatPLN(g.max)}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(g.avg / (groups[0]?.avg || 1)) * 100}%`,
                    backgroundColor: g.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {tempData.length >= 3 && (
        <Card>
          <h3 className="text-sm font-bold text-white mb-3">🌡️ Temperatura vs Utarg</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                type="number"
                dataKey="temp"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                domain={['auto', 'auto']}
              >
                <Label value="Temperatura (°C)" position="insideBottom" offset={-12} style={{ fill: '#64748b', fontSize: 11 }} />
              </XAxis>
              <YAxis
                type="number"
                dataKey="total"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={v => `${Math.round(Number(v) / 100) * 100}`}
              />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(v, name) =>
                  [name === 'total' ? formatPLN(Number(v)) : v, name === 'total' ? 'Utarg' : 'Temp.'] as [string, string]
                }
              />
              <Scatter
                data={tempData}
                fill="#14b8a6"
                opacity={0.8}
              />
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-slate-500 text-center mt-1">
            Każdy punkt = jeden dzień parkingowy
          </p>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-bold text-white mb-2">Dni z danymi pogodowymi</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="text-left py-1.5 pl-2">Data</th>
              <th className="text-left py-1.5">Pogoda</th>
              <th className="text-right py-1.5">Temp.</th>
              <th className="text-right py-1.5 pr-2">Utarg</th>
            </tr>
          </thead>
          <tbody>
            {withWeather.sort((a, b) => b.date.localeCompare(a.date)).map(r => {
              const wl = r.weather ? WEATHER_LABELS[r.weather] : null;
              return (
                <tr key={r.date} className="border-b border-slate-800 hover:bg-slate-800">
                  <td className="py-1.5 pl-2 text-slate-300">{r.date.split('-').slice(1).join('.')}</td>
                  <td className="py-1.5">
                    {wl ? <span>{wl.icon} {wl.label}</span> : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="py-1.5 text-right text-slate-400">
                    {r.temperature != null ? `${r.temperature}°C` : '—'}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-semibold text-teal-400">
                    {formatPLN(r.total ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
