/**
 * useIdleLock — autoblokada po N minutach bezczynności.
 *
 * Wywołuje `onLock` po `timeoutMs` braku ruchu myszki / klawiatury / dotyku.
 * Na ekranie blokady (renderowanym przez wywołującego) user wpisuje hasło
 * i odblokowuje aplikację.
 *
 * Używamy `mousemove`, `keydown`, `touchstart`, `wheel` jako sygnałów aktywności.
 * Throttle 1s żeby nie resetować timera co milisekundę.
 */

import { useEffect, useRef } from 'react';

export interface UseIdleLockOptions {
  timeoutMs: number;        // 0 = wyłączone
  onLock: () => void;
  enabled: boolean;
}

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousemove', 'keydown', 'touchstart', 'wheel', 'click',
];

export function useIdleLock({ timeoutMs, onLock, enabled }: UseIdleLockOptions) {
  const timerRef = useRef<number | null>(null);
  const lastResetRef = useRef(0);
  const onLockRef = useRef(onLock);

  useEffect(() => { onLockRef.current = onLock; }, [onLock]);

  useEffect(() => {
    if (!enabled || timeoutMs <= 0) return;

    const reset = () => {
      const now = Date.now();
      // throttle 1s
      if (now - lastResetRef.current < 1000) return;
      lastResetRef.current = now;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => onLockRef.current(), timeoutMs);
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    reset();

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [timeoutMs, enabled]);
}
