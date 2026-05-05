import { LayoutDashboard, Camera, CalendarDays, DollarSign, Settings, Smartphone, MessageCircle, Mail, LogOut, ClipboardList } from 'lucide-react';
import type { AppUser } from '../../lib/session';

export type Page = 'dashboard' | 'cameras' | 'reservations' | 'finances' | 'admin' | 'chat' | 'email' | 'settings' | 'logs';

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { id: 'cameras', label: 'Kamery', icon: <Camera size={20} /> },
  { id: 'reservations', label: 'Rezerwacje', icon: <CalendarDays size={20} /> },
  { id: 'finances', label: 'Finanse', icon: <DollarSign size={20} /> },
  { id: 'chat', label: 'Czat Orzeł', icon: <MessageCircle size={20} /> },
  { id: 'email', label: 'Skrzynka', icon: <Mail size={20} /> },
  { id: 'logs', label: 'Logi', icon: <ClipboardList size={20} /> },
  { id: 'settings', label: 'Ustawienia', icon: <Settings size={20} /> },
];

interface SidebarProps {
  current: Page;
  onChange: (page: Page) => void;
  reservationBadge?: number;
  chatBadge?: number;
  onOpenPwa?: () => void;
  onStopPwa?: () => void;
  pwaStatus?: 'stopped' | 'starting' | 'running';
  user?: AppUser | null;
  onLogout?: () => void;
}

export default function Sidebar({ current, onChange, reservationBadge, chatBadge, onOpenPwa, onStopPwa, pwaStatus, user, onLogout }: SidebarProps) {
  const visibleItems = navItems.filter(item =>
    !user || user.role === 'superadmin' || user.permissions.includes(item.id)
  );

  return (
    <aside className="w-60 flex-shrink-0 glass-sidebar rounded-[var(--radius-xl)] border border-[var(--color-border)]/40 flex flex-col overflow-hidden shadow-[var(--shadow-xl)] animate-slideRight">
      {/* App title — z bursztynowym glow pod logiem */}
      <div className="relative flex items-center justify-center px-5 py-6 border-b border-[var(--color-border)]/30">
        <div className="absolute inset-0 opacity-50 pointer-events-none"
             style={{ background: 'var(--gradient-amber-glow)' }} />
        <img src="/logo2026.png" alt="Parking.OS" className="h-12 w-auto object-contain drop-shadow-[0_4px_16px_rgba(245,158,11,0.4)] animate-float-slow relative z-10" />
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-5 overflow-y-auto">
        <p className="px-3 mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300/50">Nawigacja</p>
        <ul className="space-y-1">
          {visibleItems.map((item, idx) => (
            <li key={item.id} style={{ animationDelay: `${idx * 30}ms` }} className="animate-slideRight">
              <button
                onClick={() => onChange(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-[var(--radius-md)] text-sm font-semibold transition-all duration-200 group relative overflow-hidden
                  ${current === item.id
                    ? 'text-[#1a1410] shadow-[var(--shadow-glow)]'
                    : 'text-amber-100/70 hover:text-white hover:translate-x-1'
                  }`}
              >
                {/* Aktywne tło z gradientem */}
                {current === item.id && (
                  <span className="absolute inset-0 bg-gradient-accent" aria-hidden="true" />
                )}
                {/* Hover overlay */}
                {current !== item.id && (
                  <span className="absolute inset-0 bg-amber-400/0 group-hover:bg-amber-400/10 transition-colors" aria-hidden="true" />
                )}
                <span className="flex-shrink-0 relative z-10">{item.icon}</span>
                <span className="relative z-10">{item.label}</span>
                {item.id === 'reservations' && reservationBadge && reservationBadge > 0 ? (
                  <span className={`ml-auto text-[10px] font-bold rounded-full px-2 py-0.5 min-w-[22px] text-center shadow-[var(--shadow-sm)] relative z-10
                    ${current === item.id ? 'bg-[#1a1410] text-amber-300' : 'bg-gradient-accent text-[#1a1410]'}`}>
                    {reservationBadge > 9 ? '9+' : reservationBadge}
                  </span>
                ) : null}
                {item.id === 'chat' && chatBadge && chatBadge > 0 ? (
                  <span className="ml-auto bg-[var(--color-orange)] text-white text-[10px] font-bold rounded-full px-2 py-0.5 min-w-[22px] text-center animate-[pulse-soft_1.4s_ease-in-out_infinite] shadow-[var(--shadow-sm)] relative z-10">
                    {chatBadge > 9 ? '9+' : chatBadge}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* PWA launcher */}
      {onOpenPwa && (
        <div className="px-3 pb-3 space-y-1">
          <button
            onClick={pwaStatus === 'starting' ? undefined : onOpenPwa}
            disabled={pwaStatus === 'starting'}
            title="Uruchom serwer PWA (iPad)"
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[var(--radius-md)] text-sm font-semibold transition-all border
              ${
                pwaStatus === 'running'
                  ? 'text-[var(--color-success)] border-[var(--color-success)]/50 bg-[var(--color-success-bg)]'
                  : pwaStatus === 'starting'
                  ? 'text-[var(--color-warning)] border-[var(--color-warning)]/50 opacity-70 cursor-wait'
                  : 'text-amber-100/70 border-amber-100/20 border-dashed hover:bg-amber-400/10 hover:text-amber-200 hover:border-amber-400/40'
              }`}
          >
            <Smartphone size={18} className="flex-shrink-0" />
            <span className="flex-1 text-left">
              {pwaStatus === 'running' ? 'PWA działa' : pwaStatus === 'starting' ? 'Uruchamianie...' : 'Uruchom PWA'}
            </span>
            {pwaStatus === 'running' && (
              <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-[pulse-soft_1.5s_ease-in-out_infinite]" />
            )}
          </button>
          {pwaStatus === 'running' && onStopPwa && (
            <button
              onClick={onStopPwa}
              className="w-full text-[11px] text-red-300/80 hover:text-red-300 hover:bg-red-900/20 rounded-[var(--radius-sm)] px-3 py-1 transition-all"
            >
              Zatrzymaj PWA
            </button>
          )}
        </div>
      )}

      {/* Footer — user info + logout */}
      <div className="px-3 py-4 border-t border-[var(--color-border)]/30 space-y-2 bg-black/20">
        {user && (
          <div className="px-2 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-gradient-accent flex items-center justify-center text-[#1a1410] font-bold text-sm shadow-[var(--shadow-md)]">
              {(user.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-amber-100 text-xs font-bold truncate">{user.email}</p>
              <p className="text-amber-300/60 text-[10px] uppercase tracking-wider font-semibold">
                {user.role === 'superadmin' ? 'Administrator' : 'Operator'}
              </p>
            </div>
          </div>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-xs text-amber-100/60 hover:text-red-300 hover:bg-red-900/20 transition-all font-semibold"
          >
            <LogOut size={14} />
            Wyloguj się
          </button>
        )}
      </div>
    </aside>
  );
}
