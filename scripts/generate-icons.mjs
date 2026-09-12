// Generator ikon PWA bez zewnętrznych narzędzi: czysty Node + zlib.
// Rysuje turkusowy kwadrat (zaokrąglony) z białą literą „T” — czytelny motyw aplikacji.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEAL = [15, 118, 110];
const WHITE = [255, 255, 255];

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/** Antyaliasowany kwadrat z zaokrągleniem `r` (fraction 0..1) — zwraca wagę pokrycia punktu. */
function rectCoverage(x, y, x0, x1, y0, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  // odległość od środka zaokrąglonego narożnika
  const d = Math.hypot(x - cx, y - cy);
  const inside = x >= x0 - 0.5 && x <= x1 + 0.5 && y >= y0 - 0.5 && y <= y1 + 0.5;
  if (!inside) return 0;
  const edge = Math.max(
    Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2,
    Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2
  );
  if (edge <= -0.5) return 1; // daleko od krawędzi
  const cover = 0.5 - edge; // miękka krawędź prosta
  if (d <= r - 0.5) return Math.min(cover, 1);
  const dd = d - (r - 0.5);
  return Math.max(0, Math.min(cover, 0.5 - dd));
}

function renderIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const bgPad = maskable ? 0.0 : 0.02;
  const bgR = maskable ? size * 0.0 : size * 0.18;
  // litera T — w trybie maskable utrzymana w bezpiecznym kole (80% środka)
  const s = maskable ? 0.62 : 0.72;
  const cx = size / 2;
  const cy = size / 2;
  const barH = size * s * 0.13;
  const tTop = cy - (size * s) / 2 + barH * 0.1;
  const tW = size * s * 0.86;
  const stemW = barH * 1.18;
  const stemH = size * s * 0.72;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const bgCov = rectCoverage(
        x,
        y,
        size * bgPad,
        size * (1 - bgPad),
        size * bgPad,
        size * (1 - bgPad),
        bgR || size * 0.5
      );
      let fg = TEAL;
      if (bgCov <= 0) {
        px[i + 3] = 0;
        continue;
      }
      const barCov = Math.max(
        rectCoverage(x, y, cx - tW / 2, cx + tW / 2, tTop, tTop + barH, barH / 2),
        rectCoverage(x, y, cx - stemW / 2, cx + stemW / 2, tTop, tTop + barH + stemH, stemW / 2)
      );
      const col = barCov > 0 ? mix(fg, WHITE, Math.min(1, barCov)) : fg;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = Math.round(bgCov * 255);
    }
  }
  return encodePng(size, px);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

const pub = path.join(ROOT, 'public');
ensureDir(pub);
fs.writeFileSync(path.join(pub, 'pwa-192x192.png'), renderIcon(192));
fs.writeFileSync(path.join(pub, 'pwa-512x512.png'), renderIcon(512));
fs.writeFileSync(path.join(pub, 'pwa-maskable-512x512.png'), renderIcon(512, { maskable: true }));
fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), renderIcon(180, { maskable: true }));

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="12" fill="#0f766e"/>
<rect x="14" y="14" width="36" height="8" rx="4" fill="#fff"/>
<rect x="28" y="14" width="8" height="36" rx="4" fill="#fff"/>
</svg>`;
fs.writeFileSync(path.join(pub, 'favicon.svg'), faviconSvg);

console.log('Ikony PWA wygenerowane w public/.');
