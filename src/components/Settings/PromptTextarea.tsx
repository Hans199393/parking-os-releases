/**
 * PromptTextarea — Iter 13.
 * Edytor tekstowy specjalnie dla promptów asystenta:
 * - syntax-highlight `{{placeholder}}` (overlay technique)
 * - po wpisaniu `{{` pojawia się suggester z dostępnymi placeholderami
 * - czerwony highlight dla nieznanych kluczy
 * - hover na badge w pasku statusu pokazuje listę nieznanych
 *
 * Użycie: zamiast `<textarea ...>` w AssistantsTab (BlockRow, RuleRow, Extra).
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  PLACEHOLDERS,
  PLACEHOLDER_MAP,
  CATEGORY_LABEL,
  analyzePlaceholders,
  type PlaceholderMeta,
} from '../../lib/placeholderRegistry';

interface Props {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** klucz → wartość (z settings) — do podglądu "z wartościami" */
  resolvedValues?: Record<string, string>;
  /** Iter 13: użytkownika własne zmienne — dodatkowe klucze do suggester + highlight */
  customVars?: { key: string; label: string; value: string }[];
  className?: string;
}

const CHIP_KNOWN = '<span style="color:#fbbf24;background:rgba(251,191,36,0.12);border-radius:3px;padding:0 2px;">';
const CHIP_UNKNOWN = '<span style="color:#f87171;background:rgba(248,113,113,0.18);border-radius:3px;padding:0 2px;text-decoration:underline wavy #f87171;">';
const CHIP_END = '</span>';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Buduje HTML overlay z podświetlonymi `{{...}}`. */
function buildHighlightHtml(text: string, customKeys: Set<string>): string {
  const safe = escapeHtml(text);
  return safe.replace(/\{\{(\w+)\}\}/g, (full, key) => {
    const isKnown = !!PLACEHOLDER_MAP[key] || customKeys.has(key);
    return (isKnown ? CHIP_KNOWN : CHIP_UNKNOWN) + escapeHtml(full) + CHIP_END;
  }) + '\n'; // dopisek żeby ostatnia linia z newline'em rendowała się prawidłowo
}

export default function PromptTextarea({
  value, onChange, rows = 6, placeholder, disabled, resolvedValues, customVars, className = '',
}: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Set kluczy custom (do highlight + analiza nieznanych)
  const customKeys = useMemo(
    () => new Set((customVars ?? []).map(c => c.key).filter(Boolean)),
    [customVars],
  );

  // Lista do suggester — PLACEHOLDERS + custom z extra metadata
  const allSuggestions = useMemo<PlaceholderMeta[]>(() => {
    const customAsMeta: PlaceholderMeta[] = (customVars ?? [])
      .filter(c => c.key)
      .map(c => ({
        key: c.key,
        category: 'dynamic' as const,
        label: c.label || c.key,
        description: 'Zmienna własna (Twoja)',
        example: c.value || '(pusta)',
        source: 'static' as const,
      }));
    return [...customAsMeta, ...PLACEHOLDERS];
  }, [customVars]);

  // Suggester state
  const [sugOpen, setSugOpen] = useState(false);
  const [sugQuery, setSugQuery] = useState('');
  const [sugIdx, setSugIdx] = useState(0);
  const [sugAnchor, setSugAnchor] = useState<{ top: number; left: number } | null>(null);
  /** pozycja w textarea, od której wstawiamy `{{...}}` (czyli pozycja PIERWSZEGO `{`) */
  const sugStartRef = useRef<number>(-1);

  const stats = useMemo(() => {
    const a = analyzePlaceholders(value);
    // Re-klasyfikuj custom keys jako "znane"
    const reallyUnknown = a.unknown.filter(k => !customKeys.has(k));
    const reallyKnown = a.known + (a.unknown.length - reallyUnknown.length);
    return { known: reallyKnown, unknown: reallyUnknown, total: a.total };
  }, [value, customKeys]);

  const filteredSug = useMemo(() => {
    const q = sugQuery.toLowerCase().trim();
    if (!q) return allSuggestions.slice(0, 10);
    return allSuggestions.filter(p =>
      p.key.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [sugQuery, allSuggestions]);

  // Sync scroll overlay z textarea
  const syncScroll = useCallback(() => {
    if (!taRef.current || !overlayRef.current) return;
    overlayRef.current.scrollTop = taRef.current.scrollTop;
    overlayRef.current.scrollLeft = taRef.current.scrollLeft;
  }, []);

  useEffect(() => { syncScroll(); }, [value, syncScroll]);

  /** Detekcja `{{` przed kursorem → włącz suggester */
  const detectSuggester = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    // Szukamy ostatniego `{{` bez `}}` po nim
    const open = before.lastIndexOf('{{');
    if (open === -1) { setSugOpen(false); return; }
    const between = before.slice(open + 2);
    if (/[}\s]/.test(between)) { setSugOpen(false); return; } // już zamknięte lub spacja
    sugStartRef.current = open;
    setSugQuery(between);
    setSugIdx(0);
    // Pozycja kursora → współrzędne (przybliżone, użyjemy mirror-div)
    const rect = ta.getBoundingClientRect();
    const caret = getCaretCoords(ta, pos);
    setSugAnchor({ top: rect.top + caret.top + 22, left: rect.left + caret.left });
    setSugOpen(true);
  }, []);

  const insertPlaceholder = useCallback((meta: PlaceholderMeta) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = sugStartRef.current;
    if (start < 0) return;
    const pos = ta.selectionStart;
    const before = value.slice(0, start);
    const after = value.slice(pos);
    const insertion = `{{${meta.key}}}`;
    const next = before + insertion + after;
    onChange(next);
    setSugOpen(false);
    // Po React-render ustaw kursor za wstawionym placeholderem
    setTimeout(() => {
      if (taRef.current) {
        const caret = before.length + insertion.length;
        taRef.current.focus();
        taRef.current.setSelectionRange(caret, caret);
      }
    }, 0);
  }, [value, onChange]);

  // Klawiszologia suggester
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugOpen && filteredSug.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSugIdx(i => Math.min(i + 1, filteredSug.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSugIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertPlaceholder(filteredSug[sugIdx]); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setSugOpen(false); return; }
    }
  };

  // Tooltip (na pasku) z listą nieznanych
  const unknownTip = stats.unknown.length > 0
    ? `Nieznane: ${stats.unknown.map(k => `{{${k}}}`).join(', ')}`
    : '';

  return (
    <div className={`relative ${className}`}>
      {/* Wrapper relatywny — overlay i textarea spinają się geometrycznie */}
      <div className="relative">
        <div
          ref={overlayRef}
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed px-2 py-1 overflow-hidden text-[var(--color-text)]"
          style={{ wordBreak: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: buildHighlightHtml(value, customKeys) }}
        />
        <textarea
          ref={taRef}
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          onChange={e => { onChange(e.target.value); }}
          onKeyUp={detectSuggester}
          onClick={detectSuggester}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          onBlur={() => { setTimeout(() => setSugOpen(false), 120); }}
          className="relative w-full px-2 py-1 text-[11px] font-mono rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)] leading-relaxed text-transparent caret-[var(--color-accent)] selection:bg-[var(--color-accent)]/30"
          style={{ wordBreak: 'break-word' }}
        />
      </div>

      {/* PASEK STATUSU */}
      <div className="flex items-center justify-between mt-1 px-1 text-[10px]">
        <span className="text-[var(--color-text-muted)]">{value.length} znaków</span>
        <div className="flex items-center gap-2">
          {stats.known > 0 && (
            <span className="text-amber-400">✓ {stats.known} placeholder{stats.known === 1 ? '' : 'ów'}</span>
          )}
          {stats.unknown.length > 0 && (
            <span title={unknownTip} className="text-red-400 cursor-help underline decoration-dotted">
              ⚠ {stats.unknown.length} nieznany
            </span>
          )}
        </div>
      </div>

      {/* SUGGESTER */}
      {sugOpen && filteredSug.length > 0 && sugAnchor && (
        <div
          className="fixed z-[100] glass-strong rounded-[var(--radius-md)] border border-[var(--color-accent-border)] shadow-[var(--shadow-xl)] py-1 min-w-[280px] max-w-[360px] overflow-hidden animate-[slideUp_.12s_ease]"
          style={{ top: sugAnchor.top, left: sugAnchor.left }}
        >
          <div className="px-3 py-1.5 border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] flex items-center justify-between">
            <span>Wstaw zmienną</span>
            <span className="text-[9px] opacity-70">↑↓ wybór · ⏎ wstaw · Esc</span>
          </div>
          <ul className="max-h-[280px] overflow-y-auto">
            {filteredSug.map((p, i) => {
              const active = i === sugIdx;
              const v = resolvedValues?.[p.key] ?? p.example;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); insertPlaceholder(p); }}
                    onMouseEnter={() => setSugIdx(i)}
                    className={`w-full px-3 py-2 text-left flex items-start gap-2 transition-colors ${active ? 'bg-[var(--color-accent-bg)]' : 'hover:bg-[var(--color-surface-2)]'}`}
                  >
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)] mt-0.5 flex-shrink-0">
                      {CATEGORY_LABEL[p.category]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-amber-400 truncate">{`{{${p.key}}}`}</div>
                      <div className="text-[11px] text-[var(--color-text)] truncate">{p.label}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)] truncate">→ <span className="font-mono">{v}</span></div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Caret coords (mirror-div technique) ─────────────────────────────────────
// Tworzymy ukryty div o tych samych stylach co textarea, wypełniamy tekstem do
// pozycji kursora + spanem-markerem, i odczytujemy współrzędne markera.

const MIRROR_PROPS = [
  'boxSizing', 'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textTransform', 'wordSpacing', 'whiteSpace', 'wordWrap',
] as const;

function getCaretCoords(ta: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const div = document.createElement('div');
  const style = div.style;
  const cs = window.getComputedStyle(ta);
  for (const prop of MIRROR_PROPS) {
    style[prop as any] = cs[prop as any]; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.overflow = 'auto';
  style.whiteSpace = 'pre-wrap';
  style.wordBreak = 'break-word';
  document.body.appendChild(div);
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.slice(pos) || '.';
  div.appendChild(span);
  const top = span.offsetTop - ta.scrollTop;
  const left = span.offsetLeft - ta.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}
