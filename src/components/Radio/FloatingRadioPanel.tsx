import { Headphones, Pause, Pin, Play, Volume2, VolumeX, X } from 'lucide-react';
import type { RadioPlayerApi } from './useRadioPlayer';

function stationInfo(player: RadioPlayerApi): string {
  const station = player.currentStation;
  if (!station) return 'Wybierz stację w zakładce Radio.';
  return [station.country, station.codec?.toUpperCase(), station.bitrate ? `${station.bitrate} kbps` : null]
    .filter(Boolean)
    .join(' · ') || 'Radio internetowe';
}

export default function FloatingRadioPanel({
  player,
  onClose,
  onOpenRadioPage,
}: {
  player: RadioPlayerApi;
  onClose: () => void;
  onOpenRadioPage: () => void;
}) {
  return (
    <div className="fixed bottom-20 right-6 z-[165] w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[var(--radius-lg)] border-2 border-[var(--color-accent-border)] glass-strong shadow-[var(--shadow-xl)] animate-slideUp">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <Headphones size={16} className="text-[var(--color-accent)]" />
        <div className="flex-1 text-xs font-bold">Radio internetowe</div>
        <button onClick={onOpenRadioPage} className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" title="Otwórz pełny widok radia">
          <Pin size={12} />
        </button>
        <button onClick={onClose} className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/20 hover:text-red-300" title="Ukryj panel">
          <X size={12} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{player.currentStation?.name ?? 'Brak wybranej stacji'}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{stationInfo(player)}</p>
        </div>

        {player.error && (
          <div className="rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {player.error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (!player.currentStation) {
                onOpenRadioPage();
                return;
              }
              void player.togglePlayback();
            }}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-gradient-accent px-3 py-2 text-sm font-semibold text-[#1a1410] shadow-[var(--shadow-md)] transition-transform hover:scale-[1.02]"
          >
            {player.isPlaying ? <Pause size={14} /> : <Play size={14} />}
            {player.isPlaying ? 'Pauza' : player.currentStation ? 'Graj' : 'Wybierz stację'}
          </button>
          <button
            onClick={player.toggleMute}
            disabled={!player.currentStation}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {player.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {player.muted ? 'Mute' : 'Dźwięk'}
          </button>
        </div>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Głośność {Math.round(player.volume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(player.volume * 100)}
            onChange={e => player.setVolume(Number(e.target.value) / 100)}
            className="mt-2 w-full accent-[var(--color-accent)]"
          />
        </label>
      </div>
    </div>
  );
}