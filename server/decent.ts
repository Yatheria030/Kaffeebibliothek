// Decent DE1: Das Plugin der de1app schickt nach jedem Bezug das Shot-JSON (`::shot::create`, Version 2) hierher.
// Gespeichert werden Kennzahlen, eine ausgedünnte Kurve und das Original ohne `app.data` (dort stehen alle App-Einstellungen).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db.ts";
import { archiveStatus } from "./decent-archive.ts";
import { preinfusionOf } from "./preinfusion.ts";
import type { DecentStatus, MachineShot, MachineShotDetail, ShotCurve } from "../shared/types.ts";

const MAX_POINTS = 250;
const PLUGIN_DIR = path.join(import.meta.dirname, "decent-plugin");
export const PLUGIN_NAME = "kaffeebibliothek";

export class ShotError extends Error {}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
/** huddle schreibt Zahlen oft als Text: alles über Number, Leeres wird null */
const num = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x) ?? 0) : []);
const text = (v: unknown, max = 200) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number | null {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Jede k-te Stelle, der letzte Punkt bleibt immer drin */
function thin(len: number): number[] {
  const k = Math.max(1, Math.ceil(len / MAX_POINTS));
  const idx: number[] = [];
  for (let i = 0; i < len; i += k) idx.push(i);
  if (len && idx[idx.length - 1] !== len - 1) idx.push(len - 1);
  return idx;
}

export type ParsedShot = Omit<MachineShot, "id" | "brew_id" | "brew_coffee_id" | "brew_coffee"> & { uuid: string; curve: ShotCurve; raw: string };

export function parseShot(input: unknown): ParsedShot {
  const s = obj(input);
  const clock = num(s.clock) ?? num(s.timestamp);
  const t = nums(s.elapsed);
  if (clock == null || clock < 1e9) throw new ShotError("Kein Zeitpunkt im Shot (clock)");
  // Sekunden bis 2286; größer heißt Millisekunden oder kaputt (toISOString würde werfen)
  if (clock >= 1e10) throw new ShotError("Zeitpunkt im Shot (clock) ist keine Unix-Zeit in Sekunden");
  if (!t.length) throw new ShotError("Shot ohne Messwerte (elapsed)");
  const pressure = obj(s.pressure);
  const flow = obj(s.flow);
  const temperature = obj(s.temperature);
  const totals = obj(s.totals);
  const meta = obj(s.meta);
  const profile = obj(s.profile);
  const settings = obj(obj(obj(s.app).data).settings);

  const p = nums(pressure.pressure);
  const w = nums(totals.weight);
  const at = (xs: number[], i: number) => (i < xs.length ? r2(xs[i]) : 0);
  const idx = thin(t.length);
  const pick = (xs: number[]) => (xs.length ? idx.map((i) => at(xs, i)) : []);
  const curve: ShotCurve = {
    t: idx.map((i) => r2(t[i])),
    p: pick(p),
    f: pick(nums(flow.flow)),
    fw: pick(nums(flow.by_weight)),
    w: pick(w),
    tb: pick(nums(temperature.basket)),
    pg: pick(nums(pressure.goal)),
    fg: pick(nums(flow.goal)),
  };

  const out = num(meta.out);
  const lastWeight = [...w].reverse().find((x) => x > 0) ?? null;
  const yieldG = out != null && out > 0 ? out : lastWeight;
  const dose = num(meta.in);
  const time = num(meta.time) ?? t[t.length - 1];
  const pi = preinfusionOf(t, nums(s.state_change), profile);
  const temp = median(nums(temperature.goal));
  const bean = [text(obj(meta.bean).brand), text(obj(meta.bean).type)].filter(Boolean).join(" ");

  // Original ohne die App-Einstellungen (groß und nicht nötig)
  const app = obj(s.app);
  const raw = JSON.stringify({ ...s, app: { app_name: app.app_name, app_version: app.app_version } });

  return {
    uuid: String(Math.round(clock)),
    shot_at: new Date(clock * 1000).toISOString(),
    profile: text(profile.title) || text(settings.profile_title),
    beverage: text(profile.beverage_type, 40) || text(settings.beverage_type, 40),
    dose_g: dose != null && dose > 0 ? r1(dose) : null,
    yield_g: yieldG != null && yieldG > 0 ? r1(yieldG) : null,
    time_s: time != null && time > 0 ? r1(time) : null,
    preinfusion_s: pi != null && time != null && pi < time ? pi : null,
    temp_c: temp != null ? r1(temp) : null,
    peak_bar: p.length ? r1(p.reduce((a, b) => Math.max(a, b), -Infinity)) : null,
    grind: text(obj(meta.grinder).setting, 40),
    bean,
    curve,
    raw,
  };
}

/** Speichern; derselbe Shot ein zweites Mal ändert nur etwas, wenn er anders ist (sonst verwirft total_changes() das gelernte Modell) */
export function saveShot(input: unknown): { id: number; created: boolean } {
  const s = parseShot(input);
  const before = db.prepare(`SELECT id FROM machine_shots WHERE uuid = ?`).get(s.uuid) as { id: number } | undefined;
  db.prepare(
    `INSERT INTO machine_shots (uuid, shot_at, profile, beverage, dose_g, yield_g, time_s, preinfusion_s, temp_c, peak_bar, grind, bean, curve, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET shot_at = excluded.shot_at, profile = excluded.profile, beverage = excluded.beverage, dose_g = excluded.dose_g,
       yield_g = excluded.yield_g, time_s = excluded.time_s, preinfusion_s = excluded.preinfusion_s, temp_c = excluded.temp_c, peak_bar = excluded.peak_bar, grind = excluded.grind,
       bean = excluded.bean, curve = excluded.curve, raw = excluded.raw
     WHERE machine_shots.raw != excluded.raw`,
  ).run(s.uuid, s.shot_at, s.profile, s.beverage, s.dose_g, s.yield_g, s.time_s, s.preinfusion_s, s.temp_c, s.peak_bar, s.grind, s.bean, JSON.stringify(s.curve), s.raw);
  const id = (db.prepare(`SELECT id FROM machine_shots WHERE uuid = ?`).get(s.uuid) as { id: number }).id;
  return { id, created: !before };
}

const COLS = `s.id, s.shot_at, s.profile, s.beverage, s.dose_g, s.yield_g, s.time_s, s.preinfusion_s, s.temp_c, s.peak_bar, s.grind, s.bean,
  b.id AS brew_id, b.coffee_id AS brew_coffee_id, c.name AS brew_coffee`;
const FROM = `FROM machine_shots s LEFT JOIN brews b ON b.machine_shot_id = s.id LEFT JOIN coffees c ON c.id = b.coffee_id`;

export function listShots(q: { since?: string; around?: string; hours?: number; limit?: number }): MachineShot[] {
  const where: string[] = [];
  const args: string[] = [];
  if (q.around && Number.isFinite(Date.parse(q.around))) {
    const t = Date.parse(q.around);
    const h = (q.hours ?? 6) * 3_600_000;
    where.push(`s.shot_at BETWEEN ? AND ?`);
    args.push(new Date(t - h).toISOString(), new Date(t + h).toISOString());
  } else if (q.since && Number.isFinite(Date.parse(q.since))) {
    where.push(`s.shot_at >= ?`);
    args.push(new Date(Date.parse(q.since)).toISOString());
  }
  const rows = db
    .prepare(`SELECT ${COLS} ${FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.shot_at DESC LIMIT ?`)
    .all(...args, Math.min(200, Math.max(1, q.limit ?? 30))) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r }) as unknown as MachineShot);
}

export function getShot(id: number): MachineShotDetail | null {
  const r = db.prepare(`SELECT ${COLS}, s.curve ${FROM} WHERE s.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return { ...(r as unknown as MachineShot), curve: JSON.parse(String(r.curve)) as ShotCurve };
}

export function decentStatus(): DecentStatus {
  const r = db.prepare(`SELECT COUNT(*) AS n, MAX(shot_at) AS last FROM machine_shots`).get() as { n: number; last: string | null };
  const last = r.last ? (db.prepare(`SELECT profile FROM machine_shots WHERE shot_at = ?`).get(r.last) as { profile: string } | undefined) : undefined;
  return { shots: Number(r.n), last_shot: r.last, last_profile: last?.profile || null, archive: archiveStatus() };
}

/** Plugin-Dateien; in settings.tdb steht die Adresse, unter der die App gerade aufgerufen wurde */
export async function pluginFiles(baseUrl: string): Promise<{ name: string; data: Buffer }[]> {
  const tcl = await readFile(path.join(PLUGIN_DIR, "plugin.tcl"));
  const tdb = `url {${baseUrl.replace(/[{}\\\s]/g, "")}}\nmin_seconds 8\nlast_result {}\nlast_shot {}\nhistory_result {}\n`;
  return [
    { name: `${PLUGIN_NAME}/plugin.tcl`, data: tcl },
    { name: `${PLUGIN_NAME}/settings.tdb`, data: Buffer.from(tdb, "utf8") },
  ];
}
