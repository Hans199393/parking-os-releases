/**
 * Settings — wspólne typy i stałe dla nowej struktury (Iteracja 2).
 */

export const ALL_SETTINGS_KEYS = [
  // Kamery
  'cam1_snapshot_url', 'cam1_rtsp_url', 'cam1_hls_url', 'cam1_name',
  'cam2_snapshot_url', 'cam2_rtsp_url', 'cam2_hls_url', 'cam2_name',
  'cam3_snapshot_url', 'cam3_rtsp_url', 'cam3_hls_url', 'cam3_name',
  'cam4_snapshot_url', 'cam4_rtsp_url', 'cam4_hls_url', 'cam4_name',
  'snapshot_interval', 'show_roi_overlay',
  // Detekcja
  'detection_confidence', 'detection_interval', 'detector_autostart',
  // Parking (lokalne — nazwa, pojemność jako fallback)
  'parking_name', 'parking_capacity',
  'rate_hourly', 'rate_daily', 'currency', 'card_commission_rate',
  // Połączenia
  'supabase_url', 'supabase_key',
  'email_imap_host', 'email_imap_port', 'email_smtp_host', 'email_smtp_port',
  'email_user', 'email_pass',
  'email_signature_html',
  'admin_url', 'admin_token',
  // Wygląd
  'session_timeout', 'confirm_exit', 'accent_color',
  // Radio internetowe (lokalne)
  'radio_autoplay', 'radio_volume', 'radio_muted',
  'radio_last_station_id', 'radio_last_station_name', 'radio_last_stream_url',
  'radio_panel_open', 'radio_favorites',
  // Cloud-mirrored (Supabase settings) — cache lokalny
  'rate_basic', 'rate_reservation', 'rate_after_hours',
  'open_from', 'open_to', 'open_days',
  'spots_available', 'komunikat',
  'owner_phone', 'owner_email', 'parking_address', 'parking_nip',
  // Messenger / panel WWW
  'authorized_psids',
  // AI Asystent (Orzeł) — lokalny czat z function calling
  'groq_api_key', 'groq_model', 'orzel_temperature',
  // Rozszerzony tryb desktopowy: pozwala na swobodne zapytania (tylko desktop)
  'orzel_expanded_mode',
  // Konfigurowalne przyciski quick-action w panelu Orła (CSV nazw narzędzi)
  'orzel_quick_actions',
] as const;

export type SettingKey = typeof ALL_SETTINGS_KEYS[number] | (string & {});

export const CAM_DEFAULTS = [
  { id: 'cam1', defaultName: 'CAM 1 — IMOU' },
  { id: 'cam2', defaultName: 'CAM 2 — YCC365Plus #1' },
  { id: 'cam3', defaultName: 'CAM 3 — YCC365Plus #2' },
  { id: 'cam4', defaultName: 'CAM 4' },
] as const;

export const ACCENT_COLORS = [
  { id: 'gold',   label: 'Złoty',        hex: '#f59e0b', strong: '#d97706', gradient: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #d97706 100%)' },
  { id: 'teal',   label: 'Teal',         hex: '#2dd4bf', strong: '#0d9488', gradient: 'linear-gradient(135deg, #5eead4 0%, #2dd4bf 50%, #0d9488 100%)' },
  { id: 'blue',   label: 'Niebieski',    hex: '#3b82f6', strong: '#1d4ed8', gradient: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #1d4ed8 100%)' },
  { id: 'violet', label: 'Fioletowy',    hex: '#a855f7', strong: '#7e22ce', gradient: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #7e22ce 100%)' },
  { id: 'orange', label: 'Pomarańczowy', hex: '#f97316', strong: '#c2410c', gradient: 'linear-gradient(135deg, #fb923c 0%, #f97316 50%, #c2410c 100%)' },
  { id: 'green',  label: 'Zielony',      hex: '#22c55e', strong: '#15803d', gradient: 'linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #15803d 100%)' },
  { id: 'pink',   label: 'Różowy',       hex: '#ec4899', strong: '#be185d', gradient: 'linear-gradient(135deg, #f472b6 0%, #ec4899 50%, #be185d 100%)' },
] as const;

export function applyAccentColor(hex: string) {
  const root = document.documentElement;
  const def = ACCENT_COLORS.find(c => c.hex === hex) ?? ACCENT_COLORS[0];
  root.style.setProperty('--color-accent', def.hex);
  root.style.setProperty('--color-accent-strong', def.strong);
  root.style.setProperty('--gradient-accent', def.gradient);
  // Shadow glow oparta o accent (rgba z hex)
  const r = parseInt(def.hex.slice(1, 3), 16);
  const g = parseInt(def.hex.slice(3, 5), 16);
  const b = parseInt(def.hex.slice(5, 7), 16);
  root.style.setProperty('--shadow-glow', `0 0 20px rgba(${r}, ${g}, ${b}, 0.35)`);
}

export type SettingsTabId = 'parking' | 'devices' | 'integrations' | 'appearance' | 'accounts' | 'assistants' | 'system';

export type SettingsValues = Record<string, string>;
