/**
 * Kompresja zdjęcia przed wysyłką: obrót wg EXIF-Orientation jest pomijany (robimy to canvasem z resize),
 * cel: plik JPEG/WebP ≤ ~300 kB przy zachowaniu czytelnej dokumentacji.
 */
export const MAX_EDGE = 1600;
export const TARGET_QUALITY = 0.82;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
  mimeType: string;
}

export function scaleDims(w: number, h: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const m = Math.max(w, h);
  if (m <= maxEdge) return { width: w, height: h };
  const k = maxEdge / m;
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** Wykrywalne testowalnie: tworzy płótno i koduje — w jsdom (bez canvas) zwraca oryginalny plik. */
export async function compressImage(file: File): Promise<CompressedImage> {
  const fallback: CompressedImage = {
    blob: file,
    width: 0,
    height: 0,
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
  };
  if (typeof document === 'undefined' || !window.Image) return fallback;

  let url: string | null = null;
  try {
    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const { width, height } = scaleDims(img.naturalWidth || file.size, img.naturalHeight || file.size);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    if (!blob) return fallback;
    // Jeśli „skompresowany” jest większy niż oryginał (mały plik), zostaw oryginał.
    if (blob.size >= file.size && file.size <= 320 * 1024) return fallback;
    return {
      blob,
      width,
      height,
      fileName: file.name.replace(/\.[a-z]+$/i, '') + '.jpg',
      mimeType: 'image/jpeg',
    };
  } catch {
    return fallback;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', TARGET_QUALITY);
  });
}

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // zgodne z limitem w bazie i Storage

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Dozwolone są zdjęcia JPG, PNG lub WEBP.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Plik jest większy niż 25 MB.';
  return null;
}
