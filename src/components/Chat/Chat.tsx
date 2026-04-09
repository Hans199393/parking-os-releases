import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, User, Bot, RefreshCw, X } from 'lucide-react';
import { getSupabaseClient, isConfigured } from '../../lib/supabase';
import { Spinner } from '../shared/UI';

interface ChatSession {
  id: string;
  lang: string;
  status: string;
  started_at: string;
  last_activity: string;
}

interface ChatMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'owner' | 'error';
  content: string;
  created_at: string;
}

export default function Chat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerReply, setOwnerReply] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<Awaited<ReturnType<typeof getSupabaseClient>>['channel']> | null>(null);
  const selectedSessionRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => { selectedSessionRef.current = selectedSession; }, [selectedSession]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      if (!(await isConfigured())) {
        setError('Supabase nie jest skonfigurowany.');
        setLoading(false);
        return;
      }
      const sb = await getSupabaseClient();
      const { data, error: err } = await sb
        .from('chat_sessions')
        .select('*')
        .order('last_activity', { ascending: false })
        .limit(50);
      if (err) throw err;
      setSessions(data || []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania sesji');
    } finally {
      setLoading(false);
    }
  }, []);

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
      await sb.from('chat_sessions')
        .update({ last_activity: new Date().toISOString() })
        .eq('id', selectedSession);
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
          <button onClick={loadSessions} className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition">
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-[var(--color-muted)] text-sm">
              Brak rozmów. Czekam na pierwszego klienta 🦅
            </div>
          ) : sessions.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedSession(s.id)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition ${
                selectedSession === s.id ? 'bg-[var(--color-surface)]' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-text)] flex items-center gap-1.5">
                  {langFlag(s.lang)} Sesja
                  {s.status === 'active' && <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />}
                </span>
                <span className="text-xs text-[var(--color-muted)]">{timeAgo(s.last_activity)}</span>
              </div>
              <div className="text-xs text-[var(--color-muted)] mt-0.5 truncate">
                {fmtDate(s.started_at)}
              </div>
            </button>
          ))}
        </div>
      </div>

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
              </div>
              <button onClick={() => setSelectedSession(null)}
                className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition md:hidden">
                <X size={18} />
              </button>
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
