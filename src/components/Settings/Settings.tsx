/**
 * Settings — orchestrator. Sidebar nav + ConnectionStatusBar + tab content + Toast.
 *
 * Re-eksportuje applyAccentColor i ACCENT_COLORS dla backcompat (App.tsx je importuje).
 *
 * NIE wymaga klikania "Zapisz" — useSettings() debounce'uje 1.5s + auto-zapis.
 * Cloud save dla parkingu (synchronizacja z botem/WWW) jest osobno w ParkingTab.
 */

import { useState, useEffect } from 'react';
import { Building2, Camera, Plug, Palette, Users, Settings as SettingsIcon, Sparkles, Undo2, Check, X, Monitor } from 'lucide-react';
import type { AppUser } from '../../lib/session';
import { useSettings } from './useSettings';
import ConnectionStatusBar from './ConnectionStatusBar';
import ParkingTab from './ParkingTab';
import DevicesTab from './DevicesTab';
import IntegrationsTab from './IntegrationsTab';
import AppearanceTab from './AppearanceTab';
import AccountsTab from './AccountsTab';
import AssistantsTab from './AssistantsTab';
import SystemTab from './SystemTab';
import type { SettingsTabId } from './settingsTypes';

// Backcompat re-exports — App.tsx importuje stąd applyAccentColor i ACCENT_COLORS
export { applyAccentColor, ACCENT_COLORS } from './settingsTypes';

interface Props {
  onThemeChange: (t: 'light' | 'dark' | 'system') => void;
  theme: 'light' | 'dark' | 'system';
  onSettingsSaved?: () => void;
  user?: AppUser | null;
}

const BASE_TABS: { id: SettingsTabId; label: string; sub: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'parking',      label: 'Parking',      sub: 'Cennik · godziny · komunikat',     Icon: Building2 },
  { id: 'devices',      label: 'Urządzenia',   sub: 'Kamery · detektor YOLO',          Icon: Camera    },
  { id: 'integrations', label: 'Integracje',   sub: 'Supabase · poczta · Messenger',    Icon: Plug      },
  { id: 'assistants',   label: 'Asystenci AI', sub: 'Prompty Messenger / WWW / Admin', Icon: Sparkles  },
  { id: 'appearance',   label: 'Wygląd',       sub: 'Motyw · kolor akcentu',           Icon: Palette   },
  { id: 'system',       label: 'System',       sub: 'Autostart · aktualizacje',        Icon: Monitor   },
  { id: 'accounts',     label: 'Konto',        sub: 'Hasło · zarządzanie kontami',     Icon: Users     },
];

export default function Settings({ onThemeChange, theme, onSettingsSaved: _onSettingsSaved, user }: Props) {
  const isSuperAdmin = user?.role === 'superadmin';
  const TABS = BASE_TABS;
  const [tab, setTab] = useState<SettingsTabId>('parking');
  const { values, set, patch, loaded, toast, dismissToast, flushNow } = useSettings();

  // Iter 13: nasłuch eventów z Command Palette (Ctrl+O → Akcje)
  useEffect(() => {
    const onAssistants = () => setTab('assistants');
    const onParking = () => setTab('parking');
    window.addEventListener('cmdpal:settings:assistants', onAssistants);
    window.addEventListener('cmdpal:settings:parking', onParking);
    return () => {
      window.removeEventListener('cmdpal:settings:assistants', onAssistants);
      window.removeEventListener('cmdpal:settings:parking', onParking);
    };
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)]">Ładowanie ustawień...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* HERO HEADER */}
      <div className="flex items-center gap-4 mb-6 animate-slideUp">
        <div className="w-14 h-14 rounded-[var(--radius-lg)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)] ring-glow">
          <SettingsIcon size={28} className="text-[#1a1410]" />
        </div>
        <div>
          <h1 className="display-heading">Ustawienia</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Zmiany zapisują się automatycznie · status połączeń odświeża się co 60 s
          </p>
        </div>
      </div>

      {/* CONNECTION STATUS BAR */}
      <ConnectionStatusBar values={values} onJump={(t) => setTab(t)} />

      {/* SIDEBAR + CONTENT */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 mt-6">
        {/* SIDEBAR */}
        <nav className="lg:sticky lg:top-4 lg:self-start space-y-1.5">
          {TABS.filter(t => t.id !== 'accounts' || isSuperAdmin || true).map(({ id, label, sub, Icon }) => {
            // 'accounts' tab visible to everyone (zwykła zmiana hasła) — AccountManager w środku rendered tylko jeśli superadmin
            const active = tab === id;
            return (
              <button key={id} onClick={() => { void flushNow(); setTab(id); }}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[var(--radius-md)] text-left transition-all duration-200 group
                  ${active
                    ? 'bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-md)] scale-[1.02]'
                    : 'glass-strong text-[var(--color-text)] hover:translate-x-0.5 hover:shadow-[var(--shadow-md)]'}`}>
                <div className={`w-9 h-9 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0
                  ${active ? 'bg-[#1a1410]/20' : 'bg-[var(--color-surface-2)]'}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm">{label}</div>
                  <div className={`text-[10px] truncate ${active ? 'text-[#1a1410]/70' : 'text-[var(--color-text-muted)]'}`}>{sub}</div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* TAB CONTENT */}
        <main className="min-w-0">
          {tab === 'parking'      && <ParkingTab values={values} set={set} patch={patch} />}
          {tab === 'devices'      && <DevicesTab values={values} set={set} />}
          {tab === 'integrations' && <IntegrationsTab values={values} set={set} />}
          {tab === 'assistants'   && <AssistantsTab user={user} />}
          {tab === 'appearance'   && <AppearanceTab values={values} set={set} theme={theme} onThemeChange={onThemeChange} />}
          {tab === 'system'       && <SystemTab />}
          {tab === 'accounts'     && <AccountsTab user={user} />}
        </main>
      </div>

      {/* TOAST */}
      {toast && (
        <div className="fixed bottom-8 left-8 z-[60] animate-slideUp">
          <div className="glass-strong rounded-[var(--radius-lg)] px-5 py-3.5 shadow-[var(--shadow-xl)] flex items-center gap-3 max-w-md">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Check size={16} className="text-emerald-400" />
            </div>
            <p className="text-sm text-[var(--color-text)] flex-1">{toast.text}</p>
            {toast.undo && (
              <button onClick={toast.undo}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)] hover:text-[var(--color-accent-strong)] px-2.5 py-1 rounded border border-[var(--color-accent)]/40 hover:border-[var(--color-accent)] transition-colors">
                <Undo2 size={12} /> Cofnij
              </button>
            )}
            <button onClick={dismissToast} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Zamknij">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
