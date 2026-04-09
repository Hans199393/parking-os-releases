import { useState, useEffect } from 'react';
import { verifyPassword, isFirstRun, initDefaultPassword } from '../../lib/auth';
import { Button, Input } from '../shared/UI';

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState(0);
  const [firstRun, setFirstRun] = useState(false);

  useEffect(() => {
    isFirstRun().then(async yes => {
      if (yes) {
        setFirstRun(true);
        await initDefaultPassword();
      }
    });
  }, []);

  useEffect(() => {
    if (lockout <= 0) return;
    const id = setInterval(() => setLockout(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [lockout]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockout > 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await verifyPassword(password);
      if (result.ok) {
        onSuccess();
      } else if (result.lockout) {
        setLockout(result.lockout);
        setError(`Za wiele błędnych prób. Zablokowano na ${result.lockout}s.`);
      } else {
        setError('Nieprawidłowe hasło. Spróbuj ponownie.');
      }
    } catch (err) {
      setError('Błąd weryfikacji. Spróbuj ponownie.');
    } finally {
      setLoading(false);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-500/20 rounded-2xl mb-4">
            <span className="text-3xl">🅿️</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Parking.OS</h1>
          <p className="text-slate-400 text-sm mt-1">Panel zarządzania parkingiem</p>
        </div>

        {/* Login card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-xl">
          {firstRun && (
            <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 mb-4">
              <p className="text-teal-400 text-sm font-medium">Pierwsze uruchomienie</p>
              <p className="text-slate-300 text-xs mt-0.5">Domyślne hasło: <code className="text-teal-300"><REDACTED_ADMIN_PASSWORD></code></p>
              <p className="text-slate-400 text-xs mt-0.5">Zmień hasło w Ustawieniach po zalogowaniu.</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Input
              label="Hasło dostępu"
              type="password"
              placeholder="Wprowadź hasło..."
              value={password}
              onChange={e => setPassword(e.target.value)}
              error={error}
              autoFocus
              disabled={lockout > 0}
            />

            {lockout > 0 && (
              <div className="text-center text-amber-400 text-sm font-medium">
                Odblokowanie za {lockout}s...
              </div>
            )}

            <Button type="submit" loading={loading} disabled={lockout > 0} size="lg" className="w-full mt-2">
              Zaloguj się
            </Button>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Parking płatny niestrzeżony "Michał Kłos" · Gdańsk, Wyspa Sobieszewska
        </p>
      </div>
    </div>
  );
}
