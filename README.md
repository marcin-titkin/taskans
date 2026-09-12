# Taskans — dziennik zleceń utrzymaniowych (PWA, offline-first)

Aplikacja dla szkoły/placówki do zgłaszania usterek i rozliczania prac: pracownik
zgłasza problem → przełożony przydziela → wykonawca startuje/wstrzymuje/kończy →
dyrektor zatwierdza (zamyka) → raport dnia. Działa w pełni offline: zapisy trafiają
do kolejki w IndexedDB i synchronizują się po odzyskaniu sieci.

**Stack:** React 18 + TypeScript + Vite (PWA/precache) + Tailwind v4 + Radix UI +
Dexie (IndexedDB) + Supabase (Postgres, RLS, SECURITY DEFINER) — jeden reducer
domenowy współdzielony przez tryb demo i serwer.

## Szybki start

```bash
npm install
npm run dev        # http://localhost:5173
```

Bez konfiguracji aplikacja startuje w **trybie demo**: na ekranie logowania klikasz
kartę osoby (Anna — dyrektor, Piotr — koordynator, Mariusz/Tomasz/Katarzyna/Marek —
wykonawcy) i cały świat demonstracyjny seeduje się do IndexedDB. Marek Lewandowski
to scenariusz „wspólny komputer / bez smartfona” — wpisy w jego imieniu wprowadza
przełożony.

## Tryby

| Tryb | Warunek | Zapisy |
|---|---|---|
| `demo` | brak konfiguracji (domyślnie) | kolejka outbox → „serwer” demo (tabele `server_*` w tej samej bazie IDB, symulowane opóźnienia) |
| `supabase` | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | kolejka outbox → REST RPC Supabase; reguły domenowe egzekwuje RLS + funkcje `SECURITY DEFINER` |

`VITE_APP_MODE=supabase` wymusza Supabase (bez kluczy — błąd startu). Login:
demo = kliknięcie karty; supabase = e-mail + hasło (`signInEmail`).

## Polecenia

| Polecenie | Co robi |
|---|---|
| `npm run dev` / `preview` / `build` | serwer dew., podgląd builda, build + PWA |
| `npm run test` | testy jednostkowe (vitest: reducer, outbox, uprawnienia, transitions) |
| `npm run test:e2e` | Playwright: desktop + telefon (a11y axe, tap-targets, offline, PDF, obieg zleceń) |
| `npm run test:rls` | harness RLS: czysty PostgreSQL (embedded), 24 scenariusze uprawnień/konfliktów/zamrażania |
| `npm run typecheck`, `npm run lint` | `tsc -b`, ESLint |
| `npm run gen:seed` / `npm run icons` | regeneracja `supabase/seed.sql` ze seeda TS, ikony PWA |

## Dokumentacja

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ścieżka danych: mutacje → outbox → gateway → reducer → cache; konflikty i offline
- [docs/TESTING.md](docs/TESTING.md) — jak uruchomić i rozszerzać testy (vitest, Playwright, harness RLS)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel + Supabase (migracje, kolejność, zmienne, cache SW)

## Statusy zleceń

`ZGŁOSZONE → PRZYPISANE → W TRAKCIE ⇄ WSTRZYMANE → WYKONANE → ZAMKNIĘTE ↺ PONOWNIE OTWARTE`

Blokada wymaga powodu, opisu i następnego kroku; zakończenie — podsumowania efektu
(min. 10 znaków). Zatwierdzony raport dnia jest zamrażany (serwer odrzuca edycje).
