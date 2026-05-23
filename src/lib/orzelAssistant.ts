/**
 * orzelAssistant — lokalny asystent operatora (Czat Orzeł).
 * Iteracja 5: function calling poprzez Groq API (OpenAI-compatible).
 *
 * Architektura:
 *   1. Operator pisze pytanie ("ile rezerwacji jutro?", "sprawdź WX12345")
 *   2. Wysyłamy do Groq z listą `tools` (function declarations)
 *   3. Model wybiera funkcję → wywołujemy lokalnie (Supabase) → zwracamy wynik
 *   4. Drugi turn: model sumuje wynik na język naturalny
 *
 * Bez globalnych side-effectów. Każde wywołanie tool jest auditowane (audit_logs).
 */

import { getStore } from './store';
import { audit } from './audit';
import {
  getReservationsForDate,
  getFullHistory,
  getBannedVehicles,
  getConfig,
  getConfigs,
  getAssistantPromptConfig,
  getAdminLogs,
  getCapacityForDate,
  getAllWaitlist,
  getWaitlistForDate,
  getExtraOpenDays,
  getReservationCountByMonth,
  getBotAlerts,
} from './supabase';
import {
  getMonthlyRevenue, getMonthlyInvoices, getRecurringMonthlyTotal, getDailyRevenue,
} from './database';
import { DEFAULT_PROMPT_CONFIG } from './promptDefaults';
import { buildPrompt } from './promptBuilder';

// ─── Tool registry ──────────────────────────────────────────────────────────

export interface OrzelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run: (args: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  // Czy narzędzie mutuje dane (wymaga potwierdzenia przy manualnym uruchomieniu)
  mutates?: boolean;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(input?: string): string {
  if (!input || input.toLowerCase() === 'dziś' || input.toLowerCase() === 'dzis' || input.toLowerCase() === 'today') return todayISO();
  if (input.toLowerCase() === 'jutro' || input.toLowerCase() === 'tomorrow') {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (input.toLowerCase() === 'wczoraj' || input.toLowerCase() === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  // DD.MM.YYYY → YYYY-MM-DD
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // YYYY-MM-DD passthrough
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return input;
}

export const TOOLS: OrzelTool[] = [
  {
    name: 'list_reservations',
    description: 'Zwraca listę rezerwacji na podany dzień lub zakres dni. Argument `date` może być w formacie YYYY-MM-DD, DD.MM.YYYY albo słowem "dziś"/"jutro"/"wczoraj". Opcjonalny `date_to` zwraca rezerwacje na zakres (włącznie). Bez argumentu = dziś.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD lub słowo (dziś/jutro/wczoraj)' },
        date_to: { type: 'string', description: 'Opcjonalna data końcowa zakresu (YYYY-MM-DD)' },
      },
    },
    run: async ({ date, date_to }: { date?: string; date_to?: string }) => {
      const dStart = parseDate(date);
      const dEnd = date_to ? parseDate(date_to) : dStart;
      if (dEnd === dStart) {
        const list = await getReservationsForDate(dStart);
        void audit('chat', 'orzel_tool', { metadata: { tool: 'list_reservations', date: dStart, count: list.length } });
        return {
          date: dStart,
          count: list.length,
          reservations: list.map(r => ({ registration: r.registration, status: r.status, id: r.id })),
        };
      }
      // Zakres dat
      const start = new Date(dStart + 'T00:00:00');
      const end = new Date(dEnd + 'T00:00:00');
      const days: { date: string; count: number; registrations: string[] }[] = [];
      let total = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const list = await getReservationsForDate(iso);
        days.push({ date: iso, count: list.length, registrations: list.map(r => r.registration) });
        total += list.length;
      }
      void audit('chat', 'orzel_tool', { metadata: { tool: 'list_reservations', date_from: dStart, date_to: dEnd, total } });
      return { date_from: dStart, date_to: dEnd, total_reservations: total, days };
    },
  },
  {
    name: 'find_reservation',
    description: 'Wyszukaj rezerwacje po fragmencie tablicy rejestracyjnej (case-insensitive, częściowe dopasowanie). Zwraca max 20 ostatnich.',
    parameters: {
      type: 'object',
      properties: { plate: { type: 'string', description: 'Fragment tablicy, np. "WX123"' } },
      required: ['plate'],
    },
    run: async ({ plate }: { plate: string }) => {
      const all = await getFullHistory();
      const needle = plate.toUpperCase().replace(/\s+/g, '');
      const hits = all
        .filter(r => r.registration.toUpperCase().replace(/\s+/g, '').includes(needle))
        .slice(0, 20);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'find_reservation', plate, count: hits.length } });
      return {
        query: plate,
        count: hits.length,
        results: hits.map(r => ({
          id: r.id,
          registration: r.registration,
          arrival_date: r.arrival_date,
          status: r.status,
        })),
      };
    },
  },
  {
    name: 'get_parking_info',
    description: 'Zwraca aktualne informacje o parkingu: nazwa, pojemność, ceny, godziny otwarcia, status (otwarte/zamknięte), aktualny komunikat publiczny.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const keys = ['parking_name', 'parking_capacity', 'rate_basic', 'rate_reservation', 'rate_after_hours',
                    'open_from', 'open_to', 'spots_available', 'komunikat', 'currency'];
      const out: Record<string, string> = {};
      await Promise.all(keys.map(async k => {
        out[k] = (await getConfig(k).catch(() => null)) ?? '';
      }));
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_parking_info' } });
      return out;
    },
  },
  // ─── Iter 11: nowe tools dla CEO ──────────────────────────────────────────
  {
    name: 'get_finance_summary',
    description: 'Iter 11: Podsumowanie finansowe parkingu. Argument `period`: "today" (dziś), "month" (miesiąc), "year" (cały rok). Opcjonalne `year` (np. 2025) i `month` (1-12) — domyślnie bieżący. Zwraca: przychód (gotówka+karta+BLIK), koszty jednorazowe (faktury), koszty cykliczne, marżę i marżę %. UWAGA: dane prywatne CEO — nie udostępniaj poza adminem.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Okres: today / month / year' },
        year:   { type: 'number', description: 'Rok np. 2025 (opcjonalny, default: bieżący)' },
        month:  { type: 'number', description: 'Miesiąc 1-12 (opcjonalny, default: bieżący)' },
      },
    },
    run: async ({ period, year: yArg, month: mArg }: { period?: string; year?: number; month?: number }) => {
      const p = (period ?? 'month').toLowerCase();
      const now = new Date();
      const year = yArg && yArg > 2000 && yArg < 3000 ? yArg : now.getFullYear();
      const month = mArg && mArg >= 1 && mArg <= 12 ? mArg : now.getMonth() + 1;
      const store = await getStore();
      const commission = (await store.get<number>('card_commission_rate')) ?? 0;

      const sumRev = (revs: Awaited<ReturnType<typeof getMonthlyRevenue>>) => revs.reduce((s, r) => {
        const cash = (r.qty_1??0)*1 + (r.qty_2??0)*2 + (r.qty_5??0)*5 + (r.qty_10??0)*10 + (r.qty_20??0)*20 + (r.qty_50??0)*50 + (r.qty_100??0)*100 + (r.qty_200??0)*200 + (r.qty_500??0)*500;
        return s + cash + (r.card??0)*(1-commission/100) + (r.blik??0)*(1-commission/100);
      }, 0);

      let revenue = 0, oneTimeCosts = 0, recurringCosts = 0, label = '';
      if (p === 'today' || p === 'dzis' || p === 'dziś') {
        const todayStr = now.toISOString().slice(0, 10);
        const revs = (await getMonthlyRevenue(now.getFullYear(), now.getMonth() + 1)).filter(r => r.date === todayStr);
        const invs = (await getMonthlyInvoices(now.getFullYear(), now.getMonth() + 1)).filter(i => i.date === todayStr);
        const rec = await getRecurringMonthlyTotal(now.getFullYear(), now.getMonth() + 1);
        revenue = sumRev(revs);
        oneTimeCosts = invs.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
        recurringCosts = Math.round(rec.total / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
        label = todayStr;
      } else if (p === 'month' || p === 'miesiac' || p === 'miesiąc') {
        const revs = await getMonthlyRevenue(year, month);
        const invs = await getMonthlyInvoices(year, month);
        const rec = await getRecurringMonthlyTotal(year, month);
        revenue = sumRev(revs);
        oneTimeCosts = invs.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
        recurringCosts = rec.total;
        label = `${year}-${String(month).padStart(2, '0')}`;
      } else {
        // rok
        for (let m = 1; m <= 12; m++) {
          const revs = await getMonthlyRevenue(year, m);
          const invs = await getMonthlyInvoices(year, m);
          const rec = await getRecurringMonthlyTotal(year, m);
          revenue += sumRev(revs);
          oneTimeCosts += invs.filter(i => i.category !== 'Inwestycja').reduce((s, i) => s + i.amount, 0);
          recurringCosts += rec.total;
        }
        label = String(year);
      }
      const totalCosts = oneTimeCosts + recurringCosts;
      const margin = revenue - totalCosts;
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
      void audit('chat', 'orzel_tool', { severity: 'info', metadata: { tool: 'get_finance_summary', period: p, year, month } });
      return {
        period: p, label, year, month: p === 'month' ? month : undefined,
        revenue: Math.round(revenue * 100) / 100,
        one_time_costs: Math.round(oneTimeCosts * 100) / 100,
        recurring_costs: Math.round(recurringCosts * 100) / 100,
        total_costs: Math.round(totalCosts * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        margin_pct: Math.round(marginPct * 10) / 10,
        currency: 'PLN',
        note: revenue === 0 && totalCosts === 0 ? 'Brak danych dla tego okresu w lokalnej bazie SQLite (dane finansowe są lokalne, nie w Supabase).' : undefined,
      };
    },
  },
  {
    name: 'get_recent_logs',
    description: 'Iter 11: Ostatnie logi systemowe (błędy, akcje administracyjne). Argument `category` opcjonalny: reservation/finance/user/mail/camera/bot/system. Argument `limit` (domyślnie 20, max 50).',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filtr kategorii (opcjonalny)' },
        limit: { type: 'number', description: 'Liczba logów (1-50)' },
      },
    },
    run: async ({ category, limit }: { category?: string; limit?: number }) => {
      const lim = Math.max(1, Math.min(50, limit ?? 20));
      const cat = category as Parameters<typeof getAdminLogs>[0];
      const logs = await getAdminLogs(cat, lim);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_recent_logs', count: logs.length, category: cat } });
      return {
        count: logs.length,
        category: category ?? 'all',
        logs: logs.map(l => ({
          when: l.created_at,
          who: l.user_email ?? 'system',
          category: l.category,
          action: l.action,
          severity: l.severity,
          description: l.description,
        })),
      };
    },
  },
  {
    name: 'get_camera_status',
    description: 'Iter 11: Stan kamer parkingu — ile jest skonfigurowanych (snapshot/RTSP/HLS).',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const store = await getStore();
      const cams: { id: number; snapshot: boolean; rtsp: boolean; hls: boolean }[] = [];
      for (let i = 1; i <= 4; i++) {
        const snap = (await store.get<string>(`cam${i}_snapshot_url`)) || '';
        const rtsp = (await store.get<string>(`cam${i}_rtsp_url`)) || '';
        const hls = (await store.get<string>(`cam${i}_hls_url`)) || '';
        cams.push({ id: i, snapshot: !!snap, rtsp: !!rtsp, hls: !!hls });
      }
      const configured = cams.filter(c => c.snapshot || c.rtsp || c.hls).length;
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_camera_status', configured } });
      return {
        total_slots: 4,
        configured,
        cameras: cams,
      };
    },
  },
  {
    name: 'list_banned_vehicles',
    description: 'Lista zbanowanych tablic rejestracyjnych z powodem i datą.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const bans = await getBannedVehicles();
      void audit('chat', 'orzel_tool', { metadata: { tool: 'list_banned_vehicles', count: bans.length } });
      return {
        count: bans.length,
        banned: bans.slice(0, 50).map(b => ({
          registration: b.registration,
          reason: b.ban_reason,
          banned_at: b.last_no_show,
          no_show_count: b.no_show_count,
        })),
      };
    },
  },
  {
    name: 'list_waitlist',
    description: 'Iter 12-pre: lista oczekujących na rezerwację (waitlist). Gdy klient chciał, ale nie było miejsca, trafia tu — żeby admin mógł zaproponować mu wolne miejsce gdy się zwolni. Argumenty opcjonalne: `date` (YYYY-MM-DD lub "dziś"/"jutro" — filtruje po dacie przyjazdu), `status` (waiting/promoted/cancelled/expired — domyślnie waiting). Bez argumentów = wszyscy oczekujący.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Filtruj po dacie (YYYY-MM-DD lub dziś/jutro)' },
        status: { type: 'string', description: 'Filtr statusu (waiting/promoted/cancelled/expired)' },
      },
    },
    run: async ({ date, status }: { date?: string; status?: string }) => {
      const list = date ? await getWaitlistForDate(parseDate(date)) : await getAllWaitlist();
      const wantedStatus = (status ?? 'waiting').toLowerCase();
      const filtered = wantedStatus === 'all' ? list : list.filter(w => w.status === wantedStatus);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'list_waitlist', date, status: wantedStatus, count: filtered.length } });
      return {
        date: date ? parseDate(date) : 'all',
        status: wantedStatus,
        count: filtered.length,
        entries: filtered.slice(0, 30).map(w => ({
          registration: w.registration,
          arrival_date: w.arrival_date,
          status: w.status,
          contact_name: w.contact_name,
          contact_phone: w.contact_phone,
          channel: w.channel,
          created_at: w.created_at,
          notes: w.notes,
        })),
      };
    },
  },
  {
    name: 'check_capacity',
    description: 'Iter 11 (rozszerzone): sprawdza obłożenie parkingu na dany dzień. Zwraca: capacity, booked, free, full (czy pełny).',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD lub dziś/jutro' } },
    },
    run: async ({ date }: { date?: string }) => {
      const d = parseDate(date);
      const cap = await getCapacityForDate(d);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'check_capacity_v2', date: d } });
      return { date: d, ...cap };
    },
  },
  // ─── Nowe tools (Iter 14) ─────────────────────────────────────────────────
  {
    name: 'get_week_overview',
    description: 'Przegląd obłożenia na najbliższe 7 dni (lub od wskazanej daty). Dla każdego dnia: data, zarezerwowane, wolne, pełny. Pomocne przy planowaniu.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Data startowa (YYYY-MM-DD lub dziś/jutro). Domyślnie dziś.' },
      },
    },
    run: async ({ from }: { from?: string }) => {
      const start = new Date(parseDate(from) + 'T00:00:00');
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        const cap = await getCapacityForDate(iso);
        days.push({ date: iso, ...cap });
      }
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_week_overview', from: parseDate(from) } });
      return { from: parseDate(from), days };
    },
  },
  {
    name: 'get_monthly_overview',
    description: 'Liczba rezerwacji na każdy dzień miesiąca (calendar view). Argument `year` i `month` — domyślnie bieżący. Przydatne: „pokaż mi cały maj".',
    parameters: {
      type: 'object',
      properties: {
        year:  { type: 'number', description: 'Rok (domyślnie bieżący)' },
        month: { type: 'number', description: 'Miesiąc 1-12 (domyślnie bieżący)' },
      },
    },
    run: async ({ year: yArg, month: mArg }: { year?: number; month?: number }) => {
      const now = new Date();
      const year = yArg ?? now.getFullYear();
      const month = mArg ?? (now.getMonth() + 1);
      const counts = await getReservationCountByMonth(year, month);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_monthly_overview', year, month } });
      return { year, month, counts };
    },
  },
  {
    name: 'get_daily_revenue',
    description: 'Utarg konkretnego dnia z lokalnej bazy SQLite (gotówka, karta, BLIK). Argument `date` — YYYY-MM-DD lub dziś/wczoraj.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD lub dziś/wczoraj (domyślnie dziś)' },
      },
    },
    run: async ({ date }: { date?: string }) => {
      const d = parseDate(date);
      const rev = await getDailyRevenue(d);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_daily_revenue', date: d } });
      if (!rev) return { date: d, message: 'Brak danych dla tego dnia w lokalnej bazie SQLite.' };
      return rev;
    },
  },
  {
    name: 'get_bot_alerts',
    description: 'Alerty wygenerowane przez bota Messenger (np. podejrzane tablice, problemy z rezerwacją). Domyślnie tylko nierozwiązane.',
    parameters: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'true = pokaż wszystkie (też rozwiązane)' },
      },
    },
    run: async ({ all }: { all?: boolean }) => {
      const alerts = await getBotAlerts(!all);
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_bot_alerts', count: alerts.length } });
      return {
        count: alerts.length,
        alerts: alerts.slice(0, 30).map(a => ({
          id: a.id,
          type: a.type,
          message: a.message,
          created_at: a.created_at,
          resolved: a.resolved,
        })),
      };
    },
  },
  {
    name: 'get_extra_open_days',
    description: 'Specjalne dni otwarcia parkingu (dni wyjątkowe, poza normalnym harmonogramem). Np. dodane ręcznie przez admina.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const days = await getExtraOpenDays();
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_extra_open_days', count: days.length } });
      return {
        count: days.length,
        days: days.map(d => ({ date: d.date, note: d.note, active: d.active })),
      };
    },
  },
  {
    name: 'get_reservation_stats',
    description: 'Statystyki rezerwacji za miesiąc lub rok: ile aktywnych, anulowanych, no-show, łącznie. Argument `period`: month / year. `year` i `month` opcjonalne (domyślnie bieżące).',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'month lub year (domyślnie month)' },
        year:   { type: 'number', description: 'Rok (domyślnie bieżący)' },
        month:  { type: 'number', description: 'Miesiąc 1-12 (domyślnie bieżący)' },
      },
    },
    run: async ({ period, year: yArg, month: mArg }: { period?: string; year?: number; month?: number }) => {
      const now = new Date();
      const year = yArg ?? now.getFullYear();
      const month = mArg ?? (now.getMonth() + 1);
      const p = (period ?? 'month').toLowerCase();

      // Pobieramy pełną historię i filtrujemy po dacie
      const all = await getFullHistory();
      const filterFn = (r: { arrival_date: string }) => {
        const d = new Date(r.arrival_date + 'T00:00:00');
        if (p === 'year') return d.getFullYear() === year;
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      };
      const filtered = all.filter(filterFn);
      const stats: Record<string, number> = {};
      for (const r of filtered) {
        const s = r.status ?? 'unknown';
        stats[s] = (stats[s] ?? 0) + 1;
      }
      void audit('chat', 'orzel_tool', { metadata: { tool: 'get_reservation_stats', period: p, year, month } });
      return {
        period: p, year, month: p === 'month' ? month : undefined,
        total: filtered.length,
        by_status: stats,
      };
    },
  },
];

// ─── OpenAI-compatible client (Groq by default) ─────────────────────────────

const DEFAULT_ORZEL_API_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface OrzelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface OrzelTurnResult {
  message: string;
  toolCalls: { name: string; args: unknown; result: unknown }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  error?: string;
}

function classifyOrzelError(message: string): string {
  if (/Klucz API jest nieważny albo został wyłączony/i.test(message)) return 'auth_invalid';
  if (/Endpoint AI zwrócił 404/i.test(message)) return 'endpoint_not_found';
  if (/Rate limit \(429\)/i.test(message)) return 'rate_limit';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message)) return 'network_error';
  return 'runtime_error';
}

// Iter 12-pre: prompt budowany dynamicznie + CACHE w pamięci modułu na 5 minut.
// Pełny prompt dla profilu 'assistant' z bloc_order (parking_info, pricing, places...)
// to 3-5k tokenów doklejanych do KAŻDEGO zapytania — to główny powod 429 TPM.
// Dla wewnętrznego asystenta admina bloków wiedzy NIE potrzebujemy (od tego są toole).
let _systemPromptCache: { prompt: string; toolsEnabled: string[]; expires: number } | null = null;
const SYSTEM_PROMPT_TTL_MS = 5 * 60 * 1000;

async function getSystemPrompt(): Promise<{ prompt: string; toolsEnabled: string[] }> {
  const now = Date.now();
  if (_systemPromptCache && _systemPromptCache.expires > now) {
    return { prompt: _systemPromptCache.prompt, toolsEnabled: _systemPromptCache.toolsEnabled };
  }
  let cfg;
  try {
    cfg = (await getAssistantPromptConfig()) ?? DEFAULT_PROMPT_CONFIG;
  } catch (e) {
    console.warn('[orzel] getAssistantPromptConfig failed, using local defaults:', e);
    cfg = DEFAULT_PROMPT_CONFIG;
  }
  let settings: Record<string, string> = {};
  try {
    settings = await getConfigs([
      'rate_basic', 'rate_reservation', 'currency',
      'open_from', 'open_to', 'owner_phone', 'owner_email',
      'parking_name', 'parking_address',
    ]);
  } catch (e) {
    console.warn('[orzel] getConfigs failed:', e);
  }
  // OPTYMALIZACJA TPM: domyślnie dla profilu 'assistant' używamy tylko najważniejszych bloków
  // (pomijamy duże bloki wiedzy, bo są dostępne jako toole). Jeśli jednak administrator
  // włączy `orzel_expanded_mode` → używamy PEŁNEGO promptu (rozszerzony tryb desktopowy).
  const slimCfg = {
    ...cfg,
    profiles: {
      ...cfg.profiles,
      assistant: {
        ...cfg.profiles.assistant,
        block_order: cfg.profiles.assistant.block_order.filter(b =>
          b === 'persona_assistant' || b === 'golden_rule'
        ),
      },
    },
  };
  // Sprawdź ustawienie rozszerzonego trybu
  let expanded = false;
  try {
    const store = await getStore();
    expanded = (await store.get<string>('orzel_expanded_mode')) === 'true';
  } catch (e) {
    // ignore — jeżeli store nie działa, pozostajemy w trybie slim
  }
  const promptCfg = expanded ? cfg : slimCfg;
  const prompt = buildPrompt(promptCfg, 'assistant', settings, { today_iso: new Date().toISOString().slice(0, 10) });
  const toolsEnabled = cfg.profiles.assistant.tools_enabled ?? [];
  _systemPromptCache = { prompt, toolsEnabled, expires: now + SYSTEM_PROMPT_TTL_MS };
  return { prompt, toolsEnabled };
}

/** Wyczyść cache promptu (np. po edycji w UI Ustawień). */
export function invalidateAssistantPromptCache(): void {
  _systemPromptCache = null;
}

/**
 * Uruchamia narzędzie z rejestru `TOOLS` bez udziału modelu.
 * Przydatne do szybkich, jednoznacznych akcji z UI (np. anuluj rezerwację).
 */
export async function runTool(name: string, args: unknown): Promise<unknown> {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Nieznane narzędzie: ${name}`);
  try {
    // Jeśli narzędzie mutuje dane, wymaga jawnego potwierdzenia w argumencie __confirm=true
    if (tool.mutates) {
      const confirmed = typeof args === 'object' && args != null && (args as any).__confirm === true;
      if (!confirmed) throw new Error('confirmation_required');
      // Dodatkowo wymagaj zalogowanego użytkownika (minimalna kontrola uprawnień)
      try {
        const sb = await import('./supabase');
        const client = await (sb as any).getSupabaseClient();
        const userResult = await (client as any).auth.getUser();
        const user = userResult?.data?.user ?? null;
        if (!user) throw new Error('not_authenticated');
      } catch (e) {
        throw new Error('not_authenticated');
      }
    }

    // Prosty cache + throttling: unikamy zbyt częstych wywołań tego samego narzędzia
    const cacheKey = JSON.stringify({ name, args });
    const now = Date.now();
    if (!runToolCache.has(name)) runToolCache.set(name, new Map());
    const toolCache = runToolCache.get(name)!;
    // Throttling: max 20 wywołań narzędzia / minuta
    const calls = runToolCalls.get(name) ?? [];
    const windowStart = now - 60_000;
    const recent = calls.filter(t => t > windowStart);
    if (recent.length >= 20) throw new Error('throttled');
    recent.push(now);
    runToolCalls.set(name, recent);
    if (toolCache.has(cacheKey)) {
      return toolCache.get(cacheKey);
    }
    const result = await tool.run(args);
    // cache wynik przez 60s
    toolCache.set(cacheKey, result);
    setTimeout(() => toolCache.delete(cacheKey), 60_000);
    void audit('chat', 'orzel_tool_manual', { metadata: { tool: name, args } });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void audit('chat', 'orzel_tool_manual_error', { metadata: { tool: name, args, error: msg } });
    throw e;
  }
}

// In-memory helpers for runTool caching and throttling
const runToolCache: Map<string, Map<string, unknown>> = new Map();
const runToolCalls: Map<string, number[]> = new Map();

interface GroqConfig {
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  temperature: number;
}

async function loadConfig(): Promise<GroqConfig | null> {
  const store = await getStore();
  const apiKey = (await store.get<string>('groq_api_key')) ?? '';
  const model = (await store.get<string>('groq_model')) ?? 'llama-3.3-70b-versatile';
  const apiBaseUrl = ((await store.get<string>('orzel_api_base_url')) ?? DEFAULT_ORZEL_API_BASE_URL).trim() || DEFAULT_ORZEL_API_BASE_URL;
  const tempStr = (await store.get<string>('orzel_temperature')) ?? '0.3';
  const temperature = Math.max(0, Math.min(1, parseFloat(tempStr) || 0.3));
  if (!apiKey) return null;
  return { apiKey, model, apiBaseUrl, temperature };
}

export async function isOrzelConfigured(): Promise<boolean> {
  const cfg = await loadConfig();
  return cfg !== null;
}

function toolsAsOpenAI(enabledNames?: string[]) {
  const list = enabledNames && enabledNames.length > 0
    ? TOOLS.filter(t => enabledNames.includes(t.name))
    : TOOLS;
  return list.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function callGroq(
  cfg: GroqConfig,
  messages: OrzelMessage[],
  enabledTools?: string[],
): Promise<{
  message: { role: string; content: string | null; tool_calls?: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  usage?: { prompt_tokens: number; completion_tokens: number };
}> {
  // Try request, on 429 attempt one fallback retry with smaller/cheaper model (do not persist change)
  const doRequest = async (model: string) => await fetch(cfg.apiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      temperature: cfg.temperature,
      max_tokens: 500,
      messages,
      tools: toolsAsOpenAI(enabledTools),
      tool_choice: 'auto',
    }),
  });
  let res = await doRequest(cfg.model);
  if (!res.ok && res.status === 429) {
    // jeśli to nie był już 8b-instant, spróbuj fallback raz na szybszy model
    const alreadyOnInstant = /8b-instant/i.test(cfg.model);
    if (!alreadyOnInstant) {
      try {
        res = await doRequest('llama-3.1-8b-instant');
      } catch (e) {
        // fall through to error handling
      }
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Czytelne komunikaty dla najczęstszych błędów
    if (res.status === 429) {
      // Rozróżniamy TPM (per minute) vs TPD (per day) — to kluczowe dla użytkownika
      const isTPD = /tokens per day|TPD/i.test(body);
      const m = /Limit\s+(\d+),?\s*Used\s+(\d+)/i.exec(body);
      const retry = /try again in ([0-9.]+)([smh])/i.exec(body);
      const retryStr = retry ? `${retry[1]}${retry[2]}` : (isTPD ? 'do północy UTC' : '~60s');
      const limitInfo = m ? `${m[2]}/${m[1]} ${isTPD ? 'TPD (dziennie)' : 'TPM (na minutę)'}` : '';
      // Sugeruj alternatywny model TYLKO jeśli użytkownik nie jest już na "tańszym" 8b-instant
      const alreadyOnInstant = /8b-instant/i.test(cfg.model);
      const altSuggestion = alreadyOnInstant
        ? ''
        : ` albo zmień model na llama-3.1-8b-instant (Ustawienia → Integracje)`;
      const tip = isTPD
        ? `Wyczerpany DZIENNY limit modelu ${cfg.model} (${limitInfo}). Poczekaj ${retryStr}${altSuggestion}.`
        : `Limit modelu ${cfg.model} wyczerpany (${limitInfo}). Poczekaj ${retryStr}${altSuggestion}.`;
      throw new Error(`Rate limit (429): ${tip}`);
    }
    if (res.status === 401) {
      throw new Error('Klucz API jest nieważny albo został wyłączony. Jeśli używasz Groq, wygeneruj nowy w console.groq.com/keys. Jeśli używasz innego endpointu, podmień bearer key w Ustawieniach → Integracje → AI Asystent.');
    }
    if (res.status === 404) {
      throw new Error('Endpoint AI zwrócił 404. Sprawdź pełny URL OpenAI-compatible, zwykle kończy się na /chat/completions.');
    }
    if (res.status === 400 && body.includes('tool_use_failed')) {
      throw new Error(`Model nie potrafił sformułować wywołania narzędzia. Spróbuj przeformułować pytanie konkretniej (np. "finanse za lipiec 2025").`);
    }
    throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return { message: json.choices?.[0]?.message ?? { role: 'assistant', content: null }, usage: json.usage };
}

/**
 * Główna pętla rozmowy. Przyjmuje historię + nowy user input,
 * wykonuje tool calls do max 4 iteracji, zwraca finalną odpowiedź.
 */
export async function chatTurn(history: OrzelMessage[], userInput: string): Promise<OrzelTurnResult> {
  const cfg = await loadConfig();
  if (!cfg) {
    return {
      message: 'Asystent Orzeł nie jest skonfigurowany. Wejdź w **Ustawienia → Integracje → AI Asystent (Orzeł)** i dodaj klucz Groq API.',
      toolCalls: [],
      error: 'no_config',
    };
  }

  const { prompt: systemPrompt, toolsEnabled } = await getSystemPrompt();
  // Iter 12-pre: ogranicz history do ostatnich 6 wiadomości (3 pary user/assistant).
  // To kompromis między zachowaniem kontekstu rozmowy a oszczędnością TPM.
  const trimmedHistory = history.slice(-6);
  const messages: OrzelMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'user', content: userInput },
  ];
  // Cache wyników narzędzi w obrębie jednego chatTurn (bot często woła 2x to samo).
  const toolCache = new Map<string, unknown>();
  const toolCalls: OrzelTurnResult['toolCalls'] = [];
  let totalUsage: { prompt_tokens: number; completion_tokens: number } | undefined;

  try {
    for (let iter = 0; iter < 4; iter++) {
      const { message, usage } = await callGroq(cfg, messages, toolsEnabled);
      if (usage) {
        totalUsage = totalUsage
          ? { prompt_tokens: totalUsage.prompt_tokens + usage.prompt_tokens, completion_tokens: totalUsage.completion_tokens + usage.completion_tokens }
          : usage;
      }
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        // Final answer
        let content = (message.content ?? '').trim() || '(asystent nie zwrócił treści)';

        // Niektóre modele (zwł. fallback llama-3.1-8b-instant) zamiast wywołać
        // narzędzie przez API tool_calls — wklejają tag <function=NAME>{"json":"args"}</function>
        // do treści. Wykryjmy taki przypadek, wykonajmy narzędzie i zastąpmy tag wynikiem.
        const fnTagRe = /<function\s*=\s*([a-z_][a-z0-9_]*)\s*>([\s\S]*?)<\/function>/gi;
        const tagMatches = [...content.matchAll(fnTagRe)];
        if (tagMatches.length > 0) {
          for (const m of tagMatches) {
            const toolName = m[1];
            const rawArgs = (m[2] || '').trim();
            const tool = TOOLS.find(t => t.name === toolName);
            let result: unknown;
            let args: unknown;
            try {
              args = rawArgs ? JSON.parse(rawArgs) : {};
              if (!tool) throw new Error(`Nieznane narzędzie: ${toolName}`);
              const ck = `${toolName}:${rawArgs || '{}'}`;
              if (toolCache.has(ck)) result = toolCache.get(ck);
              else { result = await tool.run(args); toolCache.set(ck, result); }
            } catch (e) {
              result = { error: e instanceof Error ? e.message : String(e) };
            }
            toolCalls.push({ name: toolName, args, result });
          }
          // Usuń tagi z odpowiedzi (zostaną renderowane przez UI jako toolCalls obok bąbla).
          content = content.replace(fnTagRe, '').replace(/\s{2,}/g, ' ').trim();
          if (!content) content = 'Wykonano narzędzia — zobacz wyniki poniżej.';
        }

        const qPreview = userInput.replace(/\s+/g, ' ').trim().slice(0, 120);
        const aPreview = content.replace(/\s+/g, ' ').trim().slice(0, 120);
        void audit('chat', 'orzel_turn', {
          description: `Q: ${qPreview}${userInput.length > 120 ? '…' : ''}`,
          metadata: { iter, tool_count: toolCalls.length, prompt_tokens: totalUsage?.prompt_tokens, completion_tokens: totalUsage?.completion_tokens, question: qPreview, answer: aPreview },
        });
        return { message: content, toolCalls, usage: totalUsage };
      }
      // Push assistant message + execute tools
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: calls.map((c: any) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } })), // eslint-disable-line @typescript-eslint/no-explicit-any
      });
      for (const call of calls) {
        const tool = TOOLS.find(t => t.name === call.function.name);
        let result: unknown;
        let args: unknown;
        const cacheKey = `${call.function.name}:${call.function.arguments || '{}'}`;
        try {
          args = JSON.parse(call.function.arguments || '{}');
          if (!tool) throw new Error(`Nieznane narzędzie: ${call.function.name}`);
          if (toolCache.has(cacheKey)) {
            result = toolCache.get(cacheKey);
          } else {
            result = await tool.run(args);
            toolCache.set(cacheKey, result);
          }
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolCalls.push({ name: call.function.name, args, result });
        // Iter 12-pre: ograniczamy odpowiedź tool do 1500 znaków (było 4000)
        // — długie listy rezerwacji potrafiły zjadać 1k+ tokenów na każdą iterację.
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result).slice(0, 1500),
        });
      }
    }
    return { message: 'Przekroczono limit iteracji narzędzi. Spróbuj zadać pytanie inaczej.', toolCalls, usage: totalUsage, error: 'max_iter' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void audit('chat', 'orzel_error', { metadata: { error: msg } });
    return { message: `❌ Błąd asystenta: ${msg}`, toolCalls, error: classifyOrzelError(msg) };
  }
}
