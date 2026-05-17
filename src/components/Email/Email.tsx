/**
 * Email — 3-panelowa skrzynka (Iteracja 4).
 *  ┌───────────┬────────────┬──────────────────────────┐
 *  │ Folders   │ Lista      │ Treść                    │
 *  │ (rail)    │ (column)   │ (preview)                │
 *  │ 200px     │ 340px      │ flex-1                   │
 *  └───────────┴────────────┴──────────────────────────┘
 *  + Compose modal z RichEditor (WYSIWYG).
 *
 * Foldery: Odebrane / Wysłane / Wersje robocze (planowane) / Kosz (planowane).
 * Visual: gradient-accent na akcjach, glass-strong, animate-slideUp.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Mail, RefreshCw, Send, Trash2, Reply, Pencil, X, AlertCircle,
  SendHorizonal, Inbox, FileText, Search, Plus,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getStore } from '../../lib/store';
import { Spinner, Button, Input } from '../shared/UI';
import RichEditor from './RichEditor';
import { usePerm } from '../../lib/usePerm';

interface EmailMessage {
  uid: number;
  subject: string;
  from: string;
  date: string;
  is_read: boolean;
}

interface EmailConfig {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  user: string;
  pass: string;
  signature_html: string;
}

interface Compose {
  to: string;
  subject: string;
  bodyHtml: string;
}

type FolderId = 'inbox' | 'sent' | 'drafts' | 'trash';

const SIG_MARKER = '<!--PARKING_SIGNATURE-->';
const FALLBACK_SIGNATURE = `<p style="margin:18px 0 0"><strong>Parking Sobieszewo</strong> · <a href="mailto:kontakt@parkingsobieszewo.pl">kontakt@parkingsobieszewo.pl</a></p>`;

function buildHtmlEmail(bodyHtml: string, signatureHtml: string): string {
  // Nie podwajaj jeśli sygnatura już dołączona w cytacie odpowiedzi
  const hasSig = bodyHtml.includes(SIG_MARKER);
  const sig = hasSig ? '' : `${SIG_MARKER}<div style="margin-top:18px;padding-top:14px;border-top:2px solid #e2e8f0">${signatureHtml || FALLBACK_SIGNATURE}</div>`;
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;max-width:600px">${bodyHtml}${sig}</body></html>`;
}

const FOLDERS: { id: FolderId; label: string; Icon: React.ComponentType<{ size?: number }>; planned?: boolean }[] = [
  { id: 'inbox',  label: 'Odebrane',         Icon: Inbox },
  { id: 'sent',   label: 'Wysłane',          Icon: SendHorizonal },
  { id: 'drafts', label: 'Wersje robocze',   Icon: FileText, planned: true },
  { id: 'trash',  label: 'Kosz',             Icon: Trash2,   planned: true },
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default function Email() {
  const perm = usePerm();
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [configMissing, setConfigMissing] = useState(false);
  const [folder, setFolder] = useState<FolderId>('inbox');
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');

  const loadConfig = useCallback(async (): Promise<EmailConfig | null> => {
    const store = await getStore();
    const imap_host = (await store.get<string>('email_imap_host')) ?? '';
    const imap_port = parseInt((await store.get<string>('email_imap_port')) ?? '993') || 993;
    const smtp_host = (await store.get<string>('email_smtp_host')) ?? '';
    const smtp_port = parseInt((await store.get<string>('email_smtp_port')) ?? '465') || 465;
    const user = (await store.get<string>('email_user')) ?? '';
    const pass = (await store.get<string>('email_pass')) ?? '';
    const signature_html = (await store.get<string>('email_signature_html')) ?? '';
    if (!imap_host || !user || !pass) return null;
    return { imap_host, imap_port, smtp_host, smtp_port, user, pass, signature_html };
  }, []);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await loadConfig();
      if (!cfg) { setConfigMissing(true); setLoading(false); return; }
      setConfig(cfg);
      setConfigMissing(false);
      const [inbox, sent] = await Promise.all([
        invoke<EmailMessage[]>('email_fetch_list', {
          imapHost: cfg.imap_host, imapPort: cfg.imap_port,
          user: cfg.user, pass: cfg.pass,
        }),
        invoke<EmailMessage[]>('email_fetch_sent', {
          imapHost: cfg.imap_host, imapPort: cfg.imap_port,
          user: cfg.user, pass: cfg.pass,
        }).catch(() => [] as EmailMessage[]),
      ]);
      setEmails(inbox);
      setSentEmails(sent);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [loadConfig]);

  useEffect(() => { loadEmails(); }, [loadEmails]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) loadEmails();
    }, 90_000);
    return () => clearInterval(id);
  }, [loadEmails]);

  const openEmail = async (email: EmailMessage, isSent = false) => {
    setSelected(email);
    setBody(null);
    setBodyLoading(true);
    try {
      const cfg = config ?? await loadConfig();
      if (!cfg) return;
      const cmd = isSent ? 'email_fetch_sent_body' : 'email_fetch_body';
      const html = await invoke<string>(cmd, {
        imapHost: cfg.imap_host, imapPort: cfg.imap_port,
        user: cfg.user, pass: cfg.pass, uid: email.uid,
      });
      setBody(html);
      if (!isSent) setEmails(prev => prev.map(e => e.uid === email.uid ? { ...e, is_read: true } : e));
    } catch (e) {
      setBody(`<p style="color:red">Błąd ładowania: ${String(e)}</p>`);
    } finally {
      setBodyLoading(false);
    }
  };

  const openCompose = (replyTo?: EmailMessage, replyHtml?: string | null) => {
    const needPerm = replyTo ? 'email.reply' : 'email.send';
    const label = replyTo ? 'odpowiedź na e-mail' : 'wysłanie nowej wiadomości';
    if (!perm.guard(needPerm, label)) return;
    if (replyTo) {
      const replyAddr = replyTo.from.match(/<(.+)>/)?.[1] ?? replyTo.from.trim();
      const quotedBlock = replyHtml
        ? `<br><br><div style="border-left:3px solid #cbd5e1;padding-left:12px;color:#64748b;font-size:13px">
            <p style="margin:0 0 8px"><strong>Od:</strong> ${escapeHtml(replyTo.from)}<br><strong>Data:</strong> ${escapeHtml(replyTo.date)}</p>
            ${replyHtml}
          </div>`
        : '';
      setCompose({
        to: replyAddr,
        subject: replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`,
        bodyHtml: `<p></p>${quotedBlock}`,
      });
    } else {
      setCompose({ to: '', subject: '', bodyHtml: '<p></p>' });
    }
    setSendError('');
  };

  const sendEmail = async () => {
    if (!compose || !config) return;
    if (!perm.guard('email.send', 'wysłanie e-maila')) { setCompose(null); return; }
    if (!compose.to.trim()) { setSendError('Wpisz adres odbiorcy.'); return; }
    if (!compose.subject.trim()) { setSendError('Wpisz temat.'); return; }
    setSending(true);
    setSendError('');
    try {
      await invoke('email_send', {
        imapHost: config.imap_host, imapPort: config.imap_port,
        smtpHost: config.smtp_host || config.imap_host, smtpPort: config.smtp_port,
        user: config.user, pass: config.pass,
        to: compose.to.trim(),
        subject: compose.subject.trim(),
        body: buildHtmlEmail(compose.bodyHtml, config.signature_html),
      });
      setCompose(null);
      invoke<EmailMessage[]>('email_fetch_sent', {
        imapHost: config.imap_host, imapPort: config.imap_port,
        user: config.user, pass: config.pass,
      }).then(setSentEmails).catch(() => {});
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteConfirm === null || !config) return;
    if (!perm.guard('email.delete', 'usunięcie wiadomości')) { setDeleteConfirm(null); return; }
    setDeleting(true);
    try {
      await invoke('email_delete', {
        imapHost: config.imap_host, imapPort: config.imap_port,
        user: config.user, pass: config.pass, uid: deleteConfirm,
      });
      setEmails(prev => prev.filter(e => e.uid !== deleteConfirm));
      if (selected?.uid === deleteConfirm) { setSelected(null); setBody(null); }
      setDeleteConfirm(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  const fmtDate = (raw: string) => {
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return raw.slice(0, 16);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      if (diffDays < 7) return d.toLocaleDateString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch { return raw.slice(0, 16); }
  };

  const extractDisplayName = (from: string) => {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : from.replace(/<.+>/, '').trim() || from;
  };

  const initials = (s: string) => {
    const parts = s.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  };

  const colorFromString = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h}, 65%, 45%)`;
  };

  const currentList = useMemo(() => {
    const src = folder === 'inbox' ? emails
              : folder === 'sent'  ? sentEmails
              : [];
    if (!search.trim()) return src;
    const q = search.toLowerCase();
    return src.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.from.toLowerCase().includes(q)
    );
  }, [folder, emails, sentEmails, search]);

  const unreadCount = emails.filter(e => !e.is_read).length;

  if (configMissing) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="glass-strong rounded-[var(--radius-xl)] p-8 max-w-sm text-center animate-slideUp">
          <div className="w-16 h-16 mx-auto mb-4 rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center">
            <AlertCircle size={32} className="text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">Brak konfiguracji poczty</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Przejdź do <strong>Ustawienia → Integracje</strong> i uzupełnij dane serwera IMAP, SMTP, login i hasło.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[200px_340px_1fr] h-full overflow-hidden">

      {/* PANEL 1: FOLDERS */}
      <aside className="border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
        <div className="p-3 border-b border-[var(--color-border)]">
          {perm.has('email.send') && (
            <Button
              variant="primary" size="md"
              className="w-full !justify-start gap-2"
              onClick={() => openCompose()}>
              <Plus size={16} /> Nowa wiadomość
            </Button>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {FOLDERS.map(({ id, label, Icon, planned }) => {
            const active = folder === id;
            const count = id === 'inbox' ? unreadCount
                        : id === 'sent'  ? sentEmails.length
                        : 0;
            return (
              <button key={id}
                onClick={() => { setFolder(id); setSelected(null); setBody(null); }}
                disabled={planned}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] text-left transition-all text-sm
                  ${active
                    ? 'bg-gradient-accent text-[#1a1410] font-bold shadow-[var(--shadow-md)]'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'}
                  ${planned ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <Icon size={16} />
                <span className="flex-1 truncate">{label}</span>
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full
                    ${active ? 'bg-[#1a1410]/30 text-[#1a1410]' : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'}`}>
                    {count}
                  </span>
                )}
                {planned && <span className="text-[9px] uppercase tracking-wide opacity-70">wkrótce</span>}
              </button>
            );
          })}
        </nav>
        <div className="p-2 border-t border-[var(--color-border)]">
          <button onClick={loadEmails}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] py-2 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Odśwież
          </button>
        </div>
      </aside>

      {/* PANEL 2: LIST */}
      <section className="border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg)] min-w-0">
        <div className="p-3 border-b border-[var(--color-border)] space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
              <Mail size={15} className="text-[var(--color-accent)]" />
              {FOLDERS.find(f => f.id === folder)?.label}
              <span className="text-xs text-[var(--color-text-muted)] font-normal">({currentList.length})</span>
            </h2>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Szukaj w temacie i nadawcy..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scroll">
          {loading ? (
            <div className="flex items-center justify-center h-32"><Spinner /></div>
          ) : error ? (
            <div className="p-4 text-red-400 text-xs text-center">
              <AlertCircle size={20} className="mx-auto mb-2" />
              {error}
              <button onClick={loadEmails} className="block mx-auto mt-2 text-[var(--color-accent)] hover:underline">Spróbuj ponownie</button>
            </div>
          ) : (folder === 'drafts' || folder === 'trash') ? (
            <div className="p-6 text-center text-[var(--color-text-muted)] text-xs">
              <FileText size={24} className="mx-auto mb-2 opacity-30" />
              Funkcja w przygotowaniu
            </div>
          ) : currentList.length === 0 ? (
            <div className="p-6 text-center text-[var(--color-text-muted)] text-xs">
              {search ? 'Brak wyników' : (folder === 'inbox' ? 'Skrzynka pusta ✉️' : 'Brak wysłanych ✉️')}
            </div>
          ) : (
            currentList.map(email => {
              const isActive = selected?.uid === email.uid;
              const displayName = extractDisplayName(email.from);
              return (
                <button key={email.uid} onClick={() => openEmail(email, folder === 'sent')}
                  className={`w-full text-left px-3 py-3 border-b border-[var(--color-border)] transition-colors flex gap-3 group
                    ${isActive ? 'bg-[var(--color-accent)]/10 border-l-4 border-l-[var(--color-accent)]'
                              : 'hover:bg-[var(--color-surface)]'}`}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: colorFromString(displayName) }}>
                    {initials(displayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className={`text-sm truncate flex items-center gap-1.5
                        ${(!email.is_read && folder === 'inbox') ? 'text-[var(--color-text)] font-bold' : 'text-[var(--color-text-muted)]'}`}>
                        {!email.is_read && folder === 'inbox' && (
                          <span className="w-1.5 h-1.5 bg-[var(--color-accent)] rounded-full flex-shrink-0" />
                        )}
                        {displayName}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">{fmtDate(email.date)}</span>
                    </div>
                    <div className={`text-xs truncate ${(!email.is_read && folder === 'inbox') ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
                      {email.subject || '(bez tematu)'}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* PANEL 3: PREVIEW */}
      <section className="flex flex-col overflow-hidden bg-[var(--color-bg)] min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-[var(--color-surface)] flex items-center justify-center">
                <Mail size={40} className="opacity-30" />
              </div>
              <p className="text-sm">Wybierz wiadomość</p>
              <p className="text-xs opacity-60 mt-1">lub kliknij <strong>Nowa wiadomość</strong></p>
            </div>
          </div>
        ) : (
          <>
            <header className="px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-[var(--color-text)] text-lg leading-tight truncate">
                    {selected.subject || '(bez tematu)'}
                  </h3>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                      style={{ background: colorFromString(extractDisplayName(selected.from)) }}>
                      {initials(extractDisplayName(selected.from))}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[var(--color-text)] font-semibold truncate">{extractDisplayName(selected.from)}</div>
                      <div className="text-[var(--color-text-muted)] text-[11px] truncate">{selected.from}</div>
                    </div>
                    <div className="ml-auto text-[var(--color-text-muted)] text-[11px] flex-shrink-0">{fmtDate(selected.date)}</div>
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {perm.has('email.reply') && (
                    <Button size="sm" variant="primary" onClick={() => openCompose(selected, body)}>
                      <Reply size={13} /> Odpowiedz
                    </Button>
                  )}
                  {perm.has('email.delete') && (
                    <button onClick={() => setDeleteConfirm(selected.uid)} title="Usuń"
                      className="p-2 rounded-[var(--radius-md)] text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </header>
            <div className="flex-1 overflow-hidden">
              {bodyLoading ? (
                <div className="flex items-center justify-center h-full"><Spinner /></div>
              ) : body !== null ? (
                <iframe
                  srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;padding:24px;color:#1f2937;background:#fff;margin:0}a{color:#2563eb}img{max-width:100%}blockquote{border-left:3px solid #cbd5e1;padding-left:12px;color:#64748b;margin:8px 0}</style></head><body>${body}</body></html>`}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-0"
                  title="email-body"
                />
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* COMPOSE MODAL */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => !sending && setCompose(null)}>
          <div className="glass-strong border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] w-full max-w-2xl flex flex-col"
            style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
              <span className="font-bold text-[var(--color-text)] flex items-center gap-2">
                <div className="w-8 h-8 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center">
                  <Pencil size={15} className="text-[#1a1410]" />
                </div>
                Nowa wiadomość
              </span>
              <button onClick={() => !sending && setCompose(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded-md transition-colors"
                disabled={sending}>
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 custom-scroll">
              <Input label="Do" type="email" value={compose.to}
                onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : c)}
                placeholder="odbiorca@email.com" />
              <Input label="Temat" type="text" value={compose.subject}
                onChange={e => setCompose(c => c ? { ...c, subject: e.target.value } : c)}
                placeholder="Temat wiadomości" />
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">Treść</label>
                <RichEditor
                  value={compose.bodyHtml}
                  onChange={html => setCompose(c => c ? { ...c, bodyHtml: html } : c)}
                  placeholder="Napisz treść wiadomości..."
                  minHeight={240}
                />
                <p className="text-[10px] text-[var(--color-text-muted)] opacity-60 mt-1.5">
                  Sygnatura z logo zostanie dodana automatycznie.
                </p>
              </div>
              {sendError && (
                <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{sendError}</span>
                </div>
              )}
            </div>

            <footer className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCompose(null)} disabled={sending}>
                Anuluj
              </Button>
              <Button variant="primary" onClick={sendEmail} loading={sending}>
                <Send size={14} /> Wyślij
              </Button>
            </footer>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => !deleting && setDeleteConfirm(null)}>
          <div className="glass-strong border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 size={26} className="text-red-400" />
              </div>
              <h3 className="text-base font-bold text-[var(--color-text)] mb-1">Usunąć wiadomość?</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-5">Tej operacji nie można cofnąć.</p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                  Anuluj
                </Button>
                <Button variant="danger" className="flex-1" onClick={confirmDelete} loading={deleting}>
                  Usuń
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
