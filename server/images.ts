import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { IMAGE_DIR } from "./db.ts";

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

/** Fremdes Bild holen und prüfen, ohne es zu speichern */
export async function fetchRemoteImage(url: string): Promise<{ buf: Uint8Array; type: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Ungültige Bild-URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Nur http(s)-Bilder");
  const res = await fetch(u, {
    headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Bild nicht ladbar (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("Bild ist größer als 12 MB");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("Bild ist größer als 12 MB");
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
