import { load } from '@tauri-apps/plugin-store';

// Single helper to load the settings store with correct options
export async function getStore() {
  return load('settings.json', { defaults: {} });
}
