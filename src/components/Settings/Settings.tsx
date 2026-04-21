import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getStore } from '../../lib/store';
import { resetSupabaseClient } from '../../lib/supabase';
import { changePassword as changeAuthPassword, verifyCurrentPassword } from '../../lib/auth';
import { Button, Input, Card, Select } from '../shared/UI';
import { Check, Eye, EyeOff, Wifi, WifiOff, Camera, Cpu, Palette, Link2, Lock, Users } from 'lucide-react';
import type { AppUser } from '../../lib/session';
import AccountManager from './AccountManager';
import { logAction } from '../../lib/audit';

export const ACCENT_COLORS = [
  { id: 'teal',   label: 'Teal',       hex: '#2dd4bf', cls: 'bg-teal-400'   },
  { id: 'blue',   label: 'Niebieski',  hex: '#3b82f6', cls: 'bg-blue-500'   },
  { id: 'violet', label: 'Fioletowy',  hex: '#a855f7', cls: 'bg-purple-500' },
  { id: 'orange', label: 'Pomaranczowy', hex: '#f97316', cls: 'bg-orange-500' },
  { id: 'green',  label: 'Zielony',    hex: '#22c55e', cls: 'bg-green-500'  },
  { id: 'pink',   label: 'Rozowy',     hex: '#ec4899', cls: 'bg-pink-500'   },
];

export function applyAccentColor(hex: string) {
  document.documentElement.style.setProperty('--color-accent', hex);
}

const ALL_KEYS = [
  'cam1_snapshot_url', 'cam1_rtsp_url', 'cam1_hls_url', 'cam1_name',
  'cam2_snapshot_url', 'cam2_rtsp_url', 'cam2_hls_url', 'cam2_name',
  'cam3_snapshot_url', 'cam3_rtsp_url', 'cam3_hls_url', 'cam3_name',
  'cam4_snapshot_url', 'cam4_rtsp_url', 'cam4_hls_url', 'cam4_name',
  'snapshot_interval', 'show_roi_overlay',
  'detection_confidence', 'detection_interval', 'detector_autostart',
  'parking_name', 'parking_capacity', 'parking_capacity_disabled',
  'rate_hourly', 'rate_daily', 'currency', 'card_commission_rate',
  'supabase_url', 'supabase_key',
  'email_imap_host', 'email_imap_port', 'email_smtp_host', 'email_smtp_port',
  'email_user', 'email_pass',
  'admin_url', 'pwa_url',
  'session_timeout', 'confirm_exit', 'accent_color',
];

const CAM_DEFAULTS = [
  { id: 'cam1', defaultName: 'CAM 1 - IMOU' },
  { id: 'cam2', defaultName: 'CAM 2 - YCC365Plus #1' },
  { id: 'cam3', defaultName: 'CAM 3 - YCC365Plus #2' },
  { id: 'cam4', defaultName: 'CAM 4' },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none
          ${checked ? 'bg-[var(--color-accent)]' : 'bg-slate-600'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
      {label && <span className="text-sm text-[var(--color-text)]">{label}</span>}
    </label>
  );
}

type Tab = 'cameras' | 'detection' | 'appearance' | 'connections' | 'account' | 'accounts';

const BASE_TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'cameras',     label: 'Kamery',     Icon: Camera  },
  { id: 'detection',   label: 'Detekcja',   Icon: Cpu     },
  { id: 'appearance',  label: 'Wyglad',     Icon: Palette },
  { id: 'connections', label: 'Polaczenia', Icon: Link2   },
  { id: 'account',     label: 'Konto',      Icon: Lock    },
  { id: 'accounts',    label: 'Konta',      Icon: Users   },
];

export default function Settings({
  onThemeChange,
  theme,
  onSettingsSaved,
  user,
}: {
  onThemeChange: (t: 'light' | 'dark' | 'system') => void;
  theme: 'light' | 'dark' | 'system';
  onSettingsSaved?: () => void;
  user?: AppUser | null;
}) {
  const isSuperAdmin = user?.role === 'superadmin';
  const TABS = BASE_TABS.filter(t => t.id !== 'accounts' || isSuperAdmin);
  const [tab, setTab] = useState<Tab>('cameras');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [testResult, setTestResult]     = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting]           = useState(false);
  const [emailResult, setEmailResult]   = useState<{ ok: boolean; error?: string } | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);

  const [oldPass, setOldPass]       = useState('');
  const [newPass, setNewPass]       = useState('');
  const [newPass2, setNewPass2]     = useState('');
  const [passError, setPassError]   = useState('');
  const [passOk, setPassOk]         = useState(false);
  const [savingPass, setSavingPass] = useState(false);
  const [showPass, setShowPass]     = useState(false);

  useEffect(() => {
    getStore().then(async store => {
      const loaded: Record<string, string> = {};
      for (const key of ALL_KEYS) {
        const v = await store.get<string | number | boolean>(key);
        loaded[key] = v != null ? String(v) : '';
      }
      if (!loaded['snapshot_interval'])    loaded['snapshot_interval']    = '1500';
      if (!loaded['show_roi_overlay'])     loaded['show_roi_overlay']     = 'true';
      if (!loaded['detection_confidence']) loaded['detection_confidence'] = '0.5';
      if (!loaded['detection_interval'])   loaded['detection_interval']   = '330';
      if (!loaded['detector_autostart'])   loaded['detector_autostart']   = 'false';
      if (!loaded['currency'])             loaded['currency']             = 'PLN';
      if (!loaded['session_timeout'])      loaded['session_timeout']      = '3600';
      if (!loaded['confirm_exit'])         loaded['confirm_exit']         = 'true';
      setValues(loaded);
    });
  }, []);

  const set = (key: string, val: string) => setValues(v => ({ ...v, [key]: val }));
  const bool = (key: string) => values[key] === 'true';

  const handleSave = async () => {
    setSaving(true);
    try {
      const store = await getStore();
      for (const key of ALL_KEYS) {
        await store.set(key, values[key] ?? '');
      }
      await store.save();
      resetSupabaseClient();
      onSettingsSaved?.();
      await logAction('settings_saved', { tab });
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestSupabase = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(values['supabase_url'] ?? '', values['supabase_key'] ?? '');
      const { error } = await client.from('settings').select('key').limit(1);
      setTestResult(error ? { ok: false, error: error.message } : { ok: true });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Blad' });
    }
    setTesting(false);
  };

  const handleTestImap = async () => {
    setTestingEmail(true); setEmailResult(null);
    try {
      await invoke('email_test_imap', {
        imapHost: values['email_imap_host'] ?? '',
        imapPort: parseInt(values['email_imap_port'] ?? '993') || 993,
        user: values['email_user'] ?? '',
        pass: values['email_pass'] ?? '',
      });
      setEmailResult({ ok: true });
    } catch (e) { setEmailResult({ ok: false, error: String(e) }); }
    setTestingEmail(false);
  };

  const handleChangePassword = async () => {
    setPassError('');
    if (!newPass)             { setPassError('Wpisz nowe haslo.'); return; }
    if (newPass !== newPass2) { setPassError('Hasla nie sa identyczne.'); return; }
    if (newPass.length < 8)  { setPassError('Minimum 8 znakow.'); return; }
    setSavingPass(true);
    try {
      const ok = await verifyCurrentPassword(oldPass);
      if (!ok) { setPassError('Nieprawidlowe obecne haslo.'); return; }
      await changeAuthPassword(newPass);
      setOldPass(''); setNewPass(''); setNewPass2('');
      setPassOk(true); setTimeout(() => setPassOk(false), 3000);
    } catch { setPassError('Blad zmiany hasla.'); }
    finally { setSavingPass(false); }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-0 flex-shrink-0">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Ustawienia</h1>
        <p className="text-[var(--color-text-muted)] text-xs mt-0.5">Konfiguracja Parking.OS</p>

        <div className="flex gap-0.5 mt-4 border-b border-[var(--color-border)]">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap
                ${tab === id
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-slate-500'}`}>
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {tab === 'cameras' && <>
          {CAM_DEFAULTS.map(({ id, defaultName }, idx) => (
            <Card key={id} title={values[`${id}_name`] || defaultName}>
              <div className="space-y-3">
                <Input label="Nazwa kamery"
                  value={values[`${id}_name`] ?? ''}
                  onChange={e => set(`${id}_name`, e.target.value)}
                  placeholder={defaultName} />
                <Input label="Snapshot HTTP URL"
                  value={values[`${id}_snapshot_url`] ?? ''}
                  onChange={e => set(`${id}_snapshot_url`, e.target.value)}
                  placeholder={idx === 0 ? 'http://admin:HASLO@192.168.0.50/cgi-bin/snapshot.cgi' : 'http://admin:HASLO@IP/snapshot'} />
                <Input label="HLS Live URL (po uruchomieniu proxy)"
                  value={values[`${id}_hls_url`] ?? ''}
                  onChange={e => set(`${id}_hls_url`, e.target.value)}
                  placeholder={`http://localhost:8888/stream/${id}.m3u8`} />
                <Input label="RTSP URL (tylko do VLC)"
                  value={values[`${id}_rtsp_url`] ?? ''}
                  onChange={e => set(`${id}_rtsp_url`, e.target.value)}
                  placeholder={idx === 0 ? 'rtsp://admin:HASLO@192.168.0.50:554/cam/realmonitor?channel=1&subtype=0' : 'rtsp://admin:HASLO@IP:554/...'} />
              </div>
            </Card>
          ))}

          <Card title="Opcje podgladu">
            <div className="space-y-5">
              <Select label="Interwal odswiezania snapshot"
                value={values['snapshot_interval'] ?? '1500'}
                onChange={e => set('snapshot_interval', e.target.value)}>
                <option value="500">0,5 s - bardzo szybki (~2 kl/s)</option>
                <option value="1000">1 s</option>
                <option value="1500">1,5 s - domyslny</option>
                <option value="3000">3 s - oszczedny</option>
              </Select>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)] mb-2">Overlay ROI na podgladzie CAM 1</p>
                <Toggle checked={bool('show_roi_overlay')} onChange={v => set('show_roi_overlay', String(v))}
                  label={bool('show_roi_overlay') ? 'Widoczny' : 'Ukryty'} />
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 opacity-60">Czerwona ramka + linia detekcji nalozna na obraz CAM 1</p>
              </div>
            </div>
          </Card>
        </>}

        {tab === 'detection' && <>
          <Card title="Parametry YOLO v8n">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-[var(--color-text)]">Prog pewnosci (confidence)</label>
                  <span className="text-sm font-mono text-teal-300">
                    {parseFloat(values['detection_confidence'] ?? '0.5').toFixed(2)}
                  </span>
                </div>
                <input type="range" min="0.1" max="0.9" step="0.05"
                  value={values['detection_confidence'] ?? '0.5'}
                  onChange={e => set('detection_confidence', e.target.value)}
                  className="w-full accent-[var(--color-accent)]" />
                <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-0.5 opacity-60">
                  <span>0.1 - czuly</span><span>0.9 - pewny</span>
                </div>
              </div>
              <Select label="Interwal probkowania (fps detekcji)"
                value={values['detection_interval'] ?? '330'}
                onChange={e => set('detection_interval', e.target.value)}>
                <option value="200">5 fps - szybki (wymaga mocnego CPU)</option>
                <option value="330">3 fps - zalecany</option>
                <option value="500">2 fps - umiarkowany</option>
                <option value="1000">1 fps - oszczedny</option>
              </Select>
            </div>
          </Card>
          <Card title="Zachowanie">
            <div>
              <p className="text-sm font-medium text-[var(--color-text)] mb-2">Auto-start przy uruchomieniu aplikacji</p>
              <Toggle checked={bool('detector_autostart')} onChange={v => set('detector_autostart', String(v))}
                label={bool('detector_autostart') ? 'Wlaczony' : 'Wylaczony'} />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 opacity-60">
                Wymaga skonfigurowanego RTSP URL dla CAM 1
              </p>
            </div>
          </Card>
          <Card title="Informacja">
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              Model <strong className="text-[var(--color-text)]">YOLO v8n</strong> (~6 MB) wykrywa pojazdy
              (samochody, autobusy, ciezarowki) przekraczajace linie w obszarze ROI na CAM 1.
            </p>
          </Card>
        </>}

        {tab === 'appearance' && <>
          <Card title="Motyw">
            <div className="flex gap-2 flex-wrap">
              {(['light', 'dark', 'system'] as const).map(t => (
                <button key={t} onClick={() => onThemeChange(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                    ${theme === t
                      ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/50 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
                  {t === 'light' ? 'Jasny' : t === 'dark' ? 'Ciemny' : 'Systemowy'}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Kolor akcentu">
            <div className="flex gap-2 flex-wrap">
              {ACCENT_COLORS.map(({ id, label, hex, cls }) => (
                <button key={id}
                  onClick={async () => {
                    set('accent_color', id);
                    applyAccentColor(hex);
                    const store = await getStore();
                    await store.set('accent_color', id);
                    await store.save();
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all
                    ${values['accent_color'] === id
                      ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30 scale-105'
                      : 'border-[var(--color-border)] hover:border-white/20'}`}>
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${cls}`} />
                  <span className="text-[var(--color-text-muted)]">{label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-3 opacity-60">
              Zmiana koloru akcentu dziala od razu i nie wymaga zapisu.
            </p>
          </Card>
        </>}

        {tab === 'connections' && <>
          <Card title="Baza danych (Supabase)">
            <div className="space-y-4">
              <Input label="Supabase URL"
                value={values['supabase_url'] ?? ''}
                onChange={e => set('supabase_url', e.target.value)}
                placeholder="https://xxx.supabase.co" />
              <Input label="Supabase Service Key"
                type="password"
                value={values['supabase_key'] ?? ''}
                onChange={e => set('supabase_key', e.target.value)}
                placeholder="eyJ..." />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={handleTestSupabase} loading={testing}>
                {testResult?.ok ? <Wifi size={14} /> : <WifiOff size={14} />} Testuj polaczenie
              </Button>
              {testResult && (
                <span className={`text-sm font-medium ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.ok ? 'OK' : `Blad: ${testResult.error}`}
                </span>
              )}
            </div>
          </Card>

          <Card title="Poczta e-mail (IMAP / SMTP)">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="IMAP serwer"
                  value={values['email_imap_host'] ?? ''}
                  onChange={e => set('email_imap_host', e.target.value)}
                  placeholder="poczta.ohv.pl" />
                <Input label="IMAP port"
                  value={values['email_imap_port'] ?? ''}
                  onChange={e => set('email_imap_port', e.target.value)}
                  placeholder="993" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="SMTP serwer"
                  value={values['email_smtp_host'] ?? ''}
                  onChange={e => set('email_smtp_host', e.target.value)}
                  placeholder="poczta.ohv.pl" />
                <Input label="SMTP port"
                  value={values['email_smtp_port'] ?? ''}
                  onChange={e => set('email_smtp_port', e.target.value)}
                  placeholder="465" />
              </div>
              <Input label="Login (adres e-mail)"
                value={values['email_user'] ?? ''}
                onChange={e => set('email_user', e.target.value)}
                placeholder="kontakt@parkingsobieszewo.pl" />
              <Input label="Haslo"
                type="password"
                value={values['email_pass'] ?? ''}
                onChange={e => set('email_pass', e.target.value)}
                placeholder="..." />
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-3 opacity-60">
              IMAP 993 SSL, SMTP 465 SSL
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={handleTestImap} loading={testingEmail}>
                {emailResult?.ok ? <Wifi size={14} /> : <WifiOff size={14} />} Testuj IMAP
              </Button>
              {emailResult && (
                <span className={`text-sm font-medium ${emailResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {emailResult.ok ? 'OK' : `Blad: ${emailResult.error}`}
                </span>
              )}
            </div>
          </Card>

          <Card title="Panele zewnetrzne">
            <div className="space-y-4">
              <Input label="URL panelu CMS / Administracja"
                value={values['admin_url'] ?? ''}
                onChange={e => set('admin_url', e.target.value)}
                placeholder="https://twoja-domena.pl/zaplecze-mk" />
              <Input label="URL panelu iPad (PWA)"
                value={values['pwa_url'] ?? ''}
                onChange={e => set('pwa_url', e.target.value)}
                placeholder="http://localhost:3001" />
            </div>
          </Card>
        </>}

        {tab === 'accounts' && isSuperAdmin && (
          <AccountManager />
        )}

        {tab === 'account' && <>
          <Card title="Zmiana hasla">
            <div className="space-y-4 max-w-sm">
              <div className="relative">
                <Input label="Obecne haslo"
                  type={showPass ? 'text' : 'password'}
                  value={oldPass}
                  onChange={e => setOldPass(e.target.value)} />
                <button onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-8 text-slate-500 hover:text-slate-300">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <Input label="Nowe haslo" type="password"
                value={newPass} onChange={e => setNewPass(e.target.value)} />
              <Input label="Powtorz nowe haslo" type="password"
                value={newPass2} onChange={e => setNewPass2(e.target.value)} error={passError} />
              <div className="flex items-center gap-3">
                <Button variant="primary" onClick={handleChangePassword} loading={savingPass}>
                  <Check size={16} /> Zmien haslo
                </Button>
                {passOk && <span className="text-green-400 text-sm font-medium">Zmieniono</span>}
              </div>
            </div>
          </Card>

          <Card title="Bezpieczenstwo sesji">
            <div className="space-y-5">
              <Select label="Automatyczne wylogowanie po nieaktywnosci"
                value={values['session_timeout'] ?? '3600'}
                onChange={e => set('session_timeout', e.target.value)}>
                <option value="1800">30 minut</option>
                <option value="3600">1 godzina</option>
                <option value="14400">4 godziny</option>
                <option value="0">Nigdy</option>
              </Select>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)] mb-2">Pytaj o potwierdzenie przy zamykaniu</p>
                <Toggle checked={bool('confirm_exit')} onChange={v => set('confirm_exit', String(v))}
                  label={bool('confirm_exit') ? 'Tak - pytaj' : 'Nie - zamknij od razu'} />
              </div>
            </div>
          </Card>

          <Card title="Zapisz">
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={handleSave} loading={saving}>
                <Check size={16} /> Zapisz
              </Button>
              {saved && <span className="text-green-400 text-sm font-medium">Zapisano</span>}
            </div>
          </Card>

          <Card>
            <p className="text-slate-500 text-xs">Parking.OS v1.0.0</p>
            <p className="text-slate-600 text-xs mt-0.5">
              Parking platny niestrzezony "Michal Klos" - Gdansk, Wyspa Sobieszewska, ul. Turystyczna 69
            </p>
          </Card>
        </>}

        {tab !== 'account' && (
          <div className="flex items-center gap-3 pt-1 pb-2">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              <Check size={16} /> Zapisz ustawienia
            </Button>
            {saved && <span className="text-green-400 text-sm font-medium">Zapisano</span>}
          </div>
        )}
      </div>
    </div>
  );
}