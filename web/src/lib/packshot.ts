/** Packungsfotos auswerten: Hintergrund, Umriss der Packung, Freistellen. Ohne React, auch für Skripte nutzbar. */

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Analysis = { bg: string | null; box: Box };

/** Hintergrundfarbe aus dem Rand schätzen und die Packung als Umriss der abweichenden Pixel finden */
export function analyze(img: HTMLImageElement): Analysis {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const full: Box = { x0: 0, y0: 0, x1: w, y1: h };
  const k = Math.min(1, 480 / Math.max(w, h));
  const W = Math.max(1, Math.round(w * k));
  const H = Math.max(1, Math.round(h * k));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bg: "#ffffff", box: full };
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return { bg: "#ffffff", box: full };
  }
  const at = (x: number, y: number) => (y * W + x) * 4;

  // Randpixel: überwiegend transparent → freigestellt, sonst Median der Farbe
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(at(x, 0), at(x, H - 1));
  for (let y = 1; y < H - 1; y++) border.push(at(0, y), at(W - 1, y));
  const opaque = border.filter((i) => data[i + 3] > 20);
  const transparent = opaque.length < border.length * 0.5;
  const med = (ch: number) => {
    const v = opaque.map((i) => data[i + ch]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 255;
  };
  const bg = transparent ? null : [med(0), med(1), med(2)];

  const rows = new Array<number>(H).fill(0);
  const cols = new Array<number>(W).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      if (data[i + 3] <= 20) continue;
      if (bg) {
        const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
        if (d < 40) continue;
      }
      rows[y]++;
      cols[x]++;
    }
  }
  // Schwelle relativ zur vollsten Zeile/Spalte: flache Schlagschatten neben der Packung füllen nur ein
  // schmales Band ihrer Spalten und fallen so heraus, statt die Box zu verbreitern und zu verschieben
  const rMin = Math.max(1, W * 0.012, Math.max(...rows) * 0.15);
  const cMin = Math.max(1, H * 0.012, Math.max(...cols) * 0.25);
  const y0 = rows.findIndex((n) => n >= rMin);
  const y1 = rows.findLastIndex((n) => n >= rMin);
  const x0 = cols.findIndex((n) => n >= cMin);
  const x1 = cols.findLastIndex((n) => n >= cMin);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const bgCss = bg ? `#${hex(bg[0])}${hex(bg[1])}${hex(bg[2])}` : null;
  if (y0 < 0 || x0 < 0 || x1 - x0 < W * 0.08 || y1 - y0 < H * 0.08) return { bg: bgCss, box: full };
  return { bg: bgCss, box: { x0: x0 / k, y0: y0 / k, x1: (x1 + 1) / k, y1: (y1 + 1) / k } };
}

/**
 * Einfarbigen Fotohintergrund vom Rand her freistellen (Flutfüllung über Pixel, die neutral zum Hintergrund und nicht
 * heller sind). Schatten werden zu halbtransparentem Schwarz: auf jeder Kachel wirkt das wie multiply, die Packung selbst
 * bleibt deckend und wird nicht mit der Kachelfarbe getönt. box = Packung in Canvas-Pixeln; läuft die Füllung weit in die
 * Packung hinein (helle Tüte ohne Kontur), wird ihr Inneres gesperrt und neu gefüllt. Liefert, ob etwas frei wurde.
 */
export function cutoutBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bgCss: string, box?: Box): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bgCss);
  if (!m) return false;
  const bg = [1, 2, 3].map((i) => Math.max(1, parseInt(m[i], 16)));
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  // Helligkeit relativ zum Hintergrund je Pixel, -1 = gehört nicht zum Hintergrund
  const level = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = d[i] / bg[0];
    const g = d[i + 1] / bg[1];
    const b = d[i + 2] / bg[2];
    const mean = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    level[p] = d[i + 3] > 0 && spread <= 0.03 && mean <= 1.03 && mean >= 0.5 ? Math.min(1, mean) : -1;
  }

  const fill = (wall?: Box): Uint8Array => {
    const done = new Uint8Array(n);
    const stack = new Int32Array(n);
    let top = 0;
    const blocked = (x: number, y: number) => !!wall && x >= wall.x0 && x < wall.x1 && y >= wall.y0 && y < wall.y1;
    const push = (x: number, y: number) => {
      const p = y * w + x;
      if (done[p] || level[p] < 0 || blocked(x, y)) return;
      done[p] = 1;
      stack[top++] = p;
    };
    for (let x = 0; x < w; x++) push(x, 0), push(x, h - 1);
    for (let y = 0; y < h; y++) push(0, y), push(w - 1, y);
    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    return done;
  };

  const inset = (b: Box, f: number): Box => {
    const dx = (b.x1 - b.x0) * f;
    const dy = (b.y1 - b.y0) * f;
    return { x0: Math.round(b.x0 + dx), y0: Math.round(b.y0 + dy), x1: Math.round(b.x1 - dx), y1: Math.round(b.y1 - dy) };
  };
  let done = fill();
  if (box) {
    const inner = inset(box, 0.04);
    let hit = 0;
    let area = 0;
    for (let y = Math.max(0, inner.y0); y < Math.min(h, inner.y1); y++)
      for (let x = Math.max(0, inner.x0); x < Math.min(w, inner.x1); x++, area++) hit += done[y * w + x];
    if (area > 0 && hit / area > 0.15) done = fill(inset(box, 0.015));
  }

  let any = false;
  for (let p = 0; p < n; p++) {
    if (!done[p]) continue;
    const i = p * 4;
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = Math.round((1 - level[p]) * d[i + 3]);
    any = true;
  }
  if (any) ctx.putImageData(img, 0, 0);
  return any;
}
