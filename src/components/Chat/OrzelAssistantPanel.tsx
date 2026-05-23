/**
 * OrzelAssistantPanel — czat operatora z lokalnym asystentem AI (Iter 5).
 * Function calling przez Groq, narzędzia w lib/orzelAssistant.ts.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, Trash2, Wrench, Bot as BotIcon, AlertCircle, User as UserIcon } from 'lucide-react';
import { chatTurn, isOrzelConfigured, runTool, type OrzelMessage } from '../../lib/orzelAssistant';
import { Modal, Button, Input } from '../shared/UI';
import { usePerm } from '../../lib/usePerm';
import { Spinner } from '../shared/UI';
import { getStore } from '../../lib/store';
import {
  QUICK_ACTION_TOOLS,
  parseQuickActions,
  DEFAULT_QUICK_ACTION_BLOCKS,
  type QuickActionBlock,
} from '../../lib/orzelQuickActions';

interface ChatItem {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolCalls?: { name: string; args: unknown; result: unknown }[];
  ts: number;
  error?: boolean;
}

type OrzelIssue = 'no_config' | 'auth_invalid' | 'endpoint_not_found' | 'rate_limit' | 'network_error' | null;

// Suggestions były tu wcześniej — przeniesione do lib/orzelQuickActions.ts.

export default function OrzelAssistantPanel() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [issue, setIssue] = useState<OrzelIssue>(null);
  const [quickActions, setQuickActions] = useState<QuickActionBlock[]>(DEFAULT_QUICK_ACTION_BLOCKS);
  const perm = usePerm();
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const refreshConfig = async () => {
      const ok = await isOrzelConfigured();
      if (cancelled) return;
      setConfigured(ok);
      setIssue(ok ? null : 'no_config');
    };
    void refreshConfig();
    const onSettingsSaved = () => { void refreshConfig(); };
    window.addEventListener('app:settings-saved', onSettingsSaved);
    return () => {
      cancelled = true;
      window.removeEventListener('app:settings-saved', onSettingsSaved);
    };
  }, []);

  // Wczytaj bloki quick-actions z ustawień (JSON tablicy { label, tool }).
  // Reaguje też na zdarzenie 'app:settings-saved' aby od razu się odświeżyć.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const store = await getStore();
        const raw = (await store.get<string>('orzel_quick_actions')) ?? '';
        const blocks = parseQuickActions(raw);
        if (!cancelled) setQuickActions(blocks);
      } catch {
        // ignore — zostaną domyślne
      }
    };
    void load();
    const onSettings = () => { void load(); };
    window.addEventListener('app:settings-saved', onSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('app:settings-saved', onSettings);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items, busy]);

  const buildHistory = useCallback((): OrzelMessage[] => {
    return items
      .filter(i => !i.error && i.role !== 'system')
      .slice(-12) // ostatnie 12 (6 par)
      .map(i => ({ role: i.role as 'user' | 'assistant', content: i.text }));
  }, [items]);

  const applyResultIssue = useCallback((errorCode?: string) => {
    if (!errorCode) {
      setConfigured(true);
      setIssue(null);
      return;
    }
    if (errorCode === 'no_config') {
      setConfigured(false);
      setIssue('no_config');
      return;
    }
    if (errorCode === 'auth_invalid' || errorCode === 'endpoint_not_found' || errorCode === 'rate_limit' || errorCode === 'network_error') {
      setConfigured(true);
      setIssue(errorCode);
      return;
    }
    setConfigured(true);
  }, []);

  const activeIssue: OrzelIssue = configured === false ? 'no_config' : issue;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const userItem: ChatItem = { id: ++idRef.current, role: 'user', text, ts: Date.now() };
    setItems(prev => [...prev, userItem]);
    setBusy(true);
    try {
      // If the user typed a short license-plate-like token, run quick find_reservation
      const plateLike = /^[A-Za-z0-9\s-]{4,12}$/.test(text) && /\d/.test(text) && /[A-Za-z]/.test(text);
      if (plateLike) {
        try {
          setBusy(true);
          const res = await runTool('find_reservation', { plate: text });
          const msg = formatToolResult('find_reservation', res);
          setItems(prev => [...prev, { id: ++idRef.current, role: 'assistant', text: msg, ts: Date.now() }]);
        } catch (e) {
          setItems(prev => [...prev, { id: ++idRef.current, role: 'assistant', text: 'Błąd narzędzia: ' + String(e), ts: Date.now(), error: true }]);
        }
      } else {
        const history = buildHistory();
        const result = await chatTurn(history, text);
        applyResultIssue(result.error);
        const aItem: ChatItem = {
          id: ++idRef.current,
          role: 'assistant',
          text: result.message,
          toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
          ts: Date.now(),
          error: !!result.error,
        };
        setItems(prev => [...prev, aItem]);
      }
    } catch (e) {
      setItems(prev => [...prev, {
        id: ++idRef.current, role: 'assistant',
        text: 'Błąd: ' + (e instanceof Error ? e.message : String(e)),
        ts: Date.now(), error: true,
      }]);
    }
    setBusy(false);
  };

  // Modal state for quick-actions / confirmations
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const confirmCb = useRef<(val?: string) => Promise<void> | void>(() => {});

  const openInputModal = (title: string, _placeholder: string, cb: (val: string) => Promise<void>) => {
    setConfirmTitle(title);
    setConfirmInput('');
    confirmCb.current = async (v?: string) => { await cb(v ?? ''); };
    setConfirmOpen(true);
  };

  function formatToolResult(name: string, res: unknown): string {
    try {
      if (!res) return 'Brak wyników.';
      if (name === 'find_reservation') {
        const r = res as any;
        if (r.count === 0) return `Nie znaleziono rezerwacji dla zapytania "${r.query}".`;
        const lines = (r.results || []).map((it: any) => `• ${it.registration} — przyjazd: ${it.arrival_date} — ${it.status}`);
        return `Znaleziono ${r.count} rezerwację(-e) dla "${r.query}":\n${lines.join('\n')}`;
      }
      if (name === 'check_capacity') {
        const c = res as any;
        return `Data: ${c.date} — Pojemność: ${c.capacity ?? 'n/d'} — Zarezerwowane: ${c.booked ?? 'n/d'} — Wolne: ${c.free ?? 'n/d'}${c.full ? ' — PEŁNY' : ''}`;
      }
      // Default: attempt to stringify succinctly
      const s = typeof res === 'string' ? res : JSON.stringify(res);
      return s.length > 800 ? s.slice(0, 800) + '…' : s;
    } catch (e) {
      return 'Wynik narzędzia (błąd formatowania)';
    }
  }

  function renderIssueBanner() {
    if (!activeIssue) return null;

    if (activeIssue === 'auth_invalid') {
      return (
        <div className="glass-strong rounded-[var(--radius-md)] p-4 flex items-start gap-3 border-2 border-red-500/40 animate-fadeIn">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--color-text)]">
            <strong>Klucz AI jest nieważny albo wyłączony.</strong>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Wejdź w <strong>Ustawienia → Integracje → AI Asystent (Orzeł)</strong> i wklej nowy klucz z <code className="px-1 rounded bg-[var(--color-surface-2)]">console.groq.com/keys</code>.
            </p>
          </div>
        </div>
      );
    }

    if (activeIssue === 'endpoint_not_found') {
      return (
        <div className="glass-strong rounded-[var(--radius-md)] p-4 flex items-start gap-3 border-2 border-amber-500/40 animate-fadeIn">
          <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--color-text)]">
            <strong>Endpoint AI jest błędny.</strong>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Sprawdź URL w <strong>Ustawienia → Integracje → AI Asystent (Orzeł)</strong>. Dla Groq powinien kończyć się na <code className="px-1 rounded bg-[var(--color-surface-2)]">/chat/completions</code>.
            </p>
          </div>
        </div>
      );
    }

    if (activeIssue === 'rate_limit') {
      return (
        <div className="glass-strong rounded-[var(--radius-md)] p-4 flex items-start gap-3 border-2 border-amber-500/40 animate-fadeIn">
          <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--color-text)]">
            <strong>Limit modelu AI został osiągnięty.</strong>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Poczekaj chwilę albo zmień model w <strong>Ustawienia → Integracje → AI Asystent (Orzeł)</strong> na lżejszy, np. <code className="px-1 rounded bg-[var(--color-surface-2)]">llama-3.1-8b-instant</code>.
            </p>
          </div>
        </div>
      );
    }

    if (activeIssue === 'network_error') {
      return (
        <div className="glass-strong rounded-[var(--radius-md)] p-4 flex items-start gap-3 border-2 border-amber-500/40 animate-fadeIn">
          <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--color-text)]">
            <strong>Brak połączenia z endpointem AI.</strong>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Sprawdź internet, firewall i adres endpointu w <strong>Ustawienia → Integracje → AI Asystent (Orzeł)</strong>.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="glass-strong rounded-[var(--radius-md)] p-4 flex items-start gap-3 border-2 border-amber-500/40 animate-fadeIn">
        <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-[var(--color-text)]">
          <strong>Brak klucza Groq.</strong>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Wejdź w <strong>Ustawienia → Integracje → AI Asystent (Orzeł)</strong> i wklej klucz z <code className="px-1 rounded bg-[var(--color-surface-2)]">console.groq.com/keys</code>.
          </p>
        </div>
      </div>
    );
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Header — dwie linie: tytuł+wyczyść, potem rząd przycisków szybkich akcji */}
      <div className="px-5 pt-3 pb-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)] flex-shrink-0">
              <Sparkles size={16} className="text-[#1a1410]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--color-text)]">Asystent Orzeł</div>
              <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                function calling · {quickActions.length} {quickActions.length === 1 ? 'szybka akcja' : 'szybkich akcji'} · pamięć krótka (12 wiadomości)
              </div>
            </div>
          </div>
          {items.length > 0 && (
            <button onClick={() => setItems([])}
              className="text-xs text-[var(--color-text-muted)] hover:text-red-400 transition-colors flex items-center gap-1 flex-shrink-0">
              <Trash2 size={13} /> Wyczyść
            </button>
          )}
        </div>

        {/* Rząd szybkich akcji + Ask — pełna szerokość, zawijanie naturalne */}
        {perm.has('chat.use') ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickActions.map((qa, idx) => {
              const def = QUICK_ACTION_TOOLS[qa.tool];
              if (!def) return null;
              return (
                <button key={`${qa.tool}-${idx}`} title={`${def.description} (${def.name})`}
                  onClick={() => openInputModal(def.modalTitle, def.placeholder, async (val) => {
                    if (!def.optional && !val) return;
                    try {
                      setBusy(true);
                      const args = def.buildArgs(val);
                      const res = await runTool(def.name, args);
                      const msg = formatToolResult(def.name, res);
                      setItems(prev => [...prev, { id: ++idRef.current, role: 'assistant', text: msg, toolCalls: [{ name: def.name, args, result: res }], ts: Date.now() }]);
                    } catch (e) {
                      setItems(prev => [...prev, { id: ++idRef.current, role: 'assistant', text: 'Błąd narzędzia: ' + String(e), ts: Date.now(), error: true }]);
                    } finally { setBusy(false); }
                  })}
                  className="px-2.5 py-1 rounded-md bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] text-xs text-[var(--color-text)] border border-[var(--color-border)]/40">
                  {qa.label}
                </button>
              );
            })}
            <button onClick={() => openInputModal('Zadaj pytanie (pełny prompt)', 'Twoje pytanie', async (val) => {
              if (!val) return;
              try {
                setBusy(true);
                const history = buildHistory();
                const r = await chatTurn(history, val);
                applyResultIssue(r.error);
                setItems(prev => [...prev, { id: ++idRef.current, role: 'assistant', text: r.message, toolCalls: r.toolCalls.length ? r.toolCalls : undefined, ts: Date.now(), error: !!r.error }]);
              } catch (e) {
                setItems(prev => [...prev, { id: ++idRef.current, role: 'assistant', text: 'Błąd: ' + String(e), ts: Date.now(), error: true }]);
              } finally { setBusy(false); }
            })} className="px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-xs text-[#1a1410] font-bold ml-auto" title="Zapytaj Orła pełnym promptem (LLM)">Ask</button>
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">Brak uprawnień do użycia Asystenta</div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-[var(--color-bg)]">
        {renderIssueBanner()}

        {items.length === 0 && !activeIssue && (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-fadeIn">
            <div className="w-16 h-16 rounded-full bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-glow)] mb-4 animate-float-slow">
              <Sparkles size={28} className="text-[#1a1410]" />
            </div>
            <h3 className="hero-number text-3xl mb-2">Cześć! Jestem Orzeł.</h3>
            <p className="text-sm text-[var(--color-text-muted)] max-w-md mb-6">
              Pomogę ci sprawdzić rezerwacje, obłożenie, bany i ustawienia parkingu. Pytaj naturalnie.
            </p>
            <div className="text-xs text-[var(--color-text-muted)]">Użyj przycisków u góry, lub wpisz pytanie.</div>
          </div>
        )}

        {items.map(item => (
          <div key={item.id} className={`flex gap-3 animate-slideUp ${item.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 shadow-[var(--shadow-sm)] ${
              item.role === 'user' ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]' : 'bg-gradient-accent text-[#1a1410]'
            }`}>
              {item.role === 'user' ? <UserIcon size={15} /> : <BotIcon size={15} />}
            </div>
            <div className={`max-w-[80%] flex flex-col gap-1.5 ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`px-4 py-2.5 rounded-[var(--radius-md)] text-sm leading-relaxed whitespace-pre-wrap ${
                item.error ? 'bg-red-500/10 border border-red-500/40 text-red-300' :
                item.role === 'user' ? 'bg-gradient-accent text-[#1a1410] font-medium shadow-[var(--shadow-md)]' :
                'glass-strong text-[var(--color-text)]'
              }`}>
                {item.text}
              </div>
              {item.toolCalls && item.toolCalls.length > 0 && (
                <details className="text-[10px] text-[var(--color-text-muted)] max-w-full">
                  <summary className="cursor-pointer hover:text-[var(--color-accent)] flex items-center gap-1 select-none">
                    <Wrench size={11} /> użyte narzędzia: {item.toolCalls.map(t => t.name).join(', ')}
                  </summary>
                  <div className="mt-1 space-y-1.5 pl-3 border-l-2 border-[var(--color-border)]">
                    {item.toolCalls.map((tc, i) => (
                      <div key={i} className="font-mono text-[10px]">
                        <div className="text-[var(--color-accent)]">→ {tc.name}({JSON.stringify(tc.args)})</div>
                        <div className="text-[var(--color-text-muted)] opacity-80 truncate max-w-[600px]">
                          ← {JSON.stringify(tc.result).slice(0, 240)}{JSON.stringify(tc.result).length > 240 ? '…' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="text-[10px] text-[var(--color-text-muted)] opacity-60 px-1">
                {new Date(item.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3 animate-fadeIn">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center flex-shrink-0 shadow-[var(--shadow-sm)]">
              <BotIcon size={15} className="text-[#1a1410]" />
            </div>
            <div className="glass-strong px-4 py-2.5 rounded-[var(--radius-md)] flex items-center gap-2">
              <Spinner /> <span className="text-xs text-[var(--color-text-muted)]">Orzeł myśli…</span>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] p-3 bg-[var(--color-bg)] flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
            placeholder="Zapytaj o rezerwacje, obłożenie, bany… (Enter = wyślij, Shift+Enter = nowa linia)"
            rows={1}
            className="flex-1 px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] text-sm resize-none focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50 max-h-32"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || busy}
            className="px-4 py-2.5 rounded-[var(--radius-md)] bg-gradient-accent text-[#1a1410] font-bold text-sm shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-glow)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0">
            <Send size={15} /> Wyślij
          </button>
        </div>
      </div>
      {/* Confirm / Input Modal */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={confirmTitle}>
        <div className="space-y-3">
          <Input label="Wartość" value={confirmInput} onChange={e => setConfirmInput(e.target.value)} placeholder="Wpisz wartość" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Anuluj</Button>
            <Button variant="primary" onClick={async () => { setConfirmOpen(false); await confirmCb.current(confirmInput); }}>OK</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
