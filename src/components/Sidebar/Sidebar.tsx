import { LayoutDashboard, Camera, CalendarDays, DollarSign, Globe, Settings, Smartphone, MessageCircle, Mail } from 'lucide-react';

export type Page = 'dashboard' | 'cameras' | 'reservations' | 'finances' | 'admin' | 'chat' | 'email' | 'settings';

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { id: 'cameras', label: 'Kamery', icon: <Camera size={20} /> },
  { id: 'reservations', label: 'Rezerwacje', icon: <CalendarDays size={20} /> },
  { id: 'finances', label: 'Finanse', icon: <DollarSign size={20} /> },
  { id: 'admin', label: 'Panel WWW', icon: <Globe size={20} /> },
  { id: 'chat', label: 'Czat Orzeł', icon: <MessageCircle size={20} /> },
  { id: 'email', label: 'Skrzynka', icon: <Mail size={20} /> },
  { id: 'settings', label: 'Ustawienia', icon: <Settings size={20} /> },
];

interface SidebarProps {
  current: Page;
  onChange: (page: Page) => void;
  reservationBadge?: number;
  onOpenPwa?: () => void;
  onStopPwa?: () => void;
  pwaStatus?: 'stopped' | 'starting' | 'running';
}

export default function Sidebar({ current, onChange, reservationBadge, onOpenPwa, onStopPwa, pwaStatus }: SidebarProps) {
  return (
    <aside className="w-56 flex-shrink-0 bg-slate-900/85 backdrop-blur-md border-r border-slate-700/60 flex flex-col h-screen">
      {/* App title */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700">
        <img src="/logo2026.png" alt="Logo" className="h-9 w-auto object-contain" />
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map(item => (
            <li key={item.id}>
              <button
                onClick={() => onChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative
                  ${current === item.id
                    ? 'bg-teal-500/20 text-teal-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span>{item.label}</span>
                {item.id === 'reservations' && reservationBadge && reservationBadge > 0 ? (
                  <span className="ml-auto bg-teal-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                    {reservationBadge > 9 ? '9+' : reservationBadge}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* PWA launcher */}
      {onOpenPwa && (
        <div className="px-3 pb-2 space-y-1">
          <button
            onClick={pwaStatus === 'starting' ? undefined : onOpenPwa}
            disabled={pwaStatus === 'starting'}
            title="Uruchom serwer PWA (iPad)"
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border border-dashed
              ${
                pwaStatus === 'running'
                  ? 'text-green-400 border-green-700 hover:bg-green-900/20'
                  : pwaStatus === 'starting'
                  ? 'text-yellow-400 border-yellow-700 opacity-70 cursor-wait'
                  : 'text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-teal-400 hover:border-teal-600'
              }`}
          >
            <Smartphone size={18} className="flex-shrink-0" />
            <span>
              {pwaStatus === 'running' ? '✓ PWA działa' : pwaStatus === 'starting' ? 'Uruchamianie…' : 'Uruchom PWA'}
            </span>
          </button>
          {pwaStatus === 'running' && onStopPwa && (
            <button
              onClick={onStopPwa}
              className="w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded px-3 py-1 transition-all"
            >
              Zatrzymaj PWA
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-700">
        <p className="text-slate-600 text-xs leading-relaxed">Michał Kłos</p>
        <p className="text-slate-600 text-xs">Wyspa Sobieszewska</p>
      </div>
    </aside>
  );
}
