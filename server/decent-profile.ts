// Decent-Profil je Kaffee (Werte und Regeln in `shared/decent-profile.ts`). Jeder Kaffee der Bibliothek bekommt beim ersten Bedarf ein
// eigenes Profil „# Rösterei - Kaffee“: Vorlage ist das Profil, mit dem er zuletzt bezogen wurde, unverändert übernommen; ohne solchen
// Shot das zuletzt genutzte Profil (sonst die eingebaute Vorgabe) mit den Werten der Empfehlung. Abgleich in beide Richtungen:
// Das Plugin holt `GET /api/decent/profiles` und schreibt neuere in profiles/, Änderungen am Tablet kommen über das Archiv zurück
// (`fromTablet`). Es gilt die jüngere Änderung; was das Tablet zum ersten Mal schickt, gilt immer.
import { db } from "./db.ts";
import { getSetting } from "./store.ts";
import {
  applyParams,
  BASE_VARS,
  filenameFromTitle,
  paramsOf,
  PREFIX,
  PROFILE_VARS,
  profileTitle,
  recommendedParams,
  type CoffeeProfile,
  type ProfileParams,
  type ProfileVars,
  type StoredProfile,
} from "../shared/decent-profile.ts";
import { parseShotOverride, parseShotTargets, shotTargetOf } from "../shared/shot.ts";
import type { RoastLevel } from "../shared/types.ts";

type CoffeeRow = { id: number; name: string; roaster: string; roast_level: string | null; shot_target: string | null; decent_profile: string | null };
type Obj = Record<string, unknown>;

const NOTES = "Aus der Kaffeebibliothek. Änderungen hier gehen in die App zurück, Änderungen dort kommen hierher.";

function stored(v: string | null): StoredProfile | null {
  if (!v) return null;
  try {
    const p = JSON.parse(v) as StoredProfile;
    return p && typeof p.filename === "string" && p.vars ? p : null;
  } catch {
    return null;
  }
}

/** Nur Profilvariablen, alle als Text */
function pick(src: Obj): ProfileVars {
  const o: ProfileVars = {};
  for (const k of PROFILE_VARS) if (src[k] != null && typeof src[k] !== "object") o[k] = String(src[k]);
  return o;
}

/** Einstellungen der de1app zu einem archivierten Shot (`app.data.settings`, dort stehen alle Profilvariablen) */
function settingsOfClock(clock: number): Obj | null {
  const r = db.prepare(`SELECT json_extract(data, '$.app.data.settings') AS s FROM decent_files WHERE kind = 'shot' AND clock = ?`).get(clock) as
    | { s: string | null }
    | undefined;
  if (!r?.s) return null;
  try {
    return JSON.parse(r.s) as Obj;
  } catch {
    return null;
  }
}

/** Vorlage: das eigene Profil „Rösterei - Kaffee“ am Tablet, sonst das des letzten Bezugs, sonst ein Shot mit diesem Profil; own = unverändert übernehmen */
function templateFor(c: CoffeeRow): { vars: ProfileVars; own: boolean } {
  // eigenes Profil „Rösterei - Kaffee“ am Tablet (aktuellster Stand)
  const file = db.prepare(`SELECT data FROM decent_files WHERE path = ?`).get(`profiles/${filenameFromTitle(profileTitle(c).slice(PREFIX.length))}.tcl`) as
    | { data: string }
    | undefined;
  if (file) {
    const v = pick(JSON.parse(file.data) as Obj);
    if (v.settings_profile_type) return { vars: v, own: true };
  }
  // sonst ein eigenes Profil mit Rösterei und einem Wort des Namens im Titel („Kaffeemacher Mano“, „Espresso Mafia - Decaf“)
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const roaster = norm(c.roaster);
  const words = c.name.split(/[\s\-–_/,.]+/).map(norm).filter((w) => w.length >= 3);
  if (roaster && words.length) {
    let best: { vars: ProfileVars; score: number; mtime: number } | null = null;
    for (const f of db.prepare(`SELECT data, mtime FROM decent_files WHERE kind = 'profile_legacy' AND path NOT LIKE 'profiles/\\_%' ESCAPE '\\'`).all() as {
      data: string;
      mtime: number | null;
    }[]) {
      const v = pick(JSON.parse(f.data) as Obj);
      const t = norm(v.profile_title ?? "");
      if (!v.settings_profile_type || !t.includes(roaster)) continue;
      const score = words.filter((w) => t.includes(w)).length;
      if (score && (!best || score > best.score || (score === best.score && (f.mtime ?? 0) > best.mtime))) best = { vars: v, score, mtime: f.mtime ?? 0 };
    }
    if (best) return { vars: best.vars, own: true };
  }
  const linked = db
    .prepare(
      `SELECT s.uuid FROM brews b JOIN machine_shots s ON s.id = b.machine_shot_id WHERE b.coffee_id = ? ORDER BY s.shot_at DESC LIMIT 5`,
    )
    .all(c.id) as { uuid: string }[];
  for (const l of linked) {
    const s = settingsOfClock(Number(l.uuid));
    if (s && s.settings_profile_type) return { vars: pick(s), own: true };
  }
  const title = profileTitle(c).slice(PREFIX.length).toLowerCase();
  const byTitle = db
    .prepare(
      `SELECT json_extract(data, '$.app.data.settings') AS s FROM decent_files
       WHERE kind = 'shot' AND lower(json_extract(data, '$.app.data.settings.profile_title')) = ? ORDER BY clock DESC LIMIT 1`,
    )
    .get(title) as { s: string | null } | undefined;
  if (byTitle?.s) return { vars: pick(JSON.parse(byTitle.s) as Obj), own: true };
  const last = db
    .prepare(
      `SELECT json_extract(data, '$.app.data.settings') AS s FROM decent_files
       WHERE kind = 'shot' AND json_extract(data, '$.app.data.settings.settings_profile_type') = 'settings_2a' ORDER BY clock DESC LIMIT 1`,
    )
    .get() as { s: string | null } | undefined;
  return { vars: last?.s ? { ...BASE_VARS, ...pick(JSON.parse(last.s) as Obj) } : { ...BASE_VARS }, own: false };
}

function targetOf(c: CoffeeRow) {
  return shotTargetOf({ roast_level: (c.roast_level as RoastLevel) ?? null, shot_target: parseShotOverride(c.shot_target) }, parseShotTargets(getSetting("shot_targets")));
}

/** Dateiname, der noch keinem anderen Kaffee gehört */
function freeFilename(title: string, id: number): string {
  const base = filenameFromTitle(title);
  const taken = (fn: string) =>
    db.prepare(`SELECT 1 FROM coffees WHERE id != ? AND json_extract(decent_profile, '$.filename') = ?`).get(id, fn) != null;
  return taken(base) ? `${base.slice(0, 52)}_${id}` : base;
}

function create(c: CoffeeRow): StoredProfile {
  const { vars, own } = templateFor(c);
  const title = profileTitle(c);
  let v: ProfileVars = { ...vars, profile_title: title, read_only: "0", profile_hide: "0", profile_notes: NOTES };
  if (!own) v = applyParams(v, { ...recommendedParams(targetOf(c)), pressure: null });
  const p: StoredProfile = { filename: freeFilename(title, c.id), vars: v, updated_at: Date.now(), source: "app", seen: null };
  db.prepare(`UPDATE coffees SET decent_profile = ? WHERE id = ?`).run(JSON.stringify(p), c.id);
  return p;
}

const COLS = `id, name, roaster, roast_level, shot_target, decent_profile`;

/** Profil eines Kaffees, bei Bedarf angelegt (nicht für „Gesehen“) */
export function ensureProfile(id: number): StoredProfile | null {
  const c = db.prepare(`SELECT ${COLS}, wishlist FROM coffees WHERE id = ?`).get(id) as (CoffeeRow & { wishlist: number }) | undefined;
  if (!c || c.wishlist) return null;
  return stored(c.decent_profile) ?? create(c);
}

/** Alle Kaffees der Bibliothek (ohne Archiv) mit Profil versorgen */
export function ensureProfiles(): void {
  const rows = db.prepare(`SELECT ${COLS} FROM coffees WHERE wishlist = 0 AND archived = 0 AND decent_profile IS NULL`).all() as CoffeeRow[];
  for (const c of rows) create(c);
}

export function coffeeProfile(id: number): CoffeeProfile | null {
  const p = ensureProfile(id);
  if (!p) return null;
  return {
    filename: p.filename,
    title: p.vars.profile_title ?? "",
    params: paramsOf(p.vars),
    type: p.vars.settings_profile_type ?? "",
    updated_at: new Date(p.updated_at).toISOString(),
    source: p.source,
    seen_at: p.seen ? new Date(p.seen).toISOString() : null,
  };
}

/** Werte in der App geändert: jünger als alles am Tablet, das Plugin holt es beim nächsten Abgleich */
export function updateProfile(id: number, params: Partial<ProfileParams>): CoffeeProfile | null {
  const p = ensureProfile(id);
  if (!p) return null;
  const vars = applyParams(p.vars, params);
  if (JSON.stringify(vars) !== JSON.stringify(p.vars)) {
    db.prepare(`UPDATE coffees SET decent_profile = ? WHERE id = ?`).run(JSON.stringify({ ...p, vars, updated_at: Date.now(), source: "app" }), id);
  }
  return coffeeProfile(id);
}

/** Profildatei vom Tablet (Archiv): gehört sie einem Kaffee, gilt sie, wenn sie jünger ist oder zum ersten Mal kommt */
export function fromTablet(path: string, mtime: number | null, data: Obj): void {
  const m = /^profiles\/(.+)\.tcl$/.exec(path);
  if (!m) return;
  const r = db.prepare(`SELECT id, decent_profile FROM coffees WHERE json_extract(decent_profile, '$.filename') = ?`).get(m[1]) as
    | { id: number; decent_profile: string }
    | undefined;
  const p = r && stored(r.decent_profile);
  if (!r || !p) return;
  // Uhr des Tablets nie in die Zukunft übernehmen, sonst gälte die Datei immer als jünger
  const at = Math.min(mtime ? mtime * 1000 : Date.now(), Date.now());
  const vars = pick(data);
  const newer = p.seen == null || at > p.updated_at;
  const next: StoredProfile =
    newer && JSON.stringify(vars) !== JSON.stringify(p.vars) ? { ...p, vars, updated_at: at, source: "decent", seen: Date.now() } : { ...p, seen: Date.now() };
  db.prepare(`UPDATE coffees SET decent_profile = ? WHERE id = ?`).run(JSON.stringify(next), r.id);
}

/** Tcl-Wort: in Klammern, wenn das geht, sonst mit Backslashes */
export function tclWord(s: string): string {
  if (s === "") return "{}";
  if (!/[\s{}[\]$"\\;#]/.test(s)) return s;
  let depth = 0;
  let ok = !s.includes("\\");
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) ok = false;
  }
  if (ok && depth === 0) return `{${s}}`;
  return s.replace(/[\s{}[\]$"\\;#]/g, (c) => (c === "\n" ? "\\n" : c === "\t" ? "\\t" : c === "\r" ? "\\r" : `\\${c}`));
}

/** Profildatei wie `save_settings_vars` der de1app: eine Zeile je Variable */
export function profileFile(v: ProfileVars): string {
  return PROFILE_VARS.filter((k) => v[k] != null).map((k) => `${k} ${tclWord(v[k])}`).join("\n") + "\n";
}

/** Für das Plugin: Tcl-Liste aus {Dateiname Stand-in-Sekunden Inhalt}; nur Dateien mit „_“ vorne, die gehören der App.
 *  since: nur Profile mit Stand nach dieser Sekunde; dieselbe Sekunde nur, solange sie frisch ist (eine Änderung in der Sekunde des
 *  letzten Abrufs geht nicht verloren, alte Gleichstände wie beim Anlegen aller Profile kommen nicht bei jedem Abruf wieder) */
export function profilesForTablet(since = 0): string {
  ensureProfiles();
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(`SELECT decent_profile FROM coffees WHERE wishlist = 0 AND archived = 0 AND decent_profile IS NOT NULL`).all() as {
    decent_profile: string;
  }[];
  const items: string[] = [];
  for (const r of rows) {
    const p = stored(r.decent_profile);
    const stand = p ? Math.floor(p.updated_at / 1000) : 0;
    if (!p || !p.filename.startsWith("_") || stand < since || (since > 0 && stand === since && now - stand > 5)) continue;
    items.push(`{${tclWord(p.filename)} ${stand} ${tclWord(profileFile(p.vars))}}`);
  }
  return items.join("\n");
}
