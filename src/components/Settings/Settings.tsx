import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getStore } from '../../lib/store';
import { resetSupabaseClient } from '../../lib/supabase';
import { changePassword as changeAuthPassword } from '../../lib/auth';
import { Button, Input, Card } from '../shared/UI';
import { Check, Eye, EyeOff, Wifi, WifiOff } from 'lucide-react';

const SETTINGS_KEYS = [
  { key: 'cam1_snapshot_url', label: 'CAM 1 — IMOU (Snapshot HTTP URL)', placeholder: 'http://admin:HASŁO@192.168.0.50/cgi-bin/snapshot.cgi', group: 'cam1' },
  { key: 'cam1_rtsp_url', label: 'CAM 1 — IMOU (RTSP URL — do VLC)', placeholder: 'rtsp://admin:HASŁO@192.168.0.50:554/cam/realmonitor?channel=1&subtype=0', group: 'cam1' },
  { key: 'cam1_hls_url', label: 'CAM 1 — IMOU (HLS Live URL — po uruchomieniu proxy)', placeholder: 'http://localhost:8888/stream/cam1.m3u8', group: 'cam1' },
  { key: 'cam2_snapshot_url', label: 'CAM 2 — YCC365Plus #1 (Snapshot HTTP URL)', placeholder: 'http://admin:HASŁO@IP/snapshot', group: 'cam2' },
  { key: 'cam2_rtsp_url', label: 'CAM 2 — YCC365Plus #1 (RTSP URL)', placeholder: 'rtsp://admin:HASŁO@IP:554/...', group: 'cam2' },
  { key: 'cam2_hls_url', label: 'CAM 2 — YCC365Plus #1 (HLS Live URL)', placeholder: 'http://localhost:8888/stream/cam2.m3u8', group: 'cam2' },
  { key: 'cam3_snapshot_url', label: 'CAM 3 — YCC365Plus #2 (Snapshot HTTP URL)', placeholder: 'http://admin:HASŁO@IP/snapshot', group: 'cam3' },
  { key: 'cam3_rtsp_url', label: 'CAM 3 — YCC365Plus #2 (RTSP URL)', placeholder: 'rtsp://admin:HASŁO@IP:554/...', group: 'cam3' },
  { key: 'cam3_hls_url', label: 'CAM 3 — YCC365Plus #2 (HLS Live URL)', placeholder: 'http://localhost:8888/stream/cam3.m3u8', group: 'cam3' },
  { key: 'cam4_snapshot_url', label: 'CAM 4 (Snapshot HTTP URL)', placeholder: 'http://admin:HASŁO@IP/snapshot', group: 'cam4' },
  { key: 'cam4_rtsp_url', label: 'CAM 4 (RTSP URL)', placeholder: 'rtsp://admin:HASŁO@IP:554/...', group: 'cam4' },
  { key: 'cam4_hls_url', label: 'CAM 4 (HLS Live URL — po uruchomieniu proxy)', placeholder: 'http://localhost:8888/stream/cam4.m3u8', group: 'cam4' },
  { key: 'supabase_url', label: 'Supabase URL', placeholder: 'https://xxx.supabase.co', group: 'supabase' },
  { key: 'supabase_key', label: 'Supabase Service Key', placeholder: 'eyJ...', group: 'supabase' },
  { key: 'admin_url', label: 'URL panelu CMS (strona administracyjna)', placeholder: 'https://twoja-domena.pl/zaplecze-mk', group: 'other' },
  { key: 'pwa_url', label: 'URL panelu iPad (PWA)', placeholder: 'http://localhost:3001', group: 'other' },
  { key: 'email_imap_host', label: 'IMAP serwer', placeholder: 'np. poczta.ohv.pl', group: 'email' },
  { key: 'email_imap_port', label: 'IMAP port', placeholder: '993', group: 'email' },
  { key: 'email_smtp_host', label: 'SMTP serwer', placeholder: 'np. poczta.ohv.pl', group: 'email' },
  { key: 'email_smtp_port', label: 'SMTP port', placeholder: '465', group: 'email' },
  { key: 'email_user', label: 'Login (adres e-mail)', placeholder: 'kontakt@parkingsobieszewo.pl', group: 'email' },
  { key: 'email_pass', label: 'Hasło', placeholder: '••••••••', group: 'email' },
];

export default function Settings({
  onThemeChange,
  theme,
  onSettingsSaved,
}: {
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  theme: 'light' | 'dark' | 'system';
  onSettingsSaved?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Test connection
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Password change
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState(false);
  const [savingPass, setSavingPass] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    getStore().then(async store => {
      const loaded: Record<string, string> = {};
      for (const { key } of SETTINGS_KEYS) {
        loaded[key] = (await store.get<string>(key)) ?? '';
      }
      setValues(loaded);
    });
  }, []);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const store = await getStore();
      for (const { key } of SETTINGS_KEYS) {
        await store.set(key, values[key] ?? '');
      }
      await store.save();
      resetSupabaseClient();
      onSettingsSaved?.();
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    // Use current form values directly without saving to store first
    const { createClient } = await import('@supabase/supabase-js');
    const url = values['supabase_url'] ?? '';
    const key = values['supabase_key'] ?? '';
    try {
      const client = createClient(url, key);
      const { error } = await client.from('settings').select('key').limit(1);
      setTestResult(error ? { ok: false, error: error.message } : { ok: true });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Błąd połączenia' });
    }
    setTesting(false);
  };

  const handleChangePassword = async () => {
    setPassError('');
    if (!newPass) { setPassError('Wpisz nowe hasło.'); return; }
    if (newPass !== newPass2) { setPassError('Hasła nie są identyczne.'); return; }
    if (newPass.length < 8) { setPassError('Hasło musi mieć minimum 8 znaków.'); return; }

    setSavingPass(true);
    try {
      const { verifyPassword } = await import('../../lib/auth');
      const res = await verifyPassword(oldPass);
      if (!res.ok) { setPassError('Nieprawidłowe obecne hasło.'); return; }
      await changeAuthPassword(newPass);
      setOldPass(''); setNewPass(''); setNewPass2('');
      setPassSuccess(true);
      setTimeout(() => setPassSuccess(false), 3000);
    } catch {
      setPassError('Błąd zmiany hasła.');
    } finally {
      setSavingPass(false);
    }
  };

  const handleTestImap = async () => {
    setTestingEmail(true);
    setEmailTestResult(null);
    try {
      await invoke('email_test_imap', {
        imapHost: values['email_imap_host'] ?? '',
        imapPort: parseInt(values['email_imap_port'] ?? '993') || 993,
        user: values['email_user'] ?? '',
        pass: values['email_pass'] ?? '',
      });
      setEmailTestResult({ ok: true });
    } catch (e) {
      setEmailTestResult({ ok: false, error: String(e) });
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Ustawienia</h1>
        <p className="text-[var(--color-text-muted)] text-sm mt-1">Konfiguracja aplikacji Parking.OS</p>
      </div>

      {/* Supabase */}
      <Card title="Baza danych (Supabase — rezerwacje)">
        <div className="space-y-4">
          {SETTINGS_KEYS.filter(s => s.group === 'supabase').map(({ key, label, placeholder }) => (
            <Input
              key={key}
              label={label}
              type={key === 'supabase_key' ? 'password' : 'text'}
              placeholder={placeholder}
              value={values[key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <Button variant="secondary" onClick={handleTestConnection} loading={testing} size="sm">
            {testResult?.ok ? <Wifi size={14} /> : <WifiOff size={14} />} Testuj połączenie
          </Button>
          {testResult && (
            <span className={`text-sm font-medium ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.ok ? '✓ Połączenie OK' : `✗ ${testResult.error}`}
            </span>
          )}
        </div>
      </Card>

      {/* Email */}
      <Card title="Poczta e-mail (IMAP / SMTP — Zimbra)">
        <div className="space-y-4">
          {SETTINGS_KEYS.filter(s => s.group === 'email').map(({ key, label, placeholder }) => (
            <Input
              key={key}
              label={label}
              type={key === 'email_pass' ? 'password' : 'text'}
              placeholder={placeholder}
              value={values[key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
            />
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-3">
          IMAP port: 993 (SSL) · SMTP port: 465 (SSL) · Serwer: sprawdź w pasku URL Zimbra webmail lub w dokumentacji ohv.pl
        </p>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <Button variant="secondary" onClick={handleTestImap} loading={testingEmail} size="sm">
            {emailTestResult?.ok ? <Wifi size={14} /> : <WifiOff size={14} />} Testuj IMAP
          </Button>
          {emailTestResult && (
            <span className={`text-sm font-medium ${emailTestResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {emailTestResult.ok ? '✓ Połączenie OK' : `✗ ${emailTestResult.error}`}
            </span>
          )}
        </div>
      </Card>

      {/* Cameras */}
      <Card title="Kamery">
        <p className="text-slate-500 text-xs mb-4">Dla każdej kamery wystarczy jeden URL (Snapshot HTTP lub HLS). RTSP URL służy tylko do kopiowania do VLC.</p>
        {['cam1', 'cam2', 'cam3', 'cam4'].map((group, idx) => (
          <div key={group} className="mb-5 last:mb-0">
            <h4 className="text-sm font-medium text-teal-400 mb-2">
              {idx === 0 ? 'CAM 1 — IMOU' : idx === 1 ? 'CAM 2 — YCC365Plus #1' : idx === 2 ? 'CAM 3 — YCC365Plus #2' : 'CAM 4 — (nowa kamera)'}
            </h4>
            <div className="space-y-3 pl-3 border-l-2 border-slate-700">
              {SETTINGS_KEYS.filter(s => s.group === group).map(({ key, label, placeholder }) => (
                <Input
                  key={key}
                  label={label.replace(/^CAM \d — [\w#+ ]+ \(/, '').replace(/\)$/, '')}
                  type="text"
                  placeholder={placeholder}
                  value={values[key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
                />
              ))}
            </div>
          </div>
        ))}
      </Card>

      {/* Other */}
      <Card title="Inne">
        <div className="space-y-4">
          {SETTINGS_KEYS.filter(s => s.group === 'other').map(({ key, label, placeholder }) => (
            <Input
              key={key}
              label={label}
              type="text"
              placeholder={placeholder}
              value={values[key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
            />
          ))}
        </div>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleSaveSettings} loading={savingSettings}>
          <Check size={16} /> Zapisz wszystkie ustawienia
        </Button>
        {saved && <span className="text-green-400 text-sm font-medium">✓ Zapisano</span>}
      </div>

      {/* Theme */}
      <Card title="Motyw">
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map(t => (
            <button
              key={t}
              onClick={() => onThemeChange(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                ${theme === t
                  ? 'bg-teal-500/20 border-teal-500/50 text-teal-400'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
                }`}
            >
              {t === 'light' ? 'Jasny' : t === 'dark' ? 'Ciemny' : 'Systemowy'}
            </button>
          ))}
        </div>
      </Card>

      {/* Password */}
      <Card title="Zmiana hasła">
        <div className="space-y-4 max-w-sm">
          <div className="relative">
            <Input
              label="Obecne hasło"
              type={showPass ? 'text' : 'password'}
              value={oldPass}
              onChange={e => setOldPass(e.target.value)}
            />
            <button
              onClick={() => setShowPass(s => !s)}
              className="absolute right-3 top-8 text-slate-500 hover:text-slate-300"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <Input label="Nowe hasło" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
          <Input label="Powtórz nowe hasło" type="password" value={newPass2} onChange={e => setNewPass2(e.target.value)} error={passError} />
          <div className="flex items-center gap-3 mt-2">
            <Button variant="primary" onClick={handleChangePassword} loading={savingPass}>
              <Check size={16} /> Zmień hasło
            </Button>
            {passSuccess && <span className="text-green-400 text-sm font-medium">✓ Hasło zmienione</span>}
          </div>
        </div>
      </Card>

      {/* Version info */}
      <Card>
        <p className="text-slate-500 text-xs">Parking.OS v1.0.0 · Parking płatny niestrzeżony "Michał Kłos"</p>
        <p className="text-slate-600 text-xs mt-1">Gdańsk, Wyspa Sobieszewska, ul. Turystyczna 69</p>
      </Card>
    </div>
  );
}
