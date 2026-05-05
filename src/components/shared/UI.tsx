import React from 'react';
import { X } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, children, className = '', disabled, ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-semibold rounded-[var(--radius-md)] transition-all duration-150 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] ' +
    'active:scale-[0.98] hover:-translate-y-[1px]';
  const variants = {
    primary:   'bg-[var(--color-accent)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--color-accent-hover)] hover:shadow-[var(--shadow-md)] focus-visible:ring-[var(--color-accent)]',
    secondary: 'bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] focus-visible:ring-[var(--color-text-muted)]',
    danger:    'bg-[var(--color-danger)] text-white shadow-[var(--shadow-sm)] hover:opacity-90 hover:shadow-[var(--shadow-md)] focus-visible:ring-[var(--color-danger)]',
    success:   'bg-[var(--color-success)] text-white shadow-[var(--shadow-sm)] hover:opacity-90 hover:shadow-[var(--shadow-md)] focus-visible:ring-[var(--color-success)]',
    warning:   'bg-[var(--color-warning)] text-white shadow-[var(--shadow-sm)] hover:opacity-90 hover:shadow-[var(--shadow-md)] focus-visible:ring-[var(--color-warning)]',
    ghost:     'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:ring-[var(--color-text-muted)]',
  };
  const sizes = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2.5 gap-2',
    lg: 'text-base px-5 py-3 gap-2',
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      )}
      {children}
    </button>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className = '', ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</label>}
      <input
        className={`bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 focus:border-[var(--color-accent)] hover:border-[var(--color-border-strong)] placeholder-[var(--color-muted)] ${error ? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/40 focus:border-[var(--color-danger)]' : ''} ${className}`}
        {...props}
      />
      {hint && !error && <span className="text-[11px] text-[var(--color-text-muted)] opacity-80">{hint}</span>}
      {error && <span className="text-xs text-[var(--color-danger)] font-medium">{error}</span>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, children, className = '', ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</label>}
      <select
        className={`bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 focus:border-[var(--color-accent)] hover:border-[var(--color-border-strong)] ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning';
}

export function Card({ children, className = '', title, subtitle, icon, action, variant = 'default' }: CardProps) {
  const variants = {
    default: 'border-[var(--color-border)]',
    accent:  'border-[var(--color-accent-border)] bg-[var(--color-accent-bg)]',
    success: 'border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[var(--color-success-bg)]',
    danger:  'border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[var(--color-danger-bg)]',
    warning: 'border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[var(--color-warning-bg)]',
  };
  return (
    <div className={`bg-[var(--color-surface)] backdrop-blur-sm border ${variants[variant]} rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow duration-200 ${className}`}>
      {(title || icon || action) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-2.5 min-w-0">
            {icon && <span className="flex-shrink-0 text-[var(--color-accent)] mt-0.5">{icon}</span>}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-bold text-[var(--color-text)] tracking-tight">{title}</h3>}
              {subtitle && <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-[fadeIn_.15s_ease]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--color-surface)] backdrop-blur-md border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] w-full max-w-md p-6 z-10 animate-[slideUp_.2s_cubic-bezier(0.16,1,0.3,1)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--color-text)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] rounded-md p-1.5 transition-colors"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <svg className={`animate-spin ${sizes[size]} text-[var(--color-accent)]`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

// ── Nowe wspólne komponenty ──

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning' | 'info';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border)]',
    accent:  'bg-[var(--color-accent-bg)] text-[var(--color-accent)] border-[var(--color-accent-border)]',
    success: 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]',
    danger:  'bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]',
    warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)]',
    info:    'bg-[var(--color-info-bg)] text-[var(--color-info)] border-[color-mix(in_srgb,var(--color-info)_30%,transparent)]',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

interface SectionTitleProps {
  children: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
}

export function SectionTitle({ children, description, action }: SectionTitleProps) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <h2 className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em]">{children}</h2>
        {description && <p className="text-xs text-[var(--color-text-muted)] opacity-70 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}
