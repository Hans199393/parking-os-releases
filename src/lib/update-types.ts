export type AppUpdateInstallKind = 'tauri' | 'helper';

export interface AppUpdateInfo {
  version: string;
  date: string;
  body: string | null;
  installKind: AppUpdateInstallKind;
}

export interface AppUpdateManifestSource {
  tauriManifestUrl: string | null;
  fullPackageUrl: string | null;
  patchPackageUrl: string | null;
}

export interface AppUpdateManifest {
  ok: boolean;
  channel: string;
  platform: string | null;
  available: boolean;
  disabled: boolean;
  installKind: AppUpdateInstallKind;
  version: string | null;
  notes: string | null;
  pubDate: string | null;
  minSupportedVersion: string | null;
  source: AppUpdateManifestSource;
}

export interface AppUpdateProgress {
  phase: 'started' | 'progress';
  contentLength: number | null;
  chunkLength: number;
}

export interface UpdateProvider {
  checkForUpdate(): Promise<AppUpdateInfo | null>;
  downloadAndInstallUpdate(
    onProgress?: (progress: AppUpdateProgress) => void,
  ): Promise<AppUpdateInfo | null>;
}