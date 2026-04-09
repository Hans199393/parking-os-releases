import { invoke } from '@tauri-apps/api/core';
import { getStore } from './store';

const STORE_KEY = 'auth_password_hash';
const DEFAULT_PASSWORD = '<REDACTED_ADMIN_PASSWORD>';
const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

let failedAttempts = 0;
let lockoutUntil: number | null = null;

export async function isFirstRun(): Promise<boolean> {
  const store = await getStore();
  const hash = await store.get<string>(STORE_KEY);
  return !hash;
}

export async function initDefaultPassword(): Promise<void> {
  const store = await getStore();
  const hash: string = await invoke('hash_password', { password: DEFAULT_PASSWORD });
  await store.set(STORE_KEY, hash);
  await store.save();
}

export async function verifyPassword(password: string): Promise<{ ok: boolean; lockout?: number }> {
  if (lockoutUntil && Date.now() < lockoutUntil) {
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
    return { ok: false, lockout: remaining };
  }

  const store = await getStore();
  const hash = await store.get<string>(STORE_KEY);

  if (!hash) {
    await initDefaultPassword();
    return verifyPassword(password);
  }

  const ok: boolean = await invoke('verify_password', { password, hashed: hash });

  if (ok) {
    failedAttempts = 0;
    lockoutUntil = null;
    return { ok: true };
  }

  failedAttempts++;
  if (failedAttempts >= MAX_ATTEMPTS) {
    lockoutUntil = Date.now() + LOCKOUT_SECONDS * 1000;
    failedAttempts = 0;
  }
  return { ok: false };
}

export async function changePassword(newPassword: string): Promise<void> {
  const store = await getStore();
  const hash: string = await invoke('hash_password', { password: newPassword });
  await store.set(STORE_KEY, hash);
  await store.save();
}
