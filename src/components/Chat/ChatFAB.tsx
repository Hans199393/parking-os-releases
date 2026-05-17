/**
 * ChatFAB — Iter 13.
 * Pływający przycisk (Floating Action Button) w prawym-dolnym rogu otwierający
 * panel chat. Pokazuje się gdy panel jest zamknięty/zminimalizowany.
 */

import { Bot } from 'lucide-react';

interface Props {
  visible: boolean;
  onClick: () => void;
  /** Czy są nowe wiadomości / panel zminimalizowany z aktywną sesją */
  pulse?: boolean;
}

export default function ChatFAB({ visible, onClick, pulse = false }: Props) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-[170] w-12 h-12 rounded-full bg-gradient-accent shadow-[var(--shadow-xl)] hover:scale-110 active:scale-95 transition-transform flex items-center justify-center group"
      title="Asystent Orzeł (Ctrl+J)"
      aria-label="Otwórz asystenta Orzeł"
    >
      <Bot size={20} className="text-[#1a1410]" />
      {pulse && (
        <span className="absolute inset-0 rounded-full bg-[var(--color-accent)] opacity-40 animate-ping pointer-events-none" />
      )}
      <span className="absolute right-full mr-2 px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        Orzeł · <kbd className="font-mono text-[10px] opacity-60">Ctrl+J</kbd>
      </span>
    </button>
  );
}
