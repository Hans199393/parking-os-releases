/**
 * AssistantsTab — Iter 10.
 * Zarządzanie promptami 3 asystentów AI (Messenger / Widget WWW / Asystent admin).
 * Źródło prawdy: Supabase `assistant_prompt_config` (singleton row id=1).
 * Fallback: `DEFAULT_PROMPT_CONFIG` z `lib/promptDefaults.ts`.
 *
 * Funkcje:
 * - Wybór profilu (3 sub-zakładki).
 * - Włącz/wyłącz profil + edycja etykiety.
 * - Lista bloków treści w kolejności + przyciski przesuwania ↑↓.
 * - Lista meta-reguł z checkbox-ami (per profil) — przy okazji edytor: dodaj / usuń / edytuj.
 * - Pole "Extra" (dopisek operatora wstrzykiwany na końcu promptu).
 * - Podgląd zbudowanego promptu (na żywo).
 * - Zapis do Supabase z auditem (kategoria 'system').
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, MessageCircle, Globe, Bot, Save, RotateCcw, Eye, Plus, Trash2, ChevronUp, ChevronDown, Check, AlertTriangle, Lock, Variable, Search } from 'lucide-react';
import { Button } from '../shared/UI';
import type { AppUser } from '../../lib/session';
import { usePerm } from '../../lib/usePerm';
import {
  DEFAULT_PROMPT_CONFIG,
  type PromptConfig,
  type ProfileId,
  type MetaRule,
  type PromptBlock,
} from '../../lib/promptDefaults';
import { buildPrompt, validateConfig } from '../../lib/promptBuilder';
import { getAssistantPromptConfig, saveAssistantPromptConfig, getConfigs } from '../../lib/supabase';
import { invalidateAssistantPromptCache } from '../../lib/orzelAssistant';
import { audit } from '../../lib/audit';
import PromptTextarea from './PromptTextarea';
import {
  PLACEHOLDERS,
  PLACEHOLDER_MAP,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type PlaceholderCategory,
  type PlaceholderMeta,
} from '../../lib/placeholderRegistry';

interface Props {
  user?: AppUser | null;
}

const PROFILE_META: { id: ProfileId; label: string; sub: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'messenger', label: 'Messenger', sub: 'Bot Facebook (chat)', Icon: MessageCircle },
  { id: 'widget',    label: 'Widget WWW', sub: 'Czat na stronie',     Icon: Globe },
  { id: 'assistant', label: 'Asystent admin', sub: 'Pomocnik operatora', Icon: Bot },
];

// Deep clone bezpieczny dla naszego JSON-config (bez funkcji, bez Date)
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export default function AssistantsTab({ user }: Props) {
  const perm = usePerm();
  const canEdit = perm.has('settings.edit_integrations');
  const [config, setConfig] = useState<PromptConfig>(() => clone(DEFAULT_PROMPT_CONFIG));
  const [originalConfig, setOriginalConfig] = useState<PromptConfig>(() => clone(DEFAULT_PROMPT_CONFIG));
  const [profileId, setProfileId] = useState<ProfileId>('messenger');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmtErr(e: unknown): string {
    if (!e) return 'Nieznany błąd';
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    if (typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const parts: string[] = [];
      if (o.message) parts.push(String(o.message));
      if (o.code) parts.push(`[${o.code}]`);
      if (o.details) parts.push(String(o.details));
      if (o.hint) parts.push(`hint: ${o.hint}`);
      if (parts.length) return parts.join(' ');
      try { return JSON.stringify(e); } catch { return '[object Object]'; }
    }
    return String(e);
  }
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(true);
  const [showVarsPanel, setShowVarsPanel] = useState(true);
  const [previewMode, setPreviewMode] = useState<'raw' | 'resolved'>('resolved');
  const [varsQuery, setVarsQuery] = useState('');

  // Load config + placeholders
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, s] = await Promise.all([
          getAssistantPromptConfig().catch(() => null),
          getConfigs([
            'rate_basic', 'rate_reservation', 'currency',
            'open_from', 'open_to', 'owner_phone', 'owner_email',
            'parking_name', 'parking_address',
          ]).catch(() => ({} as Record<string, string>)),
        ]);
        if (cancelled) return;
        const effective = cfg ?? clone(DEFAULT_PROMPT_CONFIG);
        setConfig(effective);
        setOriginalConfig(clone(effective));
        setSettings(s);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) {
          setError(fmtErr(e));
          setLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const profile = config.profiles[profileId];
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(originalConfig), [config, originalConfig]);
  const issues = useMemo(() => validateConfig(config), [config]);

  const preview = useMemo(() => {
    try {
      // Iter 13: scal settings + custom_vars (custom nadpisuj\u0105 settings)
      const merged: Record<string, string> = { ...settings };
      for (const cv of config.custom_vars ?? []) {
        if (cv.key && cv.value) merged[cv.key] = cv.value;
      }
      return buildPrompt(config, profileId, merged, profileId === 'assistant'
        ? { today_iso: new Date().toISOString().slice(0, 10) }
        : {});
    } catch (e) {
      return `Błąd builderu: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [config, profileId, settings]);

  // Wersja "surowa" — złożony prompt PRZED zamianą placéholderów (do toggle).
  const previewRaw = useMemo(() => {
    try {
      // buildPrompt zawsze podstawia — więc składamy ręcznie składniki z config
      const profile = config.profiles[profileId];
      const parts: string[] = [];
      for (const blockId of profile.block_order) {
        const block = config.blocks[blockId];
        if (block) parts.push(block.body.trim());
      }
      if (profile.meta_rule_ids.length > 0) {
        const numbered = profile.meta_rule_ids
          .map((rid, idx) => {
            const r = config.meta_rules.find(x => x.id === rid);
            return r ? `${idx + 1}. ${r.title}\n${r.body.trim()}` : null;
          })
          .filter((x): x is string => x !== null);
        if (numbered.length > 0) parts.push(`META-REGUŁY — NADRZĘDNE ZASADY (stosuj ZAWSZE):\n\n${numbered.join('\n\n')}`);
      }
      if (profile.extra && profile.extra.trim()) parts.push(profile.extra.trim());
      return parts.join('\n\n');
    } catch (e) {
      return `Błąd builderu: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [config, profileId]);

  // Resolved values dla suggester (settings + custom_vars + dynamic)
  const resolvedValues = useMemo(() => {
    const out: Record<string, string> = { ...settings };
    for (const cv of config.custom_vars ?? []) {
      if (cv.key && cv.value) out[cv.key] = cv.value;
    }
    out.today_iso = new Date().toISOString().slice(0, 10);
    return out;
  }, [settings, config.custom_vars]);

  const updateProfile = (updater: (p: PromptConfig['profiles'][ProfileId]) => void) => {
    setConfig(prev => {
      const next = clone(prev);
      updater(next.profiles[profileId]);
      return next;
    });
  };

  const moveBlock = (blockId: string, dir: -1 | 1) => updateProfile(p => {
    const idx = p.block_order.indexOf(blockId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= p.block_order.length) return;
    [p.block_order[idx], p.block_order[target]] = [p.block_order[target], p.block_order[idx]];
  });

  const removeBlockFromProfile = (blockId: string) => updateProfile(p => {
    p.block_order = p.block_order.filter(id => id !== blockId);
  });

  const addBlockToProfile = (blockId: string) => updateProfile(p => {
    if (!p.block_order.includes(blockId)) p.block_order.push(blockId);
  });

  const toggleRuleInProfile = (ruleId: string) => updateProfile(p => {
    if (p.meta_rule_ids.includes(ruleId)) {
      p.meta_rule_ids = p.meta_rule_ids.filter(id => id !== ruleId);
    } else {
      p.meta_rule_ids.push(ruleId);
    }
  });

  const addNewRule = () => {
    const id = `mr_custom_${Date.now()}`;
    setConfig(prev => {
      const next = clone(prev);
      next.meta_rules.push({ id, title: 'Nowa reguła', body: 'Treść reguły...' });
      return next;
    });
  };

  // Iter 13: dodaj nowy własny blok i automatycznie wstaw go do bieżącego profilu
  const addNewBlock = () => {
    const id = `block_custom_${Date.now()}`;
    setConfig(prev => {
      const next = clone(prev);
      next.blocks[id] = {
        id,
        title: 'Nowy blok',
        body: 'Treść bloku — możesz używać {{placeholderów}}…',
        kind: 'knowledge',
      };
      // dodaj do bieżącego profilu
      if (!next.profiles[profileId].block_order.includes(id)) {
        next.profiles[profileId].block_order.push(id);
      }
      return next;
    });
  };

  // Usuwa blok globalnie (z config.blocks i ze wszystkich profili)
  const removeBlockGlobally = (blockId: string) => {
    if (!confirm('Usunąć blok z całego systemu? (zniknie ze wszystkich profili)')) return;
    setConfig(prev => {
      const next = clone(prev);
      delete next.blocks[blockId];
      for (const pid of Object.keys(next.profiles) as ProfileId[]) {
        next.profiles[pid].block_order = next.profiles[pid].block_order.filter(id => id !== blockId);
      }
      return next;
    });
  };

  // Iter 13: CRUD dla custom_vars (własne zmienne {{key}})
  const addCustomVar = () => {
    setConfig(prev => {
      const next = clone(prev);
      if (!next.custom_vars) next.custom_vars = [];
      // wygeneruj unikalny klucz typu var_1, var_2…
      let n = next.custom_vars.length + 1;
      let key = `var_${n}`;
      while (next.custom_vars.some(v => v.key === key)) { n++; key = `var_${n}`; }
      next.custom_vars.push({ key, label: 'Nowa zmienna', value: '' });
      return next;
    });
  };

  const updateCustomVar = (idx: number, patch: Partial<{ key: string; label: string; value: string }>) => {
    setConfig(prev => {
      const next = clone(prev);
      if (!next.custom_vars || !next.custom_vars[idx]) return prev;
      // jeśli zmieniamy klucz — sanitizuj (a-z, 0-9, _)
      if (patch.key != null) {
        patch.key = patch.key.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
      }
      Object.assign(next.custom_vars[idx], patch);
      return next;
    });
  };

  const removeCustomVar = (idx: number) => {
    setConfig(prev => {
      const next = clone(prev);
      if (!next.custom_vars) return prev;
      next.custom_vars.splice(idx, 1);
      return next;
    });
  };

  const removeRule = (ruleId: string) => {
    if (!confirm('Usunąć regułę z całego systemu? (zostanie też odhaczona z każdego profilu)')) return;
    setConfig(prev => {
      const next = clone(prev);
      next.meta_rules = next.meta_rules.filter(r => r.id !== ruleId);
      for (const pid of Object.keys(next.profiles) as ProfileId[]) {
        next.profiles[pid].meta_rule_ids = next.profiles[pid].meta_rule_ids.filter(id => id !== ruleId);
      }
      return next;
    });
  };

  const updateRule = (ruleId: string, patch: Partial<MetaRule>) => {
    setConfig(prev => {
      const next = clone(prev);
      const r = next.meta_rules.find(x => x.id === ruleId);
      if (r) Object.assign(r, patch);
      return next;
    });
  };

  const updateBlock = (blockId: string, patch: Partial<PromptBlock>) => {
    setConfig(prev => {
      const next = clone(prev);
      const b = next.blocks[blockId];
      if (b) Object.assign(b, patch);
      return next;
    });
  };

  const handleResetToDefaults = () => {
    if (!confirm('Przywrócić wartości domyślne (tylko ten profil)? Edycje bloków/reguł poza tym profilem zostaną zachowane.')) return;
    setConfig(prev => {
      const next = clone(prev);
      next.profiles[profileId] = clone(DEFAULT_PROMPT_CONFIG.profiles[profileId]);
      return next;
    });
  };

  const handleSave = async () => {
    if (!user?.id) {
      setError('Brak zalogowanego użytkownika.');
      return;
    }
    if (!perm.guard('settings.edit_integrations', 'edycja promptów asystenta')) return;
    if (issues.length > 0) {
      if (!confirm(`Konfiguracja ma ${issues.length} ostrzeżeń. Zapisać mimo to?`)) return;
    }
    setSaving(true);
    setError(null);
    try {
      const before = clone(originalConfig);
      await saveAssistantPromptConfig(config, user.id);
      // Iter 12-pre: zrób unieaktualnienie cache promptu w orzelAssistant,
      // żeby kolejna rozmowa odczytała nową wersję.
      invalidateAssistantPromptCache();
      void audit('system', 'assistant_prompt_updated', {
        description: `Zaktualizowano prompty asystentów AI`,
        metadata: { profile_active: profileId, rules_count: config.meta_rules.length, blocks_count: Object.keys(config.blocks).length },
        before,
        after: config,
      });
      setOriginalConfig(clone(config));
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
    } catch (e) {
      console.error('[AssistantsTab] save error:', e);
      setError(fmtErr(e));
    }
    setSaving(false);
  };

  if (!loaded) {
    return <div className="flex items-center justify-center py-16">
      <div className="w-10 h-10 rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
    </div>;
  }

  const allBlockIds = Object.keys(config.blocks);
  const blocksNotInProfile = allBlockIds.filter(id => !profile.block_order.includes(id));

  return (
    <div className="space-y-5">
      {!canEdit && (
        <div className="glass-strong rounded-[var(--radius-lg)] p-4 flex items-center gap-3 border-2 border-[var(--color-warning)]/40 animate-slideUp">
          <Lock size={20} className="text-[var(--color-warning)] flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-[var(--color-text)]">Tryb tylko do odczytu</p>
            <p className="text-xs text-[var(--color-text-muted)]">Brak uprawnienia <code>settings.edit_integrations</code> — zapis będzie zablokowany.</p>
          </div>
        </div>
      )}
      {/* HEADER + ACTIONS */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center flex-shrink-0 shadow-[var(--shadow-md)]">
            <Sparkles size={22} className="text-[#1a1410]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[var(--color-text)]">Asystenci AI — prompty</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Zarządzaj treścią systemowych promptów dla 3 wariantów asystenta. Zmiany trafiają do bazy i są
              używane przez bota Messengera (parking_botaimess) oraz lokalnego asystenta operatora.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="ghost" onClick={handleResetToDefaults} title="Przywróć domyślne dla tego profilu">
              <RotateCcw size={14} /> Domyślne
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Zapisywanie…' : <><Save size={14} /> Zapisz</>}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {savedAt && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
            <Check size={14} /> Zapisano. Bot zacznie używać nowych promptów w ciągu ~60 s (TTL cache).
          </div>
        )}
        {issues.length > 0 && (
          <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            <strong>Ostrzeżenia ({issues.length}):</strong>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              {issues.slice(0, 5).map((i, idx) => <li key={idx}>{i}</li>)}
              {issues.length > 5 && <li>…i {issues.length - 5} więcej</li>}
            </ul>
          </div>
        )}
      </div>

      {/* PROFILE TABS */}
      <div className="grid grid-cols-3 gap-2">
        {PROFILE_META.map(({ id, label, sub, Icon }) => {
          const active = profileId === id;
          const enabled = config.profiles[id].enabled;
          return (
            <button key={id} onClick={() => setProfileId(id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)] text-left transition-all
                ${active ? 'bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-md)]' : 'glass-strong hover:translate-y-[-1px]'}`}>
              <div className={`w-9 h-9 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0
                ${active ? 'bg-[#1a1410]/20' : 'bg-[var(--color-surface-2)]'}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm flex items-center gap-2">
                  {label}
                  {!enabled && <span className={`text-[9px] px-1.5 py-0.5 rounded font-normal ${active ? 'bg-[#1a1410]/20' : 'bg-red-500/20 text-red-300'}`}>OFF</span>}
                </div>
                <div className={`text-[10px] truncate ${active ? 'text-[#1a1410]/70' : 'text-[var(--color-text-muted)]'}`}>{sub}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5">
        {/* LEWA KOLUMNA — edytor profilu */}
        <div className="space-y-5 min-w-0">
          {/* Profil — meta */}
          <div className="glass-strong rounded-[var(--radius-lg)] p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">Profil</h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={profile.enabled}
                  onChange={e => updateProfile(p => { p.enabled = e.target.checked; })}
                  className="w-4 h-4 accent-[var(--color-accent)]" />
                <span>Profil aktywny</span>
              </label>
              <input value={profile.label}
                onChange={e => updateProfile(p => { p.label = e.target.value; })}
                placeholder="Etykieta profilu"
                className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] border-2 border-[var(--color-border)] bg-transparent text-sm focus:outline-none focus:border-[var(--color-accent)]" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">Extra (dopisek na końcu promptu)</label>
              <PromptTextarea
                value={profile.extra ?? ''}
                onChange={v => updateProfile(p => { p.extra = v; })}
                rows={3}
                placeholder="Opcjonalny dodatek wstrzykiwany po blokach i meta-regułach…"
                resolvedValues={resolvedValues}
                customVars={config.custom_vars ?? []}
                className="mt-1"
              />
            </div>
          </div>

          {/* Bloki treści w profilu */}
          <div className="glass-strong rounded-[var(--radius-lg)] p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
                Bloki treści ({profile.block_order.length})
              </h3>
              <div className="flex items-center gap-2">
                {blocksNotInProfile.length > 0 && (
                  <select onChange={e => { if (e.target.value) { addBlockToProfile(e.target.value); e.target.value = ''; } }}
                    className="text-xs px-2 py-1 rounded border-2 border-[var(--color-border)] bg-transparent">
                    <option value="">+ z istniejących…</option>
                    {blocksNotInProfile.map(id => <option key={id} value={id}>{config.blocks[id]?.title || id}</option>)}
                  </select>
                )}
                <Button variant="ghost" onClick={addNewBlock}><Plus size={12} /> Nowy blok</Button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
              {profile.block_order.map((blockId, idx) => {
                const b = config.blocks[blockId];
                if (!b) return (
                  <div key={blockId} className="px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center justify-between">
                    <span>⚠ Brakujący blok: <code>{blockId}</code></span>
                    <button onClick={() => removeBlockFromProfile(blockId)} className="text-red-300 hover:text-red-200"><Trash2 size={12} /></button>
                  </div>
                );
                return (
                  <BlockRow
                    key={blockId}
                    block={b}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < profile.block_order.length - 1}
                    onMoveUp={() => moveBlock(blockId, -1)}
                    onMoveDown={() => moveBlock(blockId, 1)}
                    onRemove={() => removeBlockFromProfile(blockId)}
                    onRemoveGlobal={() => removeBlockGlobally(blockId)}
                    onUpdate={patch => updateBlock(blockId, patch)}
                    resolvedValues={resolvedValues}
                    customVars={config.custom_vars ?? []}
                  />
                );
              })}
            </div>
          </div>

          {/* Iter 13: Zmienne własne (custom placeholders) */}
          <div className="glass-strong rounded-[var(--radius-lg)] p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] flex items-center gap-1.5">
                  <Variable size={12} /> Zmienne własne ({(config.custom_vars ?? []).length})
                </h3>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                  Dodaj własne <code className="text-amber-400">{'{{key}}'}</code> używane w blokach i regułach.
                </p>
              </div>
              <Button variant="ghost" onClick={addCustomVar}><Plus size={12} /> Nowa zmienna</Button>
            </div>
            {(config.custom_vars ?? []).length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] italic px-2 py-3 text-center">
                Brak zmiennych. Kliknij „Nowa zmienna" aby dodać np. <code className="text-amber-400">{'{{sezon_letni}}'}</code>.
              </p>
            ) : (
              <div className="space-y-2">
                {(config.custom_vars ?? []).map((cv, idx) => {
                  const conflict = !!PLACEHOLDER_MAP[cv.key]; // koliduje z wbudowanym?
                  const dupKey = (config.custom_vars ?? []).filter(x => x.key === cv.key).length > 1;
                  return (
                    <div key={idx} className={`rounded border-2 ${conflict || dupKey ? 'border-red-500/40' : 'border-[var(--color-border)]'} bg-[var(--color-surface-2)]/40 p-2 space-y-1.5`}>
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 text-xs font-mono">{'{{'}</span>
                        <input
                          value={cv.key}
                          onChange={e => updateCustomVar(idx, { key: e.target.value })}
                          placeholder="klucz"
                          className="flex-1 px-2 py-1 text-xs font-mono rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)]"
                        />
                        <span className="text-amber-400 text-xs font-mono">{'}}'}</span>
                        <input
                          value={cv.label}
                          onChange={e => updateCustomVar(idx, { label: e.target.value })}
                          placeholder="opis (etykieta)"
                          className="flex-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)]"
                        />
                        <button onClick={() => removeCustomVar(idx)} className="p-1 rounded hover:bg-red-500/20 text-red-400" title="Usuń"><Trash2 size={12} /></button>
                      </div>
                      <textarea
                        value={cv.value}
                        onChange={e => updateCustomVar(idx, { value: e.target.value })}
                        placeholder="wartość (możesz użyć kilku linii)"
                        rows={Math.min(6, Math.max(1, cv.value.split('\n').length))}
                        className="w-full px-2 py-1 text-[11px] rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)]"
                      />
                      {conflict && (
                        <p className="text-[10px] text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} /> Klucz <code>{cv.key}</code> koliduje z wbudowaną zmienną — Twoja wartość nadpisze wbudowaną.
                        </p>
                      )}
                      {dupKey && (
                        <p className="text-[10px] text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} /> Duplikat klucza — zmień nazwę.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Meta-reguły — checkbox-y per profil + edytor globalny */}
          <div className="glass-strong rounded-[var(--radius-lg)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
                Meta-reguły ({config.meta_rules.length}) · w profilu: {profile.meta_rule_ids.length}
              </h3>
              <Button variant="ghost" onClick={addNewRule}><Plus size={12} /> Dodaj regułę</Button>
            </div>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {config.meta_rules.map(rule => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  enabled={profile.meta_rule_ids.includes(rule.id)}
                  onToggle={() => toggleRuleInProfile(rule.id)}
                  onUpdate={patch => updateRule(rule.id, patch)}
                  onRemove={() => removeRule(rule.id)}
                  resolvedValues={resolvedValues}
                  customVars={config.custom_vars ?? []}
                />
              ))}
              {config.meta_rules.length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)] italic px-2 py-3">Brak reguł. Dodaj nową przyciskiem powyżej.</p>
              )}
            </div>
          </div>
        </div>

        {/* PRAWA KOLUMNA — panel zmiennych + podgląd */}
        <div className="xl:sticky xl:top-4 xl:self-start min-w-0 space-y-4">
          {/* PANEL "DOSTĘPNE ZMIENNE" */}
          <VariablesPanel
            open={showVarsPanel}
            onToggle={() => setShowVarsPanel(s => !s)}
            query={varsQuery}
            onQueryChange={setVarsQuery}
            resolvedValues={resolvedValues}
            customVars={config.custom_vars ?? []}
          />

          {/* PODGLĄD PROMPTU */}
          <div className="glass-strong rounded-[var(--radius-lg)] p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] flex items-center gap-1.5">
                <Eye size={12} /> Podgląd promptu
              </h3>
              <div className="flex items-center gap-1">
                {/* Toggle raw/resolved */}
                <div className="flex rounded overflow-hidden border border-[var(--color-border)]">
                  <button onClick={() => setPreviewMode('raw')}
                    className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${previewMode === 'raw' ? 'bg-[var(--color-accent)] text-[#1a1410]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'}`}
                    title="Pokaż surowo z {{placeholderami}}">
                    surowo
                  </button>
                  <button onClick={() => setPreviewMode('resolved')}
                    className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${previewMode === 'resolved' ? 'bg-[var(--color-accent)] text-[#1a1410]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'}`}
                    title="Pokaż z podstawionymi wartościami">
                    z wartościami
                  </button>
                </div>
                <button onClick={() => setShowPreview(s => !s)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-2">
                  {showPreview ? 'ukryj' : 'pokaż'}
                </button>
              </div>
            </div>
            {showPreview && (
              <>
                <div className="text-[10px] text-[var(--color-text-muted)] mb-2">
                  ~{preview.length} znaków · ~{Math.round(preview.length / 4)} tokenów
                </div>
                {previewMode === 'raw' ? (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-[640px] overflow-y-auto p-3 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)]"
                    dangerouslySetInnerHTML={{
                      __html: previewRaw
                        .replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
                        .replace(/\{\{(\w+)\}\}/g, (full: string, key: string) => {
                          const known = !!PLACEHOLDER_MAP[key];
                          return known
                            ? `<span style="color:#fbbf24;background:rgba(251,191,36,0.12);border-radius:3px;padding:0 2px">${full.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c] as string))}</span>`
                            : `<span style="color:#f87171;background:rgba(248,113,113,0.18);border-radius:3px;padding:0 2px;text-decoration:underline wavy #f87171">${full.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c] as string))}</span>`;
                        }),
                    }}
                  />
                ) : (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-[640px] overflow-y-auto p-3 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)]">
                    {preview}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel zmiennych (placeholdery) ─────────────────────────────────────────

function VariablesPanel({ open, onToggle, query, onQueryChange, resolvedValues, customVars }: {
  open: boolean;
  onToggle: () => void;
  query: string;
  onQueryChange: (v: string) => void;
  resolvedValues: Record<string, string>;
  customVars: { key: string; label: string; value: string }[];
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return PLACEHOLDERS;
    return PLACEHOLDERS.filter(p =>
      p.key.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }, [query]);

  const filteredCustom = useMemo(() => {
    const q = query.toLowerCase().trim();
    const valid = customVars.filter(c => c.key);
    if (!q) return valid;
    return valid.filter(c =>
      c.key.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.value.toLowerCase().includes(q)
    );
  }, [customVars, query]);

  const grouped = useMemo(() => {
    const map: Partial<Record<PlaceholderCategory, PlaceholderMeta[]>> = {};
    for (const p of filtered) {
      (map[p.category] ||= []).push(p);
    }
    return map;
  }, [filtered]);

  const copyKey = (key: string) => {
    const text = `{{${key}}}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    }).catch(() => {});
  };

  return (
    <div className="glass-strong rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <Variable size={12} /> Dostępne zmienne ({PLACEHOLDERS.length + customVars.filter(c => c.key).length})
        </h3>
        <button onClick={onToggle} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          {open ? 'ukryj' : 'pokaż'}
        </button>
      </div>
      {open && (
        <>
          <div className="relative mb-3">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder="Szukaj zmiennej…"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] mb-2 italic">
            💡 W edytorze wpisz <code className="px-1 rounded bg-[var(--color-surface-2)] text-amber-400">{'{{'}</code> aby otworzyć podpowiedzi. Klik kafla = kopiuj.
          </p>
          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
            {/* SEKCJA: WŁASNE — na górze, mocno wyróżniona */}
            {filteredCustom.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1.5 sticky top-0 bg-[var(--color-surface)] py-0.5 z-10 flex items-center gap-1">
                  ★ Własne · {filteredCustom.length}
                </div>
                <ul className="space-y-1">
                  {filteredCustom.map(cv => {
                    const v = cv.value || '(pusta)';
                    return (
                      <li key={cv.key}>
                        <button
                          type="button"
                          onClick={() => copyKey(cv.key)}
                          title={cv.label || cv.key}
                          className="w-full text-left px-2 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-400 hover:bg-emerald-500/10 transition-all group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-amber-400 truncate">{`{{${cv.key}}}`}</span>
                            {copiedKey === cv.key
                              ? <span className="text-[10px] text-emerald-400">skopiowane ✓</span>
                              : <span className="text-[9px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">kliknij aby skopiować</span>}
                          </div>
                          <div className="text-[11px] text-[var(--color-text)] mt-0.5">{cv.label || '(bez opisu)'}</div>
                          <div className="text-[10px] text-emerald-400 mt-0.5 truncate">→ <span className="font-mono">{v.length > 60 ? v.slice(0, 60) + '…' : v}</span></div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {CATEGORY_ORDER.map(cat => {
              const items = grouped[cat];
              if (!items || items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent)] mb-1.5 sticky top-0 bg-[var(--color-surface)] py-0.5 z-10">
                    {CATEGORY_LABEL[cat]} · {items.length}
                  </div>
                  <ul className="space-y-1">
                    {items.map(p => {
                      const v = resolvedValues[p.key] ?? p.example;
                      const live = resolvedValues[p.key] != null && resolvedValues[p.key] !== '';
                      return (
                        <li key={p.key}>
                          <button
                            type="button"
                            onClick={() => copyKey(p.key)}
                            title={p.description + (p.editableAt ? `\n\n📍 ${p.editableAt}` : '')}
                            className="w-full text-left px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-bg)]/30 transition-all group"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-amber-400 truncate">{`{{${p.key}}}`}</span>
                              {copiedKey === p.key
                                ? <span className="text-[10px] text-emerald-400">skopiowane ✓</span>
                                : <span className="text-[9px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">kliknij aby skopiować</span>}
                            </div>
                            <div className="text-[11px] text-[var(--color-text)] mt-0.5">{p.label}</div>
                            <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1">
                              <span className={live ? 'text-emerald-400' : 'opacity-60'}>→ {v}</span>
                              {live && <span className="text-[9px] px-1 rounded bg-emerald-500/15 text-emerald-400">live</span>}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)] italic px-2 py-3 text-center">Brak wyników dla "{query}"</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-komponenty ─────────────────────────────────────────────────────────

function BlockRow({ block, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onRemove, onRemoveGlobal, onUpdate, resolvedValues, customVars }: {
  block: PromptBlock;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onRemoveGlobal: () => void;
  onUpdate: (patch: Partial<PromptBlock>) => void;
  resolvedValues: Record<string, string>;
  customVars: { key: string; label: string; value: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rounded-[var(--radius-sm)] border-2 ${expanded ? 'border-[var(--color-accent)]/50' : 'border-[var(--color-border)]'} bg-[var(--color-surface-2)]/40`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${kindColor(block.kind)}`}>{block.kind}</span>
        <button onClick={() => setExpanded(e => !e)} className="flex-1 text-left text-xs font-semibold truncate hover:text-[var(--color-accent)]">
          {block.title}
        </button>
        <span className="text-[9px] text-[var(--color-text-muted)]">{block.body.length}ch</span>
        <button disabled={!canMoveUp} onClick={onMoveUp} className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-30"><ChevronUp size={12} /></button>
        <button disabled={!canMoveDown} onClick={onMoveDown} className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-30"><ChevronDown size={12} /></button>
        <button onClick={onRemove} className="p-1 rounded hover:bg-red-500/20 text-red-400" title="Usuń z profilu"><Trash2 size={12} /></button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2 mt-2">
            <input value={block.title}
              onChange={e => onUpdate({ title: e.target.value })}
              placeholder="Tytuł bloku"
              className="flex-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)]" />
            <select
              value={block.kind}
              onChange={e => onUpdate({ kind: e.target.value as PromptBlock['kind'] })}
              className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
              title="Kategoria bloku"
            >
              <option value="persona">persona</option>
              <option value="policy">policy</option>
              <option value="knowledge">knowledge</option>
              <option value="format">format</option>
              <option value="examples">examples</option>
            </select>
            <button
              onClick={onRemoveGlobal}
              className="p-1 rounded hover:bg-red-500/20 text-red-400 border border-red-500/30"
              title="Usuń blok z całego systemu (wszystkie profile)"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <PromptTextarea
            value={block.body}
            onChange={v => onUpdate({ body: v })}
            rows={Math.min(20, Math.max(4, block.body.split('\n').length))}
            resolvedValues={resolvedValues}
            customVars={customVars}
          />
        </div>
      )}
    </div>
  );
}

function RuleRow({ rule, enabled, onToggle, onUpdate, onRemove, resolvedValues, customVars }: {
  rule: MetaRule;
  enabled: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<MetaRule>) => void;
  onRemove: () => void;
  resolvedValues: Record<string, string>;
  customVars: { key: string; label: string; value: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rounded-[var(--radius-sm)] border-2 ${expanded ? 'border-[var(--color-accent)]/50' : enabled ? 'border-emerald-500/30' : 'border-[var(--color-border)]'} bg-[var(--color-surface-2)]/40`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input type="checkbox" checked={enabled} onChange={onToggle} className="w-4 h-4 accent-[var(--color-accent)]" title="W tym profilu" />
        <button onClick={() => setExpanded(e => !e)} className="flex-1 text-left text-xs font-semibold truncate hover:text-[var(--color-accent)]">
          {rule.title}
        </button>
        <span className="text-[9px] text-[var(--color-text-muted)] font-mono">{rule.id}</span>
        <button onClick={onRemove} className="p-1 rounded hover:bg-red-500/20 text-red-400" title="Usuń regułę globalnie"><Trash2 size={12} /></button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-[var(--color-border)]">
          <input value={rule.title}
            onChange={e => onUpdate({ title: e.target.value })}
            className="w-full mt-2 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-transparent focus:outline-none focus:border-[var(--color-accent)]" />
          <PromptTextarea
            value={rule.body}
            onChange={v => onUpdate({ body: v })}
            rows={Math.min(15, Math.max(3, rule.body.split('\n').length))}
            resolvedValues={resolvedValues}
            customVars={customVars}
          />
        </div>
      )}
    </div>
  );
}

function kindColor(k: string): string {
  switch (k) {
    case 'persona': return 'bg-purple-500/20 text-purple-300';
    case 'policy': return 'bg-amber-500/20 text-amber-300';
    case 'knowledge': return 'bg-sky-500/20 text-sky-300';
    case 'format': return 'bg-emerald-500/20 text-emerald-300';
    case 'examples': return 'bg-pink-500/20 text-pink-300';
    default: return 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]';
  }
}
