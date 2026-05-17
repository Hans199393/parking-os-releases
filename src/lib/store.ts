import { load } from '@tauri-apps/plugin-store';
import { DEFAULT_SETTINGS } from './defaultSettings';

// Single helper to load the settings store with correct options
export async function getStore() {
  const store = await load('settings.json', { defaults: DEFAULT_SETTINGS });
  let changed = false;

  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const current = await store.get<string | number | boolean>(key);
    const missing = current == null || (String(current).trim() === '' && fallback !== '');
    if (missing) {
      await store.set(key, fallback);
      changed = true;
    }
  }

  if (changed) {
    await store.save();
  }

  return store;
}
