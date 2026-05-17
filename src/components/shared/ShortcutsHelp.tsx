/**
 * ShortcutsHelp — modal pomocy klawiszy (Iter 9).
 * Otwierany przez wciśnięcie '?' (event 'app:show-shortcuts').
 * Zamykany przez Esc (event 'app:escape') albo kliknięcie tła.
 */

import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUTS_HELP } from '../../lib/useKeyboardShortcuts';

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onShow() { setOpen(true); }
    function onEsc() { setOpen(false); }
    window.addEventListener('app:show-shortcuts', onShow);
    window.addEventListener('app:escape', onEsc);
    return () => {
      window.removeEventListener('app:show-shortcuts', onShow);
      window.removeEventListener('app:escape', onEsc);
    };
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={() => setOpen(false)}>
      <div className="glass-strong rounded-[var(--radius-xl)] p-6 max-w-md w-[92vw] shadow-[var(--shadow-xl)] animate-slideUp"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-gradient-accent flex items-center justify-center">
              <Keyboard size={20} className="text-[#1a1410]" />
            </div>
            <h2 className="text-lg font-bold">Skróty klawiaturowe</h2>
          </div>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-[var(--color-surface-2)]">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS_HELP.map(s => (
            <div key={s.keys} className="flex items-center justify-between px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)]/40">
              <span className="text-sm">{s.label}</span>
              <kbd className="px-2.5 py-1 text-[11px] font-mono font-bold rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10px] text-[var(--color-text-muted)] text-center">
          Skróty nie działają gdy piszesz w polu tekstowym.
        </p>
      </div>
    </div>
  );
}
