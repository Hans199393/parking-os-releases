/**
 * CommandPalette — Iter 13.
 * Globalna paleta poleceń otwierana skrótem **Ctrl+O** ("O" jak Orzeł).
 *
 * 3 tryby (zakładki):
 *   1. 🔎 Szukaj — szybka nawigacja do widoków + akcje
 *   2. 💬 Asystent — czat z Orłem (reuse `chatTurn` z orzelAssistant)
 *   3. ⚡ Akcje — lista akcji wykonywalnych jednym klikiem
 *
 * Skróty:
 *   - Ctrl+O / Cmd+O   — otwórz/zamknij
 *   - ↑↓ / Tab+Shift   — wybór pozycji
 *   - Enter            — wykonaj
 *   - Esc              — zamknij
 *   - Ctrl+1/2/3       — przełącz zakładkę
 *
 * Mount: w App.tsx jako sąsiad `<main>`. Otrzymuje `onNavigate(page)` aby móc
 * skakać po widokach.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Bot, Zap, X, Cog, Wallet, Calendar, Camera, MessageCircle, BarChart3, Mail, FileText, Variable, Headphones } from 'lucide-react';
import type { Page } from '../Sidebar/Sidebar';
import OrzelChatBody from '../Chat/OrzelChatBody';
import { usePerm } from '../../lib/usePerm';

type Mode = 'search' | 'chat' | 'actions';

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: Page) => void;
}

interface SearchItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  /** klucze do wyszukiwania (lowercase) */
  keywords: string[];
  run: () => void;
  group: string;
  /** Iter 13: uprawnienie wymagane do wyświetlenia/wykonania pozycji.
   *  Brak → dostępne dla każdego zalogowanego użytkownika. */
  perm?: string;
}

// Klucze constants — historia chat zarządza się w OrzelChatBody (orzel_chat_history_v1)

export default function CommandPalette({ open, onClose, onNavigate }: Props) {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset przy otwarciu
  useEffect(() => {
    if (open) {
      setMode('search');
      setQuery('');
      // Focus po krótkiej chwili (czeka aż element wejdzie do DOM)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Globalne klawisze wewnątrz palety
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '1') { e.preventDefault(); setMode('search'); }
        if (e.key === '2') { e.preventDefault(); setMode('chat'); }
        if (e.key === '3') { e.preventDefault(); setMode('actions'); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] px-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl glass-strong rounded-[var(--radius-lg)] border-2 border-[var(--color-accent-border)] shadow-[var(--shadow-xl)] overflow-hidden animate-slideUp"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER — zakładki + close */}
        <div className="flex items-center border-b border-[var(--color-border)]">
          <ModeTab active={mode === 'search'}  onClick={() => setMode('search')}  icon={<Search size={14} />}        label="Szukaj"   hint="Ctrl+1" />
          <ModeTab active={mode === 'chat'}    onClick={() => setMode('chat')}    icon={<Bot size={14} />}           label="Asystent" hint="Ctrl+2" />
          <ModeTab active={mode === 'actions'} onClick={() => setMode('actions')} icon={<Zap size={14} />}           label="Akcje"    hint="Ctrl+3" />
          <div className="flex-1" />
          <button onClick={onClose} className="p-2 hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)]" aria-label="Zamknij (Esc)">
            <X size={14} />
          </button>
        </div>

        {/* CONTENT */}
        {mode === 'search' && (
          <SearchMode
            query={query}
            onQueryChange={setQuery}
            inputRef={inputRef}
            onNavigate={page => { onNavigate(page); onClose(); }}
            onClose={onClose}
          />
        )}
        {mode === 'chat' && (
          <div className="h-[55vh] min-h-[280px]">
            <OrzelChatBody autoFocus />
          </div>
        )}
        {mode === 'actions' && (
          <ActionsMode
            query={query}
            onQueryChange={setQuery}
            inputRef={inputRef}
            onNavigate={page => { onNavigate(page); onClose(); }}
            onClose={onClose}
          />
        )}

        {/* STOPKA */}
        <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)]/30">
          <div className="flex items-center gap-3">
            <KeyHint label="↑↓" desc="wybór" />
            <KeyHint label="⏎" desc="wykonaj" />
            <KeyHint label="Esc" desc="zamknij" />
          </div>
          <span className="font-mono">Ctrl+O · Orzeł</span>
        </div>
      </div>
    </div>
  );
}

// ─── ZAKŁADKA: SZUKAJ ──────────────────────────────────────────────────────

function SearchMode({ query, onQueryChange, inputRef, onNavigate, onClose }: {
  query: string;
  onQueryChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (page: Page) => void;
  onClose: () => void;
}) {
  const perm = usePerm();
  const items = useMemo<SearchItem[]>(
    () => buildSearchItems(onNavigate).filter(it => !it.perm || perm.has(it.perm)),
    [onNavigate, perm],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(it =>
      it.label.toLowerCase().includes(q) ||
      it.hint?.toLowerCase().includes(q) ||
      it.keywords.some(k => k.includes(q))
    );
  }, [items, query]);

  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [query]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); filtered[idx]?.run(); onClose(); }
  };

  // Grupowanie
  const groups = useMemo(() => {
    const m = new Map<string, SearchItem[]>();
    for (const it of filtered) {
      if (!m.has(it.group)) m.set(it.group, []);
      m.get(it.group)!.push(it);
    }
    return Array.from(m.entries());
  }, [filtered]);

  // Globalny indeks dla highlightu
  let runningIdx = -1;

  return (
    <>
      <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
        <Search size={14} className="text-[var(--color-text-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder='Co chcesz otworzyć? (np. „rezerwacje”, „finanse”, „kamery”)'
          className="flex-1 bg-transparent border-0 focus:outline-none text-sm"
        />
        {query && (
          <button onClick={() => onQueryChange('')} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-1">×</button>
        )}
      </div>
      <div className="max-h-[55vh] overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
            Brak wyników dla "{query}".
            <div className="text-xs mt-1">Spróbuj zakładki <span className="text-[var(--color-accent)]">💬 Asystent</span> aby zapytać Orła.</div>
          </div>
        )}
        {groups.map(([g, list]) => (
          <div key={g}>
            <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]/70 font-bold">{g}</div>
            {list.map(it => {
              runningIdx++;
              const i = runningIdx;
              const active = i === idx;
              return (
                <button
                  key={it.id}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => { it.run(); onClose(); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${active ? 'bg-[var(--color-accent-bg)]' : 'hover:bg-[var(--color-surface-2)]'}`}
                >
                  <span className={`flex-shrink-0 ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>{it.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-[var(--color-text)] truncate">{it.label}</span>
                    {it.hint && <span className="block text-[10px] text-[var(--color-text-muted)] truncate">{it.hint}</span>}
                  </span>
                  {active && <span className="text-[9px] text-[var(--color-accent)] font-mono">⏎</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function buildSearchItems(onNavigate: (page: Page) => void): SearchItem[] {
  const nav = (page: Page, label: string, hint: string, kw: string[], icon: React.ReactNode, permKey?: string): SearchItem => ({
    id: `nav-${page}`,
    label,
    hint,
    keywords: [page, ...kw],
    icon,
    run: () => onNavigate(page),
    group: 'Nawigacja',
    // Domyślnie wymagamy uprawnienia o nazwie strony (np. 'dashboard', 'finances')
    // — checkPermission akceptuje sam id modułu (zwraca true jeśli user ma jakiekolwiek '<id>.*').
    perm: permKey ?? page,
  });
  return [
    nav('dashboard',    'Dashboard',           'Pulpit operatora · podgląd kamer + rezerwacje',  ['pulpit', 'home', 'start'], <BarChart3 size={14} />),
    nav('cameras',      'Kamery',              'Podgląd LPR + wjazdy/wyjazdy',                     ['camera', 'lpr', 'wjazd'], <Camera size={14} />),
    nav('reservations', 'Rezerwacje',          'Lista rezerwacji + nowa',                          ['booking', 'rezerwacja', 'klient'], <Calendar size={14} />),
    nav('finances',     'Finanse',             'Przychody, faktury, raporty',                      ['finance', 'kasa', 'utarg', 'pieniądze', 'faktury'], <Wallet size={14} />),
    nav('radio',        'Radio internetowe',   'Wybór stacji, głośność i panel pływający',         ['muzyka', 'stacje', 'audio', 'stream'], <Headphones size={14} />),
    nav('chat',         'Czat operatora',      'Wiadomości z klientami',                            ['messenger', 'wiadomości'], <MessageCircle size={14} />),
    nav('email',        'E-maile',             'Skrzynka i odpowiedzi',                            ['mail', 'gmail', 'skrzynka'], <Mail size={14} />),
    nav('logs',         'Dziennik zdarzeń',    'Logi aplikacji i audyt',                           ['logi', 'audit', 'historia'], <FileText size={14} />),
    nav('settings',     'Ustawienia',          'Konto, integracje, asystent AI',                   ['config', 'preferencje', 'orzeł', 'groq'], <Cog size={14} />),
    nav('admin',        'Panel administratora', 'Użytkownicy, uprawnienia, RODO',                 ['users', 'admin'], <Bot size={14} />),
  ];
}

// ─── ZAKŁADKA: AKCJE ────────────────────────────────────────────────────────

function ActionsMode({ query, onQueryChange, inputRef, onNavigate, onClose }: {
  query: string;
  onQueryChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (page: Page) => void;
  onClose: () => void;
}) {
  const perm = usePerm();
  // Akcje "skok do widoku w trybie X" — z wymaganymi uprawnieniami
  const items = useMemo<SearchItem[]>(() => [
    {
      id: 'act-new-reservation',
      label: 'Nowa rezerwacja',
      hint: 'Otwórz formularz dodawania',
      keywords: ['rezerwacja', 'add', 'dodaj', 'klient'],
      icon: <Calendar size={14} />,
      group: 'Rezerwacje',
      perm: 'reservations.create',
      run: () => {
        onNavigate('reservations');
        // Sygnał dla Reservations żeby otworzył modal "Nowa"
        setTimeout(() => window.dispatchEvent(new CustomEvent('cmdpal:reservations:new')), 50);
      },
    },
    {
      id: 'act-revenue-today',
      label: 'Wpisz utarg z dzisiaj',
      hint: 'Otwórz Finanse → formularz przychodu',
      keywords: ['utarg', 'kasa', 'revenue', 'przychód'],
      icon: <Wallet size={14} />,
      group: 'Finanse',
      perm: 'finances.add_income',
      run: () => {
        onNavigate('finances');
        setTimeout(() => window.dispatchEvent(new CustomEvent('cmdpal:finances:revenue')), 50);
      },
    },
    {
      id: 'act-invoice-new',
      label: 'Nowa faktura',
      hint: 'Otwórz Finanse → faktury',
      keywords: ['faktura', 'invoice'],
      icon: <FileText size={14} />,
      group: 'Finanse',
      perm: 'finances.edit',
      run: () => {
        onNavigate('finances');
        setTimeout(() => window.dispatchEvent(new CustomEvent('cmdpal:finances:invoice')), 50);
      },
    },
    {
      id: 'act-settings-assistant',
      label: 'Konfiguruj asystenta AI',
      hint: 'Ustawienia → Asystent (prompty + zmienne)',
      keywords: ['orzeł', 'ai', 'groq', 'prompt', 'placeholder'],
      icon: <Bot size={14} />,
      group: 'Ustawienia',
      perm: 'settings.edit_integrations',
      run: () => {
        onNavigate('settings');
        setTimeout(() => window.dispatchEvent(new CustomEvent('cmdpal:settings:assistants')), 50);
      },
    },
    {
      id: 'act-settings-vars',
      label: 'Edytuj zmienne (cennik, godziny, kontakt)',
      hint: 'Ustawienia → Konfiguracja parkingu',
      keywords: ['cennik', 'rate', 'godziny', 'parking', 'placeholder', 'ceny'],
      icon: <Variable size={14} />,
      group: 'Ustawienia',
      perm: 'settings.edit_parking',
      run: () => {
        onNavigate('settings');
        setTimeout(() => window.dispatchEvent(new CustomEvent('cmdpal:settings:parking')), 50);
      },
    },
  ].filter(it => !it.perm || perm.has(it.perm)), [onNavigate, perm]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(it =>
      it.label.toLowerCase().includes(q) ||
      it.hint?.toLowerCase().includes(q) ||
      it.keywords.some(k => k.includes(q))
    );
  }, [items, query]);

  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [query]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); filtered[idx]?.run(); onClose(); }
  };

  return (
    <>
      <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
        <Zap size={14} className="text-[var(--color-accent)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder='Akcja… (np. „nowa rezerwacja”, „utarg”, „faktura”)'
          className="flex-1 bg-transparent border-0 focus:outline-none text-sm"
        />
      </div>
      <div className="max-h-[55vh] overflow-y-auto py-1">
        {filtered.map((it, i) => {
          const active = i === idx;
          return (
            <button
              key={it.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => { it.run(); onClose(); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${active ? 'bg-[var(--color-accent-bg)]' : 'hover:bg-[var(--color-surface-2)]'}`}
            >
              <span className={`flex-shrink-0 ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>{it.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-[var(--color-text)] truncate">{it.label}</span>
                {it.hint && <span className="block text-[10px] text-[var(--color-text-muted)] truncate">{it.hint}</span>}
              </span>
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">{it.group}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">Brak akcji dla "{query}"</div>
        )}
      </div>
    </>
  );
}

// ─── ZAKŁADKA: ASYSTENT — używa wspólnego OrzelChatBody (zob. ../Chat/OrzelChatBody.tsx) ───

// ─── HELPERY UI ────────────────────────────────────────────────────────────

function ModeTab({ active, onClick, icon, label, hint }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
        active
          ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-bg)]/40'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className="text-[9px] opacity-50 font-mono ml-1">{hint}</span>
    </button>
  );
}

function KeyHint({ label, desc }: { label: string; desc: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[9px] font-mono">{label}</kbd>
      <span>{desc}</span>
    </span>
  );
}
