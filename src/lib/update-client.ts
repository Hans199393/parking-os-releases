import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';

import type { AppUpdateInfo, AppUpdateInstallKind, AppUpdateManifest, AppUpdateProgress, UpdateProvider } from './update-types';

const DEFAULT_PRIVATE_UPDATE_MANIFEST_URL = 'https://parking-messenger-bot.vercel.app/api/update-manifest';
const PRIVATE_UPDATE_MANIFEST_URL =
  (import.meta.env.VITE_PRIVATE_UPDATER_MANIFEST_URL ?? '').trim() || DEFAULT_PRIVATE_UPDATE_MANIFEST_URL;
const PRIVATE_UPDATE_MANIFEST_TIMEOUT_MS = 2500;
const UPDATE_CHANNEL = 'stable';
const UPDATE_PLATFORM = 'windows-x86_64';
const HELPER_UPDATE_PROGRESS_EVENT = 'helper-update-progress';

interface HelperUpdateLaunchResult {
  filePath: string;
}

interface HelperUpdateProgressEventPayload {
  phase: 'started' | 'progress';
  contentLength: number | null;
  chunkLength: number;
}

function normalizeUpdate(
  update: { version: string; date?: string | null; body?: string | null },
  installKind: AppUpdateInstallKind = 'tauri',
): AppUpdateInfo {
  return {
    version: update.version,
    date: update.date ?? '—',
    body: update.body ?? null,
    installKind,
  };
}

function normalizeManifestUpdate(manifest: AppUpdateManifest): AppUpdateInfo {
  return {
    version: manifest.version ?? '—',
    date: manifest.pubDate ?? '—',
    body: manifest.notes ?? null,
    installKind: manifest.installKind,
  };
}

function toVersionParts(input: string): number[] {
  return input
    .split('.')
    .map(part => Number.parseInt(part, 10))
    .map(part => (Number.isFinite(part) ? part : 0));
}

function isVersionNewer(candidate: string, current: string): boolean {
  const a = toVersionParts(candidate);
  const b = toVersionParts(current);
  const len = Math.max(a.length, b.length);

  for (let index = 0; index < len; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }

  return false;
}

function normalizeManifest(payload: unknown): AppUpdateManifest | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = payload as Record<string, unknown>;
  const rawSource = data.source;
  const source = rawSource && typeof rawSource === 'object'
    ? rawSource as Record<string, unknown>
    : {};

  return {
    ok: data.ok !== false,
    channel: typeof data.channel === 'string' && data.channel.trim() ? data.channel : UPDATE_CHANNEL,
    platform: typeof data.platform === 'string' && data.platform.trim() ? data.platform : null,
    available: Boolean(data.available),
    disabled: Boolean(data.disabled),
    installKind: data.installKind === 'helper' ? 'helper' : 'tauri',
    version: typeof data.version === 'string' && data.version.trim() ? data.version : null,
    notes: typeof data.notes === 'string' ? data.notes : null,
    pubDate: typeof data.pubDate === 'string'
      ? data.pubDate
      : (typeof data.pub_date === 'string' ? data.pub_date : null),
    minSupportedVersion: typeof data.minSupportedVersion === 'string' && data.minSupportedVersion.trim()
      ? data.minSupportedVersion
      : null,
    source: {
      tauriManifestUrl: typeof source.tauriManifestUrl === 'string' && source.tauriManifestUrl.trim()
        ? source.tauriManifestUrl
        : null,
      fullPackageUrl: typeof source.fullPackageUrl === 'string' && source.fullPackageUrl.trim()
        ? source.fullPackageUrl
        : null,
      patchPackageUrl: typeof source.patchPackageUrl === 'string' && source.patchPackageUrl.trim()
        ? source.patchPackageUrl
        : null,
    },
  };
}

async function fetchManifest(url: string): Promise<AppUpdateManifest | null> {
  const currentVersion = await getVersion().catch(() => '0.0.0');
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('currentVersion', currentVersion);
  requestUrl.searchParams.set('channel', UPDATE_CHANNEL);
  requestUrl.searchParams.set('platform', UPDATE_PLATFORM);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PRIVATE_UPDATE_MANIFEST_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const manifest = normalizeManifest(payload);
    if (!manifest || !manifest.version) return manifest;

    if (!manifest.available && isVersionNewer(manifest.version, currentVersion)) {
      return {
        ...manifest,
        available: true,
      };
    }

    return manifest;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getHelperPackageUrl(manifest: AppUpdateManifest): string | null {
  const value = manifest.source.fullPackageUrl ?? '';
  const normalized = value.trim();
  return normalized || null;
}

function inferHelperFileName(url: string, version: string): string {
  const path = url.split('#')[0]?.split('?')[0] ?? '';
  const candidate = path.slice(path.lastIndexOf('/') + 1).trim();
  const safeName = candidate.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  if (safeName) return safeName;
  return `Parking.OS_${version}_helper-update.exe`;
}

async function launchHelperInstaller(
  url: string,
  version: string,
  onProgress?: (progress: AppUpdateProgress) => void,
): Promise<string> {
  let unlisten: null | (() => void) = null;

  if (onProgress) {
    try {
      unlisten = await listen<HelperUpdateProgressEventPayload>(HELPER_UPDATE_PROGRESS_EVENT, (event) => {
        const payload = event.payload;
        if (!payload) return;

        onProgress({
          phase: payload.phase,
          contentLength: payload.contentLength,
          chunkLength: payload.chunkLength,
        });
      });
    } catch (error) {
      console.warn('[update-client] helper progress listener failed:', error);
    }
  }

  try {
    const result = await invoke<HelperUpdateLaunchResult>('helper_update_download_and_launch_installer', {
      url,
      version,
      fileName: inferHelperFileName(url, version),
    });

    return result.filePath;
  } finally {
    unlisten?.();
  }
}

class TauriUpdateProvider implements UpdateProvider {
  async checkForUpdate(): Promise<AppUpdateInfo | null> {
    const update = await check();
    if (!update?.available) return null;
    return normalizeUpdate(update, 'tauri');
  }

  async downloadAndInstallUpdate(
    onProgress?: (progress: AppUpdateProgress) => void,
  ): Promise<AppUpdateInfo | null> {
    const update = await check();
    if (!update?.available) return null;

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        onProgress?.({
          phase: 'started',
          contentLength: event.data.contentLength ?? null,
          chunkLength: 0,
        });
        return;
      }

      if (event.event === 'Progress') {
        onProgress?.({
          phase: 'progress',
          contentLength: null,
          chunkLength: event.data.chunkLength,
        });
      }
    });

    return normalizeUpdate(update, 'tauri');
  }
}

class BackendManifestUpdateProvider implements UpdateProvider {
  private readonly fallbackProvider: UpdateProvider;

  private readonly manifestUrl: string;

  constructor(manifestUrl: string, fallbackProvider: UpdateProvider) {
    this.manifestUrl = manifestUrl;
    this.fallbackProvider = fallbackProvider;
  }

  async checkForUpdate(): Promise<AppUpdateInfo | null> {
    const manifest = await fetchManifest(this.manifestUrl);
    if (!manifest || manifest.disabled || !manifest.available || manifest.installKind !== 'tauri' || !manifest.version) {
      if (!manifest || manifest.disabled || !manifest.available || !manifest.version) return null;
    }

    if (manifest.installKind === 'helper' && !getHelperPackageUrl(manifest)) {
      throw new Error('Manifest helper updatera nie zawiera fullPackageUrl.');
    }

    return normalizeManifestUpdate(manifest);
  }

  async downloadAndInstallUpdate(
    onProgress?: (progress: AppUpdateProgress) => void,
  ): Promise<AppUpdateInfo | null> {
    const manifest = await fetchManifest(this.manifestUrl);
    if (!manifest || manifest.disabled || !manifest.available || !manifest.version) {
      return null;
    }

    if (manifest.installKind === 'helper') {
      const packageUrl = getHelperPackageUrl(manifest);
      if (!packageUrl) {
        throw new Error('Manifest helper updatera nie zawiera fullPackageUrl.');
      }

      onProgress?.({
        phase: 'started',
        contentLength: null,
        chunkLength: 0,
      });

      await launchHelperInstaller(packageUrl, manifest.version, onProgress);
      return normalizeManifestUpdate(manifest);
    }

    return this.fallbackProvider.downloadAndInstallUpdate(onProgress);
  }
}

class CompositeUpdateProvider implements UpdateProvider {
  private readonly providers: UpdateProvider[];

  private lastResolvedProvider: UpdateProvider | null = null;

  constructor(providers: UpdateProvider[]) {
    this.providers = providers;
  }

  async checkForUpdate(): Promise<AppUpdateInfo | null> {
    this.lastResolvedProvider = null;

    for (const provider of this.providers) {
      try {
        const update = await provider.checkForUpdate();
        if (update) {
          this.lastResolvedProvider = provider;
          return update;
        }
      } catch (error) {
        console.warn('[update-client] provider check failed:', error);
      }
    }

    return null;
  }

  async downloadAndInstallUpdate(
    onProgress?: (progress: AppUpdateProgress) => void,
  ): Promise<AppUpdateInfo | null> {
    const orderedProviders = this.lastResolvedProvider
      ? [this.lastResolvedProvider, ...this.providers.filter(provider => provider !== this.lastResolvedProvider)]
      : this.providers;

    let lastError: unknown = null;

    for (const provider of orderedProviders) {
      try {
        const update = await provider.downloadAndInstallUpdate(onProgress);
        if (update) return update;
      } catch (error) {
        lastError = error;
        console.warn('[update-client] provider install failed:', error);
      }
    }

    if (lastError) throw lastError;
    return null;
  }
}

function createUpdateClient(): UpdateProvider {
  const tauriProvider = new TauriUpdateProvider();

  if (!PRIVATE_UPDATE_MANIFEST_URL) {
    return tauriProvider;
  }

  return new CompositeUpdateProvider([
    new BackendManifestUpdateProvider(PRIVATE_UPDATE_MANIFEST_URL, tauriProvider),
    tauriProvider,
  ]);
}

export const updateClient: UpdateProvider = createUpdateClient();