import { useState, useEffect } from 'react';
import { DailyRevenue, Invoice, DENOMS, BASE_DENOMS } from '../../lib/database';
import { Card } from '../shared/UI';

function formatPLN(v: number) {
  return v.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
}

const WEATHER_LABELS: Record<string, string> = {
  sunny: '☀️ Słonecznie',
  cloudy: '🌤️ Zachmurzenie',
  rainy: '🌧️ Deszcz',
  stormy: '⛈️ Burza',
};

interface Props {
  revenues: DailyRevenue[];
  invoices: Invoice[];
  selectedDate: string | null;
  commissionRate: number;
}

export default function DailyReport({ revenues, invoices, selectedDate, commissionRate }: Props) {
  const [date, setDate] = useState<string>(
    selectedDate ?? revenues[revenues.length - 1]?.date ?? ''
  );

  useEffect(() => {
    if (selectedDate) setDate(selectedDate);
  }, [selectedDate]);

  const r = revenues.find(rv => rv.date === date);
  const dayInvoices = invoices.filter(inv => inv.date === date);
  const dayOperCosts = dayInvoices.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const dayInvestCosts = dayInvoices.filter(i => i.category === 'Inwestycja').reduce((s, i) => s + i.amount, 0);
  const dayTotalCosts = dayOperCosts + dayInvestCosts;
  const dayProfit = r ? (r.total ?? 0) - dayTotalCosts : 0;
  const card_net = r ? r.card * (1 - commissionRate / 100) : 0;
  const blik_net = r ? r.blik * (1 - commissionRate / 100) : 0;

  const coinDenoms = DENOMS.filter(d => d.type === 'coin');
  const noteDenoms = DENOMS.filter(d => d.type === 'note');

  if (revenues.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        Brak danych za ten miesiąc
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Day selector */}
      <div className="flex gap-1.5 flex-wrap">
        {revenues.map(rv => (
          <button
            key={rv.date}
            onClick={() => setDate(rv.date)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${rv.date === date
                ? 'bg-teal-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}`}
          >
            {rv.date.split('-')[2]}
            {rv.weather === 'sunny' ? ' ☀️' : rv.weather === 'rainy' ? ' 🌧️' : rv.weather === 'stormy' ? ' ⛈️' : ''}
          </button>
        ))}
      </div>

      {!r ? (
        <div className="text-slate-500 text-sm text-center py-10">Wybierz dzień powyżej</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Left column */}
          <div className="flex flex-col gap-3">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="text-center py-3">
                <p className="text-xs text-slate-500 mb-1">DO SEJFU</p>
                <p className="text-xl font-bold text-teal-300">{formatPLN(r.do_sejfu ?? 0)}</p>
              </Card>
              <Card className="text-center py-3">
                <p className="text-xs text-slate-500 mb-1">Razem przychód</p>
                <p className="text-xl font-bold text-teal-400">{formatPLN(r.total ?? 0)}</p>
              </Card>
              <Card className="text-center py-3">
                <p className="text-xs text-slate-500 mb-1">Karta + BLIK</p>
                <p className="text-xl font-bold text-slate-300">{formatPLN(r.card + r.blik)}</p>
              </Card>
              <Card className="text-center py-3">
                <p className="text-xs text-slate-500 mb-1">Szac. auta</p>
                <p className="text-xl font-bold text-yellow-400">{r.estimated_cars ?? 0}</p>
              </Card>
            </div>

            {/* Denomination breakdown */}
            <Card title="Saszetka — nominały">
              <div className="space-y-0.5 text-sm">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Monety</div>
                {coinDenoms.map(d => {
                  const qty = (r[d.key as keyof DailyRevenue] as number) ?? 0;
                  if (qty === 0) return null;
                  return (
                    <div key={d.key} className="flex justify-between py-0.5">
                      <span className="text-slate-400">{d.label} × {qty}</span>
                      <span className="text-slate-300">{formatPLN(qty * d.value)}</span>
                    </div>
                  );
                })}
                <div className="text-xs text-slate-500 uppercase tracking-wider mt-2 mb-1.5">Banknoty</div>
                {noteDenoms.map(d => {
                  const qty = (r[d.key as keyof DailyRevenue] as number) ?? 0;
                  if (qty === 0) return null;
                  return (
                    <div key={d.key} className="flex justify-between py-0.5">
                      <span className="text-slate-400">{d.label} × {qty}</span>
                      <span className="text-slate-300">{formatPLN(qty * d.value)}</span>
                    </div>
                  );
                })}
                <div className="flex justify-between font-semibold border-t border-slate-700 pt-1.5 mt-1">
                  <span className="text-slate-300">Suma gotówka:</span>
                  <span className="text-teal-300">{formatPLN(r.cash ?? 0)}</span>
                </div>
              </div>
            </Card>

            {/* Base na jutro */}
            {(r.base_total ?? 0) > 0 && (
              <Card title="Baza na jutro">
                <div className="space-y-0.5 text-sm">
                  {[...BASE_DENOMS].map(d => {
                    const qty = (r[d.key as keyof DailyRevenue] as number) ?? 0;
                    if (qty === 0) return null;
                    return (
                      <div key={d.key} className="flex justify-between py-0.5">
                        <span className="text-slate-400">{d.label} × {qty}</span>
                        <span className="text-slate-300">{formatPLN(qty * d.value)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between font-semibold border-t border-slate-700 pt-1.5 mt-1">
                    <span className="text-yellow-400">Baza:</span>
                    <span className="text-yellow-300">− {formatPLN(r.base_total ?? 0)}</span>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-3">
            {/* Context */}
            <Card title="Kontekst dnia">
              <div className="space-y-2 text-sm">
                {r.weather && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Pogoda:</span>
                    <span className="text-white">{WEATHER_LABELS[r.weather] ?? r.weather}</span>
                  </div>
                )}
                {r.temperature != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Temperatura:</span>
                    <span className="text-white">{r.temperature}°C</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Gotówka (saszetka):</span>
                  <span className="text-slate-300">{formatPLN(r.cash ?? 0)}</span>
                </div>
                {(r.base_total ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">— Baza na jutro:</span>
                    <span className="text-yellow-400">− {formatPLN(r.base_total ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span className="text-slate-300">DO SEJFU:</span>
                  <span className="text-teal-300">{formatPLN(r.do_sejfu ?? 0)}</span>
                </div>
                {(r.card + r.blik) > 0 && (
                  <>
                    <div className="flex justify-between border-t border-slate-800 pt-1.5">
                      <span className="text-slate-400">Karta:</span>
                      <span className="text-slate-300">{formatPLN(r.card)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">BLIK:</span>
                      <span className="text-slate-300">{formatPLN(r.blik)}</span>
                    </div>
                    {commissionRate > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Karta+BLIK netto ({commissionRate}%):</span>
                        <span className="text-green-400">{formatPLN(card_net + blik_net)}</span>
                      </div>
                    )}
                  </>
                )}
                {r.notes && r.notes !== 'historyczny 2025' && (
                  <div className="mt-1 pt-1.5 border-t border-slate-700">
                    <span className="text-slate-500 block text-xs mb-0.5 uppercase tracking-wider">Notatki</span>
                    <span className="text-slate-300 text-xs">{r.notes}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Invoices for this day */}
            <Card title="Faktury — ten dzień">
              {dayInvoices.length === 0 ? (
                <p className="text-slate-500 text-xs">Brak faktur powiązanych z tym dniem</p>
              ) : (
                <div className="space-y-1 text-sm">
                  {dayInvoices.map(inv => (
                    <div key={inv.id} className="flex justify-between">
                      <span className="text-slate-400 truncate max-w-[60%] text-xs">{inv.name}</span>
                      <span className="text-red-400 font-medium text-xs">− {formatPLN(inv.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Day summary */}
            <div className="bg-slate-900 rounded-xl border border-teal-700/40 px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Przychód dnia:</span>
                <span className="text-teal-300 font-semibold">{formatPLN(r.total ?? 0)}</span>
              </div>
              {dayOperCosts > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Koszty oper.:</span>
                  <span className="text-red-400">− {formatPLN(dayOperCosts)}</span>
                </div>
              )}
              {dayInvestCosts > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Inwestycje:</span>
                  <span className="text-purple-400">− {formatPLN(dayInvestCosts)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-slate-700 pt-1.5">
                <span className="text-white">Zysk na czysto:</span>
                <span className={`text-lg ${dayProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatPLN(dayProfit)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
