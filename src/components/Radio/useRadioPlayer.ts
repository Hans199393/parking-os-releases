import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getStore } from '../../lib/store';
import type { RadioStation } from './radioCatalog';

const DEFAULT_VOLUME = 0.75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === 'true';
}

function asNumber(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : fallback;
}

function normalizeStation(value: unknown, source: RadioStation['source'] = 'favorite'): RadioStation | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const streamUrl = typeof raw.streamUrl === 'string' ? raw.streamUrl.trim() : '';
  if (!name || !streamUrl) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : streamUrl,
    name,
    streamUrl,
    favicon: typeof raw.favicon === 'string' ? raw.favicon : undefined,
    country: typeof raw.country === 'string' ? raw.country : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === 'string') as string[] : [],
    codec: typeof raw.codec === 'string' ? raw.codec : undefined,
    bitrate: typeof raw.bitrate === 'number' ? raw.bitrate : undefined,
    homepage: typeof raw.homepage === 'string' ? raw.homepage : undefined,
    source,
  };
}

function parseFavorites(raw: string | null | undefined): RadioStation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => normalizeStation(item, 'favorite')).filter(Boolean) as RadioStation[];
  } catch {
    return [];
  }
}

function friendlyPlaybackError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Odtwarzanie zostało zablokowane przez system. Uruchom stację ręcznie przyciskiem play.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Nie udało się uruchomić transmisji radiowej.';
}

function isHls(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

export interface RadioPlayerApi {
  canControl: boolean;
  ready: boolean;
  currentStation: RadioStation | null;
  favorites: RadioStation[];
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  muted: boolean;
  autoplay: boolean;
  panelOpen: boolean;
  error: string | null;
  selectStation: (station: RadioStation) => void;
  playStation: (station: RadioStation) => Promise<void>;
  togglePlayback: () => Promise<void>;
  stop: () => void;
  setVolume: (next: number) => void;
  toggleMute: () => void;
  setAutoplay: (next: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  toggleFavorite: (station: RadioStation) => void;
  isFavorite: (stationId: string) => boolean;
  clearError: () => void;
}

export function useRadioPlayer(enabled: boolean): RadioPlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const currentStationRef = useRef<RadioStation | null>(null);
  const [ready, setReady] = useState(false);
  const [currentStation, setCurrentStation] = useState<RadioStation | null>(null);
  const [favorites, setFavorites] = useState<RadioStation[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const [autoplay, setAutoplayState] = useState(false);
  const [panelOpen, setPanelOpenState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!audioRef.current && typeof window !== 'undefined') {
    const audio = new Audio();
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;
  }

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const attachSource = useCallback((url: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    destroyHls();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    if (isHls(url)) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = url;
        audio.load();
        return;
      }
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(url);
        hls.attachMedia(audio);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          setIsPlaying(false);
          setIsBuffering(false);
          setError('Transmisja HLS przerwała połączenie. Spróbuj innej stacji.');
          hls.destroy();
          if (hlsRef.current === hls) hlsRef.current = null;
        });
        hlsRef.current = hls;
        return;
      }
    }

    audio.src = url;
    audio.load();
  }, [destroyHls]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      setError(null);
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onError = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      setError('Ta transmisja jest chwilowo niedostępna lub nie pozwala na odtwarzanie w aplikacji.');
    };

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = clamp(volume, 0, 1);
    audio.muted = muted;
  }, [muted, volume]);

  useEffect(() => {
    currentStationRef.current = currentStation;
  }, [currentStation]);

  const selectStation = useCallback((station: RadioStation) => {
    currentStationRef.current = station;
    setCurrentStation(station);
    setError(null);
  }, []);

  const playStation = useCallback(async (station: RadioStation) => {
    if (!enabled) {
      setError('Brak uprawnień do modułu radia internetowego.');
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const shouldReuseSource = currentStationRef.current?.id === station.id && !!audio.currentSrc;

    selectStation(station);
    setPanelOpenState(true);
    setIsBuffering(true);

    if (!shouldReuseSource) {
      attachSource(station.streamUrl);
    }

    try {
      await audio.play();
    } catch (playbackError) {
      setIsPlaying(false);
      setIsBuffering(false);
      setError(friendlyPlaybackError(playbackError));
    }
  }, [attachSource, enabled, selectStation]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentStation) return;

    if (audio.paused) {
      if (!audio.currentSrc) {
        attachSource(currentStation.streamUrl);
      }
      setError(null);
      setIsBuffering(true);
      try {
        await audio.play();
      } catch (playbackError) {
        setIsPlaying(false);
        setIsBuffering(false);
        setError(friendlyPlaybackError(playbackError));
      }
      return;
    }

    audio.pause();
    setIsBuffering(false);
  }, [attachSource, currentStation]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* ignore */ }
    setIsPlaying(false);
    setIsBuffering(false);
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = clamp(next, 0, 1);
    setVolumeState(clamped);
    if (clamped > 0 && muted) setMuted(false);
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted(prev => !prev);
  }, []);

  const setAutoplay = useCallback((next: boolean) => {
    setAutoplayState(next);
  }, []);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenState(open);
  }, []);

  const toggleFavorite = useCallback((station: RadioStation) => {
    setFavorites(prev => {
      const exists = prev.some(item => item.id === station.id);
      if (exists) return prev.filter(item => item.id !== station.id);
      return [{ ...station, source: 'favorite' as const }, ...prev].slice(0, 24);
    });
  }, []);

  const isFavorite = useCallback((stationId: string) => {
    return favorites.some(station => station.id === stationId);
  }, [favorites]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const store = await getStore();
        const autoplayValue = asBool(await store.get<string>('radio_autoplay'), false);
        const volumeValue = asNumber(await store.get<string>('radio_volume'), DEFAULT_VOLUME);
        const mutedValue = asBool(await store.get<string>('radio_muted'), false);
        const panelOpenValue = asBool(await store.get<string>('radio_panel_open'), false);
        const favoritesValue = parseFavorites(await store.get<string>('radio_favorites'));
        const lastStation = normalizeStation({
          id: await store.get<string>('radio_last_station_id'),
          name: await store.get<string>('radio_last_station_name'),
          streamUrl: await store.get<string>('radio_last_stream_url'),
        }, 'restored');

        if (cancelled) return;

        setAutoplayState(autoplayValue);
        setVolumeState(volumeValue);
        setMuted(mutedValue);
        setPanelOpenState(panelOpenValue);
        setFavorites(favoritesValue);
        setCurrentStation(lastStation);
        setReady(true);

        if (enabled && autoplayValue && lastStation) {
          void playStation(lastStation);
        }
      } catch {
        if (cancelled) return;
        setReady(true);
        setError('Nie udało się odczytać lokalnych ustawień radia.');
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [enabled, playStation]);

  useEffect(() => {
    if (!ready) return;

    const timeout = window.setTimeout(() => {
      void (async () => {
        const store = await getStore();
        await store.set('radio_autoplay', autoplay ? 'true' : 'false');
        await store.set('radio_volume', String(volume));
        await store.set('radio_muted', muted ? 'true' : 'false');
        await store.set('radio_panel_open', panelOpen ? 'true' : 'false');
        await store.set('radio_last_station_id', currentStation?.id ?? '');
        await store.set('radio_last_station_name', currentStation?.name ?? '');
        await store.set('radio_last_stream_url', currentStation?.streamUrl ?? '');
        await store.set('radio_favorites', JSON.stringify(favorites));
        await store.save();
      })();
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [autoplay, currentStation, favorites, muted, panelOpen, ready, volume]);

  useEffect(() => {
    if (enabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setIsBuffering(false);
    setPanelOpenState(false);
  }, [enabled]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !currentStation) return;
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentStation.name,
      artist: currentStation.country || 'Radio internetowe',
      album: currentStation.tags?.join(' · ') || 'Parking.OS',
      artwork: currentStation.favicon
        ? [{ src: currentStation.favicon, sizes: '512x512', type: 'image/png' }]
        : [],
    });

    try {
      navigator.mediaSession.setActionHandler('play', () => { void togglePlayback(); });
      navigator.mediaSession.setActionHandler('pause', () => { void togglePlayback(); });
      navigator.mediaSession.setActionHandler('stop', () => stop());
    } catch {
      // ignore unsupported action handlers
    }
  }, [currentStation, stop, togglePlayback]);

  useEffect(() => {
    return () => {
      destroyHls();
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [destroyHls]);

  return useMemo(() => ({
    canControl: enabled,
    ready,
    currentStation,
    favorites,
    isPlaying,
    isBuffering,
    volume,
    muted,
    autoplay,
    panelOpen,
    error,
    selectStation,
    playStation,
    togglePlayback,
    stop,
    setVolume,
    toggleMute,
    setAutoplay,
    setPanelOpen,
    toggleFavorite,
    isFavorite,
    clearError,
  }), [
    enabled,
    ready,
    currentStation,
    favorites,
    isPlaying,
    isBuffering,
    volume,
    muted,
    autoplay,
    panelOpen,
    error,
    selectStation,
    playStation,
    togglePlayback,
    stop,
    setVolume,
    toggleMute,
    setAutoplay,
    setPanelOpen,
    toggleFavorite,
    isFavorite,
    clearError,
  ]);
}