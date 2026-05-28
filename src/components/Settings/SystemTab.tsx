/**
 * SystemTab — uruchamianie z Windows + sprawdzanie aktualizacji.
 */
import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { Power, RefreshCw, Download, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

import { updateClient } from '../../lib/update-client';
import type { AppUpdateInfo } from '../../lib/update-types';

interface AutostartStatus {
  enabled: boolean;
}

type UpdateState = 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function SystemTab() {
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('—');

  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [lastChunkBytes, setLastChunkBytes] = useState(0);

  // Załaduj status autostartu
  useEffect(() => {
    invoke<AutostartStatus>('autostart_get_status')
      .then(s => setAutostartEnabled(s.enabled))
      .catch(() => setAutostartEnabled(false));
  }, []);

  useEffect(() => {
    getVersion()
      .then(version => setCurrentVersion(version))
      .catch(() => setCurrentVersion('dev'));
  }, []);

  const handleAutostartToggle = async () => {
    if (autostartBusy || autostartEnabled === null) return;
    setAutostartBusy(true);
    const newVal = !autostartEnabled;
    try {
      await invoke('autostart_set', { enable: newVal });
      setAutostartEnabled(newVal);
    } catch (e) {
      console.error('[autostart]', e);
    }
    setAutostartBusy(false);
  };

  const handleCheckUpdate = async () => {
    setUpdateState('checking');
    setUpdateError(null);
    setUpdateInfo(null);
    setDownloadedBytes(0);
    setTotalBytes(null);
    setLastChunkBytes(0);
    try {
      const update = await updateClient.checkForUpdate();
      if (update) {
        setUpdateInfo(update);
        setUpdateState('available');
      } else {
        setUpdateState('none');
      }
    } catch (e: unknown) {
      setUpdateError(e instanceof Error ? e.message : String(e));
      setUpdateState('error');
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateState('downloading');
    setUpdateError(null);
    setDownloadedBytes(0);
    setTotalBytes(null);
    setLastChunkBytes(0);
    try {
      const update = await updateClient.downloadAndInstallUpdate((progress) => {
        if (progress.phase === 'started') {
          setDownloadedBytes(0);
          setLastChunkBytes(0);
          setTotalBytes(progress.contentLength);
          return;
        }

        setLastChunkBytes(progress.chunkLength);
        setDownloadedBytes(prev => prev + progress.chunkLength);
      });

      if (update) {
        setUpdateInfo(update);
        setUpdateState('done');
      } else {
        setUpdateState('none');
      }
    } catch (e: unknown) {
      setUpdateError(e instanceof Error ? e.message : String(e));
      setUpdateState('error');
    }
  };

  const progressPercent = totalBytes && totalBytes > 0
    ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
    : null;
  const remainingBytes = totalBytes != null ? Math.max(totalBytes - downloadedBytes, 0) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-text)]">System</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Bieżąca wersja aplikacji: <span className="font-mono text-amber-300">v{currentVersion}</span>
        </p>
      </div>

      {/* Autostart */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-5 border border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] flex items-center justify-center flex-shrink-0">
              <Power size={18} className="text-[var(--color-accent)]" />
            </div>
            <div>
              <p className="font-semibold text-sm text-[var(--color-text)]">Uruchamiaj z systemem Windows</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Parking.OS będzie startować automatycznie przy logowaniu do Windows
              </p>
            </div>
          </div>
          {/* Toggle */}
          <button
            onClick={handleAutostartToggle}
            disabled={autostartBusy || autostartEnabled === null}
            aria-pressed={autostartEnabled ?? false}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200
              ${autostartEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface-3)]'}
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                ${autostartEnabled ? 'translate-x-6' : 'translate-x-0'}`}
            />
          </button>
        </div>
        {autostartEnabled !== null && (
          <p className="mt-3 text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
            <Info size={11} />
            Status: {autostartEnabled ? 'włączony — aplikacja uruchomi się automatycznie' : 'wyłączony'}
          </p>
        )}
      </div>

      {/* Aktualizacje */}
      <div className="glass-strong rounded-[var(--radius-lg)] p-5 border border-[var(--color-border)]">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] flex items-center justify-center flex-shrink-0">
            <RefreshCw size={18} className="text-[var(--color-accent)]" />
          </div>
          <div>
            <p className="font-semibold text-sm text-[var(--color-text)]">Aktualizacje aplikacji</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Sprawdza skonfigurowane źródło aktualizacji — może użyć wbudowanego updatera Tauri albo uruchomić instalator pomocniczy
            </p>
          </div>
        </div>

        {/* Stany */}
        {updateState === 'none' && (
          <div className="flex items-center gap-2 text-sm text-green-400 mb-3">
            <CheckCircle2 size={15} />
            Masz najnowszą wersję
          </div>
        )}
        {updateState === 'available' && updateInfo && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
            <p className="text-sm font-bold text-amber-300 mb-1">
              Dostępna aktualizacja: v{updateInfo.version}
            </p>
            {updateInfo.body && (
              <p className="text-xs text-white/50 whitespace-pre-line line-clamp-4">{updateInfo.body}</p>
            )}
          </div>
        )}
        {updateState === 'downloading' && (
          <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-sm text-white/80">
              <RefreshCw size={14} className="animate-spin" />
              {updateInfo?.installKind === 'helper'
                ? 'Pobieranie aktualizacji i uruchamianie instalatora…'
                : 'Pobieranie i instalacja aktualizacji…'}
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
                style={{ width: progressPercent != null ? `${progressPercent}%` : '12%' }}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
              <span>Pobrano: {formatBytes(downloadedBytes)}</span>
              <span>Całość: {totalBytes != null ? formatBytes(totalBytes) : 'rozmiar nieznany'}</span>
              <span>Pozostało: {remainingBytes != null ? formatBytes(remainingBytes) : '—'}</span>
              <span>Chunk: {lastChunkBytes > 0 ? formatBytes(lastChunkBytes) : '—'}</span>
              {progressPercent != null && <span>Postęp: {progressPercent}%</span>}
            </div>
          </div>
        )}
        {updateState === 'done' && (
          <div className="flex items-center gap-2 text-sm text-green-400 mb-3">
            <CheckCircle2 size={15} />
            {updateInfo?.installKind === 'helper'
              ? 'Instalator aktualizacji został uruchomiony — zamknij Parking.OS, jeśli instalator o to poprosi.'
              : 'Aktualizacja zainstalowana — uruchom ponownie aplikację'}
          </div>
        )}
        {updateState === 'error' && updateError && (
          <div className="flex items-start gap-2 text-sm text-red-300 mb-3">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            {updateError}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleCheckUpdate}
            disabled={['checking', 'downloading'].includes(updateState)}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] text-sm font-semibold
              bg-[var(--color-accent)] text-[#1a1410] hover:opacity-90
              disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {updateState === 'checking'
              ? <><RefreshCw size={14} className="animate-spin" /> Sprawdzanie…</>
              : <><RefreshCw size={14} /> Sprawdź aktualizacje</>}
          </button>

          {updateState === 'available' && (
            <button
              onClick={handleInstallUpdate}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] text-sm font-semibold
                bg-green-600 hover:bg-green-500 text-white transition-colors"
            >
              <Download size={14} />
              {updateInfo?.installKind === 'helper'
                ? `Pobierz i uruchom instalator v${updateInfo?.version}`
                : `Pobierz i zainstaluj v${updateInfo?.version}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
