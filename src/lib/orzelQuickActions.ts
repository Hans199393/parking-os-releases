/**
 * orzelQuickActions — wspólny rejestr definicji „szybkich akcji" Orła.
 *
 * Używane przez:
 *  - components/Chat/OrzelAssistantPanel.tsx — render przycisków + uruchomienie tool'a
 *  - components/Settings/IntegrationsTab.tsx — picker tool'a w konfiguratorze bloków
 *
 * Format zapisu w store (klucz `orzel_quick_actions`): JSON tablicy bloków:
 *   [{ "label": "Znajdź tablicę", "tool": "find_reservation" }, ...]
 *
 * Każdy blok wskazuje JEDEN tool z poniższej listy. Operator może mieć
 * dowolnie dużo bloków o własnych etykietach (np. dwa różne dla "Sprawdź obłożenie"
 * — jeden domyślny, drugi z innym placeholderem... w tej wersji etykiety są
 * konfigurowalne, ale resztę (modal title / placeholder / mapowanie val→args)
 * bierzemy z definicji tool'a poniżej).
 */

export interface QuickActionToolDef {
  /** Nazwa tool'a (zgodna z TOOLS w lib/orzelAssistant.ts) */
  name: string;
  /** Domyślna etykieta przycisku (operator może nadpisać w bloku) */
  defaultLabel: string;
  /** Krótki opis do pickera w Ustawieniach */
  description: string;
  /** Tytuł modala z polem wartości */
  modalTitle: string;
  /** Placeholder w polu wartości */
  placeholder: string;
  /** Czy wartość jest opcjonalna (puste = uruchom z domyślnymi args) */
  optional?: boolean;
  /** Mapowanie wartości z modala na obiekt args dla runTool() */
  buildArgs: (val: string) => Record<string, unknown>;
}

export const QUICK_ACTION_TOOLS: Record<string, QuickActionToolDef> = {
  find_reservation: {
    name: 'find_reservation',
    defaultLabel: 'Znajdź tablicę',
    description: 'Wyszukaj rezerwację po fragmencie rejestracji',
    modalTitle: 'Znajdź rezerwacje — fragment tablicy',
    placeholder: 'np. WX123',
    buildArgs: (val) => ({ plate: val }),
  },
  check_capacity: {
    name: 'check_capacity',
    defaultLabel: 'Sprawdź obłożenie',
    description: 'Pojemność / zarezerwowane / wolne miejsca na dzień',
    modalTitle: 'Sprawdź obłożenie — data',
    placeholder: 'YYYY-MM-DD lub "jutro" (puste = dziś)',
    optional: true,
    buildArgs: (val) => (val ? { date: val } : {}),
  },
  list_reservations: {
    name: 'list_reservations',
    defaultLabel: 'Lista rezerwacji',
    description: 'Rezerwacje na podany dzień lub zakres',
    modalTitle: 'Lista rezerwacji — data',
    placeholder: 'YYYY-MM-DD lub "jutro" (puste = dziś)',
    optional: true,
    buildArgs: (val) => (val ? { date: val } : {}),
  },
  list_banned_vehicles: {
    name: 'list_banned_vehicles',
    defaultLabel: 'Zbanowane tablice',
    description: 'Lista zbanowanych pojazdów',
    modalTitle: 'Zbanowane tablice',
    placeholder: '(brak argumentów — naciśnij OK)',
    optional: true,
    buildArgs: () => ({}),
  },
  list_waitlist: {
    name: 'list_waitlist',
    defaultLabel: 'Lista oczekujących',
    description: 'Klienci czekający na zwolnione miejsce',
    modalTitle: 'Lista oczekujących — data (opcjonalna)',
    placeholder: 'YYYY-MM-DD lub puste',
    optional: true,
    buildArgs: (val) => (val ? { date: val } : {}),
  },
  get_parking_info: {
    name: 'get_parking_info',
    defaultLabel: 'Info o parkingu',
    description: 'Pojemność, ceny, godziny otwarcia, status',
    modalTitle: 'Informacje o parkingu',
    placeholder: '(brak argumentów — naciśnij OK)',
    optional: true,
    buildArgs: () => ({}),
  },
  get_finance_summary: {
    name: 'get_finance_summary',
    defaultLabel: 'Finanse',
    description: 'Przychód / koszty / marża (dziś/miesiąc/rok)',
    modalTitle: 'Podsumowanie finansów — okres',
    placeholder: 'today / month / year (puste = month)',
    optional: true,
    buildArgs: (val) => (val ? { period: val } : {}),
  },
  get_recent_logs: {
    name: 'get_recent_logs',
    defaultLabel: 'Ostatnie logi',
    description: 'Logi systemowe i akcje',
    modalTitle: 'Ostatnie logi — kategoria (opcjonalna)',
    placeholder: 'reservation / finance / user / system / puste',
    optional: true,
    buildArgs: (val) => (val ? { category: val } : {}),
  },
  get_camera_status: {
    name: 'get_camera_status',
    defaultLabel: 'Status kamer',
    description: 'Ile kamer skonfigurowanych / online',
    modalTitle: 'Status kamer',
    placeholder: '(brak argumentów — naciśnij OK)',
    optional: true,
    buildArgs: () => ({}),
  },
  // ─── Nowe tools (Iter 14) ────────────────────────────────────────────────
  get_week_overview: {
    name: 'get_week_overview',
    defaultLabel: 'Tydzień',
    description: 'Obłożenie na 7 dni od podanej daty',
    modalTitle: 'Przegląd tygodnia — data startowa',
    placeholder: 'YYYY-MM-DD lub "jutro" (puste = dziś)',
    optional: true,
    buildArgs: (val) => (val ? { from: val } : {}),
  },
  get_monthly_overview: {
    name: 'get_monthly_overview',
    defaultLabel: 'Miesiąc',
    description: 'Liczba rezerwacji na każdy dzień miesiąca',
    modalTitle: 'Przegląd miesiąca — rok i miesiąc',
    placeholder: 'np. 2026-05 lub puste (= bieżący)',
    optional: true,
    buildArgs: (val) => {
      if (!val) return {};
      const m = val.match(/^(\d{4})-(\d{2})$/);
      if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) };
      return {};
    },
  },
  get_daily_revenue: {
    name: 'get_daily_revenue',
    defaultLabel: 'Utarg dnia',
    description: 'Utarg gotówka/karta/BLIK dla konkretnego dnia',
    modalTitle: 'Utarg dnia — data',
    placeholder: 'YYYY-MM-DD lub "wczoraj" (puste = dziś)',
    optional: true,
    buildArgs: (val) => (val ? { date: val } : {}),
  },
  get_bot_alerts: {
    name: 'get_bot_alerts',
    defaultLabel: 'Alerty bota',
    description: 'Nierozwiązane alerty bota Messenger',
    modalTitle: 'Alerty bota',
    placeholder: '(puste = nierozwiązane, wpisz "all" = wszystkie)',
    optional: true,
    buildArgs: (val) => (val && val.toLowerCase() === 'all' ? { all: true } : {}),
  },
  get_extra_open_days: {
    name: 'get_extra_open_days',
    defaultLabel: 'Specjalne dni',
    description: 'Specjalne dni otwarcia dodane przez admina',
    modalTitle: 'Specjalne dni otwarcia',
    placeholder: '(brak argumentów — naciśnij OK)',
    optional: true,
    buildArgs: () => ({}),
  },
  get_reservation_stats: {
    name: 'get_reservation_stats',
    defaultLabel: 'Statystyki',
    description: 'Ile aktywnych / anulowanych / no-show w miesiącu lub roku',
    modalTitle: 'Statystyki rezerwacji — okres',
    placeholder: 'month / year (puste = bieżący miesiąc)',
    optional: true,
    buildArgs: (val) => (val ? { period: val } : {}),
  },
};

export const QUICK_ACTION_TOOL_NAMES = Object.keys(QUICK_ACTION_TOOLS);

/** Jeden blok-przycisk skonfigurowany przez operatora. */
export interface QuickActionBlock {
  /** Etykieta wyświetlana na przycisku (operator nadaje) */
  label: string;
  /** Nazwa tool'a — musi istnieć w QUICK_ACTION_TOOLS */
  tool: string;
}

export const DEFAULT_QUICK_ACTION_BLOCKS: QuickActionBlock[] = [
  { label: 'Znajdź tablicę', tool: 'find_reservation' },
  { label: 'Sprawdź obłożenie', tool: 'check_capacity' },
  { label: 'Lista rezerwacji', tool: 'list_reservations' },
];

/**
 * Parsuje wartość z store. Obsługuje:
 *  - JSON array bloków (nowy format)
 *  - CSV nazw tool'ów (stary format — automatyczna migracja)
 *  - puste / niepoprawne → zwraca domyślne
 */
export function parseQuickActions(raw: string | null | undefined): QuickActionBlock[] {
  if (!raw) return [...DEFAULT_QUICK_ACTION_BLOCKS];
  const trimmed = raw.trim();
  if (!trimmed) return [...DEFAULT_QUICK_ACTION_BLOCKS];

  // Nowy format: JSON array
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const blocks: QuickActionBlock[] = [];
        for (const item of parsed) {
          if (item && typeof item === 'object' && 'tool' in item && typeof (item as any).tool === 'string') {
            const toolName = String((item as any).tool);
            if (!QUICK_ACTION_TOOLS[toolName]) continue;
            const label = typeof (item as any).label === 'string' && (item as any).label.trim()
              ? String((item as any).label).trim()
              : QUICK_ACTION_TOOLS[toolName].defaultLabel;
            blocks.push({ label: label.slice(0, 40), tool: toolName });
          }
        }
        return blocks.length ? blocks : [...DEFAULT_QUICK_ACTION_BLOCKS];
      }
    } catch {
      // ignore — fallback
    }
  }

  // Stary format: CSV nazw tool'ów (migracja)
  const names = trimmed.split(',').map(s => s.trim()).filter(s => s && QUICK_ACTION_TOOLS[s]);
  if (names.length) {
    return names.map(n => ({ label: QUICK_ACTION_TOOLS[n].defaultLabel, tool: n }));
  }
  return [...DEFAULT_QUICK_ACTION_BLOCKS];
}

export function serializeQuickActions(blocks: QuickActionBlock[]): string {
  return JSON.stringify(blocks);
}
