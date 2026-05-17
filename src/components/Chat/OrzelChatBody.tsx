/**
 * OrzelChatBody — Iter 13.
 * Reusable widget chat (lista wiadomości + input + suggesty) używany przez:
 *   - CommandPalette (zakładka "Asystent", Ctrl+O)
 *   - FloatingChatPanel (pływające okno, Ctrl+J)
 *
 * Wspólna historia w localStorage pod kluczem `orzel_chat_history_v1`.
 * Synchronizacja między instancjami: storage event + custom 'orzel-chat-update'.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Send, Loader2, AlertTriangle, Eraser } from 'lucide-react';
import { chatTurn, type OrzelMessage } from '../../lib/orzelAssistant';
import { QUICK_ACTION_TOOLS, type QuickActionBlock } from '../../lib/orzelQuickActions';

export interface ChatItem {
  role: 'user' | 'assistant' | 'tool-summary';
  content: string;
  toolHints?: string[];
  ts: number;
}

const HISTORY_KEY = 'orzel_chat_history_v1';
const MAX_HISTORY = 30;
const SYNC_EVENT = 'orzel-chat-update';

function loadHistory(): ChatItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(-MAX_HISTORY);
  } catch { return []; }
}

function saveHistory(messages: ChatItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch { /* quota */ }
}

interface Props {
  /** Auto-focus input przy mount (np. po otwarciu palety/panelu) */
  autoFocus?: boolean;
  /** Tryb kompaktowy — mniejsze paddingi, do pływającego okienka */
  compact?: boolean;
  /** Customowa wysokość listy wiadomości (CSS string lub klasa Tailwind) */
  listClassName?: string;
  /** Skonfigurowane bloki szybkich akcji (z ustawień Orła) */
  quickActions?: QuickActionBlock[];
}

export default function OrzelChatBody({ autoFocus = true, compact = false, listClassName, quickActions }: Props) {
  const [messages, setMessages] = useState<ChatItem[]>(() => loadHistory());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync z innych instancji (storage event między oknami, custom event w tym samym oknie)
  useEffect(() => {
    const reload = () => setMessages(loadHistory());
    const onStorage = (e: StorageEvent) => { if (e.key === HISTORY_KEY) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(SYNC_EVENT, reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SYNC_EVENT, reload);
    };
  }, []);

  // Auto-focus
  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => inputRef.current?.focus());
  }, [autoFocus]);

  // Autoscroll
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const userMsg: ChatItem = { role: 'user', content: text, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    saveHistory(next);
    const history: OrzelMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    try {
      const res = await chatTurn(history, text);
      if (res.error === 'no_config') {
        setError(res.message);
      } else {
        const toolHints = res.toolCalls.map(c => `${c.name}(${tinyArgs(c.args)})`);
        const finalMsgs = [...next, { role: 'assistant' as const, content: res.message, toolHints: toolHints.length ? toolHints : undefined, ts: Date.now() }];
        setMessages(finalMsgs);
        saveHistory(finalMsgs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [input, busy, messages]);

  const clearHistory = () => {
    setMessages([]);
    saveHistory([]);
  };

  const runQuickAction = useCallback(async (block: QuickActionBlock, val: string) => {
    const def = QUICK_ACTION_TOOLS[block.tool];
    if (!def) return;
    // Budujemy zapytanie jak gdyby użytkownik wpisał je ręcznie
    const query = val ? `${block.label}: ${val}` : block.label;
    setInput('');
    setError(null);
    setBusy(true);
    const userMsg: ChatItem = { role: 'user', content: query, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    saveHistory(next);
    const history: OrzelMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    try {
      const res = await chatTurn(history, query);
      if (res.error === 'no_config') {
        setError(res.message);
      } else {
        const toolHints = res.toolCalls.map(c => `${c.name}(${tinyArgs(c.args)})`);
        const finalMsgs = [...next, { role: 'assistant' as const, content: res.message, toolHints: toolHints.length ? toolHints : undefined, ts: Date.now() }];
        setMessages(finalMsgs);
        saveHistory(finalMsgs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [messages]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const padList = compact ? 'p-2' : 'p-3';
  const padInput = compact ? 'px-2 py-2' : 'px-3 py-2.5';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={listRef}
        className={`flex-1 min-h-0 overflow-y-auto ${padList} space-y-2 bg-[var(--color-surface-2)]/20 ${listClassName ?? ''}`}
      >
        {messages.length === 0 && (
          <div className="text-center text-sm text-[var(--color-text-muted)] py-8">
            <Bot size={28} className="mx-auto mb-2 text-[var(--color-accent)]" />
            <p className="font-bold text-[var(--color-text)] mb-1">Cześć! Jestem Orzeł.</p>
            <p className="text-xs">Zapytaj mnie o rezerwacje, kasę, kamery czy obiekt:</p>
            <div className="mt-3 flex flex-wrap gap-1.5 justify-center text-[11px]">
              <Suggest text="ile rezerwacji jutro?" onClick={t => setInput(t)} />
              <Suggest text="utarg z tego miesiąca?" onClick={t => setInput(t)} />
              <Suggest text="status kamery LPR" onClick={t => setInput(t)} />
            </div>
          </div>
        )}
        {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] px-2">
            <Loader2 size={12} className="animate-spin" /> Orzeł myśli…
          </div>
        )}
        {error && (
          <div className="rounded p-2 bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}
      </div>
      {/* Pasek szybkich akcji — widoczny gdy quickActions skonfigurowane */}
      {quickActions && quickActions.length > 0 && (
        <div className="px-2 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap gap-1">
          {quickActions.map((qa, i) => {
            const def = QUICK_ACTION_TOOLS[qa.tool];
            if (!def) return null;
            return (
              <QuickActionBtn key={i} label={qa.label} hint={def.description}
                needsInput={!def.optional} placeholder={def.placeholder}
                disabled={busy}
                onRun={(val) => void runQuickAction(qa, val)}
              />
            );
          })}
        </div>
      )}
      <div className={`${padInput} border-t border-[var(--color-border)] flex items-center gap-2 bg-[var(--color-surface)]`}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Zapytaj Orła… (Enter)"
          className="flex-1 bg-transparent border border-[var(--color-border)] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
          disabled={busy}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-3 py-1.5 rounded bg-gradient-accent text-[#1a1410] text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          title="Wyślij (Enter)"
        >
          <Send size={12} /> Wyślij
        </button>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10"
            title="Wyczyść historię"
          ><Eraser size={12} /></button>
        )}
      </div>
    </div>
  );
}

/** Przycisk szybkiej akcji z inline-expand: klik → pojawia się input obok → Enter uruchamia */
function QuickActionBtn({ label, hint, needsInput, placeholder, disabled, onRun }: {
  label: string;
  hint: string;
  needsInput: boolean;
  placeholder: string;
  disabled: boolean;
  onRun: (val: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = () => {
    if (needsInput && !val.trim()) return;
    onRun(val.trim());
    setVal('');
    setExpanded(false);
  };

  const cancel = () => { setVal(''); setExpanded(false); };

  useEffect(() => {
    if (expanded) requestAnimationFrame(() => inputRef.current?.focus());
  }, [expanded]);

  if (expanded) {
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') cancel(); }}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent border border-[var(--color-accent)] rounded px-2 py-0.5 text-xs focus:outline-none" />
        <button onClick={confirm} disabled={needsInput && !val.trim()}
          className="px-2 py-0.5 text-xs rounded bg-[var(--color-accent)] text-[#1a1410] font-bold disabled:opacity-40">OK</button>
        <button onClick={cancel} className="px-1.5 py-0.5 text-[10px] rounded text-[var(--color-text-muted)] hover:text-red-400">✕</button>
      </div>
    );
  }

  return (
    <button
      title={hint}
      disabled={disabled}
      onClick={() => {
        if (!needsInput) { onRun(''); return; }
        setExpanded(true);
      }}
      className="px-2 py-0.5 text-[11px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]/50 hover:border-[var(--color-accent)] text-[var(--color-text)] transition-colors disabled:opacity-40"
    >{label}</button>
  );
}

function ChatBubble({ msg }: { msg: ChatItem }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
        isUser
          ? 'bg-[var(--color-accent)] text-[#1a1410]'
          : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]'
      }`}>
        {msg.content}
        {msg.toolHints && msg.toolHints.length > 0 && (
          <div className="mt-1 pt-1 border-t border-[var(--color-border)]/30 text-[9px] text-[var(--color-text-muted)] font-mono">
            🔧 {msg.toolHints.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function Suggest({ text, onClick }: { text: string; onClick: (t: string) => void }) {
  return (
    <button onClick={() => onClick(text)} className="px-2 py-1 rounded border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-bg)]/30 transition-colors">
      {text}
    </button>
  );
}

function tinyArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const obj = args as Record<string, unknown>;
  return Object.entries(obj).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 12)}`).join(',');
}
