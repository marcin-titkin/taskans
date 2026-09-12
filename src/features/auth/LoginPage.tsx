import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardHat } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card } from '@/components/ui/card';
import { roleLabels } from '@/lib/labels';
import { initials } from '@/lib/utils';

export function LoginPage() {
  const { status, mode, demoUsers, signInDemo, signInEmail, authError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(authError);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/', { replace: true });
    }
  }, [status, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await signInEmail(email.trim(), password);
    setBusy(false);
    setError(res.error);
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-700 text-white" aria-hidden="true">
            <HardHat className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Taskans</h1>
            <p className="text-slate-600">dziennik zleceń i prac konserwatorskich</p>
          </div>
        </div>

        {mode === 'demo' ? (
          <Card className="p-4">
            <h2 className="mb-1 text-lg font-bold">Zaloguj się (tryb demonstracyjny)</h2>
            <p className="mb-4 text-sm text-slate-600">
              Aplikacja działa lokalnie na tym urządzeniu — dane nie są wysyłane do serwera. Wybierz swoje imię i
              nazwisko, aby kontynuować.
            </p>
            <ul className="space-y-2">
              {demoUsers.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => void signInDemo(u.id)}
                    className="tap-target flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand-600 hover:bg-brand-50"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-700" aria-hidden="true">
                      {initials(u.display_name)}
                    </span>
                    <span>
                      <span className="block font-bold text-slate-900">{u.display_name}</span>
                      <span className="block text-sm text-slate-600">{roleLabels[u.role]}</span>
                    </span>
                  </button>
                </li>
              ))}
              {demoUsers.length === 0 ? <li className="text-sm text-slate-600">Ładowanie konta demonstracyjnych…</li> : null}
            </ul>
          </Card>
        ) : (
          <Card className="p-5">
            <h2 className="mb-4 text-lg font-bold">Zaloguj się</h2>
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
              <Field name="email" label="E-mail służbowy" required>
                {(ids) => (
                  <Input id={ids.id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                )}
              </Field>
              <Field name="password" label="Hasło" required>
                {(ids) => (
                  <Input id={ids.id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                )}
              </Field>
              {error ? (
                <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? 'Logowanie…' : 'Zaloguj'}
              </Button>
            </form>
          </Card>
        )}

        <p className="text-center text-xs text-slate-500">
          Zbiór danych ograniczony do imienia, nazwiska i ról — bez śledzenia lokalizacji i czasu pracy.
        </p>
      </div>
    </div>
  );
}
