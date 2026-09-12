import { test, expect } from '@playwright/test';

/** Smoke: aplikacja startuje, manifest i service worker są zarejestrowane. */
test('aplikacja się ładuje i jest instalowalna jako PWA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Taskans' })).toBeVisible();
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const sw = await page.request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
});
