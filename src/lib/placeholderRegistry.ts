/**
 * placeholderRegistry.ts — Iter 13.
 * Centralny katalog placeholderów `{{key}}` używanych w promptach asystentów AI.
 *
 * Wykorzystywane przez:
 *   - Settings → Asystenci AI: panel "Dostępne zmienne", suggester `{{`,
 *     highlight w edytorze, walidacja i podgląd "z wartościami".
 *   - lib/promptBuilder.ts (pośrednio przez PROMPT_PLACEHOLDER_DEFAULTS).
 *
 * Po dodaniu nowego klucza do `PROMPT_PLACEHOLDER_DEFAULTS` w promptDefaults.ts
 * dorzuć też wpis tutaj — inaczej w UI pojawi się ostrzeżenie "nieznany".
 */

export type PlaceholderCategory =
  | 'parking'   // Dane podstawowe parkingu
  | 'cennik'    // Stawki i waluta
  | 'godziny'   // Godziny otwarcia
  | 'kontakt'   // Telefon, e-mail
  | 'dynamic'   // Wstrzykiwane runtime (today_iso etc.)
  | 'rezerwacja'; // Kontekst rezerwacji (jeśli kiedyś)

export type PlaceholderSource = 'settings' | 'static' | 'dynamic';

export interface PlaceholderMeta {
  /** klucz bez nawiasów, np. 'open_from' */
  key: string;
  category: PlaceholderCategory;
  /** czytelna nazwa po polsku */
  label: string;
  /** krótki opis do tooltip / panel */
  description: string;
  /** przykładowa wartość (gdy brak ustawienia) */
  example: string;
  /** skąd brana jest wartość w runtime */
  source: PlaceholderSource;
  /** klucz w tabeli `settings` (jeśli source==='settings') */
  settingsKey?: string;
  /** krótki link słowny gdzie użytkownik może to zmienić */
  editableAt?: string;
}

export const PLACEHOLDERS: PlaceholderMeta[] = [
  // ─── Parking ─────────────────────────────────────────
  {
    key: 'parking_name',
    category: 'parking',
    label: 'Nazwa parkingu',
    description: 'Pełna nazwa parkingu używana w prezentacji bota.',
    example: 'Parking niestrzeżony płatny "Michał Kłos"',
    source: 'settings',
    settingsKey: 'parking_name',
    editableAt: 'Ustawienia → Parking → Nazwa',
  },
  {
    key: 'parking_address',
    category: 'parking',
    label: 'Adres parkingu',
    description: 'Pełny adres pocztowy parkingu.',
    example: 'ul. Turystyczna 69, Gdańsk 80-690 (Wyspa Sobieszewska)',
    source: 'settings',
    settingsKey: 'parking_address',
    editableAt: 'Ustawienia → Parking → Adres',
  },

  // ─── Cennik ──────────────────────────────────────────
  {
    key: 'rate_basic',
    category: 'cennik',
    label: 'Stawka bez rezerwacji',
    description: 'Cena za wjazd bez wcześniejszej rezerwacji (płatne na miejscu).',
    example: '20',
    source: 'settings',
    settingsKey: 'rate_basic',
    editableAt: 'Ustawienia → Parking → Cennik',
  },
  {
    key: 'rate_reservation',
    category: 'cennik',
    label: 'Stawka z rezerwacją',
    description: 'Cena za wjazd z gwarancją wolnego miejsca (rezerwacja online).',
    example: '25',
    source: 'settings',
    settingsKey: 'rate_reservation',
    editableAt: 'Ustawienia → Parking → Cennik',
  },
  {
    key: 'rate_after_hours',
    category: 'cennik',
    label: 'Stawka po godzinach',
    description: 'Opłata za pobyt poza standardowymi godzinami otwarcia.',
    example: '50',
    source: 'static',
    editableAt: 'lib/promptDefaults.ts (PROMPT_PLACEHOLDER_DEFAULTS)',
  },
  {
    key: 'currency',
    category: 'cennik',
    label: 'Waluta',
    description: 'Symbol waluty doklejany do kwot.',
    example: 'zł',
    source: 'settings',
    settingsKey: 'currency',
    editableAt: 'Ustawienia → Parking → Waluta',
  },

  // ─── Godziny ─────────────────────────────────────────
  {
    key: 'open_from',
    category: 'godziny',
    label: 'Godzina otwarcia',
    description: 'Pora rozpoczęcia pracy parkingu (HH:MM).',
    example: '08:00',
    source: 'settings',
    settingsKey: 'open_from',
    editableAt: 'Ustawienia → Parking → Godziny',
  },
  {
    key: 'open_to',
    category: 'godziny',
    label: 'Godzina zamknięcia',
    description: 'Pora zakończenia pracy parkingu (HH:MM).',
    example: '19:00',
    source: 'settings',
    settingsKey: 'open_to',
    editableAt: 'Ustawienia → Parking → Godziny',
  },

  // ─── Kontakt ─────────────────────────────────────────
  {
    key: 'owner_phone',
    category: 'kontakt',
    label: 'Telefon do obsługi',
    description: 'Numer kontaktowy do właściciela / obsługi parkingu.',
    example: '784 828 748',
    source: 'settings',
    settingsKey: 'owner_phone',
    editableAt: 'Ustawienia → Parking → Kontakt',
  },
  {
    key: 'owner_email',
    category: 'kontakt',
    label: 'E-mail kontaktowy',
    description: 'Adres e-mail do kontaktu z właścicielem (RODO, sprawy formalne).',
    example: 'kontakt@parkingsobieszewo.pl',
    source: 'settings',
    settingsKey: 'owner_email',
    editableAt: 'Ustawienia → Parking → Kontakt',
  },

  // ─── Dynamic (runtime) ───────────────────────────────
  {
    key: 'today_iso',
    category: 'dynamic',
    label: 'Dzisiejsza data',
    description: 'Aktualna data w formacie ISO (YYYY-MM-DD), wstrzykiwana przy każdym wywołaniu asystenta.',
    example: new Date().toISOString().slice(0, 10),
    source: 'dynamic',
    editableAt: '— automatyczne, każde wywołanie',
  },
];

/** Mapa key → meta (do szybkiego lookupu) */
export const PLACEHOLDER_MAP: Record<string, PlaceholderMeta> = Object.fromEntries(
  PLACEHOLDERS.map(p => [p.key, p]),
);

export function findPlaceholdersInText(text: string): { key: string; index: number; length: number }[] {
  const out: { key: string; index: number; length: number }[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ key: m[1], index: m.index, length: m[0].length });
  }
  return out;
}

export interface PlaceholderUsageStats {
  known: number;
  unknown: string[]; // unique keys
  total: number;
}

export function analyzePlaceholders(text: string): PlaceholderUsageStats {
  const found = findPlaceholdersInText(text);
  const unknownSet = new Set<string>();
  let known = 0;
  for (const p of found) {
    if (PLACEHOLDER_MAP[p.key]) known += 1;
    else unknownSet.add(p.key);
  }
  return { known, unknown: Array.from(unknownSet), total: found.length };
}

export const CATEGORY_LABEL: Record<PlaceholderCategory, string> = {
  parking: 'Parking',
  cennik: 'Cennik',
  godziny: 'Godziny',
  kontakt: 'Kontakt',
  dynamic: 'Dynamiczne',
  rezerwacja: 'Rezerwacja',
};

export const CATEGORY_ORDER: PlaceholderCategory[] = [
  'parking', 'cennik', 'godziny', 'kontakt', 'dynamic', 'rezerwacja',
];
