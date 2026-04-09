import { useEffect, useRef, useState } from 'react';
import { CAM_BASE_URL } from '../supabase';
import { RefreshCw, VideoOff } from 'lucide-react';

export default function Camera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0); // increment to force re-mount

  const hlsUrl = `${CAM_BASE_URL}/stream/cam1.m3u8`;

  // Safari (iPad) obsługuje HLS natywnie poprzez <video src="...m3u8">
  // Dla innych przeglądarek ładujemy hls.js dynamicznie
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(false);

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS
      video.src = hlsUrl;
      video.load();
      return;
    }

    // Inne przeglądarki — dynamiczny import hls.js
    let hlsInstance: import('hls.js').default | null = null;
    import('hls.js').then(({ default: Hls }) => {
      if (!Hls.isSupported()) { setError(true); return; }
      hlsInstance = new Hls({ liveSyncDurationCount: 2 });
      hlsInstance.loadSource(hlsUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError(true);
      });
    });

    return () => { hlsInstance?.destroy(); };
  }, [hlsUrl, key]);

  return (
    <div className="flex flex-col h-full px-4 pt-5 pb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Kamera 1</h2>
        <button
          onClick={() => { setKey(k => k + 1); setError(false); }}
          className="p-2 -mr-1 text-slate-400 active:text-white transition-colors"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      <div className="relative w-full rounded-2xl overflow-hidden bg-slate-800 border border-slate-700" style={{ aspectRatio: '16/9' }}>
        {!error ? (
          <video
            key={key}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            controls
            className="w-full h-full object-contain"
            onError={() => setError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <VideoOff size={40} className="opacity-40" />
            <p className="text-sm">Nie można załadować streamu</p>
            <button
              onClick={() => { setKey(k => k + 1); setError(false); }}
              className="text-xs bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl transition-colors"
            >
              Spróbuj ponownie
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600 mt-3 text-center break-all">{hlsUrl}</p>
    </div>
  );
}
