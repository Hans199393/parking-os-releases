/**
 * RichEditor — lekki WYSIWYG (contentEditable) z toolbar.
 * Używamy document.execCommand — deprecated ale wciąż wspierane w Chrome/WebView2/Tauri.
 *
 * Props:
 *  - value: HTML wejściowy (jednorazowo, dalej zarządza DOM)
 *  - onChange: callback z HTML
 *  - placeholder
 *
 * Toolbar: Bold/Italic/Underline · UL/OL · Link · Cofnij/Ponów
 */

import { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, List, ListOrdered, Link2, Undo2, Redo2, Eraser, Image as ImageIcon,
} from 'lucide-react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

interface ToolBtn {
  cmd: string;
  icon: React.ReactNode;
  title: string;
  arg?: string;
}

const TOOLS_LEFT: ToolBtn[] = [
  { cmd: 'bold',          icon: <Bold        size={14} />, title: 'Pogrubienie (Ctrl+B)' },
  { cmd: 'italic',        icon: <Italic      size={14} />, title: 'Kursywa (Ctrl+I)' },
  { cmd: 'underline',     icon: <Underline   size={14} />, title: 'Podkreślenie (Ctrl+U)' },
  { cmd: 'insertUnorderedList', icon: <List      size={14} />, title: 'Lista wypunktowana' },
  { cmd: 'insertOrderedList',   icon: <ListOrdered size={14} />, title: 'Lista numerowana' },
];

const TOOLS_RIGHT: ToolBtn[] = [
  { cmd: 'undo',          icon: <Undo2  size={14} />, title: 'Cofnij (Ctrl+Z)' },
  { cmd: 'redo',          icon: <Redo2  size={14} />, title: 'Ponów (Ctrl+Y)' },
  { cmd: 'removeFormat',  icon: <Eraser size={14} />, title: 'Usuń formatowanie' },
];

export default function RichEditor({ value, onChange, placeholder, minHeight = 220 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hasFocus, setHasFocus] = useState(false);

  // Inicjalizuj treść jednorazowo (nie nadpisuj kursora przy każdej zmianie).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd: string, arg?: string) => {
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const insertLink = () => {
    const sel = window.getSelection();
    const selected = sel?.toString() ?? '';
    const url = window.prompt('Adres URL (np. https://parkingsobieszewo.pl):', 'https://');
    if (!url) return;
    if (selected) {
      exec('createLink', url);
    } else {
      exec('insertHTML', `<a href="${url}" target="_blank">${url}</a>`);
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const insertImageFromUrl = () => {
    const url = window.prompt('Adres URL obrazka (najlepiej publiczny https://...):', 'https://');
    if (!url || url === 'https://') return;
    exec('insertHTML', `<img src="${url}" alt="" style="max-width:200px;height:auto;display:inline-block;vertical-align:middle">`);
  };
  const insertImageFromFile = (file: File) => {
    if (file.size > 512 * 1024) {
      window.alert('Plik jest większy niż 512 KB. Zmniejsz rozmiar (zalecane logo ≤ 200×200 px) — inaczej e-maile będą ciężkie.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = String(reader.result ?? '');
      if (!dataUri.startsWith('data:image/')) return;
      exec('insertHTML', `<img src="${dataUri}" alt="logo" style="max-width:120px;height:auto;display:inline-block;vertical-align:middle">`);
    };
    reader.readAsDataURL(file);
  };

  const onInput = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const isEmpty = !value || value === '<br>' || value.replace(/<[^>]+>/g, '').trim() === '';

  return (
    <div className={`rounded-[var(--radius-md)] border-2 transition-colors ${hasFocus ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] rounded-t-[var(--radius-md)]">
        {TOOLS_LEFT.map(t => (
          <button key={t.cmd} type="button" title={t.title}
            onMouseDown={e => { e.preventDefault(); exec(t.cmd, t.arg); }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-accent)]/20 hover:text-[var(--color-accent)] transition-colors">
            {t.icon}
          </button>
        ))}
        <button type="button" title="Wstaw link"
          onMouseDown={e => { e.preventDefault(); insertLink(); }}
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-accent)]/20 hover:text-[var(--color-accent)] transition-colors">
          <Link2 size={14} />
        </button>
        <button type="button" title="Wstaw obraz — z pliku (do 512 KB) lub URL (Shift+klik)"
          onMouseDown={e => {
            e.preventDefault();
            if (e.shiftKey) { insertImageFromUrl(); return; }
            fileInputRef.current?.click();
          }}
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-accent)]/20 hover:text-[var(--color-accent)] transition-colors">
          <ImageIcon size={14} />
        </button>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) insertImageFromFile(f);
            e.target.value = '';
          }} />
        <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
        {TOOLS_RIGHT.map(t => (
          <button key={t.cmd} type="button" title={t.title}
            onMouseDown={e => { e.preventDefault(); exec(t.cmd, t.arg); }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-accent)]/20 hover:text-[var(--color-accent)] transition-colors">
            {t.icon}
          </button>
        ))}
      </div>
      {/* Editor */}
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-3 left-3 text-sm text-[var(--color-text-muted)] opacity-50 pointer-events-none">
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={onInput}
          onFocus={() => setHasFocus(true)}
          onBlur={() => setHasFocus(false)}
          className="px-3 py-3 text-sm text-[var(--color-text)] leading-relaxed focus:outline-none rich-editor-content"
          style={{ minHeight: `${minHeight}px` }}
        />
      </div>
    </div>
  );
}
