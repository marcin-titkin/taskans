export type AppMode = 'supabase' | 'demo';

interface EnvLike {
  VITE_APP_MODE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

function readEnv(): EnvLike {
  // W testach Vitest import.meta.env też jest dostępny, ale helper pozwala podmienić źródło.
  return import.meta.env as EnvLike;
}

/**
 * Wybór trybu: `VITE_APP_MODE=supabase|demo|auto`.
 * `auto` (domyślnie): jeśli skonfigurowano URL + klucz anon → Supabase, w przeciwnym razie pełne demo lokalne (IndexedDB).
 */
export function resolveAppMode(env: EnvLike = readEnv()): AppMode {
  const forced = env.VITE_APP_MODE;
  if (forced === 'demo') return 'demo';
  if (forced === 'supabase') {
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
      throw new Error(
        'VITE_APP_MODE=supabase wymaga ustawienia VITE_SUPABASE_URL oraz VITE_SUPABASE_ANON_KEY (patrz .env.example).'
      );
    }
    return 'supabase';
  }
  return env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? 'supabase' : 'demo';
}

export function supabaseConfig(env: EnvLike = readEnv()): { url: string; anonKey: string } | null {
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    return { url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY };
  }
  return null;
}
