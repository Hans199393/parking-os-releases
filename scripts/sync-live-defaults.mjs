import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const liveSettingsPath = path.resolve(process.env.APPDATA ?? '', 'com.klose.parking-os', 'settings.json');
const tsDefaultsPath = path.join(rootDir, 'src', 'lib', 'defaultSettings.ts');
const jsonDefaultsPath = path.join(rootDir, 'src-tauri', 'default-settings.json');
const syncedKeys = ['email_signature_html', 'detector_roi', 'show_roi_overlay'];

function stripBom(text) {
  return text.replace(/^\uFEFF/, '');
}

function readJson(filePath) {
  return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function syncTsDefaults(liveSettings) {
  const original = fs.readFileSync(tsDefaultsPath, 'utf8');
  let updated = original;

  for (const key of syncedKeys) {
    const pattern = new RegExp(`^(\\s*${key}:\\s*)([^\\n]*)(,)$`, 'm');
    if (!pattern.test(updated)) {
      throw new Error(`Key not found in defaultSettings.ts: ${key}`);
    }

    const nextValue = JSON.stringify(String(liveSettings[key] ?? ''));
    updated = updated.replace(pattern, (_match, prefix, _value, suffix) => `${prefix}${nextValue}${suffix}`);
  }

  if (updated !== original) {
    fs.writeFileSync(tsDefaultsPath, updated, 'utf8');
  }
}

function syncJsonDefaults(liveSettings) {
  const original = fs.readFileSync(jsonDefaultsPath, 'utf8');
  const eol = detectEol(original);
  const parsed = JSON.parse(stripBom(original));

  for (const key of syncedKeys) {
    parsed[key] = String(liveSettings[key] ?? '');
  }

  const next = `${JSON.stringify(parsed, null, 4).replace(/\n/g, eol)}${eol}`;
  if (next !== original) {
    fs.writeFileSync(jsonDefaultsPath, next, 'utf8');
  }
}

function main() {
  if (!fs.existsSync(liveSettingsPath)) {
    throw new Error(`Live settings file not found: ${liveSettingsPath}`);
  }

  const liveSettings = readJson(liveSettingsPath);
  for (const key of syncedKeys) {
    if (!(key in liveSettings)) {
      throw new Error(`Missing key in live settings: ${key}`);
    }
  }

  syncTsDefaults(liveSettings);
  syncJsonDefaults(liveSettings);

  console.log(JSON.stringify({
    syncedFrom: liveSettingsPath,
    syncedKeys: Object.fromEntries(
      syncedKeys.map((key) => [
        key,
        key === 'email_signature_html'
          ? { length: String(liveSettings[key]).length }
          : String(liveSettings[key]),
      ]),
    ),
  }, null, 2));
}

main();