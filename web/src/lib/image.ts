/** Bild verkleinern (lange Kante max. 1600 px) und als JPEG-Data-URL liefern. */
export async function fileToDataUrl(file: Blob, max = 1600): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Bildformat wird vom Browser nicht unterstützt (HEIC bitte als JPEG exportieren)");
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild nicht ladbar"));
    img.src = src;
  });
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/**
 * Prägende Farbe eines Packungsbilds (gleiche Herkunft, also /images/...).
 * Fast weiße und fast schwarze Pixel zählen nicht, gesättigte Töne wiegen mehr.
 */
export async function dominantColor(src: string): Promise<string | null> {
  try {
    const img = await loadImage(src);
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const buckets = new Map<number, { r: number; g: number; b: number; n: number; w: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (min > 228) continue; // Hintergrundweiß
      if (max < 18) continue; // Schlagschatten
      const sat = max === 0 ? 0 : (max - min) / max;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, w: 0 };
      e.r += r;
      e.g += g;
      e.b += b;
      e.n += 1;
      e.w += 0.35 + sat;
      buckets.set(key, e);
    }
    let best: { r: number; g: number; b: number; n: number; w: number } | null = null;
    for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
    if (!best || best.n < 6) return null;
    return `#${hex(best.r / best.n)}${hex(best.g / best.n)}${hex(best.b / best.n)}`;
  } catch {
    return null;
  }
}

/** Relative Helligkeit 0..1 einer #rrggbb-Farbe */
export function luminance(color: string): number {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
