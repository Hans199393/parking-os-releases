import { useRef, useEffect, useState } from 'react';
import { logCameraOnline, logCameraOffline } from '../../lib/logger';

/**
 * HLS player — łączy się ze streamem HLS serwowanym przez lokalny proxy ffmpeg.
 * Automatycznie wznawia połączenie po utracie streamu (np. restart ffmpeg).
 */
export default function RTSPPlayer({ streamUrl, label, fill }: { streamUrl: string; label?: string; fill?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 'loading' | 'playing' | 'reconnecting' | 'error'
  const [status, setStatus] = useState<'loading' | 'playing' | 'reconnecting' | 'error'>('loading');
  const [retryInfo, setRetryInfo] = useState('');

  useEffect(() => {
    if (!streamUrl) {
      setStatus('error');
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any = null;
    let destroyed = false;
    let retries = 0;
    const MAX_RETRIES = 99; // praktycznie bez limitu — proxy restartuje co 5s
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Stall watchdog — jeśli obraz stoi >2s, wymuś live edge
    let lastTime = -1;
    let stallTicks = 0;
    const watchdog = setInterval(() => {
      if (destroyed || !video) return;
      if (video.paused && !video.ended) { video.play().catch(() => {}); return; }
      if (video.currentTime === lastTime && !video.paused) {
        stallTicks++;
        if (stallTicks >= 1) {
          if (video.seekable.length > 0)
            video.currentTime = video.seekable.end(video.seekable.length - 1);
          stallTicks = 0;
        }
      } else {
        stallTicks = 0;
      }
      lastTime = video.currentTime;
    }, 2000);

    async function initHls() {
      if (destroyed) return;
      if (hls) { hls.destroy(); hls = null; }

      try {
        const Hls = (await import('hls.js')).default;
        if (destroyed || !video) return;

        if (Hls.isSupported()) {
          const hlsInstance = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 4,
            maxBufferLength: 4,
            maxMaxBufferLength: 8,
            backBufferLength: 0,
            highBufferWatchdogPeriod: 2,
            nudgeMaxRetry: 5,
            // Dużo prób ładowania manifestu — proxy restartuje ~5s po crashu ffmpeg
            manifestLoadingMaxRetry: 30,
            manifestLoadingRetryDelay: 2000,
            manifestLoadingMaxRetryTimeout: 4000,
            levelLoadingMaxRetry: 10,
            levelLoadingRetryDelay: 1000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 500,
          });
          hls = hlsInstance;

          hlsInstance.loadSource(streamUrl);
          hlsInstance.attachMedia(video);

          hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed || !video) return;
            if (video.seekable.length > 0)
              video.currentTime = video.seekable.end(video.seekable.length - 1);
            video.play().catch(() => {});
            retries = 0;
            setStatus('playing');
          });

          hlsInstance.on(Hls.Events.ERROR, (_e: unknown, data: { fatal: boolean; type: string; details?: string }) => {
            if (destroyed) return;
            if (data.fatal) {
              // Fatal = hls.js wyczerpał własne retry — niszczymy i odpalamy od nowa
              hlsInstance.destroy();
              hls = null;
              retries++;
              if (retries > MAX_RETRIES) { setStatus('error'); return; }
              const delay = Math.min(1500 + retries * 500, 8000);
              setStatus('reconnecting');
              setRetryInfo(`próba ${retries} — za ${(delay / 1000).toFixed(0)}s`);
              retryTimer = setTimeout(() => { if (!destroyed) initHls(); }, delay);
            } else if (data.type === 'mediaError') {
              // Niefatalny błąd media (np. zepsuta ramka z RTSP) — soft recovery
              hlsInstance.recoverMediaError();
            }
          });

        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = streamUrl;
          video.addEventListener('loadedmetadata', () => {
            if (destroyed || !video) return;
            video.play().catch(() => {});
            setStatus('playing');
          });
        } else {
          setStatus('error');
        }
      } catch {
        if (!destroyed) {
          retries++;
          const delay = Math.min(2000 * retries, 10000);
          setStatus('reconnecting');
          setRetryInfo(`próba ${retries}`);
          retryTimer = setTimeout(() => { if (!destroyed) initHls(); }, delay);
        }
      }
    }

    setStatus('loading');
    initHls();

    return () => {
      destroyed = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      hls?.destroy();
    };
  }, [streamUrl]);

  // Loguj zmiany stanu kamery
  const prevStatusRef = useRef<typeof status | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === null) return; // pierwsze renderowanie — nie loguj
    if (status === 'playing' && prev !== 'playing') {
      logCameraOnline(label ?? 'Kamera', streamUrl);
    } else if ((status === 'error') && prev === 'playing') {
      logCameraOffline(label ?? 'Kamera', streamUrl, 'błąd streamu');
    }
  }, [status, label, streamUrl]);

  return (
    <div className={`relative bg-black overflow-hidden ${fill ? 'absolute inset-0' : 'rounded-xl border border-slate-700'}`} style={fill ? undefined : { aspectRatio: '16/9' }}>
      {label && (
        <div className="absolute top-2 left-2 z-10">
          <span className="text-xs text-white bg-black/60 px-2 py-0.5 rounded font-medium">{label}</span>
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        muted
        playsInline
        autoPlay
        style={{ display: status === 'playing' ? 'block' : 'none' }}
      />

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-xs">Łączenie ze streamem...</p>
        </div>
      )}

      {status === 'reconnecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-xs">Wznawianie połączenia...</p>
          <p className="text-slate-600 text-xs">{retryInfo}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-3xl">📷</div>
          <p className="text-slate-400 text-sm">Stream niedostępny</p>
          <p className="text-slate-600 text-xs max-w-xs">Nie można nawiązać połączenia z kamerą.</p>
        </div>
      )}
    </div>
  );
}
