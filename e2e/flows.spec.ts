import { expect, test } from '@playwright/test';
import { clickDialogConfirm, clickScrolled, loginAs, logout, queueDrained, selectOption, settle } from './helpers';

/**
 * Scenariusze z briefu na trybie demo — ta sama logika domenowa co na Supabase (reduktor + kolejka offline);
 * reguły serwera (RLS, macierz, walidacje, zamrażanie raportów) weryfikuje dodatkowo harness: npm run test:rls.
 * Uwaga: każdy test ma świeży kontekst = świeży świat demo (IndexedDB), więc pełny obieg zadania
 * rozgrywamy w jednym teście, przechodząc między użytkownikami przez wylogowanie.
 */
const UNIQUE = Date.now().toString(36).slice(-5);
const title = `Testowy kran ${UNIQUE}`;
const unreqTitle = `Zabezpieczenie płytki ${UNIQUE}`;

test('pełny obieg zlecenia: zgłoszenie → przydział → start → blokada → wznowienie → wykonanie → zamknięcie → raport', async ({
  page,
}) => {
  // 1) Anna (dyrektor) zgłasza i przydziela Mariuszowi
  await loginAs(page, 'Anna Kowalska');
  await clickScrolled(page.getByRole('button', { name: /Nowe zlecenie/i }).first());
  await page.locator('#f-title').fill(title);
  await page.locator('#f-description').fill('Kapie przy tablicy, potrzebna naprawa przed zajęciami.');
  await selectOption(page, page.locator('#f-locationId'), 'Sala 104');
  await selectOption(page, page.locator('#f-leadWorkerId'), 'Mariusz');
  await clickScrolled(page.getByRole('button', { name: /Zapisz zlecenie/i }));
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 20_000 });
  await queueDrained(page);

  // 2) Mariusz (lider): start, blokada z walidacją, wznowienie, zakończenie
  await logout(page);
  await loginAs(page, 'Mariusz');
  await page.goto('/#/moja-praca');
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
  await clickScrolled(page.getByText(title).first());
  await clickScrolled(page.getByRole('button', { name: /Rozpocznij/i }));
  await expect(page.getByRole('button', { name: /Wstrzymaj/i })).toBeEnabled({ timeout: 20_000 });

  await clickScrolled(page.getByRole('button', { name: /Wstrzymaj/i }));
  await clickScrolled(page.getByRole('button', { name: /Zatrzymaj zadanie/i }).first());
  await expect(page.getByRole('alert').first()).toBeVisible();
  await selectOption(page, page.locator('#f-hold-reason'), 'Brak materiałów');
  await page.locator('#f-hold-details').fill('Brak uszczelki 3/4 w magazynie.');
  await page.locator('#f-hold-next').fill('Kierownik zamawia uszczelkę, montaż po dostawie.');
  await clickDialogConfirm(page, /Zatrzymaj zadanie/i);
  await expect(page.getByText('Praca wstrzymana')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Brak uszczelki 3/4 w magazynie.').first()).toBeVisible();

  await clickScrolled(page.getByRole('button', { name: /Wznów pracę/i }));
  await expect(page.getByRole('button', { name: /Zakończ/i })).toBeEnabled({ timeout: 20_000 });
  await clickScrolled(page.getByRole('button', { name: /Zakończ/i }));
  await page
    .locator('#composer-text')
    .fill('Wymieniona uszczelka i sterówka; sucho, sprawdzone pod obciążeniem. Kran działa normalnie.');
  await clickDialogConfirm(page, /Oznacz jako wykonane/i);
  await expect(page.getByText(/Wykonane/).first()).toBeVisible({ timeout: 20_000 });
  await queueDrained(page);

  // 3) Anna zamyka zadanie
  await logout(page);
  await loginAs(page, 'Anna Kowalska');
  await page.goto('/#/zespol');
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
  await clickScrolled(page.getByText(title).first());
  // dociągnij szczegóły: karta ma prowadzić do zadania po DONE (serwer potwierdzony)
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 20_000 });
  await settle(page, 400);
  await expect(page.getByText(/Wykonane/).first()).toBeVisible({ timeout: 20_000 });
  await clickScrolled(page.getByRole('button', { name: /Zamknij zadanie/i }));
  await clickDialogConfirm(page, /Tak, zamknij/i);
  await expect(page.getByText(/Zamknięte/).first()).toBeVisible({ timeout: 20_000 });
  await queueDrained(page);

  // 4) raport dnia — pozycja „wykonane” + licznik
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/#/raporty/${today}`);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
});

test('praca bez zlecenia zapisuje się od razu jako wykonana', async ({ page }) => {
  await loginAs(page, 'Tomasz Zieliński');
  await page.goto('/#/praca-bez-zlecenia');
  await settle(page);
  await page.locator('#f-u-title').fill(unreqTitle);
  await selectOption(page, page.locator('#f-u-loc'), 'Hall');
  await page.locator('#f-u-summary').fill('Płytka oznaczona taśmą i pachołkiem; zgłoszone do trwałej naprawy kładzarki.');
  await clickScrolled(page.getByRole('button', { name: /Zapisz jako wykonane/i }));
  await expect(page.getByRole('heading', { name: unreqTitle })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Wykonane/).first()).toBeVisible();
  await queueDrained(page);
});

test('wspólny komputer: przełożony loguje wpis w imieniu pracownika', async ({ page }) => {
  await loginAs(page, 'Piotr Nowak');
  await page.goto('/#/zlecenia/b0000006-0000-4000-8000-000000000002');
  await expect(page.getByRole('heading', { name: /Naprawa zamka/i })).toBeVisible({ timeout: 20_000 });
  await settle(page, 300);
  await clickScrolled(page.getByRole('button', { name: /Dodaj aktualizację/i }));
  await page.locator('#composer-text').fill('Marek zgłosił telefonicznie: klamka dociśnięta, działa prawidłowo.');
  await selectOption(page, page.locator('#composer-performed'), 'Marek');
  await clickDialogConfirm(page, /^Zapisz$/);
  await expect(page.getByText(/Marek zgłosił telefonicznie/).first()).toBeVisible({ timeout: 20_000 });
});

test('raport dnia: szkic → zatwierdzenie zamraża dokument', async ({ page }) => {
  await loginAs(page, 'Anna Kowalska');
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/#/raporty/${today}`);
  await clickScrolled(page.getByRole('button', { name: /Zapisz roboczą/i }).first());
  await clickScrolled(page.getByRole('button', { name: /Zatwierdź raport/i }));
  await clickDialogConfirm(page, /Tak, zatwierdź/i);
  await expect(page.getByText(/Zatwierdzony/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Zapisz roboczą/i })).toHaveCount(0);
});

test('raport dnia: eksport PDF z widoku wydruku', async ({ page }) => {
  await loginAs(page, 'Anna Kowalska');
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/#/raporty/${today}`);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4' });
  expect(pdf.length).toBeGreaterThan(2_000);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('offline: rozłączenie sieci nie blokuje pracy, kolejka flushuje się po powrocie', async ({ page, context }) => {
  await loginAs(page, 'Katarzyna Mazur');
  await page.goto('/#/zlecenia/nowe');
  const offTitle = `Offline zgłoszenie ${UNIQUE}`;
  await context.setOffline(true);
  await page.locator('#f-title').fill(offTitle);
  await page.locator('#f-description').fill('Zgłoszenie spisane w piwnicy bez zasięgu.');
  await selectOption(page, page.locator('#f-locationId'), 'Magazyn');
  await clickScrolled(page.getByRole('button', { name: /Zapisz zlecenie/i }));
  await expect(page.getByRole('heading', { name: offTitle })).toBeVisible({ timeout: 20_000 });

  await page.goto('/#/synchronizacja');
  await expect(page.getByText(/do wysłania/).first()).toBeVisible();
  await context.setOffline(false);
  await queueDrained(page);
  await expect(page.getByText('Kolejka pusta')).toBeVisible({ timeout: 10_000 });
});

test('powiadomienia: uczestnicy dostają wieści o przydziale i blokadzie', async ({ page }) => {
  await loginAs(page, 'Mariusz');
  await page.goto('/#/powiadomienia');
  await settle(page);
  await expect(page.getByText(/przydział|Blokada|wróciło/i).first()).toBeVisible({ timeout: 10_000 });
});
