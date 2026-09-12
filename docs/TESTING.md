# Testy

Trzy warstwy, każda łapie inny klasę błędów:

## 1. Jednostowe — `npm run test` (vitest + jsdom + fake-indexeddb)

- `src/data/reducer.test.ts` — maszyna stanów, macierz uprawnień, idempotentność (`opId`),
  walidacje blokady/zakończenia, zamrażanie raportu, generowanie powiadomień;
- `src/data/outbox.test.ts` — SyncManager na fałszywym timerze: kolejność FIFO po `seq`,
  retry/backoff, ERROR po 8 próbach, CONFLICT z `conflictInfo`, `clearDirty → upsertSnapshot`;
- `src/lib/permissions.test.ts`, `src/lib/transitions.test.ts` — spójność matrycy i dozwolonych tranzycji.

Pomocnicze: `src/test/setup.ts` montuje `fake-indexeddb/auto` (nadpisuje `indexedDB`/`IDBKeyRange`).

## 2. E2E — `npm run test:e2e` (Playwright)

`playwright.config.ts`: `webServer = npm run build && vite preview` (port 4173,
`reuseExistingServer`), projekty `chromium-desktop` i `chromium-phone` (viewport 390px,
`isMobile`). Bez zainstalowanej przeglądarki Playwright config automatycznie pobiera
headless-shell do `.tmp-chromium/` (fallback piaskownicowy).

- `e2e/smoke.spec.ts` — start aplikacji, manifest, rejestracja SW;
- `e2e/flows.spec.ts` — scenariusze briefu na trybie demo: pełny obieg zlecenia
  (zgłoszenie→przydział→start→blokada z walidacją→wznowienie→wykonanie→zamknięcie→pozycja
  w raporcie), praca bez zlecenia, wspólny komputer (wpis w imieniu Marka, zadanie
  `b0000006-0000-4000-8000-000000000002` ze seeda — uwaga: `uid()` dokleja `(n % 10)`
  w HEX, nie dziesiętnie), zamrażanie raportu, eksport PDF (`emulateMedia print` +
  `page.pdf`), offline (`context.setOffline(true)` — zapis działa, kolejka flushuje po
  powrocie), powiadomienia uczestników;
- `e2e/a11y-mobile.spec.ts` — axe-core na 7 ekranach (fail przy critical/serious —
  `throw`, bo `expect.fail` nie istnieje w typach @playwright/test) + na
  `chromium-phone` test tap-targetów ≥44px dolnej nawigacji.

**Każdy test = świeży kontekst = re-seed demo-bazy** — scenariusza nie wolno dzielić
między testy; stąd „pełny obieg” to JEDEN test przechodzący między użytkownikami
przez `logout/loginAs`.

`e2e/helpers.ts` — trzy odporności wyuczone flakami:
- `selectOption`: otwieranie Radix Select przez KLAWIATURĘ (`focus` + `Space` + strzałki
  do `data-highlighted`) — na emulowanym telefonie zoom visual-viewportu przesuwa klik;
- `clickDialogConfirm`: klik zatwierdzający powtarzany aż dialog zniknie; warunek wstępny:
  `dialog` musi wisieć w DOM (inaczej „vacuous pass” przy pochłoniętym klikiem otwierającym);
- `clickScrolled`: scroll + klik z retry na detach i DOM-fallbackiem.

## 3. Harness RLS — `npm run test:rls`

`scripts/rls/test-rls.mjs`: uruchamia `embedded-postgres` w `.tmp-rls-pg/` (port 55432),
wczytuje `supabase/migrations/*` + `supabase/seed.sql` i odpala 24 scenariusze jako role
`authenticated` z ustawionym `auth.uid()` (`set_config`): RLS selekcji, macierz zapisów
(w tym odrzucenie nie-dozwolonych tranzycji), konflikty `expectedPrevious`, zamrażanie
zatwierdzonego raportu, audyt `app.audit`, `app.insert_assignees` jako jedyna ścieżka
przydziałów, `app.priority_rank`, notyfikacje. Wzorzec: asercje na błąd
(`expectErr`), rollback po każdej próbie (`asUser`) albo commit (asUserCommit).
Testuje PRAWDZIWY serwer — bez instancji Supabase i bez kluczy.

## Dodawanie testów

- nowa reguła domenowa → najpierw przypadek w `reducer.test.ts`, potem (jeśli dotyczy
  serwera) scenariusz w `scripts/rls/test-rls.mjs`;
- nowy ekran → dołóż wpis na listę `EKRANY` w `a11y-mobile.spec.ts` i (jeśli interaktywny)
  scenariusz w `flows.spec.ts`; selektory trzymaj konwencji `Field id = f-${name}`.
