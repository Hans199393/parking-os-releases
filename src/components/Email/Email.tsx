import { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, Send, Trash2, Reply, Pencil, X, AlertCircle, SendHorizonal } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getStore } from '../../lib/store';
import { Spinner } from '../shared/UI';

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
}

interface Compose {
  to: string;
  subject: string;
  body: string;
}

const SIG_SEPARATOR = '\n\n---\n';
const REPLY_SIGNATURE = `${SIG_SEPARATOR}Michał Kłos | Parking płatny niestrzeżony\nkontakt@parkingsobieszewo.pl | tel. 784 828 748`;

const HTML_SIGNATURE = `
<table style="border-top:2px solid #e2e8f0;padding-top:14px;margin-top:18px;border-collapse:collapse">
  <tr>
    <td style="padding-right:16px;vertical-align:middle">
      <img src="cid:logo@parking" width="88" height="88" alt="Logo" style="display:block">
    </td>
    <td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#374151;line-height:1.6">
      <strong style="font-size:15px;color:#1a2d4a">Micha&#322; K&#322;os</strong><br>
      Parking p&#322;atny niestrze&#380;ony<br>
      <a href="mailto:kontakt@parkingsobieszewo.pl" style="color:#4dbfbf;text-decoration:none">kontakt@parkingsobieszewo.pl</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;tel. <a href="tel:+48784828748" style="color:#4dbfbf;text-decoration:none">784&nbsp;828&nbsp;748</a><br>
      <span style="font-size:11px;color:#9ca3af">ul. Turystyczna 69, Wyspa Sobieszewska, Gda&#324;sk</span>
    </td>
  </tr>
</table>`;

function buildHtmlEmail(body: string): string {
  const sepIdx = body.indexOf(SIG_SEPARATOR);
  const userText = sepIdx >= 0 ? body.slice(0, sepIdx) : body;
  const escaped = userText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;max-width:600px">${escaped}${HTML_SIGNATURE}</body></html>`;
}

export default function Email() {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [configMissing, setConfigMissing] = useState(false);
  const [folder, setFolder] = useState<'inbox' | 'sent'>('inbox');
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

  const loadConfig = useCallback(async (): Promise<EmailConfig | null> => {
    const store = await getStore();
    const imap_host = (await store.get<string>('email_imap_host')) ?? '';
    const imap_port = parseInt((await store.get<string>('email_imap_port')) ?? '993') || 993;
    const smtp_host = (await store.get<string>('email_smtp_host')) ?? '';
    const smtp_port = parseInt((await store.get<string>('email_smtp_port')) ?? '465') || 465;
    const user = (await store.get<string>('email_user')) ?? '';
    const pass = (await store.get<string>('email_pass')) ?? '';
    if (!imap_host || !user || !pass) return null;
    return { imap_host, imap_port, smtp_host, smtp_port, user, pass };
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
          imapHost: cfg.imap_host,
          imapPort: cfg.imap_port,
          user: cfg.user,
          pass: cfg.pass,
        }),
        invoke<EmailMessage[]>('email_fetch_sent', {
          imapHost: cfg.imap_host,
          imapPort: cfg.imap_port,
          user: cfg.user,
          pass: cfg.pass,
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

  // Auto-refresh inbox every 90 seconds
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
      // For sent folder, fetch body without marking as read
      const html = await invoke<string>('email_fetch_body', {
        imapHost: cfg.imap_host,
        imapPort: cfg.imap_port,
        user: cfg.user,
        pass: cfg.pass,
        uid: email.uid,
      });
      setBody(html);
      if (!isSent) setEmails(prev => prev.map(e => e.uid === email.uid ? { ...e, is_read: true } : e));
    } catch (e) {
      setBody(`<p style="color:red">Błąd ładowania: ${String(e)}</p>`);
    } finally {
      setBodyLoading(false);
    }
  };

  const openCompose = (replyTo?: EmailMessage) => {
    if (replyTo) {
      const replyTo_addr = replyTo.from.match(/<(.+)>/)?.[1] ?? replyTo.from.trim();
      setCompose({
        to: replyTo_addr,
        subject: replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`,
        body: REPLY_SIGNATURE,
      });
    } else {
      setCompose({ to: '', subject: '', body: REPLY_SIGNATURE });
    }
    setSendError('');
  };

  const sendEmail = async () => {
    if (!compose || !config) return;
    if (!compose.to.trim()) { setSendError('Wpisz adres odbiorcy.'); return; }
    if (!compose.subject.trim()) { setSendError('Wpisz temat.'); return; }
    setSending(true);
    setSendError('');
    try {
      await invoke('email_send', {
        imapHost: config.imap_host,
        imapPort: config.imap_port,
        smtpHost: config.smtp_host || config.imap_host,
        smtpPort: config.smtp_port,
        user: config.user,
        pass: config.pass,
        to: compose.to.trim(),
        subject: compose.subject.trim(),
        body: buildHtmlEmail(compose.body),
      });
      setCompose(null);
      // Refresh sent folder in background
      invoke<EmailMessage[]>('email_fetch_sent', {
        imapHost: config.imap_host,
        imapPort: config.imap_port,
        user: config.user,
        pass: config.pass,
      }).then(setSentEmails).catch(() => {});
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteConfirm === null || !config) return;
    setDeleting(true);
    try {
      await invoke('email_delete', {
        imapHost: config.imap_host,
        imapPort: config.imap_port,
        user: config.user,
        pass: config.pass,
        uid: deleteConfirm,
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
      return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return raw.slice(0, 16); }
  };

  const extractDisplayName = (from: string) => {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : from.replace(/<.+>/, '').trim() || from;
  };

  // ─── Screens ───────────────────────────────────────────────────────────────

  if (configMissing) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-sm">
          <AlertCircle size={40} className="text-amber-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">Brak konfiguracji poczty</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Przejdź do <strong>Ustawienia → Poczta e-mail</strong> i uzupełnij dane serwera IMAP, SMTP, login i hasło.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Email list panel ── */}
      <div className="w-80 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg)]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-bold text-[var(--color-text)] flex items-center gap-2">
            <Mail size={17} /> Poczta
            {emails.filter(e => !e.is_read).length > 0 && (
              <span className="bg-teal-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {emails.filter(e => !e.is_read).length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1.5">
            <button onClick={() => openCompose()} title="Nowa wiadomość" className="p-1.5 rounded-md text-amber-400 hover:bg-amber-400/10 transition">
              <Pencil size={15} />
            </button>
            <button onClick={loadEmails} title="Odśwież" className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] transition">
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {/* Folder tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            onClick={() => { setFolder('inbox'); setSelected(null); setBody(null); }}
            className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition ${folder === 'inbox' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
          >
            <Mail size={13} /> Odebrane
          </button>
          <button
            onClick={() => { setFolder('sent'); setSelected(null); setBody(null); }}
            className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition ${folder === 'sent' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
          >
            <SendHorizonal size={13} /> Wysłane
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><Spinner /></div>
          ) : error ? (
            <div className="p-4 text-red-400 text-sm text-center">
              <AlertCircle size={20} className="mx-auto mb-2" />
              {error}
              <button onClick={loadEmails} className="block mx-auto mt-2 text-xs text-teal-400 hover:underline">Spróbuj ponownie</button>
            </div>
          ) : (folder === 'inbox' ? emails : sentEmails).length === 0 ? (
            <div className="p-6 text-center text-[var(--color-muted)] text-sm">{folder === 'inbox' ? 'Skrzynka pusta ✉️' : 'Brak wysłanych ✉️'}</div>
          ) : (
            (folder === 'inbox' ? emails : sentEmails).map(email => (
              <button
                key={email.uid}
                onClick={() => openEmail(email, folder === 'sent')}
                className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition ${selected?.uid === email.uid ? 'bg-[var(--color-surface)]' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 mb-0.5">
                  <span className={`text-sm truncate flex items-center gap-1.5 ${email.is_read || folder === 'sent' ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)] font-semibold'}`}>
                    {!email.is_read && folder === 'inbox' && <span className="w-2 h-2 bg-teal-400 rounded-full flex-shrink-0" />}
                    {extractDisplayName(email.from)}
                  </span>
                  <span className="text-[10px] text-[var(--color-muted)] flex-shrink-0">{fmtDate(email.date)}</span>
                </div>
                <div className={`text-xs truncate ${email.is_read ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]'}`}>
                  {email.subject || '(bez tematu)'}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Message view ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)]">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-muted)]">
            <div className="text-center">
              <Mail size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Wybierz wiadomość</p>
            </div>
          </div>
        ) : (
          <>
            {/* Message header */}
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-bold text-[var(--color-text)] text-base truncate">{selected.subject || '(bez tematu)'}</h3>
                  <div className="text-xs text-[var(--color-muted)] mt-1">
                    <span className="font-medium">Od:</span> {selected.from}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    <span className="font-medium">Data:</span> {fmtDate(selected.date)}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => openCompose(selected)}
                    title="Odpowiedz"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 text-xs font-medium transition"
                  >
                    <Reply size={14} /> Odpowiedz
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(selected.uid)}
                    title="Usuń"
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-400/10 transition"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Message body */}
            <div className="flex-1 overflow-hidden">
              {bodyLoading ? (
                <div className="flex items-center justify-center h-full"><Spinner /></div>
              ) : body !== null ? (
                <iframe
                  srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;padding:24px;color:#1e293b;margin:0}a{color:#0ea5e9}img{max-width:100%}</style></head><body>${body}</body></html>`}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-0"
                  title="email-body"
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* ── Compose modal ── */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCompose(null)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
              <span className="font-bold text-[var(--color-text)] flex items-center gap-2">
                <Pencil size={16} className="text-amber-400" /> Nowa wiadomość
              </span>
              <button onClick={() => setCompose(null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Do</label>
                <input
                  type="email"
                  value={compose.to}
                  onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : c)}
                  placeholder="odbiorca@email.com"
                  className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Temat</label>
                <input
                  type="text"
                  value={compose.subject}
                  onChange={e => setCompose(c => c ? { ...c, subject: e.target.value } : c)}
                  placeholder="Temat wiadomości"
                  className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Treść</label>
                <textarea
                  value={compose.body}
                  onChange={e => setCompose(c => c ? { ...c, body: e.target.value } : c)}
                  rows={10}
                  className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-teal-500 resize-none font-mono"
                />
              </div>
              {sendError && <p className="text-xs text-red-400">{sendError}</p>}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
              <button onClick={() => setCompose(null)} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] transition">
                Anuluj
              </button>
              <button onClick={sendEmail} disabled={sending} className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-teal-500 hover:bg-teal-600 disabled:bg-slate-600 text-white font-semibold transition">
                <Send size={14} /> {sending ? 'Wysyłanie...' : 'Wyślij'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ── */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text)] mb-2">Usunąć wiadomość?</h3>
            <p className="text-sm text-[var(--color-muted)] mb-4">Wiadomość zostanie trwale usunięta ze skrzynki.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] transition">
                Anuluj
              </button>
              <button onClick={confirmDelete} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white transition">
                {deleting ? 'Usuwanie...' : 'Tak, usuń'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
