// Mahlkompass: Startwert für den Mahlgrad aus den Merkmalen eines Kaffees, auf der Skala einer bekannten Mühle.
// Feste Regeln (Röstgrad, Röstung für, Höhe, Aufbereitung, Robusta, Röstalter) als Anteil vom Ausgangswert der Zubereitung.
// Der Server legt darauf die eigene Abweichung aus gelungenen Bezügen (Kalibrierung der Mühle, eigener Geschmack).
// Server, Bewertungsdialog, Kaffee-Detail und der Wiki-Artikel „Mahlkompass“ lesen nur von hier.

import type { RoastFor, RoastLevel } from "./types.ts";

export type GrinderBase = {
  /** Zubereitung, für die der Wert gilt (methodKey oder Rezeptmethode) */
  test: RegExp;
  label: string;
  value: number;
  /** übliche Spanne um den Startwert */
  spread: number;
  /** nur grobe Orientierung (keine belastbaren Erfahrungswerte für diese Mühle) */
  rough: boolean;
  /** Pixel je Einheit im Regler und Abstand der beschrifteten Striche */
  ppu: number;
  major: number;
};

export type GrinderProfile = {
  id: string;
  name: string;
  unit: string;
  /** kleinste Einstellstufe */
  step: number;
  min: number;
  max: number;
  /** „eine Stufe feiner/gröber“ im Einstell-Tipp, in Einheiten der Mühle */
  nudge: number;
  /** höhere Zahl heißt gröber */
  coarserUp: boolean;
  /** Espresso: wie weit der Mahlgrad je Sekunde Bezugszeit wandert (Annahme, das Modell lernt den echten Wert) */
  shotK: number;
  /** Rezept nennt diese Mühle (leeres Feld zählt immer als die eigene) */
  match: RegExp;
  bases: GrinderBase[];
  note: string;
};

/**
 * Mahlkönig E64 WS: elektronisch in µm Scheibenabstand ab dem kalibrierten Nullpunkt (Wartung → Nullpunkt setzen).
 * Espresso-Anker: Kaffeemacher stellt den Compadre (dunkel, mit Robusta) auf 95 µm und rät zu ±10 µm Spielraum,
 * der dunkle Wildsau lief hier mit 120 µm in 29 s (18 g → 38 g). Filterwerte sind geschätzt, nicht gemessen.
 */
export const E64WS: GrinderProfile = {
  id: "e64ws",
  name: "Mahlkönig E64 WS",
  unit: "µm",
  step: 1,
  min: 0,
  max: 1500,
  nudge: 3,
  coarserUp: true,
  shotK: 1,
  match: /e\s*-?\s*64|mahlk(ö|oe|o)nig/i,
  bases: [
    { test: /espresso|ristretto|lungo/i, label: "Espresso", value: 110, spread: 10, rough: false, ppu: 9, major: 10 },
    { test: /moka|herdkanne/i, label: "Moka", value: 250, spread: 30, rough: true, ppu: 3, major: 50 },
    { test: /aeropress/i, label: "AeroPress", value: 350, spread: 50, rough: true, ppu: 2, major: 50 },
    { test: /french|kaltaufguss|cold/i, label: "French Press", value: 800, spread: 100, rough: true, ppu: 1.5, major: 100 },
    { test: /chemex/i, label: "Chemex", value: 550, spread: 70, rough: true, ppu: 2, major: 50 },
    { test: /.*/, label: "Filter", value: 450, spread: 60, rough: true, ppu: 2, major: 50 },
  ],
  note: "Werte gelten ab kalibriertem Nullpunkt (Wartung → Nullpunkt setzen). Kleinere Zahl ist feiner.",
};

export const GRINDERS: GrinderProfile[] = [E64WS];
export const DEFAULT_GRINDER = E64WS.id;
/** Einstellung „andere Mühle“: kein Kompass, nur das Lernen aus eigenen Bezügen */
export const NO_GRINDER = "andere";

/** Profil, das für einen Bezug gilt: eigene Mühle laut Einstellung, solange das Rezept keine andere nennt */
export function grinderProfile(setting: string | null | undefined, recipeGrinder: string | null | undefined): GrinderProfile | null {
  const p = GRINDERS.find((g) => g.id === (setting || DEFAULT_GRINDER));
  if (!p) return null;
  const g = (recipeGrinder ?? "").trim();
  return !g || p.match.test(g) ? p : null;
}

export function grinderBase(p: GrinderProfile, method: string): GrinderBase {
  return p.bases.find((b) => b.test.test(method)) ?? p.bases[p.bases.length - 1];
}

export type CompassInput = {
  roast_level: RoastLevel | null;
  roast_for: RoastFor | null;
  process: string;
  process_detail?: string;
  varieties: string[];
  /** Freitext („1.800–2.000 m“) */
  altitude: string;
};

export type CompassFactor = { key: string; label: string; pct: number; effect: number };

export type Compass = {
  grinder: string;
  unit: string;
  method: string;
  base: number;
  base_label: string;
  rough: boolean;
  /** Startwert aus den Regeln, gerundet auf die Stufe der Mühle */
  value: number;
  raw: number;
  range: [number, number];
  factors: CompassFactor[];
};

// ---------- Regeln (Anteile vom Ausgangswert) ----------

export const ROAST_PCT: Record<RoastLevel, number> = { hell: -0.12, mittel: 0, dunkel: 0.08 };
/** Röstung passt nicht zur Zubereitung: Filterröstung als Espresso feiner, Espressoröstung als Filter gröber */
export const ROAST_FOR_PCT = { filterAsEspresso: -0.05, omniAsEspresso: -0.02, espressoAsFilter: 0.05 };
/** Höhe: je 100 m über 1.500 m feiner (dichtere Bohne), begrenzt */
export const ALT_PCT = { ref: 1500, per100: -0.006, min: -0.05, max: 0.04 };
export const PROCESS_PCT: Record<string, number> = {
  Natural: 0.03,
  Honey: 0.02,
  Anaerob: 0.04,
  "Carbonic Maceration": 0.04,
  "Wet Hulled": 0.02,
  Monsooned: 0.04,
  Entkoffeiniert: 0.06,
};
export const ROBUSTA_PCT = 0.04;
/** Röstalter: Bezug Tag 14, je Woche älter feiner (weniger CO₂, läuft schneller); Filter halb so stark */
export const AGE_PCT = { ref: 14, perWeek: -0.015, min: -0.05, max: 0.04 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** „1.800–2.000 m“ oder „1,800 masl“ → Meter (Mittel); Werte unter 100 m gelten als Fehlangabe */
export function altitudeM(s: string): number | null {
  // Tausendertrenner beider Schreibweisen weg, sonst wird aus „1,800“ die 800
  const nums = (s.replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1").match(/\d{3,4}/g) ?? []).map(Number).filter((n) => n >= 100 && n <= 3500);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

const ROBUSTA = /robusta|canephora|conilon/i;
const DECAF = /decaf|entkoffein/i;

export function roundTo(v: number, step: number): number {
  return Math.round(Math.round(v / step) * step * 100) / 100;
}

/** Startwert aus den Merkmalen; `day` = Tage seit Röstung am Bezugstag (null ohne Röstdatum) */
export function compass(p: GrinderProfile, method: string, c: CompassInput, day: number | null): Compass {
  const base = grinderBase(p, method);
  const espresso = /espresso|ristretto|lungo/i.test(method);
  const f: Omit<CompassFactor, "effect">[] = [];

  if (c.roast_level && ROAST_PCT[c.roast_level]) f.push({ key: "roast", label: `Röstgrad ${c.roast_level}`, pct: ROAST_PCT[c.roast_level] });
  if (espresso && c.roast_for === "filter") f.push({ key: "for", label: "Filterröstung", pct: ROAST_FOR_PCT.filterAsEspresso });
  if (espresso && c.roast_for === "omni") f.push({ key: "for", label: "Omni-Röstung", pct: ROAST_FOR_PCT.omniAsEspresso });
  if (!espresso && c.roast_for === "espresso") f.push({ key: "for", label: "Espressoröstung", pct: ROAST_FOR_PCT.espressoAsFilter });

  const alt = altitudeM(c.altitude);
  if (alt != null) {
    const pct = clamp(((alt - ALT_PCT.ref) / 100) * ALT_PCT.per100, ALT_PCT.min, ALT_PCT.max);
    if (Math.abs(pct) >= 0.005) f.push({ key: "alt", label: `Höhe ${Math.round(alt / 10) * 10} m`, pct });
  }

  const decaf = c.process === "Entkoffeiniert" || DECAF.test(c.process_detail ?? "");
  const proc = decaf ? "Entkoffeiniert" : c.process;
  if (PROCESS_PCT[proc]) f.push({ key: "process", label: proc, pct: PROCESS_PCT[proc] });

  if (ROBUSTA.test([...c.varieties, c.process_detail ?? ""].join(" "))) f.push({ key: "robusta", label: "Robusta-Anteil", pct: ROBUSTA_PCT });

  if (day != null && day >= 0) {
    const pct = clamp(((day - AGE_PCT.ref) / 7) * AGE_PCT.perWeek * (espresso ? 1 : 0.5), AGE_PCT.min, AGE_PCT.max);
    if (Math.abs(pct) >= 0.005) f.push({ key: "age", label: `Röstalter Tag ${day}`, pct });
  }

  const factors = f.map((x) => ({ ...x, pct: Math.round(x.pct * 1000) / 1000, effect: Math.round(base.value * x.pct * 10) / 10 }));
  const raw = base.value * (1 + factors.reduce((a, x) => a + x.pct, 0));
  const value = clamp(roundTo(raw, p.step), p.min, p.max);
  return {
    grinder: p.name,
    unit: p.unit,
    method,
    base: base.value,
    base_label: base.label,
    rough: base.rough,
    value,
    raw: Math.round(raw * 10) / 10,
    range: [roundTo(value - base.spread, p.step), roundTo(value + base.spread, p.step)],
    factors,
  };
}

/** Lesbare Regeln für den Wiki-Artikel, aus denselben Zahlen */
export function compassRules(p: GrinderProfile = E64WS): [string, string][] {
  const esp = grinderBase(p, "Espresso").value;
  const pct = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v * 1000) / 10).toLocaleString("de-DE")} %`;
  const um = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(Math.round(esp * v))} ${p.unit}`;
  const both = (v: number) => `${pct(v)} (Espresso ${um(v)})`;
  return [
    ["Röstgrad", `hell ${both(ROAST_PCT.hell)}, dunkel ${both(ROAST_PCT.dunkel)}. Helle Bohnen sind dichter und lösen sich schwerer.`],
    ["Röstung für", `Filterröstung als Espresso ${pct(ROAST_FOR_PCT.filterAsEspresso)}, Omni ${pct(ROAST_FOR_PCT.omniAsEspresso)}, Espressoröstung als Filter ${pct(ROAST_FOR_PCT.espressoAsFilter)}.`],
    ["Anbauhöhe", `je 100 m über ${ALT_PCT.ref.toLocaleString("de-DE")} m ${pct(ALT_PCT.per100)}, höchstens ${pct(ALT_PCT.min)} bis ${pct(ALT_PCT.max)}. Höher gewachsen heißt dichter.`],
    [
      "Aufbereitung",
      `${Object.entries(PROCESS_PCT)
        .map(([k, v]) => `${k} ${pct(v)}`)
        .join(", ")}. Naturals und Fermentationen lösen sich leichter, monsunierte Bohnen sind aufgequollen und porös, Decaf ist spröde und macht mehr Feinanteil.`,
    ],
    ["Robusta", `${both(ROBUSTA_PCT)}: viel Crema, der Shot läuft zäher.`],
    ["Röstalter", `ab Tag ${AGE_PCT.ref} je Woche ${pct(AGE_PCT.perWeek)} (Filter halb so viel), frischer entsprechend gröber, höchstens ${pct(AGE_PCT.min)} bis ${pct(AGE_PCT.max)}.`],
  ];
}
