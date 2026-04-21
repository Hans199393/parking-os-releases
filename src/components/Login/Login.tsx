import { useState } from 'react';
import { signIn } from '../../lib/auth';
import { logLogin } from '../../lib/logger';
import { Button, Input } from '../shared/UI';

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Podaj e-mail i haslo.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await signIn(email, password);
      if (result.ok) {
        logLogin(email);
        onSuccess();
      } else {
        setError(result.error ?? 'Nieprawidlowe dane logowania.');
      }
    } catch {
      setError('Blad polaczenia. Sprawdz konfiguracje Supabase.');
    } finally {
      setLoading(false);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo2026.png" alt="Parking.OS logo" className="h-20 w-auto mx-auto mb-4 drop-shadow-lg" />
          <h1 className="text-2xl font-bold text-white tracking-tight">Parking.OS</h1>
          <p className="text-slate-400 text-sm mt-1">Panel zarzadzania parkingiem</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Input
              label="Adres e-mail"
              type="email"
              placeholder="np. klosekmichal@gmail.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              autoComplete="email"
            />
            <Input
              label="Haslo"
              type="password"
              placeholder="Wprowadz haslo..."
              value={password}
              onChange={e => setPassword(e.target.value)}
              error={error}
              autoComplete="current-password"
            />
            <Button type="submit" loading={loading} size="lg" className="w-full mt-2">
              Zaloguj sie
            </Button>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Parking platny niestrzezony "Michal Klos" · Gdansk, Wyspa Sobieszewska
        </p>
      </div>
    </div>
  );
}

