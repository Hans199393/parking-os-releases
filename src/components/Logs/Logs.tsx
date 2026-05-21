/**
 * Logs — Iteracja 6.
 * Audyt zdarzeń + alerty bota + filtry + eksport + realtime + retencja.
 *
 * Visual gold: glass-strong, gradient-accent, hero-number, animate-slideUp.
 * Uprawnienia: logs.view (cały moduł), logs.export, logs.clear.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Activity, User, Camera, Bot, Settings2,
  RefreshCw, ChevronDown, AlertCircle,
  Search, Download, Trash2, Filter, Play, Pause, X,
  ShieldAlert, Mail, DollarSign, Calendar as CalIcon,
  Sparkles, Clock,
} from 'lucide-react';
import {
  getAdminLogs, getBotAlerts, deleteOldAdminLogs, subscribeAdminLogs,
  type AdminLog, type BotAlert,
} from '../../lib/supabase';
import { usePerm } from '../../lib/usePerm';
import { audit } from '../../lib/audit';
import { Spinner, Button, Modal } from '../shared/UI';

// ─── Konfiguracja kategorii ─────────────────────────────────────────────────

interface CatDef {
  id: AdminLog['category'];
  label: string;
  icon: React.ReactNode;
  badge: string;
}

const CATEGORIES: CatDef[] = [
  { id: 'session',     label: 'Sesje',       icon: <User size={13} />,        badge: 'bg-blue-900/40 text-blue-300 border-blue-700' },
  { id: 'reservation', label: 'Rezerwacje',  icon: <CalIcon size={13} />,     badge: 'bg-emerald-900/40 text-emerald-300 border-emerald-700' },
  { id: 'finance',     label: 'Finanse',     icon: <DollarSign size={13} />,  badge: 'bg-amber-900/40 text-amber-300 border-amber-700' },
  { id: 'user',        label: 'Konta',       icon: <ShieldAlert size={13} />, badge: 'bg-pink-900/40 text-pink-300 border-pink-700' },
  { id: 'mail',        label: 'E-mail',      icon: <Mail size={13} />,        badge: 'bg-indigo-900/40 text-indigo-300 border-indigo-700' },
  { id: 'action',      label: 'Akcje',       icon: <Settings2 size={13} />,   badge: 'bg-purple-900/40 text-purple-300 border-purple-700' },
  { id: 'camera',      label: 'Kamery',      icon: <Camera size={13} />,      badge: 'bg-teal-900/40 text-teal-300 border-teal-700' },
  { id: 'chat',        label: 'Czat',        icon: <Sparkles size={13} />,    badge: 'bg-violet-900/40 text-violet-300 border-violet-700' },
  { id: 'bot',         label: 'Bot',         icon: <Bot size={13} />,         badge: 'bg-red-900/40 text-red-300 border-red-700' },
  { id: 'system',      label: 'System',      icon: <AlertCircle size={13} />, badge: 'bg-yellow-900/40 text-yellow-300 border-yellow-700' },
];

const SEVERITIES: { id: 'info' | 'warning' | 'critical'; label: string; cls: string }[] = [
  { id: 'info',     label: 'Info',     cls: 'bg-slate-800 text-slate-300 border-slate-600' },
  { id: 'warning',  label: 'Warn',     cls: 'bg-orange-900/40 text-orange-300 border-orange-700' },
  { id: 'critical', label: 'Critical', cls: 'bg-red-900/50 text-red-300 border-red-700' },
];

const ALERT_LABELS: Record<string, string> = {
  groq_tpd_limit: 'TPD — dzienny limit tokenów',
  groq_rpm_limit: 'RPM — minutowy limit zapytań',
  groq_timeout:   'Timeout — brak odpowiedzi AI',
  groq_error:     'Błąd API AI',
};

const ACTION_ICONS: Record<string, string> = {
  login:                      '🔐',
  logout:                     '🚪',
  page_view:                  '📄',
  permission_denied:          '🔒',
  camera_online:              '🟢',
  camera_offline:             '🔴',
  reservation_created:        '➕',
  reservation_updated:        '✏️',
  reservation_deleted:        '🗑️',
  reservation_no_show_marked: '⚠️',
  reservation_restored:       '♻️',
  invoice_added:              '🧾',
  invoice_deleted:            '🗑️',
  revenue_saved:              '💰',
  mail_sent:                  '✉️',
  mail_deleted:               '🗑️',
  user_created:               '👤',
  user_deleted:               '👤',
  vehicle_banned:             '🚫',
  vehicle_unbanned:           '✅',
  settings_change:            '⚙️',
  orzel_turn:                 '🤖',
  orzel_tool:                 '🔧',
};

// ─── Helpery ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function catDef(cat: string): CatDef | undefined {
  return CATEGORIES.find(c => c.id === cat);
}

function severityRing(sev?: string | null): string {
  switch (sev) {
    case 'warning':  return 'ring-1 ring-orange-500/40';
    case 'critical': return 'ring-2 ring-red-500/60 shadow-md shadow-red-900/30';
    default:         return '';
  }
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Wiersz logu ────────────────────────────────────────────────────────────

function LogRow({ log, onClick }: { log: AdminLog; onClick: () => void }) {
  const def = catDef(log.category);
  const icon = ACTION_ICONS[log.action] ?? '•';
  const sev = log.severity ?? 'info';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left border rounded-[var(--radius-md)] px-4 py-2.5 mb-1.5 transition-all hover:scale-[1.005]
        ${def?.badge ?? 'bg-slate-800 text-slate-300 border-slate-600'} ${severityRing(sev)}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-base mt-0.5 flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold opacity-80">
              {fmtDate(log.created_at)}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border opacity-70 font-mono uppercase">
              {def?.label ?? log.category} · {log.action}
            </span>
            {sev !== 'info' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-black/30">
                {sev}
              </span>
            )}
            {log.user_email && (
              <span className="text-[11px] opacity-60 truncate max-w-[200px]">{log.user_email}</span>
            )}
          </div>
          <p className="text-sm mt-0.5 font-medium truncate">{log.description ?? log.action}</p>
        </div>
        <ChevronDown size={14} className="opacity-40 flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─── Modal szczegółów ───────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider opacity-60 mb-0.5">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function LogDetailsModal({ log, onClose }: { log: AdminLog; onClose: () => void }) {
  const def = catDef(log.category);
  const before = log.before;
  const after = log.after;
  const hasDiff = Boolean((before && Object.keys(before as object).length > 0) ||
                  (after && Object.keys(after as object).length > 0));
  return (
    <Modal open onClose={onClose} title="Szczegóły zdarzenia" maxWidth="max-w-3xl">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="Data">{fmtDate(log.created_at)}</Field>
          <Field label="Kategoria">{def?.label ?? log.category}</Field>
          <Field label="Akcja"><code className="text-[var(--color-accent)]">{log.action}</code></Field>
          <Field label="Severity">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
              log.severity === 'critical' ? 'bg-red-900/50 text-red-300' :
              log.severity === 'warning' ? 'bg-orange-900/50 text-orange-300' :
              'bg-slate-700 text-slate-300'
            }`}>{log.severity ?? 'info'}</span>
          </Field>
          <Field label="Użytkownik">{log.user_email ?? '—'}</Field>
          <Field label="Sesja"><code className="text-[10px] opacity-60">{log.session_id ?? '—'}</code></Field>
          {log.entity_type && (
            <Field label="Encja">{log.entity_type} · <code>{log.entity_id ?? ''}</code></Field>
          )}
        </div>

        {Boolean(log.description) && (
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">Opis</div>
            <p className="bg-[var(--color-surface)] rounded px-3 py-2">{String(log.description ?? '')}</p>
          </div>
        )}

        {hasDiff && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {before != null && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1">Przed</div>
                <pre className="text-xs font-mono whitespace-pre-wrap bg-red-950/30 border border-red-900/40 rounded p-2 overflow-x-auto max-h-72">{JSON.stringify(before, null, 2)}</pre>
              </div>
            )}
            {after != null && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1">Po</div>
                <pre className="text-xs font-mono whitespace-pre-wrap bg-emerald-950/30 border border-emerald-900/40 rounded p-2 overflow-x-auto max-h-72">{JSON.stringify(after, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {log.metadata && Object.keys(log.metadata).length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">Metadane</div>
            <pre className="text-xs font-mono whitespace-pre-wrap bg-black/30 rounded p-2 overflow-x-auto max-h-60">{JSON.stringify(log.metadata, null, 2)}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── KPI Tile ───────────────────────────────────────────────────────────────

function KpiTile({ label, value, accent, icon }: { label: string; value: number; accent?: 'red' | 'orange'; icon: React.ReactNode }) {
  const ring = accent === 'red' ? 'ring-2 ring-red-500/40'
             : accent === 'orange' ? 'ring-1 ring-orange-500/40'
             : '';
  return (
    <div className={`glass-strong rounded-[var(--radius-lg)] p-4 animate-slideUp ${ring}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">{label}</div>
        <div className="text-[var(--color-accent)] opacity-70">{icon}</div>
      </div>
      <div className="hero-number text-3xl font-bold">{value}</div>
    </div>
  );
}

// ─── Główny komponent ───────────────────────────────────────────────────────

export default function Logs() {
  const perm = usePerm();
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [botAlerts, setBotAlerts] = useState<BotAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selected, setSelected] = useState<AdminLog | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearDays, setClearDays] = useState(90);
  const [clearing, setClearing] = useState(false);

  // Filtry
  const [search, setSearch] = useState('');
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [activeSevs, setActiveSevs] = useState<Set<string>>(new Set());
  const [filterUser, setFilterUser] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [adminLogs, alerts] = await Promise.all([
      getAdminLogs(undefined, 1000),
      getBotAlerts(false),
    ]);
    setLogs(adminLogs);
    setBotAlerts(alerts);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!perm.has('logs.view')) return;
    void load();
    void audit('action', 'logs_viewed');
  }, [load, perm]);

  // Auto-refresh co 30s + realtime push
  useEffect(() => {
    if (!autoRefresh || !perm.has('logs.view')) return;
    const iv = setInterval(() => { void load(); }, 30_000);
    const unsub = subscribeAdminLogs(newLog => {
      setLogs(prev => [newLog, ...prev].slice(0, 1000));
      setLastRefresh(new Date());
    });
    return () => { clearInterval(iv); unsub(); };
  }, [autoRefresh, load, perm]);

  // ─── Filtrowanie + agregacja ──────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Infinity;
    const userQ = filterUser.trim().toLowerCase();
    return logs.filter(l => {
      if (activeCats.size > 0 && !activeCats.has(l.category)) return false;
      if (activeSevs.size > 0 && !activeSevs.has(l.severity ?? 'info')) return false;
      const ts = new Date(l.created_at).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (userQ && !(l.user_email ?? '').toLowerCase().includes(userQ)) return false;
      if (q) {
        const hay = `${l.action} ${l.description ?? ''} ${l.user_email ?? ''} ${l.entity_type ?? ''} ${l.entity_id ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, activeCats, activeSevs, filterUser, dateFrom, dateTo]);

  // KPI agregaty (na nieprzefiltrowanych — całość)
  const kpi = useMemo(() => {
    const now = Date.now();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const week = now - 7 * 86400_000;
    let dToday = 0, w7 = 0, crit7 = 0, denied7 = 0;
    for (const l of logs) {
      const ts = new Date(l.created_at).getTime();
      if (ts >= today0.getTime()) dToday++;
      if (ts >= week) {
        w7++;
        if (l.severity === 'critical') crit7++;
        if (l.action === 'permission_denied') denied7++;
      }
    }
    return { dToday, w7, crit7, denied7 };
  }, [logs]);

  // Block all if no view perm — render po hookach żeby nie naruszać reguł
  if (!perm.has('logs.view')) {
    return (
      <div className="h-full flex items-center justify-center text-center p-8">
        <div className="max-w-md">
          <ShieldAlert size={48} className="mx-auto text-red-400 mb-3 opacity-60" />
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-1">Brak uprawnień</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Twoje konto nie ma uprawnienia <code className="text-[var(--color-accent)]">logs.view</code>.
            Skontaktuj się z administratorem.
          </p>
        </div>
      </div>
    );
  }

  // ─── Akcje ────────────────────────────────────────────────────────────────

  const toggleCat = (id: string) => {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSev = (id: string) => {
    setActiveSevs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const resetFilters = () => {
    setSearch(''); setActiveCats(new Set()); setActiveSevs(new Set());
    setFilterUser(''); setDateFrom(''); setDateTo('');
  };

  const exportCsv = () => {
    if (!perm.guard('logs.export', 'eksport logów')) return;
    const headers = ['data', 'kategoria', 'akcja', 'severity', 'uzytkownik', 'opis', 'encja', 'id_encji', 'metadata'];
    const rows = filtered.map(l => [
      l.created_at, l.category, l.action, l.severity ?? 'info',
      l.user_email ?? '', l.description ?? '',
      l.entity_type ?? '', l.entity_id ?? '',
      l.metadata ? JSON.stringify(l.metadata) : '',
    ].map(csvEscape).join(','));
    const csv = '\ufeff' + [headers.join(','), ...rows].join('\n');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(csv, `logi_${stamp}.csv`, 'text/csv;charset=utf-8');
    void audit('action', 'logs_export', { metadata: { format: 'csv', count: filtered.length } });
  };

  const exportJson = () => {
    if (!perm.guard('logs.export', 'eksport logów')) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(JSON.stringify(filtered, null, 2), `logi_${stamp}.json`, 'application/json');
    void audit('action', 'logs_export', { metadata: { format: 'json', count: filtered.length } });
  };

  const handleClear = async () => {
    if (!perm.guard('logs.clear', 'czyszczenie starych logów')) { setConfirmClear(false); return; }
    if (clearDays < 7) return;
    setClearing(true);
    const removed = await deleteOldAdminLogs(clearDays);
    setClearing(false);
    setConfirmClear(false);
    void audit('system', 'logs_cleared', { severity: 'warning', metadata: { older_than_days: clearDays, removed } });
    await load();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const unresolvedAlerts = botAlerts.filter(a => !a.resolved);
  const filtersActive = activeCats.size > 0 || activeSevs.size > 0 || !!search || !!filterUser || !!dateFrom || !!dateTo;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* HEADER */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <Activity size={20} className="text-[var(--color-accent)]" />
              Logi systemowe
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 flex items-center gap-2">
              <Clock size={11} />
              Aktualizacja: {lastRefresh.toLocaleTimeString('pl-PL')}
              {autoRefresh && <span className="text-emerald-400">· auto co 30s + realtime</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              title={autoRefresh ? 'Wstrzymaj auto-refresh' : 'Włącz auto-refresh'}
              className={`p-2 rounded-[var(--radius-md)] transition-colors ${autoRefresh ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'}`}
            >
              {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <Button variant="secondary" size="sm" onClick={load} loading={loading}>
              <RefreshCw size={13} /> Odśwież
            </Button>
            {perm.has('logs.export') && (
              <>
                <Button variant="secondary" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
                  <Download size={13} /> CSV
                </Button>
                <Button variant="secondary" size="sm" onClick={exportJson} disabled={filtered.length === 0}>
                  <Download size={13} /> JSON
                </Button>
              </>
            )}
            {perm.has('logs.clear') && (
              <Button variant="danger" size="sm" onClick={() => setConfirmClear(true)}>
                <Trash2 size={13} /> Wyczyść stare
              </Button>
            )}
          </div>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <KpiTile label="Dziś" value={kpi.dToday} icon={<Activity size={14} />} />
          <KpiTile label="Ostatnie 7 dni" value={kpi.w7} icon={<CalIcon size={14} />} />
          <KpiTile label="Krytyczne (7d)" value={kpi.crit7} icon={<AlertCircle size={14} />} accent={kpi.crit7 > 0 ? 'red' : undefined} />
          <KpiTile label="Brak uprawnień (7d)" value={kpi.denied7} icon={<ShieldAlert size={14} />} accent={kpi.denied7 > 0 ? 'orange' : undefined} />
        </div>

        {/* Filtry */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Szukaj w opisie, akcji, encji..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <input
              type="text" value={filterUser} onChange={e => setFilterUser(e.target.value)}
              placeholder="user@email"
              className="w-44 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-xs text-[var(--color-text-muted)]">–</span>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            {filtersActive && (
              <button onClick={resetFilters} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] flex items-center gap-1">
                <X size={12} /> Wyczyść filtry
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <Filter size={11} className="text-[var(--color-text-muted)]" />
            {CATEGORIES.map(c => {
              const active = activeCats.has(c.id);
              return (
                <button key={c.id} onClick={() => toggleCat(c.id)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 transition-all
                    ${active ? c.badge + ' ring-2 ring-[var(--color-accent)]/40' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}>
                  {c.icon} {c.label}
                </button>
              );
            })}
            <span className="mx-1 text-[10px] text-[var(--color-text-muted)]">|</span>
            {SEVERITIES.map(s => {
              const active = activeSevs.has(s.id);
              return (
                <button key={s.id} onClick={() => toggleSev(s.id)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border uppercase font-bold tracking-wider transition-all
                    ${active ? s.cls + ' ring-2 ring-[var(--color-accent)]/40' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto px-6 py-4 custom-scroll">
        {/* Alerty bota — pin na górze */}
        {unresolvedAlerts.length > 0 && (
          <div className="mb-4">
            <h2 className="text-[10px] uppercase tracking-wider text-red-400 font-bold mb-2 flex items-center gap-2">
              <Bot size={12} /> Aktywne alerty bota ({unresolvedAlerts.length})
            </h2>
            <div className="space-y-1.5">
              {unresolvedAlerts.map(a => (
                <div key={a.id} className="flex items-start gap-3 border rounded-[var(--radius-md)] px-4 py-2.5 bg-red-900/30 border-red-700 text-red-200">
                  <span className="text-base flex-shrink-0">🚨</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold opacity-80">{fmtDateShort(a.created_at)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-700 font-mono opacity-70">
                        {ALERT_LABELS[a.type] ?? a.type}
                      </span>
                      <span className="text-[10px] text-red-400 font-bold">AKTYWNY</span>
                    </div>
                    <p className="text-sm mt-0.5">{a.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-32"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-text-muted)]">
            <Activity size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{filtersActive ? 'Brak wpisów spełniających filtry' : 'Brak logów'}</p>
            {filtersActive && (
              <button onClick={resetFilters} className="text-xs text-[var(--color-accent)] hover:underline mt-2">Wyczyść filtry</button>
            )}
          </div>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2">
              {filtered.length} {filtered.length === 1 ? 'wpis' : 'wpisów'}
              {filtered.length !== logs.length && <span className="text-[var(--color-accent)]"> z {logs.length}</span>}
            </p>
            {filtered.map(log => (
              <LogRow key={log.id} log={log} onClick={() => setSelected(log)} />
            ))}
          </>
        )}
      </div>

      {/* Modal szczegółów */}
      {selected && <LogDetailsModal log={selected} onClose={() => setSelected(null)} />}

      {/* Modal czyszczenia */}
      {confirmClear && (
        <Modal open onClose={() => !clearing && setConfirmClear(false)} title="Wyczyść stare logi" maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text)]">
              Usunie wszystkie logi <strong>starsze niż X dni</strong>. Operacji <strong className="text-red-400">nie można cofnąć</strong>.
            </p>
            <label className="block">
              <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Starsze niż (dni, min. 7)</span>
              <input
                type="number" min={7} max={3650} value={clearDays}
                onChange={e => setClearDays(Math.max(7, parseInt(e.target.value) || 7))}
                className="mt-1 w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmClear(false)} disabled={clearing}>Anuluj</Button>
              <Button variant="danger" className="flex-1" onClick={handleClear} loading={clearing}>
                <Trash2 size={13} /> Usuń
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
