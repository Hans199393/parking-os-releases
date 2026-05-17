/**
 * SyncManager — synchronizacja bazy SQLite między komputerami przez Supabase Storage.
 *
 * Flow:
 *  Komputer A: "Wyślij dane" → odczyt .db → base64 → upload do Supabase Storage (transit)
 *  Komputer B: "Pobierz dane" → download → zapisz temp → porównaj tabele → dialog wyboru → zastosuj → usuń z Storage
 *
 * Plik w Storage jest TYMCZASOWY — usuwany po pobraniu lub po timeoucie 24h (policy w Supabase).
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getSupabaseClient } from '../../lib/supabase';
import { getDb } from '../../lib/database';
import Database from '@tauri-apps/plugin-sql';
import {
  Upload, Download, RefreshCw, CheckCircle2, AlertTriangle,
  Database as DbIcon, Clock, HardDrive, ArrowRight, Trash2, RotateCcw, Info
} from 'lucide-react';

// ── Typy ────────────────────────────────────────────────────────────────────

interface DbMeta {
  size_bytes: number;
  last_modified: string; // unix timestamp string
  path: string;
}

interface RevenueRow {
  date: string;
  qty_1: number; qty_2: number; qty_5: number; qty_10: number;
  qty_20: number; qty_50: number; qty_100: number; qty_200: number; qty_500: number;
  base_qty_1: number; base_qty_2: number; base_qty_5: number; base_qty_10: number;
  base_qty_20: number; base_qty_50: number; base_qty_100: number; base_qty_200: number; base_qty_500: number;
  card: number; blik: number;
  notes: string | null;
  weather: string | null;
  temperature: number | null;
}

interface SyncRow {
  date: string;
  local: RevenueRow | null;
  remote: RevenueRow | null;
  choice: 'local' | 'remote' | 'skip';
  totalLocal: number;
  totalRemote: number;
}

type SyncStep = 'idle' | 'uploading' | 'uploaded' | 'checking' | 'downloading' | 'comparing' | 'applying' | 'done' | 'error';

const BUCKET = 'parking-sync-transit';
const OBJECT_KEY = 'parking_os_sync.b64';

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTimestamp(ts: string) {
  const n = parseInt(ts, 10);
  if (!n) return '—';
  return new Date(n * 1000).toLocaleString('pl-PL');
}

function calcTotal(row: RevenueRow): number {
  return row.qty_1 * 1 + row.qty_2 * 2 + row.qty_5 * 5 +
    row.qty_10 * 10 + row.qty_20 * 20 + row.qty_50 * 50 +
    row.qty_100 * 100 + row.qty_200 * 200 + row.qty_500 * 500 +
    row.card + row.blik;
}

async function applyMergedSelection(rows: SyncRow[]): Promise<void> {
  const localDb = await getDb();
  try {
    await localDb.execute('BEGIN IMMEDIATE');

    for (const row of rows) {
      if (row.choice !== 'remote') continue;

      if (!row.remote) {
        await localDb.execute('DELETE FROM daily_revenue WHERE date = $1', [row.date]);
        continue;
      }

      const remote = row.remote;
      await localDb.execute(`
        INSERT INTO daily_revenue (
          date,
          qty_1, qty_2, qty_5, qty_10, qty_20, qty_50, qty_100, qty_200, qty_500,
          base_qty_1, base_qty_2, base_qty_5, base_qty_10, base_qty_20, base_qty_50, base_qty_100, base_qty_200, base_qty_500,
          card, blik, notes, weather, temperature
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24
        )
        ON CONFLICT(date) DO UPDATE SET
          qty_1 = excluded.qty_1,
          qty_2 = excluded.qty_2,
          qty_5 = excluded.qty_5,
          qty_10 = excluded.qty_10,
          qty_20 = excluded.qty_20,
          qty_50 = excluded.qty_50,
          qty_100 = excluded.qty_100,
          qty_200 = excluded.qty_200,
          qty_500 = excluded.qty_500,
          base_qty_1 = excluded.base_qty_1,
          base_qty_2 = excluded.base_qty_2,
          base_qty_5 = excluded.base_qty_5,
          base_qty_10 = excluded.base_qty_10,
          base_qty_20 = excluded.base_qty_20,
          base_qty_50 = excluded.base_qty_50,
          base_qty_100 = excluded.base_qty_100,
          base_qty_200 = excluded.base_qty_200,
          base_qty_500 = excluded.base_qty_500,
          card = excluded.card,
          blik = excluded.blik,
          notes = excluded.notes,
          weather = excluded.weather,
          temperature = excluded.temperature
      `, [
        remote.date,
        remote.qty_1, remote.qty_2, remote.qty_5, remote.qty_10, remote.qty_20, remote.qty_50, remote.qty_100, remote.qty_200, remote.qty_500,
        remote.base_qty_1, remote.base_qty_2, remote.base_qty_5, remote.base_qty_10, remote.base_qty_20, remote.base_qty_50, remote.base_qty_100, remote.base_qty_200, remote.base_qty_500,
        remote.card, remote.blik, remote.notes, remote.weather, remote.temperature,
      ]);
    }

    await localDb.execute('COMMIT');
  } catch (error) {
    try { await localDb.execute('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

// ── Główny komponent ─────────────────────────────────────────────────────────

export default function SyncManager() {
  const [step, setStep] = useState<SyncStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localMeta, setLocalMeta] = useState<DbMeta | null>(null);
  const [remoteMeta, setRemoteMeta] = useState<DbMeta | null>(null);
  const [transitExists, setTransitExists] = useState<boolean | null>(null);
  const [diffRows, setDiffRows] = useState<SyncRow[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Załaduj metadane lokalnej bazy przy montowaniu
  useEffect(() => {
    invoke<DbMeta>('db_get_meta').then(setLocalMeta).catch(() => {});
    checkTransit();
  }, []);

  // Sprawdź czy jest plik transit w Supabase Storage
  const checkTransit = useCallback(async () => {
    try {
      const sb = await getSupabaseClient();
      const { data } = await sb.storage.from(BUCKET).list('', { search: OBJECT_KEY });
      setTransitExists(!!(data && data.length > 0));
    } catch {
      setTransitExists(false);
    }
  }, []);

  // ── WYŚLIJ DANE ─────────────────────────────────────────────────────────

  const handleUpload = async () => {
    setError(null);
    setSuccessMsg('');
    setStep('uploading');
    setStatusMsg('Odczyt bazy danych…');
    try {
      // 1. Odczytaj bajty bazy
      const b64: string = await invoke('db_read_for_sync');
      setStatusMsg('Przesyłanie do chmury (transit)…');

      // 2. Upload do Supabase Storage
      const sb = await getSupabaseClient();
      const blob = new Blob([b64], { type: 'text/plain' });
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(OBJECT_KEY, blob, { upsert: true, cacheControl: '0' });
      if (upErr) throw new Error(`Błąd uploadu: ${upErr.message}`);

      setStep('uploaded');
      setTransitExists(true);
      setSuccessMsg('✅ Dane wysłane! Na drugim komputerze kliknij "Pobierz dane".');
      setStatusMsg('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  // ── POBIERZ DANE ─────────────────────────────────────────────────────────

  const handleDownload = async () => {
    setError(null);
    setSuccessMsg('');
    setStep('downloading');
    setStatusMsg('Pobieranie danych z chmury…');
    try {
      // 1. Pobierz plik z Supabase Storage
      const sb = await getSupabaseClient();
      const { data: fileData, error: dlErr } = await sb.storage
        .from(BUCKET)
        .download(OBJECT_KEY);
      if (dlErr || !fileData) throw new Error(`Błąd pobierania: ${dlErr?.message ?? 'brak danych'}`);

      const b64 = await fileData.text();
      setStatusMsg('Zapisywanie tymczasowej bazy…');

      // 2. Zapisz jako temp .db przez Rust
      const meta: DbMeta = await invoke('db_save_temp_for_sync', { data: b64 });
      setRemoteMeta(meta);
      setStatusMsg('Porównywanie danych…');
      setStep('comparing');

      // 3. Otwórz obie bazy i porównaj daily_revenue
      const localDb = await getDb();
      const remoteDb = await Database.load('sqlite:parking_os_sync_temp.db');

      const localRows: RevenueRow[] = await localDb.select('SELECT * FROM daily_revenue ORDER BY date', []);
      const remoteRows: RevenueRow[] = await remoteDb.select('SELECT * FROM daily_revenue ORDER BY date', []);
      await remoteDb.close().catch(() => false);

      // Merge wszystkich dat
      const allDates = new Set([
        ...localRows.map(r => r.date),
        ...remoteRows.map(r => r.date),
      ]);

      const localMap = new Map(localRows.map(r => [r.date, r]));
      const remoteMap = new Map(remoteRows.map(r => [r.date, r]));

      const rows: SyncRow[] = [...allDates].sort().map(date => {
        const local = localMap.get(date) ?? null;
        const remote = remoteMap.get(date) ?? null;
        const totalLocal = local ? calcTotal(local) : 0;
        const totalRemote = remote ? calcTotal(remote) : 0;

        // Domyślny wybór: wyższy przychód wygrywa
        let choice: 'local' | 'remote' | 'skip' = 'local';
        if (!local) choice = 'remote';
        else if (!remote) choice = 'local';
        else if (totalRemote > totalLocal) choice = 'remote';

        return { date, local, remote, choice, totalLocal, totalRemote };
      });

      setDiffRows(rows);
      setStatusMsg('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  // ── ZASTOSUJ SYNC ─────────────────────────────────────────────────────────

  const handleApply = async (action: 'replace' | 'keep' | 'merge') => {
    setStep('applying');
    setStatusMsg(
      action === 'replace'
        ? 'Zastępowanie bazy…'
        : action === 'merge'
        ? 'Scalanie wybranych dni do lokalnej bazy…'
        : 'Zachowywanie lokalnej bazy…'
    );
    try {
      if (action === 'merge') {
        await applyMergedSelection(diffRows);
        await invoke('db_delete_temp');
      } else {
        await invoke('db_apply_sync', { action });
      }

      // Usuń transit z Supabase Storage
      setStatusMsg('Usuwanie pliku transit z chmury…');
      const sb = await getSupabaseClient();
      await sb.storage.from(BUCKET).remove([OBJECT_KEY]);
      setTransitExists(false);

      setStep('done');
      setSuccessMsg(
        action === 'replace'
          ? '✅ Dane zsynchronizowane! Aplikacja uruchomi się ponownie.'
          : action === 'merge'
          ? '✅ Wybrane dni zostały zapisane lokalnie. Aplikacja uruchomi się ponownie.'
          : '✅ Zachowano lokalną bazę. Plik transit usunięty z chmury.'
      );
      setDiffRows([]);
      setRemoteMeta(null);

      if (action === 'replace' || action === 'merge') {
        // Restart po 2s żeby DB plugin zresetował połączenie
        setTimeout(() => invoke('app_restart'), 2000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  // ── Usuń transit (anuluj) ─────────────────────────────────────────────────

  const handleCancelTransit = async () => {
    setStatusMsg('Usuwanie pliku transit…');
    try {
      const sb = await getSupabaseClient();
      await sb.storage.from(BUCKET).remove([OBJECT_KEY]);
      await invoke('db_delete_temp');
      setTransitExists(false);
      setDiffRows([]);
      setRemoteMeta(null);
      setStep('idle');
      setStatusMsg('');
      setSuccessMsg('Plik transit usunięty.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isLoading = ['uploading', 'downloading', 'applying'].includes(step);

  // ── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Nagłówek */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <DbIcon size={22} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Synchronizacja danych</h2>
          <p className="text-sm text-white/40">Przenoś bazę SQLite między komputerami przez tymczasowy schowek w chmurze</p>
        </div>
      </div>

      {/* Info box */}
      <div className="flex gap-3 items-start p-4 rounded-xl bg-blue-500/8 border border-blue-500/20 mb-6">
        <Info size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-white/60 leading-relaxed">
          <strong className="text-white/80">Jak to działa:</strong> Komputer A wysyła dane → plik leci przez Supabase Storage jak przez schowek → Komputer B pobiera i porównuje → po zastosowaniu plik jest <strong className="text-white/80">usuwany z chmury</strong>. Dane finansowe nigdy nie zostają trwale w chmurze.
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Lokalna baza */}
        <div className="p-4 rounded-xl bg-white/4 border border-white/8">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive size={16} className="text-amber-400" />
            <span className="text-sm font-semibold text-white/80">Ten komputer</span>
          </div>
          {localMeta ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Rozmiar bazy</span>
                <span className="text-white/80 font-mono">{fmtSize(localMeta.size_bytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Ostatnia zmiana</span>
                <span className="text-white/80">{fmtTimestamp(localMeta.last_modified)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/30">Ładowanie…</p>
          )}
        </div>

        {/* Transit status */}
        <div className="p-4 rounded-xl bg-white/4 border border-white/8">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-blue-400" />
            <span className="text-sm font-semibold text-white/80">Schowek (transit)</span>
            <button onClick={checkTransit} className="ml-auto p-1 rounded hover:bg-white/8 text-white/30 hover:text-white/60 transition-colors">
              <RefreshCw size={12} />
            </button>
          </div>
          {transitExists === null ? (
            <p className="text-sm text-white/30">Sprawdzanie…</p>
          ) : transitExists ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm text-amber-300 font-semibold">Plik czeka na pobranie</span>
              <button
                onClick={handleCancelTransit}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
              >
                <Trash2 size={11} /> Usuń
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-white/40">Schowek pusty</span>
            </div>
          )}
        </div>
      </div>

      {/* Akcje */}
      {step !== 'comparing' && (
        <div className="flex flex-wrap gap-3 mb-6">
          <button
            onClick={handleUpload}
            disabled={isLoading}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-semibold text-sm
              bg-gradient-to-r from-amber-500 to-orange-500 text-black
              hover:from-amber-400 hover:to-orange-400 active:scale-95
              disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/25"
          >
            {step === 'uploading' ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
            Wyślij dane na drugi komputer
          </button>

          <button
            onClick={handleDownload}
            disabled={isLoading || !transitExists}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-semibold text-sm
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            {step === 'downloading' ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
            Pobierz dane z transit
            {!transitExists && <span className="ml-1 text-xs font-normal opacity-60">(brak pliku)</span>}
          </button>
        </div>
      )}

      {/* Status/progress */}
      {statusMsg && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/4 mb-4 text-sm text-white/60">
          <RefreshCw size={14} className="animate-spin text-amber-400 flex-shrink-0" />
          {statusMsg}
        </div>
      )}

      {/* Sukces */}
      {successMsg && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-green-500/10 border border-green-500/20 mb-4 text-sm text-green-300">
          <CheckCircle2 size={16} className="flex-shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Błąd */}
      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <strong className="block mb-0.5">Błąd synchronizacji</strong>
            {error}
            <button
              onClick={() => { setError(null); setStep('idle'); }}
              className="mt-2 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-200 transition-colors"
            >
              <RotateCcw size={11} /> Spróbuj ponownie
            </button>
          </div>
        </div>
      )}

      {/* ── Tabela porównawcza (krok comparing) ── */}
      {step === 'comparing' && diffRows.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-white">
              Porównanie danych — {diffRows.length} {diffRows.length === 1 ? 'dzień' : 'dni'}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setDiffRows(r => r.map(row => ({ ...row, choice: 'local' })))}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
              >
                Wszystkie lokalne
              </button>
              <button
                onClick={() => setDiffRows(r => r.map(row => ({ ...row, choice: 'remote' })))}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 transition-colors"
              >
                Wszystkie z transit
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/8 overflow-hidden mb-4">
            <div className="grid grid-cols-[120px_1fr_1fr_100px] bg-white/4 text-xs font-bold uppercase tracking-wider text-white/40 border-b border-white/8">
              <div className="px-4 py-2.5">Data</div>
              <div className="px-4 py-2.5 border-l border-white/8">
                <span className="text-amber-400">◆</span> Ten komputer
              </div>
              <div className="px-4 py-2.5 border-l border-white/8">
                <span className="text-blue-400">◆</span> Transit (drugi komp.)
              </div>
              <div className="px-4 py-2.5 border-l border-white/8 text-center">Wybierz</div>
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-white/5">
              {diffRows.map((row) => (
                <div
                  key={row.date}
                  className="grid grid-cols-[120px_1fr_1fr_100px] hover:bg-white/3 transition-colors"
                >
                  <div className="px-4 py-3 text-sm font-mono text-white/70 self-center">{row.date}</div>

                  {/* Lokalne */}
                  <div className={`px-4 py-3 border-l border-white/8 text-sm ${row.choice === 'local' ? 'bg-amber-500/8' : ''}`}>
                    {row.local ? (
                      <div>
                        <div className={`font-bold ${row.choice === 'local' ? 'text-amber-300' : 'text-white/70'}`}>
                          {row.totalLocal.toFixed(2)} PLN
                        </div>
                        <div className="text-xs text-white/30 mt-0.5">
                          Karta: {row.local.card.toFixed(2)} · BLIK: {row.local.blik.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-white/20 italic">Brak rekordu</span>
                    )}
                  </div>

                  {/* Remote */}
                  <div className={`px-4 py-3 border-l border-white/8 text-sm ${row.choice === 'remote' ? 'bg-blue-500/8' : ''}`}>
                    {row.remote ? (
                      <div>
                        <div className={`font-bold ${row.choice === 'remote' ? 'text-blue-300' : 'text-white/70'}`}>
                          {row.totalRemote.toFixed(2)} PLN
                        </div>
                        <div className="text-xs text-white/30 mt-0.5">
                          Karta: {row.remote.card.toFixed(2)} · BLIK: {row.remote.blik.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-white/20 italic">Brak rekordu</span>
                    )}
                  </div>

                  {/* Wybór */}
                  <div className="px-4 py-3 border-l border-white/8 flex flex-col gap-1.5 items-center justify-center">
                    <button
                      onClick={() => setDiffRows(r => r.map(rr => rr.date === row.date ? { ...rr, choice: 'local' } : rr))}
                      className={`w-full px-2 py-1 rounded text-xs font-semibold transition-colors
                        ${row.choice === 'local'
                          ? 'bg-amber-500 text-black'
                          : 'bg-white/6 text-white/40 hover:bg-amber-500/20 hover:text-amber-300'}`}
                    >
                      Moje
                    </button>
                    <button
                      onClick={() => setDiffRows(r => r.map(rr => rr.date === row.date ? { ...rr, choice: 'remote' } : rr))}
                      className={`w-full px-2 py-1 rounded text-xs font-semibold transition-colors
                        ${row.choice === 'remote'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white/6 text-white/40 hover:bg-blue-500/20 hover:text-blue-300'}`}
                    >
                      Transit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Przyciski zastosowania */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                const allRemote = diffRows.every(r => r.choice === 'remote');
                const anyRemote = diffRows.some(r => r.choice === 'remote');
                handleApply(allRemote ? 'replace' : anyRemote ? 'merge' : 'keep');
              }}
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm
                bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 transition-all active:scale-95"
            >
              {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Zastosuj wybór
              <ArrowRight size={14} className="opacity-60" />
            </button>

            <button
              onClick={handleCancelTransit}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
                bg-white/6 hover:bg-white/10 text-white/60 hover:text-white/80 border border-white/10 transition-colors"
            >
              <Trash2 size={14} />
              Anuluj i usuń transit
            </button>
          </div>
        </div>
      )}

      {/* Remote meta po pobraniu */}
      {remoteMeta && step === 'comparing' && (
        <p className="mt-3 text-xs text-white/30">
          Plik transit — rozmiar: {fmtSize(remoteMeta.size_bytes)} · Data modyfikacji: {fmtTimestamp(remoteMeta.last_modified)}
        </p>
      )}
    </div>
  );
}
