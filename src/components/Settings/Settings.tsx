import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getStore } from '../../lib/store';
import { resetSupabaseClient, getConfigs } from '../../lib/supabase';
import { changePassword as changeAuthPassword, verifyCurrentPassword } from '../../lib/auth';
import { Button, Input, Card, Select } from '../shared/UI';
import { Check, Eye, EyeOff, Wifi, WifiOff, Camera, Cpu, Palette, Link2, Lock, Users, Building2, Cloud, Banknote, Clock, CalendarPlus, Megaphone, Car, MapPin } from 'lucide-react';
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
  'parking_name', 'parking_capacity',
  'rate_hourly', 'rate_daily', 'currency', 'card_commission_rate',
  'supabase_url', 'supabase_key',
  'email_imap_host', 'email_imap_port', 'email_smtp_host', 'email_smtp_port',
  'email_user', 'email_pass',
  'admin_url', 'admin_token', 'pwa_url',
  'session_timeout', 'confirm_exit', 'accent_color',
  // Phase A/B — central settings (cache lokalny, źródło prawdy: Supabase settings)
  'rate_basic', 'rate_reservation', 'rate_after_hours',
  'open_from', 'open_to', 'open_days',
  'spots_available', 'komunikat',
  'owner_phone', 'owner_email', 'parking_address', 'parking_nip',
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

type Tab = 'cameras' | 'detection' | 'appearance' | 'connections' | 'account' | 'accounts' | 'parking';

const BASE_TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'cameras',     label: 'Kamery',     Icon: Camera   },
  { id: 'detection',   label: 'Detekcja',   Icon: Cpu      },
  { id: 'parking',     label: 'Parking',    Icon: Building2 },
  { id: 'appearance',  label: 'Wyglad',     Icon: Palette  },
  { id: 'connections', label: 'Polaczenia', Icon: Link2    },
  { id: 'account',     label: 'Konto',      Icon: Lock     },
  { id: 'accounts',    label: 'Konta',      Icon: Users    },
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

  // Phase B \u2014 zapis ustawie\u0144 parkingu do chmury (Vercel/Supabase)
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudResult, setCloudResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Dni dodatkowe (tabela extra_open_days)
  type ExtraDay = { id?: number; date: string; note?: string | null; active?: boolean };
  const [extraDays, setExtraDays] = useState<ExtraDay[]>([]);
  const [extraDayInput, setExtraDayInput] = useState('');
  const [extraDaysLoading, setExtraDaysLoading] = useState(false);
  const [extraDaysError, setExtraDaysError] = useState<string | null>(null);

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

  // Auto-fetch dni dodatkowych przy wejściu na zakładkę 'parking'
  useEffect(() => {
    if (tab === 'parking' && values['admin_url'] && values['admin_token']) {
      fetchExtraDays();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, values['admin_url'], values['admin_token']]);

  // Auto-pobieranie aktualnych wartości z chmury (Supabase) gdy wchodzimy na Parking
  // Dzięki temu widać prawdziwy stan: spots_available, komunikat, ceny, godziny
  useEffect(() => {
    if (tab !== 'parking') return;
    if (!values['supabase_url'] || !values['supabase_key']) return;
    let cancelled = false;
    (async () => {
      try {
        const keys = [
          'rate_basic', 'rate_reservation', 'rate_after_hours',
          'open_from', 'open_to', 'open_days',
          'spots_available', 'komunikat',
          'owner_phone', 'owner_email', 'parking_address', 'parking_name', 'parking_nip',
          'parking_capacity',
        ];
        const cloud = await getConfigs(keys);
        if (cancelled) return;
        setValues(prev => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(cloud)) next[k] = v;
          return next;
        });
      } catch (e) {
        console.warn('[settings] cloud fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, values['supabase_url'], values['supabase_key']]);

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

  // Phase B \u2014 wy\u015blij ustawienia parkingu do chmury (Vercel /api/admin?action=settings_save)
  const handleCloudSaveParking = async () => {
    setCloudSaving(true);
    setCloudResult(null);
    try {
      const adminUrl = (values['admin_url'] ?? '').trim().replace(/\/+$/, '');
      const adminToken = (values['admin_token'] ?? '').trim();
      if (!adminUrl) throw new Error('Brak admin_url (zak\u0142adka Po\u0142\u0105czenia)');
      if (!adminToken) throw new Error('Brak admin_token (poni\u017cej)');

      const PARKING_KEYS = [
        'rate_basic', 'rate_reservation', 'rate_after_hours',
        'open_from', 'open_to', 'open_days',
        'spots_available', 'komunikat',
        'owner_phone', 'owner_email', 'parking_address', 'parking_name', 'parking_nip',
        'parking_capacity',
      ];
      const settings: Record<string, string> = {};
      for (const k of PARKING_KEYS) {
        if (values[k] != null && values[k] !== '') settings[k] = values[k];
      }

      const resp = await fetch(`${adminUrl}/api/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: 'settings_save', settings }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || `HTTP ${resp.status}`);
      }
      // Lokalnie te\u017c utrwal (cache offline)
      const store = await getStore();
      for (const [k, v] of Object.entries(settings)) await store.set(k, v);
      await store.save();
      await logAction('settings_saved', { tab: 'parking', cloud: true, keys: Object.keys(settings) });
      setCloudResult({ ok: true });
      setTimeout(() => setCloudResult(null), 3000);
    } catch (e) {
      setCloudResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCloudSaving(false);
    }
  };

  // ── Dni dodatkowe (tabela extra_open_days w Supabase, przez /api/admin) ──
  const adminCall = async (body: object) => {
    const adminUrl = (values['admin_url'] ?? '').trim().replace(/\/+$/, '');
    const adminToken = (values['admin_token'] ?? '').trim();
    if (!adminUrl) throw new Error('Brak admin_url (zakładka Połączenia)');
    if (!adminToken) throw new Error('Brak admin_token (zakładka Połączenia)');
    const resp = await fetch(`${adminUrl}/api/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    return json;
  };

  const fetchExtraDays = async () => {
    const adminUrl = (values['admin_url'] ?? '').trim().replace(/\/+$/, '');
    const adminToken = (values['admin_token'] ?? '').trim();
    if (!adminUrl || !adminToken) return;
    setExtraDaysLoading(true);
    setExtraDaysError(null);
    try {
      const resp = await fetch(`${adminUrl}/api/admin?action=extra_open_days`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
      setExtraDays(json.extraOpenDays || []);
    } catch (e) {
      setExtraDaysError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtraDaysLoading(false);
    }
  };

  // ISO YYYY-MM-DD (z input[type=date]) → DD.MM.YYYY (format wymagany przez API)
  const isoToPlDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
  };
  const plToIsoDate = (pl: string) => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(pl);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : pl;
  };

  const addExtraDay = async () => {
    if (!extraDayInput) return;
    setExtraDaysError(null);
    try {
      await adminCall({ action: 'add_extra_day', date: isoToPlDate(extraDayInput), note: null });
      setExtraDayInput('');
      await fetchExtraDays();
    } catch (e) {
      setExtraDaysError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeExtraDay = async (id: number) => {
    setExtraDaysError(null);
    try {
      await adminCall({ action: 'remove_extra_day', id });
      await fetchExtraDays();
    } catch (e) {
      setExtraDaysError(e instanceof Error ? e.message : String(e));
    }
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
      <div className="px-8 pt-7 pb-0 flex-shrink-0 relative">
        {/* Hero header z bursztynowym glow */}
        <div className="flex items-center gap-4 mb-1">
          <div className="w-1 h-10 rounded-full bg-gradient-accent shadow-[var(--shadow-glow)]" />
          <div>
            <h1 className="display-heading text-[var(--color-text)]">Ustawienia</h1>
            <p className="text-[var(--color-text-muted)] text-sm mt-0.5">Konfiguracja Parking.OS — wszystko w jednym miejscu</p>
          </div>
        </div>

        {/* Tab nav — pill style z gradientem na aktywnym */}
        <div className="flex gap-2 mt-6 overflow-x-auto pb-2 -mx-1 px-1">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-full transition-all duration-200 whitespace-nowrap
                ${tab === id
                  ? 'text-[#1a1410] shadow-[var(--shadow-glow)] scale-105'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/60 backdrop-blur-sm border border-[var(--color-border)]/50'}`}>
              {tab === id && <span className="absolute inset-0 rounded-full bg-gradient-accent" aria-hidden="true" />}
              <span className="relative z-10 flex items-center"><Icon size={15} /></span>
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">

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
              <Input label="ADMIN_TOKEN (Bearer — z env Vercel)"
                type="password"
                value={values['admin_token'] ?? ''}
                onChange={e => set('admin_token', e.target.value)}
                placeholder="dlugi sekret" />
              <Input label="URL panelu iPad (PWA)"
                value={values['pwa_url'] ?? ''}
                onChange={e => set('pwa_url', e.target.value)}
                placeholder="http://localhost:3001" />
            </div>
          </Card>
        </>}

        {tab === 'parking' && (() => {
          const isAvailable = (values['spots_available'] ?? 'true') !== 'false';
          let kom: { tytul?: string; tresc?: string; od?: string; do?: string; aktywny?: boolean } = {};
          try { kom = JSON.parse(values['komunikat'] ?? '{}'); } catch { /* empty */ }
          const updateKom = (patch: Partial<typeof kom>) => {
            set('komunikat', JSON.stringify({ ...kom, ...patch }));
          };
          const days = [
            { v: '1', l: 'Pn' }, { v: '2', l: 'Wt' }, { v: '3', l: 'Śr' },
            { v: '4', l: 'Cz' }, { v: '5', l: 'Pt' }, { v: '6', l: 'Sb' }, { v: '0', l: 'Nd' },
          ];
          const csv = (values['open_days'] ?? '0,5,6').split(',').map(s => s.trim()).filter(Boolean);
          return <>
            {/* ═══ HERO STATUS BANNER ═══ Wielki, dramatyczny — od razu widać stan parkingu */}
            <div className={`relative overflow-hidden rounded-[var(--radius-xl)] p-7 mb-6 animate-slideUp shadow-[var(--shadow-lg)]
              ${isAvailable
                ? 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:via-emerald-950/40 dark:to-emerald-900/30 border border-emerald-300/40 dark:border-emerald-700/30'
                : 'bg-gradient-to-br from-red-100 via-red-50 to-red-100 dark:from-red-900/30 dark:via-red-950/40 dark:to-red-900/30 border border-red-300/40 dark:border-red-700/30'}`}>
              {/* Animowany glow w tle */}
              <div className={`absolute -top-20 -right-20 w-64 h-64 rounded-full blur-3xl opacity-40 animate-[pulse-soft_4s_ease-in-out_infinite]
                ${isAvailable ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full blur-3xl opacity-25"
                   style={{ background: 'var(--gradient-accent)' }} />

              <div className="relative flex items-center gap-6 flex-wrap">
                <div className={`w-20 h-20 rounded-[var(--radius-lg)] flex items-center justify-center shadow-[var(--shadow-md)] flex-shrink-0
                  ${isAvailable ? 'bg-[var(--color-success)] ring-glow' : 'bg-[var(--color-danger)]'}`}>
                  <Car size={40} className="text-white" />
                </div>
                <div className="flex-1 min-w-[220px]">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)] mb-1">Status parkingu (walk-in)</p>
                  <h2 className={`display-heading ${isAvailable ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                    {isAvailable ? 'WOLNE MIEJSCA' : 'PARKING PEŁNY'}
                  </h2>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">
                    {isAvailable ? 'Klienci mogą przyjechać bez rezerwacji' : 'Bot odpowiada „brak miejsc", strona pokazuje czerwony pasek'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 ml-auto">
                  <button
                    onClick={() => set('spots_available', 'true')}
                    className={`px-5 py-2.5 rounded-[var(--radius-md)] font-bold text-sm transition-all duration-200 border-2
                      ${isAvailable
                        ? 'bg-[var(--color-success)] border-[var(--color-success)] text-white shadow-[var(--shadow-md)] cursor-default'
                        : 'border-emerald-400/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500'}`}>
                    ✓ Otwórz
                  </button>
                  <button
                    onClick={() => set('spots_available', 'false')}
                    className={`px-5 py-2.5 rounded-[var(--radius-md)] font-bold text-sm transition-all duration-200 border-2
                      ${!isAvailable
                        ? 'bg-[var(--color-danger)] border-[var(--color-danger)] text-white shadow-[var(--shadow-md)] cursor-default'
                        : 'border-red-400/50 text-red-700 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500'}`}>
                    ✕ Zamknij
                  </button>
                </div>
              </div>
            </div>

            {/* ═══ MASONRY KART — Cennik | Pojemność | Godziny | Dni dodatkowe ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* CENNIK — z hero ceną */}
              <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5"
                   style={{ animationDelay: '50ms' }}>
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
                      <Banknote size={22} className="text-[#1a1410]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[var(--color-text)]">Cennik</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">Stawki widoczne na stronie i w czacie bota</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1">Walk-in</p>
                    <div className="flex items-baseline gap-1">
                      <input
                        type="text"
                        value={values['rate_basic'] ?? ''}
                        onChange={e => set('rate_basic', e.target.value)}
                        placeholder="20"
                        className="hero-number bg-transparent border-0 outline-none w-full p-0 leading-none"
                        style={{ fontSize: 'clamp(2.2rem,5vw,3.5rem)' }}
                      />
                      <span className="text-lg font-bold text-[var(--color-text-muted)]">zł</span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">/ dobę bez rezerwacji</p>
                  </div>
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-accent)] mb-1">Z rezerwacją ★</p>
                    <div className="flex items-baseline gap-1">
                      <input
                        type="text"
                        value={values['rate_reservation'] ?? ''}
                        onChange={e => set('rate_reservation', e.target.value)}
                        placeholder="25"
                        className="hero-number bg-transparent border-0 outline-none w-full p-0 leading-none"
                        style={{ fontSize: 'clamp(2.2rem,5vw,3.5rem)' }}
                      />
                      <span className="text-lg font-bold text-[var(--color-text-muted)]">zł</span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">/ dobę online</p>
                  </div>
                </div>
              </div>

              {/* POJEMNOŚĆ — duża cyfra */}
              <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5"
                   style={{ animationDelay: '100ms' }}>
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
                      <MapPin size={22} className="text-[#1a1410]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[var(--color-text)]">Pojemność online</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">Reszta klientów przyjeżdża walk-in</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-center py-4">
                  <div className="flex items-baseline gap-3">
                    <input
                      type="number"
                      value={values['parking_capacity'] ?? ''}
                      onChange={e => set('parking_capacity', e.target.value)}
                      placeholder="10"
                      className="hero-number bg-transparent border-0 outline-none p-0 leading-none w-32 text-center"
                    />
                    <span className="text-xl font-bold text-[var(--color-text-muted)]">miejsc</span>
                  </div>
                </div>
              </div>

              {/* GODZINY OTWARCIA */}
              <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5"
                   style={{ animationDelay: '150ms' }}>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
                    <Clock size={22} className="text-[#1a1410]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-text)]">Godziny otwarcia</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Codziennie obowiązujące</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Otwarcie</p>
                    <input type="time" value={values['open_from'] ?? ''}
                      onChange={e => set('open_from', e.target.value)}
                      className="w-full text-2xl font-bold text-[var(--color-text)] bg-transparent border-2 border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-2 hover:border-[var(--color-accent)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-1.5">Zamknięcie</p>
                    <input type="time" value={values['open_to'] ?? ''}
                      onChange={e => set('open_to', e.target.value)}
                      className="w-full text-2xl font-bold text-[var(--color-text)] bg-transparent border-2 border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-2 hover:border-[var(--color-accent)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
                  </div>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-text-muted)] mb-2">Dni pracujące</p>
                <div className="flex flex-wrap gap-1.5">
                  {days.map(({ v, l }) => {
                    const active = csv.includes(v);
                    return (
                      <button key={v}
                        onClick={() => {
                          const next = active ? csv.filter(x => x !== v) : [...csv, v];
                          next.sort();
                          set('open_days', next.join(','));
                        }}
                        className={`w-12 h-12 rounded-[var(--radius-md)] text-sm font-bold transition-all duration-200 relative overflow-hidden
                          ${active
                            ? 'text-[#1a1410] shadow-[var(--shadow-md)] scale-105'
                            : 'border-2 border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'}`}>
                        {active && <span className="absolute inset-0 bg-gradient-accent" aria-hidden="true" />}
                        <span className="relative z-10">{l}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* DNI DODATKOWE */}
              <div className="glass-strong rounded-[var(--radius-lg)] p-6 animate-slideUp transition-all hover:shadow-[var(--shadow-xl)] hover:-translate-y-0.5"
                   style={{ animationDelay: '200ms' }}>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-11 h-11 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center shadow-[var(--shadow-md)]">
                    <CalendarPlus size={22} className="text-[#1a1410]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-text)]">Dni dodatkowe</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Jednorazowe wyjątki — święto, długi weekend</p>
                  </div>
                </div>
                <div className="flex gap-2 mb-4">
                  <input
                    type="date"
                    value={extraDayInput}
                    onChange={e => setExtraDayInput(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  <Button size="sm" variant="primary" onClick={addExtraDay} disabled={!extraDayInput || extraDaysLoading}>
                    + Dodaj
                  </Button>
                  <Button size="sm" variant="ghost" onClick={fetchExtraDays} disabled={extraDaysLoading} title="Odśwież">⟳</Button>
                </div>
                {extraDaysError && <p className="text-xs text-[var(--color-danger)] mb-2 font-medium">Błąd: {extraDaysError}</p>}
                {extraDaysLoading && <p className="text-xs text-[var(--color-text-muted)] mb-2">Ładowanie...</p>}
                <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
                  {extraDays.length === 0 && !extraDaysLoading && (
                    <span className="text-xs text-[var(--color-text-muted)] opacity-60 italic py-2">brak dodatkowych dni</span>
                  )}
                  {extraDays.map(d => (
                    <span key={d.id ?? d.date}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-sm)] animate-fadeIn">
                      {plToIsoDate(d.date)}
                      <button
                        onClick={() => d.id != null && removeExtraDay(d.id)}
                        className="ml-0.5 w-4 h-4 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
                        aria-label={`Usuń ${d.date}`}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* ═══ KOMUNIKAT — full width, animowany gdy aktywny ═══ */}
            <div className={`relative overflow-hidden rounded-[var(--radius-lg)] p-6 mt-5 animate-slideUp transition-all
              ${kom.aktywny
                ? 'bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-100 dark:from-amber-900/30 dark:via-yellow-950/30 dark:to-amber-900/30 border-2 border-amber-400/50 shadow-[var(--shadow-glow)]'
                : 'glass-strong'}`}
                 style={{ animationDelay: '250ms' }}>
              {kom.aktywny && (
                <div className="absolute top-0 left-0 w-full h-1 shimmer-bg" />
              )}
              <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center shadow-[var(--shadow-md)]
                    ${kom.aktywny ? 'bg-gradient-accent animate-[pulse-soft_2s_ease-in-out_infinite]' : 'bg-[var(--color-surface-2)]'}`}>
                    <Megaphone size={22} className={kom.aktywny ? 'text-[#1a1410]' : 'text-[var(--color-text-muted)]'} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-text)]">Komunikat na stronie WWW</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Żółty baner — np. zmiana godzin, majówka, awaria</p>
                  </div>
                </div>
                <button
                  onClick={() => updateKom({ aktywny: !kom.aktywny })}
                  className={`px-4 py-2 rounded-full font-bold text-xs transition-all
                    ${kom.aktywny
                      ? 'bg-gradient-accent text-[#1a1410] shadow-[var(--shadow-md)]'
                      : 'border-2 border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-warning)] hover:text-[var(--color-warning)]'}`}>
                  {kom.aktywny ? '● AKTYWNY' : '○ nieaktywny'}
                </button>
              </div>
              <div className="space-y-3">
                <Input label="Tytuł"
                  value={kom.tytul ?? ''}
                  onChange={e => updateKom({ tytul: e.target.value })}
                  placeholder="np. Zmiana godzin otwarcia – Majówka" />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Treść</label>
                  <textarea
                    value={kom.tresc ?? ''}
                    onChange={e => updateKom({ tresc: e.target.value })}
                    rows={3}
                    placeholder="Treść komunikatu widoczna na stronie..."
                    className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] text-sm resize-none transition-all hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-accent)]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Widoczny od" type="datetime-local"
                    value={kom.od ?? ''}
                    onChange={e => updateKom({ od: e.target.value })} />
                  <Input label="Widoczny do" type="datetime-local"
                    value={kom.do ?? ''}
                    onChange={e => updateKom({ do: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Spacer dla floating save button */}
            <div className="h-24" />

            {/* ═══ FLOATING SAVE BUTTON ═══ Zawsze widoczny w prawym dolnym rogu */}
            <div className="fixed bottom-8 right-8 z-50 animate-slideUp">
              <button
                onClick={handleCloudSaveParking}
                disabled={cloudSaving}
                className={`group relative inline-flex items-center gap-3 px-7 py-4 rounded-full font-bold text-base text-[#1a1410] shadow-[var(--shadow-xl)] hover:shadow-[var(--shadow-glow)] transition-all duration-300 hover:scale-105 active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-accent`}>
                {cloudSaving ? (
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : cloudResult?.ok ? (
                  <Check size={20} />
                ) : (
                  <Cloud size={20} />
                )}
                <span>
                  {cloudSaving ? 'Wysyłam...' : cloudResult?.ok ? 'Zapisano!' : 'Zapisz w chmurze'}
                </span>
                {/* Pulsująca otoczka */}
                {!cloudSaving && !cloudResult?.ok && (
                  <span className="absolute inset-0 rounded-full ring-glow pointer-events-none" aria-hidden="true" />
                )}
              </button>
              {cloudResult && !cloudResult.ok && (
                <div className="mt-2 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-danger)] text-white text-xs font-bold shadow-[var(--shadow-md)] max-w-xs animate-fadeIn">
                  ✕ {cloudResult.error}
                </div>
              )}
            </div>
          </>;
        })()}

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