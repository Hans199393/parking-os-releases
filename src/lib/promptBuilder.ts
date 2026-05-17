/**
 * promptBuilder.ts — generator pełnego system-prompt na podstawie PromptConfig.
 *
 * Algorytm jest IDENTYCZNY z parking_botaimess/lib/promptBuilder.js.
 * Trzymaj oba pliki w synchronizacji.
 */

import type { PromptConfig, ProfileId } from './promptDefaults';
import { PROMPT_PLACEHOLDER_DEFAULTS } from './promptDefaults';

/**
 * Składa pełny system-prompt dla podanego profilu.
 * @param config konfiguracja (z DB lub z DEFAULT_PROMPT_CONFIG)
 * @param profileId 'messenger' | 'widget' | 'assistant'
 * @param settings publiczne ustawienia z `settings` (rate_basic, owner_phone, ...)
 * @param vars dodatkowe zmienne dynamiczne (np. today_iso)
 */
export function buildPrompt(
  config: PromptConfig,
  profileId: ProfileId,
  settings: Record<string, string> = {},
  vars: Record<string, string> = {},
): string {
  const profile = config.profiles[profileId];
  if (!profile) throw new Error(`Nieznany profil: ${profileId}`);

  const parts: string[] = [];

  // 1) Bloki w zadanej kolejności
  for (const blockId of profile.block_order) {
    const block = config.blocks[blockId];
    if (!block) continue;
    parts.push(block.body.trim());
  }

  // 2) Meta-reguły (numerowane automatycznie 1..N)
  if (profile.meta_rule_ids.length > 0) {
    const ruleHeader = 'META-REGUŁY — NADRZĘDNE ZASADY (stosuj ZAWSZE):';
    const numbered = profile.meta_rule_ids
      .map((rid, idx) => {
        const r = config.meta_rules.find(x => x.id === rid);
        if (!r) return null;
        return `${idx + 1}. ${r.title}\n${r.body.trim()}`;
      })
      .filter((x): x is string => x !== null);
    if (numbered.length > 0) {
      parts.push(`${ruleHeader}\n\n${numbered.join('\n\n')}`);
    }
  }

  // 3) Extra (ad-hoc dopisek z UI)
  if (profile.extra && profile.extra.trim()) {
    parts.push(profile.extra.trim());
  }

  const raw = parts.join('\n\n');
  return applyPlaceholders(raw, settings, vars);
}

/**
 * Zamienia {{key}} na wartość z settings → defaults → vars.
 * Nieznane placeholdery zostawia w formie {{key}} (nie chowa błędów konfiguracji).
 */
export function applyPlaceholders(
  tpl: string,
  settings: Record<string, string> = {},
  vars: Record<string, string> = {},
): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars[key] != null && vars[key] !== '') return String(vars[key]);
    if (settings[key] != null && settings[key] !== '') return String(settings[key]);
    if (PROMPT_PLACEHOLDER_DEFAULTS[key] != null) return PROMPT_PLACEHOLDER_DEFAULTS[key];
    return `{{${key}}}`;
  });
}

/** Walidacja konfiguracji — zwraca listę problemów (puste = OK) */
export function validateConfig(config: PromptConfig): string[] {
  const issues: string[] = [];
  for (const profKey of Object.keys(config.profiles) as ProfileId[]) {
    const p = config.profiles[profKey];
    for (const bid of p.block_order) {
      if (!config.blocks[bid]) issues.push(`profil "${profKey}": brakujący blok "${bid}"`);
    }
    for (const rid of p.meta_rule_ids) {
      if (!config.meta_rules.find(r => r.id === rid)) {
        issues.push(`profil "${profKey}": brakująca meta-reguła "${rid}"`);
      }
    }
  }
  return issues;
}
