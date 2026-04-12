import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, User, Bot, RefreshCw, X, Trash2, CheckCircle, RotateCcw, UserCheck, BotOff } from 'lucide-react';
import { getSupabaseClient, isConfigured } from '../../lib/supabase';
import { Spinner } from '../shared/UI';

interface ChatSession {
  id: string;
  lang: string;
  status: string;
  started_at: string;
  last_activity: string;
  last_message?: string;
  message_count?: number;
  bot_paused?: boolean;
  bot_paused_at?: string | null;
}

interface ChatMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'owner' | 'error';
  content: string;
  created_at: string;
}

type FilterTab = 'active' | 'closed' | 'all';

const PAGE_SIZE = 20;

export default function Chat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerReply, setOwnerReply] = useState('');
  const [sending, setSending] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>('active');
  const [hasMore, setHasMore] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<Awaited<ReturnType<typeof getSupabaseClient>>['channel']> | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);

  // Keep refs in sync with state
  useEffect(() => { selectedSessionRef.current = selectedSession; }, [selectedSession]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Load sessions with filter & pagination
  const loadSessions = useCallback(async (append = false) => {
    try {
      if (!(await isConfigured())) {
        setError('Supabase nie jest skonfigurowany.');
        setLoading(false);
        return;
      }
      const sb = await getSupabaseClient();
      const offset = append ? sessionsRef.current.length : 0;
      let query = sb
        .from('chat_sessions')
        .select('*')
        .order('last_activity', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (filterTab !== 'all') {
        query = query.eq('status', filterTab);
      }

      const { data, error: err } = await query;
      if (err) throw err;

      const rows = (data || []) as ChatSession[];

      // Fetch last message preview + count for each session
      const enriched = await Promise.all(rows.map(async (s) => {
        try {
          const [lastMsg, countRes] = await Promise.all([
            sb.from('chat_messages')
              .select('content, role')
              .eq('session_id', s.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            sb.from('chat_messages')
              .select('id', { count: 'exact', head: true })
              .eq('session_id', s.id),
          ]);
          return {
            ...s,
            last_message: lastMsg.data
              ? `${lastMsg.data.role === 'user' ? '🧑' : '🤖'} ${(lastMsg.data.content || '').slice(0, 50)}`
              : undefined,
            message_count: countRes.count ?? undefined,
          };
        } catch {
          return s;
        }
      }));

      setHasMore(rows.length === PAGE_SIZE);
      if (append) {
        setSessions(prev => [...prev, ...enriched]);
      } else {
        setSessions(enriched);
      }
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania sesji');
    } finally {
      setLoading(false);
    }
  }, [filterTab]);

  // Load messages for selected session
  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const sb = await getSupabaseClient();
      const { data, error: err } = await sb
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (err) throw err;
      setMessages((data || []) as ChatMessage[]);
    } catch (e: unknown) {
      console.error('Error loading messages:', e);
    }
  }, []);

  // Toggle bot_paused per session
  const toggleBotPaused = async (sessionId: string, currentlyPaused: boolean) => {
    setTogglingPause(true);
    try {
      const sb = await getSupabaseClient();
      const update: Record<string, unknown> = currentlyPaused
        ? { bot_paused: false, bot_paused_at: null }
        : { bot_paused: true, bot_paused_at: new Date().toISOString() };
      await (sb.from('chat_sessions') as any).update(update).eq('id', sessionId);
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, ...update } : s
      ));
    } catch (e) {
      console.error('Error toggling bot pause:', e);
    } finally {
      setTogglingPause(false);
    }
  };

  // Close / reopen session
  const toggleSessionStatus = async (sessionId: string, currentStatus: string) => {
    try {
      const sb = await getSupabaseClient();
      const newStatus = currentStatus === 'active' ? 'closed' : 'active';
      await sb.from('chat_sessions').update({ status: newStatus }).eq('id', sessionId);
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: newStatus } : s));
    } catch (e) {
      console.error('Error toggling session status:', e);
    }
  };

  // Delete session + its messages
  const deleteSession = async (sessionId: string) => {
    try {
      const sb = await getSupabaseClient();
      // Delete messages first (FK constraint)
      await sb.from('chat_messages').delete().eq('session_id', sessionId);
      await sb.from('chat_sessions').delete().eq('id', sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (selectedSession === sessionId) {
        setSelectedSession(null);
        setMessages([]);
      }
      setDeleteConfirm(null);
    } catch (e) {
      console.error('Error deleting session:', e);
    }
  };

  // Reset pagination + reload on filter change
  useEffect(() => {
    setSessions([]);
    setLoading(true);
    loadSessions();
  }, [filterTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to realtime
  useEffect(() => {
    let mounted = true;

    async function subscribe() {
      if (!(await isConfigured())) return;
      const sb = await getSupabaseClient();

      const channel = sb.channel('chat-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
          if (!mounted) return;
          const newMsg = payload.new as ChatMessage;
          // Add to messages if it's the currently open session
          if (selectedSessionRef.current === newMsg.session_id) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
          // Always refresh sessions list for last_activity update
          loadSessions();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_sessions' }, () => {
          if (mounted) loadSessions();
        })
        .subscribe();

      channelRef.current = channel;
    }

    subscribe();
    return () => {
      mounted = false;
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
    };
  }, [loadSessions]);

  // Initial load
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load messages when session changes
  useEffect(() => {
    if (selectedSession) loadMessages(selectedSession);
    else setMessages([]);
  }, [selectedSession, loadMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Polling fallback — co 5s odświeżaj wiadomości, co 15s listę sesji
  useEffect(() => {
    if (!selectedSession) return;
    const id = setInterval(() => loadMessages(selectedSession), 5000);
    return () => clearInterval(id);
  }, [selectedSession, loadMessages]);

  useEffect(() => {
    const id = setInterval(loadSessions, 15000);
    return () => clearInterval(id);
  }, [loadSessions]);

  // Send owner reply
  const handleSendReply = async () => {
    if (!ownerReply.trim() || !selectedSession || sending) return;
    setSending(true);
    try {
      const sb = await getSupabaseClient();
      await sb.from('chat_messages').insert({
        session_id: selectedSession,
        role: 'owner',
        content: ownerReply.trim()
      });
      // Auto-pause bot when owner sends a message
      await sb.from('chat_sessions')
        .update({ last_activity: new Date().toISOString(), bot_paused: true, bot_paused_at: new Date().toISOString() })
        .eq('id', selectedSession);
      setSessions(prev => prev.map(s =>
        s.id === selectedSession ? { ...s, bot_paused: true, bot_paused_at: new Date().toISOString() } : s
      ));
      setOwnerReply('');
    } catch (e) {
      console.error('Error sending reply:', e);
    } finally {
      setSending(false);
    }
  };

  // Format timestamp
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  // Time ago
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'teraz';
    if (mins < 60) return `${mins} min temu`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h temu`;
    return `${Math.floor(hrs / 24)}d temu`;
  };

  const langFlag = (l: string) => {
    const flags: Record<string, string> = { pl: '🇵🇱', en: '🇬🇧', ua: '🇺🇦', de: '🇩🇪' };
    return flags[l] || '🌐';
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner /></div>;
  if (error) return <div className="flex items-center justify-center h-full text-red-400">{error}</div>;

  return (
    <div className="flex h-full">
      {/* Sessions list */}
      <div className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg)]">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-bold text-[var(--color-text)] flex items-center gap-2">
            <MessageCircle size={18} /> Czat Orzeł
          </h2>
          <button onClick={() => loadSessions()} className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          {([
            ['active', 'Aktywne'],
            ['closed', 'Zamknięte'],
            ['all', 'Wszystkie'],
          ] as [FilterTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterTab(key)}
              className={`flex-1 py-2 text-xs font-semibold transition ${
                filterTab === key
                  ? 'text-amber-500 border-b-2 border-amber-500'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && !loading ? (
            <div className="p-4 text-center text-[var(--color-muted)] text-sm">
              {filterTab === 'active' ? 'Brak aktywnych rozmów 🦅' : filterTab === 'closed' ? 'Brak zamkniętych rozmów' : 'Brak rozmów. Czekam na pierwszego klienta 🦅'}
            </div>
          ) : sessions.map(s => (
            <div
              key={s.id}
              className={`group relative border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition ${
                selectedSession === s.id ? 'bg-[var(--color-surface)]' : ''
              }`}
            >
              <button
                onClick={() => setSelectedSession(s.id)}
                className="w-full text-left px-4 py-3 pr-16"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-text)] flex items-center gap-1.5">
                    {langFlag(s.lang)} Sesja
                    {s.status === 'active' && <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />}
                    {s.status === 'closed' && <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />}
                    {s.message_count != null && (
                      <span className="text-[10px] text-[var(--color-muted)] ml-1">({s.message_count})</span>
                    )}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">{timeAgo(s.last_activity)}</span>
                </div>
                {s.last_message && (
                  <div className="text-xs text-[var(--color-muted)] mt-0.5 truncate">{s.last_message}</div>
                )}
                <div className="text-[10px] text-[var(--color-muted)] mt-0.5 truncate">
                  {fmtDate(s.started_at)}
                </div>
              </button>

              {/* Session actions — visible on hover */}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleBotPaused(s.id, !!s.bot_paused); }}
                  title={s.bot_paused ? 'Zwróć Orłowi' : 'Przejmij rozmówę'}
                  disabled={togglingPause}
                  className={`p-1.5 rounded-md transition ${
                    s.bot_paused
                      ? 'text-amber-500 hover:bg-amber-500/10'
                      : 'text-blue-400 hover:bg-blue-400/10'
                  }`}
                >
                  {s.bot_paused ? <UserCheck size={14} /> : <BotOff size={14} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSessionStatus(s.id, s.status); }}
                  title={s.status === 'active' ? 'Zamknij rozmowę' : 'Wznów rozmowę'}
                  className={`p-1.5 rounded-md transition ${
                    s.status === 'active'
                      ? 'text-green-500 hover:bg-green-500/10'
                      : 'text-amber-500 hover:bg-amber-500/10'
                  }`}
                >
                  {s.status === 'active' ? <CheckCircle size={14} /> : <RotateCcw size={14} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(s.id); }}
                  title="Usuń rozmowę"
                  className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => loadSessions(true)}
              className="w-full py-3 text-xs text-amber-500 hover:text-amber-400 font-semibold transition"
            >
              Załaduj starsze rozmowy...
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text)] mb-2">Usunąć rozmowę?</h3>
            <p className="text-sm text-[var(--color-muted)] mb-4">
              Ta operacja usunie sesję i wszystkie jej wiadomości. Nie można tego cofnąć.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] transition"
              >
                Anuluj
              </button>
              <button
                onClick={() => deleteSession(deleteConfirm)}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition"
              >
                Tak, usuń
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-[var(--color-bg)]">
        {!selectedSession ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-muted)]">
            <div className="text-center">
              <span className="text-5xl block mb-3">🦅</span>
              <p>Wybierz rozmowę z listy</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🦅</span>
                <span className="font-medium text-sm text-[var(--color-text)]">
                  {langFlag(sessions.find(s => s.id === selectedSession)?.lang || 'pl')} Rozmowa
                </span>
                {(() => {
                  const sess = sessions.find(s => s.id === selectedSession);
                  if (!sess) return null;
                  return (
                    <>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        sess.status === 'active'
                          ? 'bg-green-500/20 text-green-500'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {sess.status === 'active' ? 'aktywna' : 'zamknięta'}
                      </span>
                      {sess.bot_paused && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-500">
                          👤 Ty przejąłeś
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1.5">
                {(() => {
                  const sess = sessions.find(s => s.id === selectedSession);
                  if (!sess) return null;
                  return (
                    <>
                      <button
                        onClick={() => toggleBotPaused(sess.id, !!sess.bot_paused)}
                        title={sess.bot_paused ? 'Zwróć Orłowi — włącz bota z powrotem' : 'Przejmij rozmówę — wyłącz bota'}
                        disabled={togglingPause}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                          sess.bot_paused
                            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                            : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                        }`}
                      >
                        {sess.bot_paused ? <UserCheck size={14} /> : <BotOff size={14} />}
                        {sess.bot_paused ? 'Zwróć Orłowi' : 'Przejmij'}
                      </button>
                      <button
                        onClick={() => toggleSessionStatus(sess.id, sess.status)}
                        title={sess.status === 'active' ? 'Zamknij rozmowę' : 'Wznów rozmowę'}
                        className={`p-1.5 rounded-md transition ${
                          sess.status === 'active'
                            ? 'text-green-500 hover:bg-green-500/10'
                            : 'text-amber-500 hover:bg-amber-500/10'
                        }`}
                      >
                        {sess.status === 'active' ? <CheckCircle size={16} /> : <RotateCcw size={16} />}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(sess.id)}
                        title="Usuń rozmowę"
                        className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10 transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  );
                })()}
                <button onClick={() => setSelectedSession(null)}
                  className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition md:hidden">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100 rounded-bl-md'
                      : msg.role === 'owner'
                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 rounded-br-md border border-amber-300 dark:border-amber-700'
                        : msg.role === 'error'
                          ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 rounded-br-md border border-red-300 dark:border-red-700 opacity-80'
                          : 'bg-teal-100 dark:bg-teal-900/40 text-teal-900 dark:text-teal-100 rounded-br-md'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {msg.role === 'user' && <User size={12} />}
                      {msg.role === 'assistant' && <Bot size={12} />}
                      {msg.role === 'owner' && <span className="text-xs">👤</span>}
                      {msg.role === 'error' && <span className="text-xs">⚠️</span>}
                      <span className="text-[10px] opacity-60">
                        {msg.role === 'user' ? 'Klient' : msg.role === 'owner' ? 'Ty' : msg.role === 'error' ? 'BŁĄD SYSTEMU' : 'Orzeł AI'}
                        {' · '}{fmtTime(msg.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Owner reply input */}
            <form onSubmit={e => { e.preventDefault(); handleSendReply(); }}
              className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2">
              <input
                value={ownerReply}
                onChange={e => setOwnerReply(e.target.value)}
                placeholder="Odpowiedz jako właściciel..."
                maxLength={500}
                className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-amber-500"
                disabled={sending}
              />
              <button type="submit" disabled={!ownerReply.trim() || sending}
                className="bg-amber-500 hover:bg-amber-600 disabled:bg-gray-500 text-white rounded-lg px-4 py-2 flex items-center gap-1.5 text-sm transition">
                <Send size={14} /> Wyślij
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
