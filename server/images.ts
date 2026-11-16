import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readdir, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db, IMAGE_DIR } from "./db.ts";

const MAX_BYTES = 12 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function sniff(buf: Uint8Array): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  const head = Buffer.from(buf.subarray(0, 16)).toString("latin1");
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  if (head.slice(4, 12) === "ftypavif") return "avif";
  return null;
}

async function store(buf: Uint8Array): Promise<string> {
  const ext = sniff(buf);
  if (!ext) throw new Error("Datei ist kein unterstütztes Bild (JPEG, PNG, WebP, GIF, AVIF)");
  if (buf.byteLength > MAX_BYTES) throw new Error("Bild ist größer als 12 MB");
  const file = `${randomUUID()}.${ext}`;
  await writeFile(path.join(IMAGE_DIR, file), buf);
  return file;
}

export async function saveDataUrl(dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/);
  if (!m) throw new Error("Ungültige Bilddaten");
  return store(Buffer.from(m[1], "base64"));
}

/** Adressen im eigenen Netz (Loopback, privat, Link-Local, ULA, Carrier-NAT, unspezifiziert) */
function internal(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}

/** Bilder nur aus dem Internet: ein Link (oder eine Weiterleitung) ins Heimnetz käme sonst über den Server an Geräte dort */
async function assertPublic(u: URL) {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Nur http(s)-Bilder");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length) throw new Error("Bildadresse nicht auflösbar");
  if (ips.some(internal)) throw new Error("Bilder aus dem Heimnetz werden nicht geladen");
}

/** Fremdes Bild holen und prüfen, ohne es zu speichern */
export async function fetchRemoteImage(url: string): Promise<{ buf: Uint8Array; type: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Ungültige Bild-URL");
  }
  // Weiterleitungen selbst folgen, damit jede Station geprüft wird
  const signal = AbortSignal.timeout(20_000);
  let res: Response | null = null;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(u);
    res = await fetch(u, {
      headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
      redirect: "manual",
      signal,
    });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!to) break;
    await res.body?.cancel().catch(() => {});
    u = new URL(to, u);
    res = null;
  }
  if (!res) throw new Error("Zu viele Weiterleitungen");
  if (!res.ok) throw new Error(`Bild nicht ladbar (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("Bild ist größer als 12 MB");
  // Stückweise lesen und früh abbrechen: content-length kann fehlen oder lügen
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of (res.body ?? []) as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error("Bild ist größer als 12 MB");
    }
    parts.push(chunk);
  }
  const buf = new Uint8Array(Buffer.concat(parts));
  const ext = sniff(buf);
  if (!ext) throw new Error("Datei ist kein unterstütztes Bild (JPEG, PNG, WebP, GIF, AVIF)");
  return { buf, type: `image/${ext === "jpg" ? "jpeg" : ext}` };
}

export async function downloadImage(url: string): Promise<string> {
  return store((await fetchRemoteImage(url)).buf);
}

export async function removeImage(file: string) {
  if (!/^[a-z0-9-]+\.(jpg|png|webp|gif|avif)$/.test(file)) return;
  await unlink(path.join(IMAGE_DIR, file)).catch(() => {});
}

/**
 * Bilder ohne Kaffee entfernen: Hochgeladenes aus abgebrochenen Formularen oder vom Auslesen ohne Speichern. Erst ab 24 h Alter,
 * damit ein gerade offenes Formular sein Bild behält
 */
export async function pruneImages(): Promise<number> {
  const used = new Set((db.prepare(`SELECT image FROM coffees WHERE image IS NOT NULL`).all() as { image: string }[]).map((r) => r.image));
  let n = 0;
  for (const f of await readdir(IMAGE_DIR)) {
    if (f.startsWith(".") || used.has(f)) continue;
    const p = path.join(IMAGE_DIR, f);
    const st = await stat(p).catch(() => null);
    if (!st?.isFile() || Date.now() - st.mtimeMs < 24 * 3600_000) continue;
    await unlink(p).catch(() => {});
    n++;
  }
  return n;
}

/** 10 min nach dem Start und danach täglich verwaiste Bilder aufräumen */
export function scheduleImagePrune() {
  const run = () =>
    void pruneImages()
      .then((n) => n && console.log(`${n} verwaiste Bilder entfernt`))
      .catch((e) => console.error("Bilder aufräumen:", e));
  setTimeout(run, 10 * 60_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
