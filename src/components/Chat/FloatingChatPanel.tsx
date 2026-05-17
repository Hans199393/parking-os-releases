/**
 * FloatingChatPanel — Iter 13.
 * Pływające okno chat à la Copilot. Przeciągalne za nagłówek, rozszerzalne
 * (resize-handle w prawym-dolnym rogu), minimalizowane do FAB.
 *
 * Stan rozmiaru/pozycji zapamiętany w localStorage:
 *   - orzel_chat_panel_pos: { x, y, w, h }
 *   - orzel_chat_panel_open: bool
 *   - orzel_chat_panel_min: bool (zminimalizowane)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, X, Minus, GripHorizontal } from 'lucide-react';
import OrzelChatBody from './OrzelChatBody';
import { parseQuickActions, type QuickActionBlock } from '../../lib/orzelQuickActions';
import { getStore } from '../../lib/store';

// Simple ErrorBoundary to prevent a render error in OrzelChatBody from
// unmounting the whole panel unexpectedly. Shows a friendly message.
import React from 'react';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('[OrzelChatBody] render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-red-300">
          Błąd ładowania panelu Asystenta. Sprawdź konsolę (DevTools) i uruchom ponownie.
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

const POS_KEY = 'orzel_chat_panel_pos_v1';

interface Pos { x: number; y: number; w: number; h: number }

const DEFAULT_POS: Pos = { x: 0, y: 0, w: 420, h: 560 };
const MIN_W = 320;
const MIN_H = 320;

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number') return { ...DEFAULT_POS, ...p };
    }
  } catch { /* ignore */ }
  // Domyślnie prawy-dolny róg
  const x = Math.max(20, window.innerWidth - DEFAULT_POS.w - 20);
  const y = Math.max(20, window.innerHeight - DEFAULT_POS.h - 80);
  return { ...DEFAULT_POS, x, y };
}

function savePos(p: Pos) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onMinimize: () => void;
}

export default function FloatingChatPanel({ open, onClose, onMinimize }: Props) {
  const [pos, setPos] = useState<Pos>(() => loadPos());
  const [quickActions, setQuickActions] = useState<QuickActionBlock[]>([]);
  const draggingRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resizingRef = useRef<{ startX: number; startY: number; ow: number; oh: number } | null>(null);

  // Ładowanie quick actions z ustawień
  useEffect(() => {
    const load = async () => {
      try {
        const store = await getStore();
        const raw = (await store.get<string>('orzel_quick_actions')) ?? '';
        setQuickActions(parseQuickActions(raw));
      } catch { /* ignore */ }
    };
    void load();
    const onSaved = () => void load();
    window.addEventListener('app:settings-saved', onSaved);
    return () => window.removeEventListener('app:settings-saved', onSaved);
  }, []);

  // Persist pos
  useEffect(() => { savePos(pos); }, [pos]);

  // Clamp do viewportu po resize okna
  useEffect(() => {
    const onResize = () => {
      setPos(p => {
        const maxX = Math.max(0, window.innerWidth - p.w);
        const maxY = Math.max(0, window.innerHeight - p.h);
        return { ...p, x: Math.min(p.x, maxX), y: Math.min(p.y, maxY) };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drag (header)
  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // klik w przycisk = nie dragujemy
    e.preventDefault();
    draggingRef.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y };
    document.body.style.userSelect = 'none';
  }, [pos.x, pos.y]);

  // Resize (rectangular handle BR)
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { startX: e.clientX, startY: e.clientY, ow: pos.w, oh: pos.h };
    document.body.style.userSelect = 'none';
  }, [pos.w, pos.h]);

  // Globalne mousemove/mouseup
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) {
        const d = draggingRef.current;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        setPos(p => {
          const nx = Math.max(0, Math.min(window.innerWidth - p.w, d.ox + dx));
          const ny = Math.max(0, Math.min(window.innerHeight - 40, d.oy + dy));
          return { ...p, x: nx, y: ny };
        });
      } else if (resizingRef.current) {
        const r = resizingRef.current;
        const dw = e.clientX - r.startX;
        const dh = e.clientY - r.startY;
        setPos(p => {
          const nw = Math.max(MIN_W, Math.min(window.innerWidth - p.x, r.ow + dw));
          const nh = Math.max(MIN_H, Math.min(window.innerHeight - p.y, r.oh + dh));
          return { ...p, w: nw, h: nh };
        });
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      resizingRef.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed z-[180] glass-strong rounded-[var(--radius-lg)] border-2 border-[var(--color-accent-border)] shadow-[var(--shadow-xl)] flex flex-col overflow-hidden animate-slideUp"
      style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
      role="dialog"
      aria-label="Asystent Orzeł"
    >
      {/* HEADER — draggable */}
      <div
        onMouseDown={onHeaderMouseDown}
        className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] cursor-move select-none"
      >
        <Bot size={16} className="text-[var(--color-accent)]" />
        <div className="text-xs font-bold flex-1">Asystent Orzeł</div>
        <GripHorizontal size={12} className="text-[var(--color-text-muted)] opacity-50" />
        <button
          onClick={onMinimize}
          className="p-1 hover:bg-[var(--color-surface-2)] rounded text-[var(--color-text-muted)]"
          title="Minimalizuj (do przycisku w rogu)"
          aria-label="Minimalizuj"
        ><Minus size={12} /></button>
        <button
          onClick={onClose}
          className="p-1 hover:bg-red-500/20 rounded text-[var(--color-text-muted)] hover:text-red-400"
          title="Zamknij (Esc)"
          aria-label="Zamknij"
        ><X size={12} /></button>
      </div>

      {/* BODY */}
      <div className="flex-1 min-h-0">
        <ErrorBoundary>
          <OrzelChatBody autoFocus compact quickActions={quickActions} />
        </ErrorBoundary>
      </div>

      {/* RESIZE HANDLE — prawy dolny róg */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        title="Przeciągnij aby zmienić rozmiar"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, var(--color-text-muted) 50%, var(--color-text-muted) 60%, transparent 60%, transparent 70%, var(--color-text-muted) 70%, var(--color-text-muted) 80%, transparent 80%)',
          opacity: 0.4,
        }}
      />
    </div>
  );
}
