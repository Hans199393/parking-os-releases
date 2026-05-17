/**
 * ConnectionStatusBar — stały pasek statusu na górze Ustawień.
 *
 * Pokazuje na żywo: Supabase / IMAP / Detektor / 4 kamery.
 * Klikalne kafelki przerzucają na właściwą zakładkę.
 *
 * Sondowanie:
 *   - Supabase: lekkie SELECT 1 z `settings`
 *   - IMAP: invoke('email_test_imap') — może być wolny, więc co 60s, nie więcej
 *   - Detector: HEAD na localhost:8890/health
 *   - Kamery: HEAD na URL snapshotu (jeśli skonfigurowane)
 *
 * Wszystkie probe wracają w ≤2s (timeout); jeśli zwlekają, pokazujemy „…".
 */

import { useEffect, useState, useCallback } from 'react';
import { Database, Mail, Cpu, Camera, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { CAM_DEFAULTS, type SettingsTabId } from './settingsTypes';

type Status = 'ok' | 'fail' | 'unknown' | 'loading' | 'na';

interface Probe {
  id: string;
  label: string;
  status: Status;
  detail?: string;
  tab: SettingsTabId;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface Props {
  values: Record<string, string>;
  onJump: (tab: SettingsTabId) => void;
}

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS  = 2_500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { window.clearTimeout(t); resolve(v); })
     .catch(e => { window.clearTimeout(t); reject(e); });
  });
}

export default function ConnectionStatusBar({ values, onJump }: Props) {
  const [probes, setProbes] = useState<Probe[]>(() => buildSkeleton(values));
  const [refreshing, setRefreshing] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runProbes = useCallback(async () => {
    setRefreshing(true);
    const next: Probe[] = buildSkeleton(values).map(p => ({ ...p, status: 'loading' }));
    setProbes(next);

    // ── Supabase ─────────────────────────────────────────────
    const supaIdx = next.findIndex(p => p.id === 'supabase');
    if (values.supabase_url && values.supabase_key) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const c = createClient(values.supabase_url, values.supabase_key);
        await withTimeout(
          Promise.resolve(c.from('settings').select('key').limit(1)).then(r => {
            if (r.error) throw new Error(r.error.message);
            return r;
          }),
          PROBE_TIMEOUT_MS,
        );
        next[supaIdx] = { ...next[supaIdx], status: 'ok' };
      } catch (e) {
        next[supaIdx] = {
          ...next[supaIdx],
          status: 'fail',
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      next[supaIdx] = { ...next[supaIdx], status: 'na', detail: 'brak konfiguracji' };
    }

    // ── IMAP ─────────────────────────────────────────────────
    const mailIdx = next.findIndex(p => p.id === 'mail');
    if (values.email_imap_host && values.email_user && values.email_pass) {
      try {
        await withTimeout(
          invoke('email_test_imap', {
            imapHost: values.email_imap_host,
            imapPort: parseInt(values.email_imap_port ?? '993', 10) || 993,
            user: values.email_user,
            pass: values.email_pass,
          }) as Promise<unknown>,
          PROBE_TIMEOUT_MS * 2, // IMAP wolniejszy
        );
        next[mailIdx] = { ...next[mailIdx], status: 'ok' };
      } catch (e) {
        next[mailIdx] = {
          ...next[mailIdx],
          status: 'fail',
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      next[mailIdx] = { ...next[mailIdx], status: 'na', detail: 'brak konfiguracji' };
    }

    // ── Detektor ─────────────────────────────────────────────
    const detIdx = next.findIndex(p => p.id === 'detector');
    try {
      const r = await withTimeout(
        fetch('http://127.0.0.1:8890/health').then(r => r.ok),
        PROBE_TIMEOUT_MS,
      );
      next[detIdx] = { ...next[detIdx], status: r ? 'ok' : 'fail' };
    } catch {
      next[detIdx] = { ...next[detIdx], status: 'fail', detail: 'offline' };
    }

    // ── Kamery (snapshot URL HEAD) ───────────────────────────
    for (const cam of CAM_DEFAULTS) {
      const url = values[`${cam.id}_snapshot_url`];
      const idx = next.findIndex(p => p.id === cam.id);
      if (!url) {
        next[idx] = { ...next[idx], status: 'na', detail: 'brak URL' };
        continue;
      }
      try {
        const ok = await withTimeout(
          fetch(url, { method: 'HEAD', mode: 'no-cors' as RequestMode })
            .then(() => true)
            .catch(() => false),
          PROBE_TIMEOUT_MS,
        );
        next[idx] = { ...next[idx], status: ok ? 'ok' : 'fail' };
      } catch {
        next[idx] = { ...next[idx], status: 'fail' };
      }
    }

    setProbes([...next]);
    setLastRun(new Date());
    setRefreshing(false);
  }, [values]);

  useEffect(() => {
    void runProbes();
    const t = window.setInterval(runProbes, PROBE_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [runProbes]);

  return (
    <div className="glass-strong rounded-[var(--radius-lg)] p-3 mb-5 animate-fadeIn">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Stan połączeń
          </span>
          {lastRun && (
            <span className="text-[10px] text-[var(--color-text-muted)] opacity-50">
              · ostatnio {lastRun.toLocaleTimeString('pl-PL')}
            </span>
          )}
        </div>
        <button
          onClick={runProbes}
          disabled={refreshing}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
          title="Odśwież"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {probes.map(p => (
          <ProbeChip key={p.id} probe={p} onClick={() => onJump(p.tab)} />
        ))}
      </div>
    </div>
  );
}

function buildSkeleton(values: Record<string, string>): Probe[] {
  return [
    { id: 'supabase', label: 'Supabase', status: 'unknown', tab: 'integrations', Icon: Database },
    { id: 'mail',     label: 'Poczta',   status: 'unknown', tab: 'integrations', Icon: Mail },
    { id: 'detector', label: 'Detektor', status: 'unknown', tab: 'devices',      Icon: Cpu },
    ...CAM_DEFAULTS.map(c => ({
      id: c.id,
      label: (values[`${c.id}_name`] || c.defaultName).split(' ').slice(0, 2).join(' '),
      status: 'unknown' as Status,
      tab: 'devices' as SettingsTabId,
      Icon: Camera,
    })),
  ];
}

function ProbeChip({ probe, onClick }: { probe: Probe; onClick: () => void }) {
  const { status, label, detail, Icon } = probe;
  const cls =
    status === 'ok'      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    : status === 'fail'  ? 'bg-red-500/15 text-red-300 border-red-500/40'
    : status === 'loading' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 animate-pulse'
    : status === 'na'    ? 'bg-slate-500/10 text-slate-400 border-slate-500/30'
    :                      'bg-slate-500/10 text-slate-400 border-slate-500/30';
  const dot =
    status === 'ok'      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
    : status === 'fail'  ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.7)]'
    : status === 'loading' ? 'bg-amber-400 animate-pulse'
    :                      'bg-slate-500';
  return (
    <button
      onClick={onClick}
      title={detail ?? label}
      className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all hover:scale-105 ${cls}`}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <Icon size={13} />
      <span>{label}</span>
    </button>
  );
}
