import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

/**
 * Konfiguracja Playwright.
 *
 * Normalnie: `npx playwright install chromium` (pobiera przeglądarkę Playwright).
 * Fallback piaskownicowy: jeśli przeglądarka Playwright nie jest zainstalowana, używamy
 * pakietu @sparticuz/chromium (chromium headless-shell z npm) i rozpakowanych bibliotek systemowych.
 */

const PW_DIR = path.join(os.homedir(), '.cache', 'ms-playwright');

function playwrightChromiumInstalled(): boolean {
  if (!fs.existsSync(PW_DIR)) return false;
  return fs.readdirSync(PW_DIR).some((d) => d.startsWith('chromium-'));
}

interface BrowserEnv {
  executablePath: string;
  ldPath: string;
  args: string[];
}

function sparticuzSetup(): BrowserEnv | null {
  try {
    const pkgRoot = path.join(process.cwd(), 'node_modules', '@sparticuz', 'chromium');
    if (!fs.existsSync(pkgRoot)) return null;
    const cacheDir = path.join(process.cwd(), '.tmp-chromium');
    const binPath = path.join(cacheDir, 'chromium');
    const libsDir = path.join(cacheDir, 'lib');
    if (!fs.existsSync(binPath) || !fs.existsSync(path.join(libsDir, 'libnspr4.so'))) {
      fs.mkdirSync(cacheDir, { recursive: true });
      const brotli = (f: string) => zlib.brotliDecompressSync(fs.readFileSync(path.join(pkgRoot, 'bin', f)));
      fs.writeFileSync(path.join(cacheDir, 'chromium.bin'), brotli('chromium.br'));
      fs.writeFileSync(path.join(cacheDir, 'libs.tar'), brotli('al2023.tar.br'));
      fs.copyFileSync(path.join(cacheDir, 'chromium.bin'), binPath);
      fs.chmodSync(binPath, 0o755);
      execFileSync('tar', ['-xf', path.join(cacheDir, 'libs.tar'), '-C', cacheDir]);
      // tar umieszcza biblioteki w ./lib lub bezpośrednio w katalogu docelowym
      if (!fs.existsSync(path.join(libsDir, 'libnspr4.so'))) {
        const alt = path.join(cacheDir, 'lib');
        if (!fs.existsSync(alt)) fs.mkdirSync(alt, { recursive: true });
      }
    }
    // Środowisko kontenerowe bez GPU: pełny `chromium.args` sparticuz wymusza headless='shell' (ozone/EGL crash),
    // więc przekazujemy zestaw softwarowy zgodny z Playwright.
    return {
      executablePath: binPath,
      ldPath: libsDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--in-process-gpu',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    };
  } catch (e) {
    console.warn('Nie udało się przygotować przeglądarki zapasowej:', e);
    return null;
  }
}

const fallback = playwrightChromiumInstalled() ? null : sparticuzSetup();
if (fallback) {
  process.env.LD_LIBRARY_PATH = [fallback.ldPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
}

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...(fallback
      ? {
          launchOptions: {
            executablePath: fallback.executablePath,
            args: fallback.args,
          },
        }
      : {}),
  },
  projects: [
    { name: 'chromium-phone', use: { ...devices['Pixel 7'] } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
