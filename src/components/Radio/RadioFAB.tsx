import { Headphones } from 'lucide-react';

export default function RadioFAB({
  visible,
  onClick,
  pulse = false,
}: {
  visible: boolean;
  onClick: () => void;
  pulse?: boolean;
}) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 right-6 z-[165] flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-xl)] ring-1 ring-[var(--color-accent-border)] transition-transform hover:scale-110 active:scale-95 group"
      title="Radio internetowe"
      aria-label="Otwórz panel radia"
    >
      <Headphones size={19} />
      {pulse && (
        <span className="pointer-events-none absolute inset-0 rounded-full bg-[var(--color-accent)] opacity-30 animate-ping" />
      )}
      <span className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] opacity-0 transition-opacity group-hover:opacity-100">
        Radio internetowe
      </span>
    </button>
  );
}