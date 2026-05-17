/**
 * useKeyboardShortcuts — globalne skróty klawiaturowe (Iter 9).
 *
 * Skróty:
 *  - Ctrl/Cmd + K → Czat Orzeł
 *  - Ctrl/Cmd + R → Rezerwacje (preventDefault — przejmuje przed odświeżeniem przeglądarki)
 *  - Ctrl/Cmd + L → Logi
 *  - Ctrl/Cmd + , → Ustawienia
 *  - Esc → wyzwala globalny event 'app:escape' (modale powinny same nasłuchiwać)
 *  - ? lub Shift+/ → otwiera modal pomocy (event 'app:show-shortcuts')
 *
 * Skróty NIE działają gdy aktywny jest input/textarea/contenteditable.
 */

import { useEffect } from 'react';
import type { Page } from '../components/Sidebar/Sidebar';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(navigate: (page: Page) => void) {
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const ctrl = ev.ctrlKey || ev.metaKey;
      const typing = isTypingTarget(ev.target);

      // Esc — globalny event nawet w polach tekstowych
      if (ev.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('app:escape'));
        return;
      }

      if (typing) return;

      // ? — pomoc
      if (ev.key === '?' || (ev.shiftKey && ev.key === '/')) {
        ev.preventDefault();
        window.dispatchEvent(new CustomEvent('app:show-shortcuts'));
        return;
      }

      if (!ctrl) return;
      const k = ev.key.toLowerCase();
      switch (k) {
        // UWAGA: Ctrl+J obsługiwane bezpośrednio w App.tsx (toggle pływającego panelu).
        // Nie dispatchujemy stąd eventu — powodowało to podwójny toggle (panel migotał).
        case 'k':
          ev.preventDefault();
          navigate('chat');
          break;
        case 'r':
          ev.preventDefault();
          navigate('reservations');
          break;
        case 'l':
          ev.preventDefault();
          navigate('logs');
          break;
        case ',':
          ev.preventDefault();
          navigate('settings');
          break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

export const SHORTCUTS_HELP: { keys: string; label: string }[] = [
  { keys: 'Ctrl + K',  label: 'Otwórz Czat Orzeł' },
  { keys: 'Ctrl + R',  label: 'Otwórz Rezerwacje' },
  { keys: 'Ctrl + L',  label: 'Otwórz Logi' },
  { keys: 'Ctrl + ,',  label: 'Otwórz Ustawienia' },
  { keys: 'Esc',       label: 'Zamknij modal / wyjdź z trybu' },
  { keys: '?',         label: 'Pokaż tę pomoc' },
];
