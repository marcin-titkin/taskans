import { expect, type Page } from '@playwright/test';

/** Login przez kartę demo (tryb demo: klik w osobę). */
export async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/#/login');
  const card = page.getByRole('button', { name: new RegExp(name, 'i') });
  await expect
    .poll(
      async () => {
        if ((await card.count()) === 0) {
          // pełne przeładowanie w trakcie seedowania demo-bazy — dociągnij i spróbuj znów
          await page.reload().catch(() => {});
          await page.waitForTimeout(600);
          return false;
        }
        await card
          .first()
          .click({ delay: 20, timeout: 4000 })
          .catch(() => {});
        await page
          .waitForURL(/#\/(pulpit|moja-praca|zespol)/, { timeout: 2500 })
          .catch(() => {});
        return /#\/(pulpit|moja-praca|zespol)/.test(page.url());
      },
      { timeout: 30_000, message: `Brak karty demo użytkownika: ${name}` }
    )
    .toBe(true);
  await expect(page).toHaveURL(/#\/(pulpit|moja-praca|zespol)/);
  // po boocie aplikacja robi refresh cache + unieważnia zapytania — dajemy dojrzeć
  // pierwszemu renderowi, żeby klik w kontrolkę nie wpadł w re-render
  await settle(page);
}

export async function logout(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /Wyloguj/i });
  try {
    await btn.click({ timeout: 5000 });
  } catch {
    await btn.evaluate((el) => (el as HTMLElement).click());
  }
  await expect(page.getByRole('heading', { name: /Taskans/ })).toBeVisible({ timeout: 15_000 });
}

/** Czekaj aż aplikacja dociągnie (boot, pierwsze zapytania, ewentualne remounty). */
export async function settle(page: Page, ms = 700): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Klik z wycentrowaniem elementu. Re-render po fluszu kolejki może odpiąć
 * element w trakcie akcji, a emulacja mobilna bywa przekłamana przez zoom
 * visual viewportu — więc retry + ostatecznie klik przez DOM, bez geometrii.
 */
export async function clickScrolled(loc: ReturnType<Page['locator']>): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          if ((await loc.count()) === 0) return false;
          await loc.first().scrollIntoViewIfNeeded();
          await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
          await loc.first().click({ timeout: 4000 });
          return true;
        } catch {
          return (
            await loc
              .first()
              .evaluate((el) => (el as HTMLElement).click() as void)
              .then(() => true)
              .catch(() => false)
          );
        }
      },
      { timeout: 20_000, message: 'clickScrolled: nie udało się kliknąć elementu' }
    )
    .toBe(true);
}

/**
 * Klik w przycisk zatwierdzający dialog. Klik bywa pochłonięty przez re-render
 * (refetch po flushu kolejki) lub zoom mobilny, więc klikamy aż dialog zniknie
 * (z JS-fallbackiem przez DOM).
 */
export async function clickDialogConfirm(page: Page, buttonName: RegExp, requiresOpenDialog = true): Promise<void> {
  if (requiresOpenDialog) {
    // dialog musi faktycznie wisieć w DOM — w przeciwnym razie klik otwierający został pochłonięty
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8_000 });
  }
  await expect
    .poll(
      async () => {
        const btn = page.getByRole('button', { name: buttonName });
        if ((await btn.count()) === 0 && (await page.getByRole('dialog').count()) === 0) return true;
        try {
          await btn.first().click({ timeout: 4000 });
        } catch {
          await btn
            .first()
            .evaluate((el) => (el as HTMLElement).click())
            .catch(() => {});
        }
        await page.waitForTimeout(120);
        return (await page.getByRole('dialog').count()) === 0;
      },
      { timeout: 20_000, message: `Dialog nie zamknął się po kliknięciu: ${buttonName}` }
    )
    .toBe(true);
}

/**
 * Otwórz Radix Select i wybierz opcję — przez klawiaturę (focus + spacja +
 * strzałki), bo na emulowanym telefonie zoom visual-viewportu przesuwa kliknięcia.
 */
export async function selectOption(page: Page, trigger: ReturnType<Page['locator']>, option: string): Promise<void> {
  const rx = new RegExp(option, 'i');
  const opt = page.getByRole('option', { name: rx }).first();
  await expect
    .poll(
      async () => {
        if ((await opt.count()) > 0) return true;
        await trigger.focus();
        await page.keyboard.press(' ');
        await page.waitForTimeout(120);
        if ((await opt.count()) > 0) return true;
        await trigger.click({ delay: 20 }).catch(() => {}); // zapas: kursor
        await page.waitForTimeout(150);
        return (await opt.count()) > 0;
      },
      { timeout: 15_000, message: `Nie udało się otworzyć listy opcji: ${option}` }
    )
    .toBe(true);

  // podświetl właściwą opcję strzałkami i zatwierdź Enterem;
  // gdyby klawiatura nie doszła (lista otworzona myszą) — kliknij opcję
  let guard = 0;
  let highlighted = false;
  while (guard++ < 40) {
    highlighted = await page
      .locator('[role="option"][data-highlighted]')
      .first()
      .textContent()
      .then((t) => rx.test(t ?? ''))
      .catch(() => false);
    if (highlighted) break;
    const pressed = await page.keyboard
      .press('ArrowDown')
      .then(() => true)
      .catch(() => false);
    if (!pressed) break;
    await page.waitForTimeout(40);
  }
  if ((await opt.count()) === 0) throw new Error(`Lista zamknęła się przed wyborem: ${option}`);
  try {
    if (highlighted) {
      await page.keyboard.press('Enter');
    } else {
      await opt.click({ timeout: 3000 });
    }
  } catch {
    await opt
      .click({ timeout: 3000 })
      .catch(() => opt.evaluate((el) => (el as HTMLElement).click()));
  }
}

/** Czekaj aż kolejka synchronizacji opróżni się (demo ma małe opóźnienia sieci). */
export async function queueDrained(page: Page): Promise<void> {
  await page.goto('/#/synchronizacja');
  await expect(page.getByText(/W kolejce:\s*0 do wysłania/)).toBeVisible({ timeout: 20_000 });
}
