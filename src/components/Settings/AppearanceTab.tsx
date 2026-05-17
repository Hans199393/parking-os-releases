/**
 * AppearanceTab — motyw + kolor akcentu.
 * Visual: gradient-accent na ikonie, duże kafelki wyboru.
 */

import { Palette, Sun, Moon, Monitor, Lock } from 'lucide-react';
import { ACCENT_COLORS, applyAccentColor } from './settingsTypes';
import { usePerm } from '../../lib/usePerm';

interface Props {
  values: Record<string, string>;
  set: (key: string, val: string) => void;
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (t: 'light' | 'dark' | 'system') => void;
}

const THEMES: { id: 'light' | 'dark' | 'system'; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'light',  label: 'Jasny',    Icon: Sun },
  { id: 'dark',   label: 'Ciemny',   Icon: Moon },
  { id: 'system', label: 'Systemowy', Icon: Monitor },
];

export default function AppearanceTab({ values, set, theme, onThemeChange }: Props) {
  const perm = usePerm();
  const canEdit = perm.has('settings.edit_appearance');
  const currentAccent = values.accent_color || ACCENT_COLORS[0].hex;

  const guardedTheme = (t: 'light' | 'dark' | 'system') => {
    if (!perm.guard('settings.edit_appearance', 'zmiana motywu')) return;
    onThemeChange(t);
  };
  const guardedAccent = (hex: string) => {
    if (!perm.guard('settings.edit_appearance', 'zmiana koloru akcentu')) return;
    applyAccentColor(hex);
    set('accent_color', hex);
  };

  return <>
    {!canEdit && (
      <div className="glass-strong rounded-[var(--radius-lg)] p-4 mb-5 flex items-center gap-3 border-2 border-[var(--color-warning)]/40 animate-slideUp">
        <Lock size={20} className="text-[var(--color-warning)] flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">Tryb tylko do odczytu</p>
          <p className="text-xs text-[var(--color-text-muted)]">Brak uprawnienia <code>settings.edit_appearance</code> — zmiany nie zostaną zapisane.</p>
        </div>
      </div>
    )}
    {/* MOTYW */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
          <Monitor size={22} className="text-[#1a1410]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text)]">Motyw aplikacji</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Jasny / ciemny / zgodny z systemem operacyjnym</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map(({ id, label, Icon }) => {
          const active = theme === id;
          return (
            <button key={id} onClick={() => guardedTheme(id)}
              className={`relative overflow-hidden p-5 rounded-[var(--radius-lg)] border-2 transition-all duration-200 hover:-translate-y-0.5
                ${active
                  ? 'border-transparent shadow-[var(--shadow-lg)] text-[#1a1410]'
                  : 'border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'}`}>
              {active && <span className="absolute inset-0 bg-gradient-accent" aria-hidden="true" />}
              <div className="relative flex flex-col items-center gap-2">
                <Icon size={28} />
                <span className="font-bold">{label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>

    {/* KOLOR AKCENTU */}
    <div className="glass-strong rounded-[var(--radius-lg)] p-6 mt-5 animate-slideUp" style={{ animationDelay: '100ms' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
          <Palette size={22} className="text-[#1a1410]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text)]">Kolor akcentu</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Złoty (domyślny) świetnie pasuje do nadmorskiego klimatu</p>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {ACCENT_COLORS.map(c => {
          const active = currentAccent === c.hex;
          return (
            <button key={c.id} onClick={() => guardedAccent(c.hex)}
              className={`group relative aspect-square rounded-[var(--radius-lg)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105
                ${active ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg)] ring-[var(--color-accent)] shadow-[var(--shadow-glow)]' : 'shadow-[var(--shadow-md)]'}`}
              style={{ background: c.gradient }}
              title={c.label}>
              {active && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-7 h-7 rounded-full bg-white/95 flex items-center justify-center shadow-md">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1410" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                </span>
              )}
              <span className="absolute -bottom-6 left-0 right-0 text-[10px] font-bold text-center text-[var(--color-text-muted)] uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity">
                {c.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)] opacity-60 mt-8">
        Zmiana stosowana natychmiast — kolor wpływa na przyciski, ikony, akcenty i hero numbers.
      </p>
    </div>
  </>;
}
