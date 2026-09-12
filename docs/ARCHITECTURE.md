# Architektura

```
UI (features/**)
  └─ mutations (src/data/repository.ts)
       └─ enqueueOp → outbox (Dexie) ──► SyncManager (src/data/outbox.ts)
            │                                │  gateway.applyOp (demo | supabase)
            │                                ▼
            │                          reducer.applyOp (src/data/reducer.ts)   ← jedyne źródło logiki domenowej
            │                                │  outcome: changed rows + touched
            │                                ▼
            │                     „serwer”: demo = tabele server_* w IDB, supabase = Postgres + RLS
            │                                │  potwierdzenie → clearDirty → upsertSnapshot → emit
            ▼                                ▼
   optimisticApply → cache lokalny (Dexie) ◄── refreshCache / merge
                                │
                                ▼
                bus {data-changed|outbox-changed|conflict|toast} (src/lib/bus.ts)
                                │
                                ▼
                useDataEvents → globalny licznik wersji → queryKey v${n} (src/data/queries.ts)
```

## Zasady, które trzymają całość

1. **Jeden reducer, dwa fronty.** `reducer.applyOp(state, entry, actor, ctx)` wylicza nową
   rzeczywistość (statusy, aktualiości, powiadomienia, zamrażanie raportu, walidacja
   macierzy ról). Używają go: `optimisticApply` (cache UI, natychmiast, też offline) oraz
   `demoServer.applyOp` (tryb demo) — a na produkcji logika lustrzana jest w SQL
   (RLS + funkcje `SECURITY DEFINER`, patrz `supabase/migrations`). Testy jednostkowe
   (`src/data/reducer.test.ts`) i harness (`npm run test:rls`) pilnują zgodności obu ścieżek.

2. **Outbox = gwarancja braku utraty danych.** Zapis UI = wpis `{PENDING}` do
   `db.outbox` (sekwencja `seq` = kolejność FIFO) + zapis optymistyczny do cache.
   Wpis znika z kolejki dopiero po potwierdzeniu serwera (`SYNCED`). Błędy:
   - `network/server` → retry z wykładniczym backoffem (`RETRY_BASE 3s … MAX 60s`),
     po `MAX_ATTEMPTS_BEFORE_HOLD=8` status `ERROR` (widoczny na ekranie synchronizacji);
   - `conflict` (serwer ma nowszy stan) → status `CONFLICT`, decyzja użytkownika
     (wgraj swoją / weź serwerową) na `/#/synchronizacja`;
   - `validation/permission` → `ERROR` z czytelnym komunikatem.

3. **Idempotentność.** Każda mutacja niesie `opId`; serwer pomija operację, jeśli w
   `updates` istnieje już wiersz z `device_operation_id === opId`. Dzięki temu retry po
   awarii sieci nie duplikuje aktualizacji.

4. **Cache lokalny i flaga `dirty`.** Wiersz `workOrders` z `dirty: true` to
   „niepotwierdzona zmiana z tego urządzenia” — `upsertSnapshot` (merge stanu serwera)
   NIGDY nie nadpisuje wierszy dirty; flagę zdejmujemy dopiero po `SYNCED`
   (`clearDirty([woId])` PRZED `upsertSnapshot`, żeby świeżo potwierdzony wiersz mógł
   zostać wchłonięty). Stąd konwencja: brak flagi = czysty.

5. **Magistrala i wersja danych.** `bus` jest synchronicznym emitterem z izolacją
   błędów (try/catch per handler). `useDataEvents` czyta **globalny monotoniczny
   licznik** (`useSyncExternalStore`) — klucze zapytań `[…, 'vN']` są unikalne na
   całe życie strony. Wersja per-komponent wracała po remoncie do 0 i zderzała się
   z wpiską z poprzedniej sesji → zamrożony, nieaktualny UI (historyczny bug #4cb0108).

6. **Realtime.** Mostek `subscribeRealtime → refreshCache → emit` podpięty jest TYLKO
   w trybie supabase. W demo „serwer” siedzi w tej samej karcie i zmiany idą przez bus —
   subskrypcja własnego busa zrobiłaby pętlę emit→refresh→emit (50 Hz).

7. **Offline.** `QueryClient: networkMode 'always'` — odczyty Dexie nie mogą pauzować
   bez sieci (pauzowałaby cały UI). Przełącznik „Pracuj offline” na `/#/synchronizacja`
   ustawia `setSimulatedNetworkDown` (demo) — kolejka czeka, praca idzie.

## Uprawnienia (macierz)

Rola + uczestnictwo decydują o akcji; tablica w `src/lib/permissions.ts` (UI,
disable/hide) jest lustrzana w SQL (odrzucenie na serwerze). Skrócony wykres sił:

| Akcja | Kto |
|---|---|
| utwórz zlecenie | każdy aktywny użytkownik |
| przydział / zmiana priorytetu / zamknięcie / ponowne otwarcie / raport | ADMIN, COORDINATOR |
| start / blokada / wznowienie / zakończenie / wpis | uczestnicy (lider + przydzieleni); lider decyduje o statusie |
| wpis „w imieniu” (`performed_by`) | tylko przełożony, dla pracownika bez smartfona (scenariusz Marka) |
| zgłoszenie materiałowe | uczestnicy, trafia do raportu dnia |

Enumy statusów typów aktualizacji żyją w schemacie (`public.*` w Postgres, uniony w TS).
Każda tranzycja niesie `expectedPrevious`; jeśli serwer zdążył się przestawić,
reducer rzuca `ConflictError` → wpis `CONFLICT` → decyzja użytkownika. Wiersze
aktualizacji noszą `created_at`/`entered_by`/`performed_by`, więc historia jest
odtwarzalna niezależnie od kolejności merge'ów.

## Trasy (hash routing)

`/#/login` `/#/pulpit` `/#/moja-praca` `/#/zespol` `/#/zlecenia/nowe` `/#/zlecenia/:id`
`/#/praca-bez-zlecenia` `/#/raporty[/:date]` `/#/powiadomienia` `/#/synchronizacja` `/#/ustawienia`
— routing hashowy znosi wymóg rewrite’ów na serwerze; wszystkie strony poza loginem są
ładowane leniwie (`React.lazy` w `src/app/App.tsx`) i precache’owane przez SW
(vite-plugin-pwa, `registerType: 'autoUpdate'`).
