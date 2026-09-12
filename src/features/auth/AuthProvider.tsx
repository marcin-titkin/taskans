import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDb } from '@/data/db';
import { ensureDemoSeed } from '@/data/seed';
import { appMode, getGateway, refreshCache, setActorForSync, supabaseClientOrNull } from '@/data/repository';
import { getSyncManager } from '@/data/repository';
import { emitDataChanged } from '@/lib/bus';
import type { Profile } from '@/types/domain';

const DEMO_SESSION_KEY = 'taskans:demo-session';

interface AuthValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  profile: Profile | null;
  mode: 'demo' | 'supabase';
  demoUsers: Profile[];
  signInDemo: (userId: string) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  authError: string | null;
  actorId: string | null;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = appMode();
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demoUsers, setDemoUsers] = useState<Profile[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);

  const establish = useCallback(
    async (p: Profile) => {
      const gateway = getGateway();
      setActorForSync({ id: p.id, displayName: p.display_name, role: p.role });
      void gateway;
      try {
        await refreshCache();
      } catch {
        // offline — działamy na cache, komunikat pokaże pasek synchronizacji
      }
      setProfile(p);
      setStatus('authenticated');
      getSyncManager().start();
      emitDataChanged('auth');
    },
    []
  );

  // Uruchomienie sesji
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (mode === 'demo') {
        await ensureDemoSeed();
        const db = getDb();
        const users = (await db.server_profiles.toArray()).filter((u) => u.active);
        if (cancelled) return;
        setDemoUsers(users);
        const saved = localStorage.getItem(DEMO_SESSION_KEY);
        if (saved) {
          const p = users.find((u) => u.id === saved);
          if (p) {
            await establish(p);
            return;
          }
          localStorage.removeItem(DEMO_SESSION_KEY);
        }
        setStatus('anonymous');
      } else {
        const supa = supabaseClientOrNull()?.getClient();
        if (!supa) {
          setStatus('anonymous');
          return;
        }
        const { data } = await supa.auth.getSession();
        if (cancelled) return;
        const user = data.session?.user;
        if (!user) {
          setStatus('anonymous');
          return;
        }
        const { data: p } = await supa.from('profiles').select('id, display_name, role, active').eq('id', user.id).single();
        if (!p?.active) {
          await supa.auth.signOut();
          setAuthError('Konto nieaktywne lub brak profilu. Skontaktuj się z administratorem systemu.');
          setStatus('anonymous');
          return;
        }
        await establish(p);
        supa.auth.onAuthStateChange((_event, session) => {
          if (!session && !cancelled) {
            setActorForSync(null);
            setProfile(null);
            setStatus('anonymous');
          }
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, establish]);

  const signInDemo = useCallback(
    async (userId: string) => {
      const db = getDb();
      const p = await db.server_profiles.get(userId);
      if (!p?.active) {
        setAuthError('Nieaktywne konto.');
        return;
      }
      localStorage.setItem(DEMO_SESSION_KEY, p.id);
      await establish(p);
    },
    [establish]
  );

  const signInEmail = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const supa = supabaseClientOrNull()?.getClient();
      if (!supa) return { error: 'Brak konfiguracji Supabase.' };
      const { data, error } = await supa.auth.signInWithPassword({ email, password });
      if (error) return { error: 'Nieprawidłowy e-mail lub hasło.' };
      const { data: p } = await supa.from('profiles').select('id, display_name, role, active').eq('id', data.user.id).single();
      if (!p?.active) return { error: 'Konto nieaktywne lub brak profilu — zgłoś się do administratora.' };
      await establish(p);
      return { error: null };
    },
    [establish]
  );

  const signOut = useCallback(async () => {
    localStorage.removeItem(DEMO_SESSION_KEY);
    if (mode === 'supabase') {
      const supa = supabaseClientOrNull()?.getClient();
      await supa?.auth.signOut();
    }
    setActorForSync(null);
    setProfile(null);
    setStatus('anonymous');
  }, [mode]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      profile,
      mode,
      demoUsers,
      signInDemo,
      signInEmail,
      signOut,
      authError,
      actorId: profile?.id ?? null,
    }),
    [status, profile, mode, demoUsers, signInDemo, signInEmail, signOut, authError]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth poza AuthProvider');
  return v;
}

/** Skrót: wymagany profil + pomocnicze flagi ról. */
export function useSession() {
  const { profile, actorId, mode } = useAuth();
  if (!profile || !actorId) throw new Error('Brak aktywnej sesji');
  return {
    profile,
    mode,
    isManager: profile.role === 'ADMIN' || profile.role === 'COORDINATOR',
    isAdmin: profile.role === 'ADMIN',
  };
}
