import { useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react';
import { Heart, Headphones, Pause, Pin, PinOff, Play, RefreshCw, Search, Volume2, VolumeX } from 'lucide-react';
import { Badge, Button, Card, Input, Spinner } from '../shared/UI';
import { fetchFeaturedStations, searchStations, type RadioStation } from './radioCatalog';
import type { RadioPlayerApi } from './useRadioPlayer';

function stationInfo(station: RadioStation | null): string {
  if (!station) return 'Wybierz stację z listy lub użyj wyszukiwarki.';
  return [station.country, station.codec?.toUpperCase(), station.bitrate ? `${station.bitrate} kbps` : null]
    .filter(Boolean)
    .join(' · ') || 'Strumień radiowy gotowy do odtwarzania';
}

function stationMeta(station: RadioStation | null): string {
  if (!station) return 'Brak aktywnej stacji';
  return station.tags?.length
    ? station.tags.slice(0, 4).join(' · ')
    : 'Ta stacja nie udostępnia dodatkowych metadanych katalogowych.';
}

function StationCard({ station, player }: { station: RadioStation; player: RadioPlayerApi }) {
  const active = player.currentStation?.id === station.id;
  const playing = active && player.isPlaying;
  const favorite = player.isFavorite(station.id);

  return (
    <Card
      className={`border transition-all ${active ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-bg)]/20' : 'cursor-pointer hover:border-[var(--color-accent-border)]/60'}`}
      title={station.name}
      subtitle={stationInfo(station)}
      icon={station.favicon ? (
        <img src={station.favicon} alt="" className="h-8 w-8 rounded-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
      ) : (
        <Headphones size={16} />
      )}
      action={
        <button
          onClick={() => player.toggleFavorite(station)}
          disabled={!player.canControl}
          className={`rounded-full p-2 transition-colors ${favorite ? 'bg-rose-500/15 text-rose-300' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}`}
          title={favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
          aria-label={favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
        >
          <Heart size={15} className={favorite ? 'fill-current' : ''} />
        </button>
      }
    >
      <div
        className="space-y-3"
        onClick={() => player.selectStation(station)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            player.selectStation(station);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Wybierz stację ${station.name}`}
      >
        <p className="text-xs leading-5 text-[var(--color-text-muted)]">{stationMeta(station)}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={playing ? 'secondary' : 'primary'}
            disabled={!player.canControl}
            onClick={e => {
              e.stopPropagation();
              if (active && player.isPlaying) {
                void player.togglePlayback();
                return;
              }
              void player.playStation(station);
            }}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? 'Pauza' : active ? 'Wznów' : 'Graj'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={e => {
              e.stopPropagation();
              player.selectStation(station);
              player.setPanelOpen(true);
            }}
          >
            {player.panelOpen ? <PinOff size={14} /> : <Pin size={14} />}
            {player.panelOpen ? 'Otwórz panel' : 'Pokaż panel'}
          </Button>
        </div>
        {!active && (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Kliknij kartę, aby wybrać stację do sterowania z górnego panelu.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function Radio({ player }: { player: RadioPlayerApi }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loadingStations, setLoadingStations] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState('Popularne stacje');

  useEffect(() => {
    const controller = new AbortController();
    const term = deferredQuery.trim();

    startTransition(() => {
      setLoadingStations(true);
      setSearchError(null);
      setSourceLabel(term.length >= 2 ? `Wyniki dla "${term}"` : 'Popularne stacje');
    });

    const load = async () => {
      try {
        const next = term.length >= 2
          ? await searchStations(term, controller.signal)
          : await fetchFeaturedStations(controller.signal);
        if (controller.signal.aborted) return;
        startTransition(() => {
          setStations(next);
          setLoadingStations(false);
          if (next.length === 0) {
            setSearchError(term.length >= 2
              ? 'Nie znaleziono stacji dla podanej frazy. Spróbuj krótszej nazwy lub gatunku.'
              : 'Nie udało się pobrać listy popularnych stacji.');
          }
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        startTransition(() => {
          setStations([]);
          setLoadingStations(false);
          setSearchError(error instanceof Error ? error.message : 'Nie udało się pobrać katalogu stacji radiowych.');
        });
      }
    };

    void load();
    return () => controller.abort();
  }, [deferredQuery]);

  const featuredFavorites = useMemo(() => player.favorites.slice(0, 6), [player.favorites]);
  const volumePercent = Math.round(player.volume * 100);

  if (!player.ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <Spinner size="md" />
          <span>Ładowanie modułu radia…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)]/40 bg-[var(--color-surface-2)]/40 p-6 shadow-[var(--shadow-xl)] animate-slideUp">
        <div className="absolute inset-y-0 right-0 w-1/2 opacity-30 pointer-events-none" style={{ background: 'var(--gradient-accent)' }} />
        <div className="relative grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[var(--color-accent)]">Radio internetowe</p>
              <h1 className="mt-2 text-3xl font-black text-[var(--color-text)]">Muzyka dla operatora, lokalnie na tym komputerze.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                Odtwarzanie działa niezależnie od zmiany widoków. Wybrana stacja, głośność, mute, autostart i panel pływający zapisują się prywatnie w lokalnych ustawieniach aplikacji.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant={player.isPlaying ? 'success' : 'accent'}>{player.isPlaying ? 'Odtwarzanie aktywne' : 'Gotowe do startu'}</Badge>
              <Badge variant="info">{player.currentStation ? player.currentStation.name : 'Brak wybranej stacji'}</Badge>
              <Badge variant={player.autoplay ? 'warning' : 'default'}>{player.autoplay ? 'Autostart włączony' : 'Start ręczny'}</Badge>
            </div>

            {!player.canControl && (
              <Card variant="warning" title="Tryb podglądu" subtitle="To konto widzi moduł radia, ale nie ma prawa sterowania.">
                <p className="text-sm text-[var(--color-text)]">
                  Aby odtwarzać i zapisywać lokalne preferencje radia, administrator musi nadać uprawnienie <strong>radio.use</strong>.
                </p>
              </Card>
            )}

            <Card
              variant="accent"
              title={player.currentStation?.name ?? 'Brak aktywnej stacji'}
              subtitle={stationInfo(player.currentStation)}
              icon={<Headphones size={18} />}
            >
              <div className="space-y-4">
                <p className="text-sm leading-6 text-[var(--color-text-muted)]">{stationMeta(player.currentStation)}</p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={player.isPlaying ? 'secondary' : 'primary'}
                    disabled={!player.currentStation || !player.canControl}
                    onClick={() => {
                      if (player.currentStation) {
                        void player.togglePlayback();
                      }
                    }}
                  >
                    {player.isPlaying ? <Pause size={15} /> : <Play size={15} />}
                    {player.isPlaying ? 'Pauza' : 'Graj'}
                  </Button>
                  <Button variant="ghost" onClick={player.stop} disabled={!player.currentStation || !player.canControl}>
                    <RefreshCw size={15} />
                    Stop
                  </Button>
                  <Button variant="ghost" onClick={player.toggleMute} disabled={!player.currentStation || !player.canControl}>
                    {player.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    {player.muted ? 'Wyciszono' : 'Mute'}
                  </Button>
                  <Button variant="ghost" onClick={() => player.setPanelOpen(!player.panelOpen)} disabled={!player.canControl}>
                    {player.panelOpen ? <PinOff size={15} /> : <Pin size={15} />}
                    {player.panelOpen ? 'Ukryj panel' : 'Pokaż panel'}
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm text-[var(--color-text)]">
                    <span className="font-semibold">Głośność: {volumePercent}%</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={volumePercent}
                      onChange={e => player.setVolume(Number(e.target.value) / 100)}
                      disabled={!player.canControl}
                      className="accent-[var(--color-accent)]"
                    />
                  </label>

                  <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={player.autoplay}
                      onChange={e => player.setAutoplay(e.target.checked)}
                      disabled={!player.canControl}
                      className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="block font-semibold">Wznawiaj po starcie aplikacji</span>
                      <span className="mt-1 block text-[var(--color-text-muted)]">Opcja lokalna dla tego komputera. Gdy wyłączona, radio startuje wyłącznie po kliknięciu.</span>
                    </span>
                  </label>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            {player.error && (
              <Card variant="danger" title="Błąd transmisji" subtitle="Odtwarzacz zgłosił problem ze streamem.">
                <div className="space-y-3">
                  <p className="text-sm text-[var(--color-text)]">{player.error}</p>
                  <Button size="sm" variant="ghost" onClick={player.clearError}>Ukryj komunikat</Button>
                </div>
              </Card>
            )}

            <Card title="Panel pływający" subtitle="Mały sterownik dostępny poza zakładką radia." icon={<Pin size={16} />}>
              <div className="space-y-3 text-sm text-[var(--color-text-muted)]">
                <p>
                  Panel pojawia się na innych ekranach aplikacji i pozwala sterować odtwarzaniem bez wracania do tej zakładki.
                </p>
                <Button size="sm" variant={player.panelOpen ? 'secondary' : 'primary'} onClick={() => player.setPanelOpen(!player.panelOpen)} disabled={!player.canControl}>
                  {player.panelOpen ? <PinOff size={14} /> : <Pin size={14} />}
                  {player.panelOpen ? 'Ukryj panel pływający' : 'Włącz panel pływający'}
                </Button>
              </div>
            </Card>

            <Card title="Ulubione stacje" subtitle="Lokalne skróty zapisane na tym komputerze." icon={<Heart size={16} />}>
              {featuredFavorites.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">Dodaj stacje do ulubionych z wyników wyszukiwania, aby mieć do nich szybki dostęp.</p>
              ) : (
                <div className="space-y-2">
                  {featuredFavorites.map(station => (
                    <button
                      key={station.id}
                      onClick={() => void player.playStation(station)}
                      className={`w-full rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${player.currentStation?.id === station.id ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-bg)]/20' : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/60'}`}
                    >
                      <span className="block text-sm font-semibold text-[var(--color-text)]">{station.name}</span>
                      <span className="block text-[11px] text-[var(--color-text-muted)]">{stationInfo(station)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <Input
            label="Wyszukaj stację"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="np. Radio ZET, RMF, jazz, chill"
            className="md:max-w-xl"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
              <Search size={14} />
              Wyczyść
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setQuery(query => query.trim())}>
              <RefreshCw size={14} />
              Odśwież
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">{sourceLabel}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {deferredQuery.trim().length >= 2
                ? 'Wyniki pochodzą z publicznego katalogu Radio Browser.'
                : 'Lista startowa ładowana jest z popularnych internetowych stacji radiowych.'}
            </p>
          </div>
          {loadingStations && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <Spinner size="sm" />
              <span>Ładowanie…</span>
            </div>
          )}
        </div>

        {searchError && !loadingStations && (
          <Card variant="warning" title="Katalog stacji" subtitle="Nie udało się pobrać pełnej listy wyników.">
            <p className="text-sm text-[var(--color-text)]">{searchError}</p>
          </Card>
        )}

        {!loadingStations && stations.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {stations.map(station => (
              <StationCard key={`${station.id}-${station.streamUrl}`} station={station} player={player} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}