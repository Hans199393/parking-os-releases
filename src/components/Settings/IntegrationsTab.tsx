/**
 * IntegrationsTab — Supabase, IMAP/SMTP, Panel WWW, Messenger PSID.
 * Visual: glass-strong, gradient-accent na ikonach.
 *
 * UWAGA: Pozycja `Messenger PSID` (authorized_psids) i `Panel WWW` przejęte
 * z dawnego AdminPanel — będzie to przeniesione w pełni w iteracji 10.
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Database, Mail, Server, MessageCircle, Wifi, WifiOff, Eye, EyeOff, FileSignature, Bot, Lock } from 'lucide-react';
import { Button } from '../shared/UI';
import { resetSupabaseClient } from '../../lib/supabase';
import RichEditor from '../Email/RichEditor';
import { usePerm } from '../../lib/usePerm';
import {
  QUICK_ACTION_TOOLS,
  parseQuickActions,
  serializeQuickActions,
  type QuickActionBlock,
} from '../../lib/orzelQuickActions';

interface Props {
  values: Record<string, string>;
  set: (key: string, val: string) => void;
}

const DEFAULT_SIGNATURE_HTML = `<p style="margin:0"><strong>Michał Kłos</strong> | Parking płatny niestrzeżony</p>
<p style="margin:4px 0 0"><a href="mailto:kontakt@parkingsobieszewo.pl">kontakt@parkingsobieszewo.pl</a> · tel. <a href="tel:+48784828748">784 828 748</a></p>
<p style="margin:2px 0 0;color:#9ca3af;font-size:12px">ul. Turystyczna 69, Wyspa Sobieszewska, Gdańsk</p>`;

// Pobiera pierwszy <img> z HTML (z atrybutami) lub null.
function extractFirstImg(html: string): string | null {
  const m = html.match(/<img\b[^>]*>/i);
  return m ? m[0] : null;
}

// Buduje sygnaturę 2-kolumnową (logo po lewej, tekst po prawej) jako tabela —
// najpewniejszy układ dla klientów poczty (Gmail, Outlook, Apple Mail).
function buildSideBySideSignature(currentHtml: string): string {
  const img = extractFirstImg(currentHtml);
  // Wymuśmy szerokość logo + display:block, żeby Outlook nie dodawał odstępów.
  const logoCell = img
    ? img
        .replace(/\s(width|height)="[^"]*"/gi, '')
        .replace(/\sstyle="[^"]*"/i, '')
        .replace(/<img\b/i, '<img width="110" style="display:block;width:110px;height:auto;border:0"')
    : '<div style="width:110px;height:110px;background:#f3f4f6;border-radius:8px"></div>';

  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif">
  <tr>
    <td style="padding-right:16px;vertical-align:middle;width:110px">${logoCell}</td>
    <td style="vertical-align:middle;font-size:14px;line-height:1.5;color:#374151">
      <div style="margin:0"><strong>Michał Kłos</strong> | Parking płatny niestrzeżony</div>
      <div style="margin:4px 0 0"><a href="mailto:kontakt@parkingsobieszewo.pl" style="color:#2563eb;text-decoration:none">kontakt@parkingsobieszewo.pl</a> · tel. <a href="tel:+48784828748" style="color:#2563eb;text-decoration:none">784 828 748</a></div>
      <div style="margin:2px 0 0;color:#9ca3af;font-size:12px">ul. Turystyczna 69, Wyspa Sobieszewska, Gdańsk</div>
    </td>
  </tr>
</table>`;
}

function Field({ label, value, onChange, placeholder, type = 'text', mono = false, hint, disabled = false, masked = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; mono?: boolean; hint?: string;
  disabled?: boolean; masked?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  const showMaskedValue = masked && isPassword;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">{label}</label>
      <div className="relative">
        <input
          type={showMaskedValue ? 'text' : (isPassword && !reveal ? 'password' : 'text')}
          value={showMaskedValue ? '••••••••••••' : value}
          onChange={e => { if (!disabled && !showMaskedValue) onChange(e.target.value); }} placeholder={placeholder}
          disabled={disabled || showMaskedValue}
          className={`w-full px-3.5 py-2.5 ${(isPassword && !showMaskedValue) ? 'pr-10' : ''} rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-70 disabled:cursor-not-allowed ${mono ? 'font-mono' : ''}`}
        />
        {isPassword && !showMaskedValue && (
          <button type="button" onClick={() => setReveal(r => !r)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {hint && <p className="text-[10px] text-[var(--color-text-muted)] opacity-60">{hint}</p>}
    </div>
  );
}

// Lista narzędzi dostępnych jako quick-action w Orle.
// Synchronizowana ręcznie z TOOLS w lib/orzelAssistant.ts (read-only tools).
const QUICK_ACTION_TOOL_LIST = Object.values(QUICK_ACTION_TOOLS);

/**
 * Edytor bloków szybkich akcji — każdy blok ma:
 *  - własną etykietę (operator nadaje, jak w promptach)
 *  - wybraną funkcję z dropdownu
 * Zapisywane jako JSON tablicy w kluczu `orzel_quick_actions`.
 */
function QuickActionsEditor({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const blocks = parseQuickActions(value);

  const update = (next: QuickActionBlock[]) => {
    if (disabled) return;
    onChange(serializeQuickActions(next));
  };

  const setBlockLabel = (idx: number, label: string) => {
    const next = blocks.slice();
    next[idx] = { ...next[idx], label: label.slice(0, 40) };
    update(next);
  };
  const setBlockTool = (idx: number, tool: string) => {
    const next = blocks.slice();
    // Jeśli etykieta to nadal default starego toola — zaktualizuj na default nowego.
    const oldDef = QUICK_ACTION_TOOLS[next[idx].tool];
    const newDef = QUICK_ACTION_TOOLS[tool];
    const label = (oldDef && next[idx].label === oldDef.defaultLabel && newDef) ? newDef.defaultLabel : next[idx].label;
    next[idx] = { label, tool };
    update(next);
  };
  const removeBlock = (idx: number) => {
    const next = blocks.filter((_, i) => i !== idx);
    update(next);
  };
  const moveBlock = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    update(next);
  };
  const addBlock = () => {
    // Domyślnie dodaj pierwszy tool którego jeszcze nie ma na liście, albo find_reservation.
    const usedTools = new Set(blocks.map(b => b.tool));
    const candidate = QUICK_ACTION_TOOL_LIST.find(t => !usedTools.has(t.name)) ?? QUICK_ACTION_TOOL_LIST[0];
    update([...blocks, { label: candidate.defaultLabel, tool: candidate.name }]);
  };

  return (
    <div className="space-y-2">
      {blocks.length === 0 && (
        <div className="text-[11px] text-[var(--color-text-muted)] italic px-2 py-3 border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)] text-center">
          Brak bloków. Kliknij „+ Dodaj blok" poniżej.
        </div>
      )}
      {blocks.map((b, idx) => {
        const def = QUICK_ACTION_TOOLS[b.tool];
        return (
          <div key={idx} className="flex items-stretch gap-2 p-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex flex-col gap-1 flex-shrink-0">
              <button type="button" onClick={() => moveBlock(idx, -1)} disabled={disabled || idx === 0}
                className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-surface-2)] hover:bg-[var(--color-bg)] disabled:opacity-30">▲</button>
              <button type="button" onClick={() => moveBlock(idx, 1)} disabled={disabled || idx === blocks.length - 1}
                className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-surface-2)] hover:bg-[var(--color-bg)] disabled:opacity-30">▼</button>
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
              <div className="flex flex-col gap-1 min-w-0">
                <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Etykieta przycisku</label>
                <input type="text" value={b.label} maxLength={40} disabled={disabled}
                  onChange={e => setBlockLabel(idx, e.target.value)}
                  placeholder="np. Sprawdź obłożenie"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)]" />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Funkcja (tool)</label>
                <select value={b.tool} disabled={disabled}
                  onChange={e => setBlockTool(idx, e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)]">
                  {QUICK_ACTION_TOOL_LIST.map(t => (
                    <option key={t.name} value={t.name}>{t.defaultLabel} — {t.name}</option>
                  ))}
                </select>
                {def && (
                  <div className="text-[9px] text-[var(--color-text-muted)] opacity-70 leading-snug">{def.description}</div>
                )}
              </div>
            </div>
            <button type="button" onClick={() => removeBlock(idx)} disabled={disabled}
              className="flex-shrink-0 px-2 py-1 text-[10px] rounded bg-red-900/20 hover:bg-red-900/40 text-red-300 self-center"
              title="Usuń ten blok">✕</button>
          </div>
        );
      })}
      <button type="button" onClick={addBlock} disabled={disabled}
        className="w-full px-3 py-2 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50">
        + Dodaj blok
      </button>
      <p className="text-[10px] text-[var(--color-text-muted)] opacity-60 mt-1">
        Dostępne narzędzia ({QUICK_ACTION_TOOL_LIST.length}): {QUICK_ACTION_TOOL_LIST.map(t => t.name).join(', ')}
      </p>
    </div>
  );
}

export default function IntegrationsTab({ values, set }: Props) {
  const perm = usePerm();
  const canEdit = perm.has('settings.edit_integrations');
  const setG = (k: string, v: string) => {
    if (!perm.guard('settings.edit_integrations', 'edycja integracji')) return;
    set(k, v);
  };
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testingMail, setTestingMail] = useState(false);
  const [mailResult, setMailResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const handleTestSupabase = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const c = createClient(values.supabase_url ?? '', values.supabase_key ?? '');
      const { error } = await c.from('settings').select('key').limit(1);
      setTestResult(error ? { ok: false, error: error.message } : { ok: true });
      if (!error) resetSupabaseClient();
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTesting(false);
  };

  const handleTestImap = async () => {
    setTestingMail(true); setMailResult(null);
    try {
      await invoke('email_test_imap', {
        imapHost: values.email_imap_host ?? '',
        imapPort: parseInt(values.email_imap_port ?? '993', 10) || 993,
        user: values.email_user ?? '',
        pass: values.email_pass ?? '',
      });
      setMailResult({ ok: true });
    } catch (e) {
      setMailResult({ ok: false, error: String(e) });
    }
    setTestingMail(false);
  };

  // Messenger PSID — CSV w jednym kluczu
  const psids = (values.authorized_psids ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const setPsids = (arr: string[]) => setG('authorized_psids', arr.join(','));
  const [newPsid, setNewPsid] = useState('');

  return <>
    {!canEdit && (
      <div className="glass-strong rounded-[var(--radius-lg)] p-4 mb-5 flex items-center gap-3 border-2 border-[var(--color-warning)]/40 animate-slideUp">
        <Lock size={20} className="text-[var(--color-warning)] flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">Tryb tylko do odczytu</p>
          <p className="text-xs text-[var(--color-text-muted)]">Brak uprawnienia <code>settings.edit_integrations</code> — sekrety są ukryte, a zmiany nie zostaną zapisane.</p>
        </div>
      </div>
    )}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* SUPABASE */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp" style={{ animationDelay: '50ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <Database size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Supabase (baza danych)</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Wspólna z botem Messenger i stroną WWW</p>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="URL projektu" value={values.supabase_url ?? ''} onChange={v => setG('supabase_url', v)}
            placeholder="https://xxx.supabase.co" mono />
          <Field label="Service Key (anon lub service_role)" type="password" value={values.supabase_key ?? ''}
            onChange={v => setG('supabase_key', v)} placeholder="eyJ..." mono disabled={!canEdit} masked={!canEdit}
            hint="service_role omija RLS — używaj tylko gdy aplikacja działa lokalnie" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTestSupabase} loading={testing}>
            {testResult?.ok ? <Wifi size={14} /> : <WifiOff size={14} />} Testuj połączenie
          </Button>
          {testResult && (
            <span className={`text-sm font-bold ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.ok ? '✓ OK' : `✕ ${testResult.error}`}
            </span>
          )}
        </div>
      </div>

      {/* POCZTA */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <Mail size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Poczta e-mail</h3>
            <p className="text-xs text-[var(--color-text-muted)]">IMAP do odbioru, SMTP do wysyłki</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="IMAP serwer" value={values.email_imap_host ?? ''} onChange={v => setG('email_imap_host', v)} placeholder="poczta.ohv.pl" mono />
            </div>
            <Field label="Port" value={values.email_imap_port ?? ''} onChange={v => setG('email_imap_port', v)} placeholder="993" mono />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="SMTP serwer" value={values.email_smtp_host ?? ''} onChange={v => setG('email_smtp_host', v)} placeholder="poczta.ohv.pl" mono />
            </div>
            <Field label="Port" value={values.email_smtp_port ?? ''} onChange={v => setG('email_smtp_port', v)} placeholder="465" mono />
          </div>
          <Field label="Login (adres e-mail)" value={values.email_user ?? ''} onChange={v => setG('email_user', v)}
            placeholder="kontakt@parkingsobieszewo.pl" mono />
          <Field label="Hasło" type="password" value={values.email_pass ?? ''} onChange={v => setG('email_pass', v)} disabled={!canEdit} masked={!canEdit} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTestImap} loading={testingMail}>
            {mailResult?.ok ? <Wifi size={14} /> : <WifiOff size={14} />} Testuj IMAP
          </Button>
          {mailResult && (
            <span className={`text-sm font-bold ${mailResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {mailResult.ok ? '✓ OK' : `✕ ${mailResult.error}`}
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] opacity-60 mt-3">
          Domyślnie: IMAP 993 SSL, SMTP 465 SSL.
        </p>
      </div>

      {/* SYGNATURA E-MAIL */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp lg:col-span-2" style={{ animationDelay: '125ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <FileSignature size={22} className="text-[#1a1410]" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-[var(--color-text)]">Sygnatura e-mail (HTML)</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Doklejana automatycznie do każdej wysyłanej wiadomości · po prawej podgląd jak zobaczy odbiorca</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Edytor */}
          <div>
            <RichEditor
              value={values.email_signature_html ?? ''}
              onChange={html => setG('email_signature_html', html)}
              placeholder="Pozdrawiam, Michał Kłos — Parking..."
              minHeight={220}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm"
                onClick={() => setG('email_signature_html', DEFAULT_SIGNATURE_HTML)}>
                Domyślna sygnatura
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => setG('email_signature_html', buildSideBySideSignature(values.email_signature_html ?? ''))}
                title="Logo po lewej + 3 linijki tekstu po prawej (układ tabelaryczny dla klientów poczty)">
                🖼 Logo po lewej
              </Button>
              <Button variant="ghost" size="sm"
                onClick={() => setG('email_signature_html', '')}>
                Wyczyść
              </Button>
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] opacity-70 mt-3 space-y-1 leading-relaxed">
              <p><strong>Logo / obrazek:</strong> użyj ikony 🖼 w pasku — wgra plik do 512 KB jako data URI (działa w każdym kliencie poczty, też Gmail i Outlook). Shift+klik = wstaw przez URL (publiczny https://).</p>
              <p><strong>Telefon klikalny:</strong> zaznacz numer, kliknij 🔗, wpisz <code className="px-1 rounded bg-[var(--color-surface-2)]">tel:+48784828748</code>.</p>
              <p><strong>E-mail klikalny:</strong> zaznacz adres, kliknij 🔗, wpisz <code className="px-1 rounded bg-[var(--color-surface-2)]">mailto:kontakt@parkingsobieszewo.pl</code>.</p>
            </div>
          </div>
          {/* Podgląd */}
          <div className="flex flex-col">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Podgląd (jak zobaczy odbiorca)</div>
            <div className="rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-white overflow-hidden flex-1 min-h-[300px]">
              <iframe
                title="Podgląd sygnatury"
                className="w-full h-full min-h-[300px] block"
                style={{ border: 0 }}
                srcDoc={`<!DOCTYPE html><html><body style="margin:0;padding:18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;background:#ffffff;max-width:600px">
                  <p style="margin:0 0 14px;color:#6b7280;font-style:italic">Witam, dziękuję za wiadomość. Pozdrawiam serdecznie.</p>
                  <div style="margin-top:18px;padding-top:14px;border-top:2px solid #e2e8f0">${values.email_signature_html || '<em style="color:#9ca3af">— sygnatura pusta —</em>'}</div>
                </body></html>`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* PANEL WWW */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp" style={{ animationDelay: '150ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <Server size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Panel WWW (Vercel)</h3>
            <p className="text-xs text-[var(--color-text-muted)]">CMS strony i bridge do bota Messenger</p>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="URL panelu" value={values.admin_url ?? ''} onChange={v => setG('admin_url', v)}
            placeholder="https://twoja-domena.pl/zaplecze-mk" mono />
          <Field label="ADMIN_TOKEN (Bearer — z env Vercel)" type="password" value={values.admin_token ?? ''}
            onChange={v => setG('admin_token', v)} placeholder="długi sekret" mono disabled={!canEdit} masked={!canEdit}
            hint="Token z env ADMIN_TOKEN w panelu Vercel" />
        </div>
      </div>

      {/* AI ASYSTENT (Orzeł) */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp" style={{ animationDelay: '175ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <Bot size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">AI Asystent (Orzeł)</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Ollama (lokalny, RODO-safe) lub inny endpoint OpenAI-compatible do czatu z function calling</p>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Endpoint API (OpenAI-compatible)" value={values.orzel_api_base_url ?? 'http://localhost:11434/v1/chat/completions'} onChange={v => setG('orzel_api_base_url', v)}
            placeholder="http://localhost:11434/v1/chat/completions" mono
            hint="Ollama (lokalne): http://localhost:11434/v1/chat/completions. Groq (chmura): https://api.groq.com/openai/v1/chat/completions. OpenRouter: https://openrouter.ai/api/v1/chat/completions" />
          <Field label="API Key (opcjonalny — Ollama nie wymaga)" type="password" value={values.groq_api_key ?? ''} onChange={v => setG('groq_api_key', v)} disabled={!canEdit} masked={!canEdit}
            placeholder="puste = Ollama bez klucza  /  gsk_... = Groq" mono
            hint="Ollama lokalne: zostaw puste. Groq: https://console.groq.com/keys. OpenRouter: sk-or-..." />
          <Field label="Model" value={values.groq_model ?? 'llama3.1:8b'} onChange={v => setG('groq_model', v)}
            placeholder="llama3.1:8b" mono
            hint="Ollama (zalecane RTX 3050): llama3.1:8b, qwen2.5:7b, mistral:7b. Groq: llama-3.3-70b-versatile. OpenRouter: meta-llama/llama-3.3-70b-instruct" />
          <Field label="Temperatura (0.0–1.0)" value={values.orzel_temperature ?? '0.3'} onChange={v => setG('orzel_temperature', v)}
            placeholder="0.3" mono
            hint="Niższa = bardziej deterministyczne odpowiedzi (zalecane 0.2–0.4)" />
          <div className="flex items-center gap-3 mt-2">
            <input id="orzel_expanded_mode" type="checkbox" className="w-4 h-4" disabled={!canEdit}
              checked={values.orzel_expanded_mode === 'true'}
              onChange={e => setG('orzel_expanded_mode', e.target.checked ? 'true' : 'false')} />
            <label htmlFor="orzel_expanded_mode" className="text-sm text-[var(--color-text)]">Rozszerzony tryb (desktop only) — pozwala na swobodne zapytania</label>
          </div>

          {/* Quick actions — konfigurowalne przyciski w nagłówku panelu Orła */}
          <div className="mt-4">
            <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] block mb-2">
              Szybkie akcje (przyciski w nagłówku Orła)
            </label>
            <p className="text-[10px] text-[var(--color-text-muted)] opacity-70 mb-2">
              Każdy blok = jeden przycisk. Nadaj własną <strong>etykietę</strong> i wybierz <strong>funkcję</strong> z listy.
              Klik na przycisk → modal z polem wartości → uruchomienie funkcji bez wywołania LLM (oszczędność tokenów).
            </p>
            <QuickActionsEditor
              value={values.orzel_quick_actions ?? ''}
              onChange={v => setG('orzel_quick_actions', v)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] opacity-70 mt-3 leading-relaxed">
          Orzeł umie: <strong>list_reservations</strong>, <strong>find_reservation</strong>, <strong>check_capacity</strong>, <strong>list_banned_vehicles</strong>, <strong>get_parking_info</strong>, <strong>get_finance_summary</strong>, <strong>get_week_overview</strong>, <strong>get_reservation_stats</strong> i więcej (22 tools).
          Akcje mutujące (ban, anuluj, no-show, status): wymagają potwierdzenia operatora.
          Każde wywołanie jest logowane do audytu. Dane nie opuszczają sieci lokalnej (Ollama).
        </p>
      </div>

      {/* MESSENGER PSID */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
            <MessageCircle size={22} className="text-[#1a1410]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">Administratorzy Messenger (PSID)</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Otrzymują codzienny raport o 7:59 i mogą używać komend bota</p>
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          <input type="text" value={newPsid} onChange={e => setNewPsid(e.target.value)}
            placeholder="np. 23456789012345"
            className="flex-1 px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm font-mono transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]" />
          <Button size="sm" variant="primary"
            onClick={() => {
              const v = newPsid.trim();
              if (!v || psids.includes(v)) return;
              setPsids([...psids, v]);
              setNewPsid('');
            }}
            disabled={!newPsid.trim() || psids.includes(newPsid.trim())}>+ Dodaj</Button>
        </div>
        <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
          {psids.length === 0 && <span className="text-xs text-[var(--color-text-muted)] opacity-60 italic py-2">brak autoryzowanych PSID</span>}
          {psids.map(p => (
            <span key={p}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-sm)] animate-fadeIn">
              {p}
              <button onClick={() => setPsids(psids.filter(x => x !== p))}
                className="ml-0.5 w-4 h-4 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
                aria-label={`Usuń ${p}`}>×</button>
            </span>
          ))}
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] opacity-70 mt-3 space-y-1">
          <p><strong>PSID</strong> = ID konta Messenger. Znajdziesz w logach bota lub przez komendę <code className="px-1 rounded bg-[var(--color-surface-2)]">!myid</code> wysłaną do bota.</p>
          <p><strong>Co dostają adminowie:</strong></p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            <li>📅 <strong>7:59 codziennie</strong> — automatyczny raport rezerwacji na dziś</li>
            <li>🔍 <code className="px-1 rounded bg-[var(--color-surface-2)]">?tablica WX12345 [DD.MM.YYYY]</code> — sprawdza rezerwację i ban</li>
            <li>📋 <code className="px-1 rounded bg-[var(--color-surface-2)]">?rezerwacje [DD.MM.YYYY]</code> — lista rezerwacji na dany dzień (bez daty = dziś)</li>
          </ul>
        </div>
      </div>
    </div>
  </>;
}
