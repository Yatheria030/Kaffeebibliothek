// Archiv der de1app: Das Plugin schickt jede Datei aus history/ (*.shot, Altformat), history_v2/ (*.json) und den Profilordnern einmal und
// wieder, wenn sie sich ändert (Beschreibung nachgetragen). Gespeichert wird alles, als JSON abfragbar (`json_extract`), nur Passwörter
// und Tokens aus den App-Einstellungen nicht. Shots ab der Mindestdauer des Plugins landen zusätzlich in `machine_shots` (dort nimmt sie der Bewertungsdialog).
import { db } from "./db.ts";
import { saveShot, ShotError } from "./decent.ts";
import { fromTablet } from "./decent-profile.ts";
import type { DecentArchive } from "../shared/types.ts";

export class ArchiveError extends Error {}

const PATH = /^(history|history_v2|profiles|profiles_v2)\/[^/\\]+\.(shot|json|tcl)$/;
const SECRET = /(^|_)(password|passwd|pass|token|secret|api_?key)(_|$)/i;
/** Vorgaben wie im Plugin, das seine eingestellten Werte mitschickt: kürzere Bezüge sind Spülen oder Fehlstarts */
export type ShotFilter = { min_seconds: number; skip_types: string[] };
export const SHOT_FILTER: ShotFilter = { min_seconds: 8, skip_types: ["cleaning", "calibrate"] };

type Kind = "shot" | "shot_legacy" | "profile" | "profile_legacy";
type Obj = Record<string, unknown>;

/** Tcl-Liste in Wörter zerlegen (Klammern wörtlich, Anführungszeichen und blanke Wörter mit Backslash-Ersetzung) */
export function tclList(s: string): string[] {
  const out: string[] = [];
  const n = s.length;
  const ws = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
  const esc = (i: number): [string, number] => {
    const c = s[i + 1];
    const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", f: "\f", v: "\v", a: "\x07", b: "\b" };
    if (c === undefined) return ["\\", i + 1];
    if (c in map) return [map[c], i + 2];
    if (c === "u") {
      const m = /^[0-9a-fA-F]{1,4}/.exec(s.slice(i + 2, i + 6));
      if (m) return [String.fromCharCode(parseInt(m[0], 16)), i + 2 + m[0].length];
    }
    if (c === "\n") {
      let j = i + 2;
      while (j < n && (s[j] === " " || s[j] === "\t")) j++;
      return [" ", j];
    }
    return [c, i + 2];
  };
  let i = 0;
  while (i < n) {
    while (i < n && ws(s[i])) i++;
    if (i >= n) break;
    if (s[i] === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth) {
        if (s[j] === "\\") j += 2;
        else {
          if (s[j] === "{") depth++;
          else if (s[j] === "}") depth--;
          j++;
        }
      }
      if (depth) throw new ArchiveError("Tcl-Liste: offene Klammer");
      out.push(s.slice(i + 1, j - 1));
      i = j;
    } else if (s[i] === '"') {
      let w = "";
      let j = i + 1;
      while (j < n && s[j] !== '"') {
        if (s[j] === "\\") {
          const [t, k] = esc(j);
          w += t;
          j = k;
        } else w += s[j++];
      }
      if (j >= n) throw new ArchiveError("Tcl-Liste: offenes Anführungszeichen");
      out.push(w);
      i = j + 1;
    } else {
      let w = "";
      let j = i;
      while (j < n && !ws(s[j])) {
        if (s[j] === "\\") {
          const [t, k] = esc(j);
          w += t;
          j = k;
        } else w += s[j++];
      }
      out.push(w);
      i = j;
    }
  }
  return out;
}

/** Schlüssel-Wert-Liste als Objekt; doppelte Schlüssel: der letzte gilt (wie `array set`) */
function tclDict(s: string): Record<string, string> {
  const w = tclList(s);
  const o: Record<string, string> = {};
  for (let i = 0; i + 1 < w.length; i += 2) o[w[i]] = w[i + 1];
  return o;
}

const NUM = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Messreihe als Zahlen, sonst null */
function series(v: string): number[] | null {
  const t = v.trim();
  if (!t) return [];
  const parts = t.split(/\s+/);
  return parts.every((p) => NUM.test(p)) ? parts.map(Number) : null;
}

function json(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/** Passwörter und Tokens (Visualizer, Wetter, …) überall leeren, alles andere bleibt */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) o[k] = SECRET.test(k) && (typeof x === "string" || typeof x === "number") ? "" : redact(x);
    return o;
  }
  return v;
}

/** Alter Shot (`history/*.shot`): Reihen als Zahlen, settings und machine als Objekte, Profil als JSON, Rest als Text */
export function parseLegacyShot(text: string): Obj {
  let top: Record<string, string>;
  try {
    top = tclDict(text);
  } catch (e) {
    // kaputte Liste (offene Klammer in Notizen): Text unverändert behalten statt die Datei zu verlieren
    const clock = /^clock\s+(\d+)/m.exec(text);
    if (!clock || !(e instanceof ArchiveError)) throw e;
    return { format: "legacy", clock: Number(clock[1]), unparsed: text };
  }
  const o: Obj = { format: "legacy" };
  for (const [k, v] of Object.entries(top)) {
    if (k === "settings" || k === "machine") o[k] = tclDict(v);
    // `profile [huddle jsondump …]`: die äußeren Klammern des JSON sind die der Tcl-Liste
    else if (k === "profile") o[k] = json(v) ?? json(`{${v}}`) ?? v;
    else if (k === "clock") o[k] = Number(v);
    else if (k === "local_time" || k === "app_version") o[k] = v;
    else o[k] = series(v) ?? v;
  }
  if (!Number.isFinite(o.clock as number)) throw new ArchiveError("Alter Shot ohne clock");
  return o;
}

/** Alten Shot in die Form von `::shot::create` bringen, soweit `parseShot` sie liest */
function legacyAsV2(l: Obj): Obj | null {
  if (l.unparsed != null) return null;
  const st = (l.settings ?? {}) as Record<string, string>;
  const r = (k: string) => (Array.isArray(l[k]) ? l[k] : []);
  const profile = l.profile && typeof l.profile === "object" ? l.profile : { title: st.profile_title ?? "", beverage_type: st.beverage_type ?? "" };
  return {
    clock: l.clock,
    elapsed: r("espresso_elapsed"),
    pressure: { pressure: r("espresso_pressure"), goal: r("espresso_pressure_goal") },
    flow: { flow: r("espresso_flow"), by_weight: r("espresso_flow_weight"), goal: r("espresso_flow_goal") },
    temperature: { basket: r("espresso_temperature_basket"), mix: r("espresso_temperature_mix"), goal: r("espresso_temperature_goal") },
    totals: { weight: r("espresso_weight"), water_dispensed: r("espresso_water_dispensed") },
    state_change: r("espresso_state_change"),
    profile,
    meta: {
      in: st.grinder_dose_weight ?? "",
      out: st.drink_weight ?? "",
      bean: { brand: st.bean_brand ?? "", type: st.bean_type ?? "" },
      grinder: { model: st.grinder_model ?? "", setting: st.grinder_setting ?? "" },
    },
    app: { app_name: "de1app", app_version: l.app_version ?? "", data: { settings: { profile_title: st.profile_title ?? "" } } },
  };
}

function kindOf(p: string): Kind {
  if (p.startsWith("history_v2/")) return "shot";
  if (p.startsWith("history/")) return "shot_legacy";
  if (p.startsWith("profiles_v2/")) return "profile";
  return "profile_legacy";
}

/** In `machine_shots` übernehmen, wenn er lang genug und keine ausgeschlossene Art ist; das Altformat nur, wenn es den Shot noch nicht gibt */
function intoShots(kind: Kind, data: Obj, f: ShotFilter): number | null {
  const v2 = kind === "shot" ? data : legacyAsV2(data);
  if (!v2) return null;
  const clock = Math.round(Number(v2.clock));
  if (kind === "shot_legacy" && db.prepare(`SELECT 1 FROM machine_shots WHERE uuid = ?`).get(String(clock))) return null;
  const el = Array.isArray(v2.elapsed) ? (v2.elapsed as unknown[]) : [];
  const secs = Number(el[el.length - 1]);
  const bev = String((v2.profile as Obj | undefined)?.beverage_type ?? "");
  if (!(secs >= f.min_seconds) || f.skip_types.includes(bev)) return null;
  try {
    return saveShot(v2).id;
  } catch (e) {
    if (e instanceof ShotError) return null;
    throw e;
  }
}

/** Eine Datei der de1app ablegen; gleiche Datei mit gleichem Inhalt ändert nichts */
export function saveArchiveFile(p: string, mtime: number | null, body: string, filter: ShotFilter = SHOT_FILTER): { id: number; kind: Kind; shot_id: number | null } {
  if (!PATH.test(p)) throw new ArchiveError("Unbekannter Pfad (erwartet history/, history_v2/, profiles/ oder profiles_v2/)");
  const kind = kindOf(p);
  let data: Obj;
  if (p.endsWith(".json")) {
    const j = json(body);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new ArchiveError("Kein JSON-Objekt");
    data = j as Obj;
  } else if (kind === "shot_legacy") data = parseLegacyShot(body);
  else data = { format: "legacy", ...tclDict(body) };
  data = redact(data) as Obj;
  const clock = kind.startsWith("shot") ? Math.round(Number(data.clock ?? data.timestamp)) : null;
  if (kind.startsWith("shot") && !(clock! > 1e9)) throw new ArchiveError("Shot ohne Zeitpunkt (clock)");
  const text = JSON.stringify(data);
  db.prepare(
    `INSERT INTO decent_files (path, kind, clock, mtime, size, data, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET kind = excluded.kind, clock = excluded.clock, mtime = excluded.mtime, size = excluded.size,
       data = excluded.data, received_at = excluded.received_at
     WHERE decent_files.data != excluded.data`,
  ).run(p, kind, clock, mtime, Buffer.byteLength(body), text, new Date().toISOString());
  const id = (db.prepare(`SELECT id FROM decent_files WHERE path = ?`).get(p) as { id: number }).id;
  if (kind === "profile_legacy") fromTablet(p, mtime, data);
  return { id, kind, shot_id: kind.startsWith("shot") ? intoShots(kind, data, filter) : null };
}

export function archiveStatus(): DecentArchive {
  const r = db
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN kind LIKE 'shot%' THEN clock END) AS shots, SUM(kind LIKE 'profile%') AS profiles,
         MIN(CASE WHEN kind LIKE 'shot%' THEN clock END) AS first, MAX(received_at) AS last_upload
       FROM decent_files`,
    )
    .get() as { shots: number; profiles: number | null; first: number | null; last_upload: string | null };
  return {
    shots: Number(r.shots),
    profiles: Number(r.profiles ?? 0),
    first_shot: r.first ? new Date(r.first * 1000).toISOString() : null,
    last_upload: r.last_upload,
  };
}
