# Wdrożenie: Vercel + Supabase

## 1. Baza — Supabase

1. Utwórz projekt na https://supabase.com (region `eu-central-1` — blisko PL).
2. Włącz PostgreSQL extensions, które używają migracji (`pgcrypto` do `gen_random_uuid()`
   — na Supabase domyślnie aktywne).
3. Uruchom migracje **w kolejności** (SQL Editor albo `supabase db push` z CLI):
   - `20260912_0001_schema.sql` — tabele + enumy `public.*` (statusy, role, typy aktualizacji);
   - `20260912_0002_functions.sql` — `app.priority_rank`, `app.audit`, `app.notify`,
     `app.insert_assignees` — wszystkie `SECURITY DEFINER` z `search_path=public`;
   - `20260912_0003_rls.sql` — polityki RLS (bez `FORCE ROW LEVEL SECURITY`; rola
     `anon` ma `SELECT`, ale RLS i tak filtruje wiersze — warstwa autoryzacji to polityki);
   - `20260912_0004_storage.sql` — kubełek `attachments` + polityki rozmiaru/typu.
4. Dane demonstracyjne (opcjonalnie): wyczyść `supabase/seed.sql` z markerów DEV i wklej
   do SQL Editor — identyfikatory są wspólne z seedem aplikacji (`uid()` w
   `src/data/seed.ts`), więc tryb demo i baza wyglądają identycznie.
   Re-generacja: `npm run gen:seed` (używa `tsx`).
5. Utwórz konta logowania (Authentication → Users) dla dyrektorów/koordynatorów/
   wykonawców — e-mail + hasło; `profiles.email` musi się zgadzać, bo login
   `signInEmail` wiąże sesję z profilem.

## 2. Frontend — Vercel

1. Import repo → framework wykryty z `vercel.json` (`vite`, build `npm run build`,
   output `dist`).
2. Zmienne środowiskowe (Production + Preview):
   - `VITE_SUPABASE_URL` = URL projektu,
   - `VITE_SUPABASE_ANON_KEY` = klucz `anon` (publiczny — bezpieczeństwo trzyma RLS),
   - `VITE_APP_MODE` = `supabase` (bez ustawienia: auto = supabase, jeśli są klucze).
3. Deploy. `vercel.json` zapewnia `Cache-Control`: `/sw.js`, `/registerSW.js`,
   `/manifest.webmanifest` — `must-revalidate` (service worker musi widzieć nowe
   wydanie), `/assets/*` — `immutable` (hashowane nazwy), rewrite catch-all → `index.html`
   (routing i tak hashowy, pasek bezpieczeństwa).

### Aktualizacje PWA

`vite-plugin-pwa` z `registerType: 'autoUpdate'`: nowy deploy podmienia SW, a SW
wymienia precache przy najbliższym odświeżeniu. Jeśli użytkownik ma otwartą kartę
w trybie offline, niezatwierdzone operacje przeżyją aktualizację w outboxie (IndexedDB
nie jest ruszany przez SW).

## 3. Tryb bez infrastruktury (pilot/proof-of-concept)

Sam Vercel bez Supabase: `VITE_APP_MODE=demo` (albo brak zmiennych). Cała aplikacja
działa lokalnie na urządzeniu (IndexedDB + „serwer” demo z symulowanymi opóźnieniami).
Dane NIE opuszczają przeglądarki — dobry tryb pokazowy, zły do produkcji.

## 4. Checklista powdrożeniowa

- [ ] `/#/synchronizacja` po pierwszym loginie: „Wszystko zsynchronizowane”, 0 w kolejce;
- [ ] zgłoś zlecenie na telefonie w trybie offline → wróć online → wpis znika z kolejki,
      drugi użytkownik widzi je <5 s (poll/realtime supabase-channel);
- [ ] RLS: `anon` nie czyta nic poza publicznym szkieletem — zweryfikuj `npm run test:rls`
      na migracjach z gałęzi, jeśli były zmieniane;
- [ ] `npx lighthouse`/axe na produkcji: brak naruszeń critical/serious (testy e2e pilnują).
