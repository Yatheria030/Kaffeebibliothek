import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { DATA_DIR, db, IMAGE_DIR } from "./db.ts";
import { cfg, onConfig } from "./config.ts";
import { exportAll } from "./store.ts";

/**
 * Vollständige Sicherung als ZIP: `kaffee.db` (Schnappschuss per VACUUM INTO, auch bei laufendem Betrieb stimmig),
 * `images/` und `kaffee.json` (Export zum Lesen). Zurückspielen: Container stoppen, ZIP in den Datenordner entpacken.
 * Nächtlich nur mit Ordner (Einstellungen, sonst BACKUP_DIR), Uhrzeit und Anzahl ebenfalls aus den Einstellungen (`server/config.ts`).
 */

/** Ordner der nächtlichen Sicherung, null = aus */
export function backupDir(): string | null {
  const c = cfg();
  return c.backup_off ? null : c.backup_dir;
}
const NAME = /^kaffee-\d{4}-\d{2}-\d{2}\.zip$/;

type Entry = { name: string; crc: number; size: number; csize: number; method: number; offset: number; time: number; date: number };

function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Kleiner ZIP-Schreiber: Dateien nacheinander in eine Datei, Bilder unkomprimiert (sind schon gepackt) */
/** Bilder erst beim Schreiben laden, damit nie alle gleichzeitig im Speicher liegen */
export type ZipFile = { name: string; load: () => Promise<Buffer>; compress: boolean; mtime: Date };

export async function writeZip(target: string, files: ZipFile[]) {
  const fh = await open(target, "w");
  const entries: Entry[] = [];
  let offset = 0;
  try {
    for (const f of files) {
      const name = Buffer.from(f.name, "utf8");
      const data = await f.load();
      const body = f.compress ? deflateRawSync(data, { level: 6 }) : data;
      const method = f.compress ? 8 : 0;
      const { time, date } = dosTime(f.mtime);
      const crc = crc32(data);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x0800, 6); // Namen in UTF-8
      head.writeUInt16LE(method, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(date, 12);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(body.length, 18);
      head.writeUInt32LE(data.length, 22);
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(0, 28);
      await fh.write(head);
      await fh.write(name);
      await fh.write(body);
      entries.push({ name: f.name, crc, size: data.length, csize: body.length, method, offset, time, date });
      offset += head.length + name.length + body.length;
      if (offset > 0xffff_0000) throw new Error("Sicherung größer als 4 GB");
    }
    const cdStart = offset;
    for (const e of entries) {
      const name = Buffer.from(e.name, "utf8");
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(0x031e, 4); // Unix, ZIP 3.0
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.csize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(name.length, 28);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38); // Datei, rw-r--r--
      h.writeUInt32LE(e.offset, 42);
      await fh.write(h);
      await fh.write(name);
      offset += h.length + name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    await fh.write(end);
  } finally {
    await fh.close();
  }
}

let running: Promise<void> = Promise.resolve();

/** Schreibt die Sicherung nach `target` (erst als .part, dann umbenannt). Läufe nacheinander, nie gleichzeitig */
export function writeBackup(target: string): Promise<void> {
  const run = running.then(async () => {
    await mkdir(path.dirname(target), { recursive: true });
    const snap = path.join(DATA_DIR, `.backup-${process.pid}-${Date.now()}.db`);
    const part = `${target}.part`;
    try {
      db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
      const now = new Date();
      const json = Buffer.from(JSON.stringify(exportAll(), null, 1));
      const files: ZipFile[] = [
        { name: "kaffee.db", load: () => readFile(snap), compress: true, mtime: now },
        { name: "kaffee.json", load: async () => json, compress: true, mtime: now },
      ];
      for (const f of (await readdir(IMAGE_DIR)).sort()) {
        if (f.startsWith(".")) continue;
        const p = path.join(IMAGE_DIR, f);
        const st = await stat(p);
        if (st.isFile()) files.push({ name: `images/${f}`, load: () => readFile(p), compress: false, mtime: st.mtime });
      }
      await writeZip(part, files);
      await rename(part, target);
    } finally {
      await rm(snap, { force: true });
      await rm(part, { force: true });
    }
  });
  running = run.catch(() => {});
  return run;
}

export type BackupInfo = { name: string; size: number; at: string };

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = backupDir();
  if (!dir) return [];
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort().reverse();
  return Promise.all(
    names.map(async (name) => {
      const st = await stat(path.join(dir, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    }),
  );
}

export function backupPath(name: string): string | null {
  const dir = backupDir();
  return dir && NAME.test(name) ? path.join(dir, name) : null;
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function nightly() {
  const dir = backupDir();
  if (!dir) return;
  const name = `kaffee-${localDate(new Date())}.zip`;
  try {
    await mkdir(dir, { recursive: true });
    await writeBackup(path.join(dir, name));
    const old = (await listBackups()).slice(cfg().backup_keep);
    for (const b of old) await rm(path.join(dir, b.name), { force: true });
    console.log(`Sicherung ${name} geschrieben${old.length ? `, ${old.length} alte entfernt` : ""}`);
  } catch (e) {
    console.error("Sicherung fehlgeschlagen:", e);
  }
}

function msUntilNext(): number {
  const [h, m] = cfg().backup_time.split(":").map(Number);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

let timer: NodeJS.Timeout | null = null;
let catchUp: NodeJS.Timeout | null = null;

/** Täglich zur eingestellten Uhrzeit (Ortszeit der Einstellung); fehlt eine Sicherung der letzten 26 h, kommt 60 s später gleich eine */
function plan(start: boolean) {
  if (timer) clearTimeout(timer);
  if (catchUp) clearTimeout(catchUp);
  timer = catchUp = null;
  const dir = backupDir();
  if (!dir) return;
  const loop = () => {
    timer = setTimeout(() => void nightly().finally(loop), msUntilNext()).unref();
  };
  loop();
  void listBackups().then((list) => {
    const newest = list[0] ? Date.parse(list[0].at) : 0;
    if (Date.now() - newest > 26 * 3600_000) catchUp = setTimeout(() => void nightly(), 60_000).unref();
  });
  const c = cfg();
  if (start) console.log(`Nächtliche Sicherung nach ${dir} um ${c.backup_time} (${c.timezone}), ${c.backup_keep} bleiben`);
}

export function scheduleBackups() {
  plan(true);
  onConfig(() => plan(false));
}
