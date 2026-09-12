import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs } from './helpers';

/**
 * Dostępność (WCAG 2.1 AA w zakresie narzędziowym) + wygodа dotyku.
 * axe-core odpalany na kluczowych ekranach; krytyczne/poważne naruszenia = fail.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const axeSource = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');

async function scan(page: Page, label: string) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    interface AxeResults {
      violations: { id: string; impact?: string; help: string; nodes: { target: string[] }[] }[];
    }
    const w = window as unknown as { axe?: { run: (o: object) => Promise<AxeResults> } };
    return w.axe ? w.axe.run({ resultTypes: ['violations'] }) : null;
  });
  const violations = (results?.violations ?? []).filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (violations.length) {
    const summary = violations.map((v) => `${v.id}: ${v.help} → ${v.nodes[0]?.target.join(' ')}`).join('\n');
    throw new Error(`${label}: naruszenia krytyczne/poważne\n${summary}`);
  }
}

const SCREENS: { path: string; name: string; loginAs: string }[] = [
  { path: '/moja-praca', name: 'Moja praca', loginAs: 'Mariusz' },
  { path: '/zespol', name: 'Tablica zespołu', loginAs: 'Anna Kowalska' },
  { path: '/zlecenia/nowe', name: 'Nowe zlecenie', loginAs: 'Tomasz Zieliński' },
  { path: '/zlecenia/b0000001-0000-4000-8000-000000000007', name: 'Szczegóły zadania', loginAs: 'Mariusz' },
  { path: '/raporty', name: 'Raporty', loginAs: 'Anna Kowalska' },
  { path: '/synchronizacja', name: 'Synchronizacja', loginAs: 'Katarzyna Mazur' },
  { path: '/ustawienia', name: 'Ustawienia', loginAs: 'Anna Kowalska' },
];

test.describe('dostępność ekranów', () => {
  for (const s of SCREENS) {
    test(s.name, async ({ page }) => {
      await loginAs(page, s.loginAs);
      await page.goto(`/#${s.path}`);
      await expect(page.locator('main')).toBeVisible();
      // daj komponentom chwilę na dane
      await page.waitForTimeout(600);
      await scan(page, s.name);
    });
  }
});

test('nawigacja dolna: cele dotyku ≥ 44 px', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium-phone', 'dotyczy projektu mobilnego');
  await loginAs(page, 'Mariusz');
  const targets = page.locator('nav[aria-label*="dolna" i] a, nav[aria-label*="dolna" i] button');
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = await targets.nth(i).boundingBox();
    expect(box, `cel ${i}`).not.toBeNull();
    expect(box!.height, `wysokość celu ${i}`).toBeGreaterThanOrEqual(44);
  }
});
