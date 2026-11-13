// Espresso-Ziel: Dosis, Verhältnis und Zeitfenster, je Röstgrad als Standard (Einstellungen) und am Kaffee einzeln überschreibbar.
// Server (Mahlgrad-Modell) und Web (Hinweis, Vorbelegung, Formulare) nutzen das.

import { ROAST_LEVELS, type RoastLevel } from "./types.ts";

export type ShotTarget = {
  dose_g: number;
  /** Verhältnis Ausbeute zu Dosis, von–bis (2 = 1:2) */
  ratio: [number, number];
  /** Bezugszeit in Sekunden ohne Preinfusion, von–bis */
  time: [number, number];
  /** Preinfusion in Sekunden (bis der Druck steigt), von–bis; zählt nicht zur Bezugszeit */
  pi: [number, number];
  /** Preinfusion in der Decent: Fluss in ml/s, bis der Druck den Abbruchwert (bar) erreicht; die Sekunden oben sind die Obergrenze */
  pi_flow: number;
  pi_bar: number;
  /** Wassertemperatur in °C, von–bis */
  temp: [number, number];
};

export type ShotTargets = Record<RoastLevel, ShotTarget>;

/** Am Kaffee: jedes Feld einzeln, null = Standard des Röstgrads */
export type ShotOverride = { dose_g: number | null; ratio: [number, number] | null; time: [number, number] | null; pi?: [number, number] | null;
  pi_flow?: number | null; pi_bar?: number | null; temp?: [number, number] | null };

/**
 * Standard je Röstgrad. Mittel ist der eigene Alltag (18 g, 1:2–2,2 in 25–30 s) und gilt auch ohne Röstgrad.
 * Helle Röstungen lösen schwerer: längeres Verhältnis, etwas mehr Zeit. Dunkle lösen leicht: kürzer und schneller.
 * Preinfusion ebenso: Helle, dichte Bohnen brauchen länger, bis der Puck durchnässt ist (Decent-Profile für helle Röstungen bis 30 s),
 * dunkle, poröse sind schnell satt und werden bei langer Preinfusion bitter. Mittel 6–10 s passt zu den eigenen Decent-Profilen (~7,5 s).
 * Fluss und Abbruchdruck der Preinfusion wie die Vorgabe der de1app und die eigenen Profile (4 ml/s bis 4 bar); was den Röstgrad
 * unterscheidet, ist die Dauer. Temperatur bewusst nah an 93 °C (eigener Alltag): hell 93–95, mittel 92–94, dunkel 91–93 wie Kaffeemacher;
 * allgemeine Tabellen (dunkel bis 85–90) sind für die Decent zu aggressiv, Abweichungen probiert man von 93 aus in kleinen Schritten.
 */
export const DEFAULT_SHOT_TARGETS: ShotTargets = {
  hell: { dose_g: 18, ratio: [2.2, 2.5], time: [27, 32], pi: [10, 20], pi_flow: 4, pi_bar: 4, temp: [93, 95] },
  mittel: { dose_g: 18, ratio: [2, 2.2], time: [25, 30], pi: [6, 10], pi_flow: 4, pi_bar: 4, temp: [92, 94] },
  dunkel: { dose_g: 18, ratio: [1.9, 2.1], time: [24, 29], pi: [3, 6], pi_flow: 4, pi_bar: 4, temp: [91, 93] },
};

/** Röstgrad, dessen Standard ohne Angabe gilt */
export const STANDARD_LEVEL: RoastLevel = "mittel";

export type ResolvedTarget = ShotTarget & {
  /** Röstgrad, dessen Standard gilt (ohne Angabe „mittel“) */
  level: RoastLevel;
  /** true: der Kaffee hat keinen Röstgrad, es gilt der Standard */
  fallback: boolean;
  /** Felder, die der Kaffee selbst vorgibt */
  own: (keyof ShotTarget)[];
};

const one = (v: unknown, min: number, max: number): number | null => {
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const pair = (v: unknown, min: number, max: number): [number, number] | null => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v.map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < min || b > max || a > b) return null;
  return [a, b];
};

/** Gespeicherte Standards lesen, kaputte oder fehlende Röstgrade mit den eingebauten Werten auffüllen */
export function parseShotTargets(json: string | null | undefined): ShotTargets {
  let raw: Record<string, Partial<ShotTarget>> = {};
  try {
    raw = json ? (JSON.parse(json) as typeof raw) : {};
  } catch {
    raw = {};
  }
  const out = {} as ShotTargets;
  for (const l of ROAST_LEVELS) {
    const d = DEFAULT_SHOT_TARGETS[l.id];
    const r = raw[l.id] ?? {};
    const dose = Number(r.dose_g);
    out[l.id] = {
      dose_g: Number.isFinite(dose) && dose >= 5 && dose <= 40 ? dose : d.dose_g,
      ratio: pair(r.ratio, 0.5, 6) ?? d.ratio,
      time: pair(r.time, 5, 120) ?? d.time,
      pi: pair(r.pi, 0, 60) ?? d.pi,
      pi_flow: one(r.pi_flow, 0.5, 10) ?? d.pi_flow,
      pi_bar: one(r.pi_bar, 0.5, 12) ?? d.pi_bar,
      temp: pair(r.temp, 70, 100) ?? d.temp,
    };
  }
  return out;
}

export function parseShotOverride(v: unknown): ShotOverride | null {
  let o: Partial<ShotOverride> | null = null;
  try {
    o = typeof v === "string" ? (JSON.parse(v) as Partial<ShotOverride>) : (v as Partial<ShotOverride> | null);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const dose = o.dose_g == null ? null : Number(o.dose_g);
  const res: ShotOverride = {
    dose_g: dose != null && Number.isFinite(dose) && dose > 0 ? dose : null,
    ratio: pair(o.ratio, 0.5, 6),
    time: pair(o.time, 5, 120),
    pi: pair(o.pi, 0, 60),
    pi_flow: one(o.pi_flow, 0.5, 10),
    pi_bar: one(o.pi_bar, 0.5, 12),
    temp: pair(o.temp, 70, 100),
  };
  return res.dose_g == null && !res.ratio && !res.time && !res.pi && res.pi_flow == null && res.pi_bar == null && !res.temp ? null : res;
}

/** Ziel für einen Kaffee: eigene Felder vor dem Standard seines Röstgrads */
export function shotTargetOf(c: { roast_level: RoastLevel | null; shot_target: ShotOverride | null }, targets: ShotTargets): ResolvedTarget {
  const level = c.roast_level ?? STANDARD_LEVEL;
  const base = targets[level];
  const o = c.shot_target;
  const own: (keyof ShotTarget)[] = [];
  if (o?.dose_g != null) own.push("dose_g");
  if (o?.ratio) own.push("ratio");
  if (o?.time) own.push("time");
  if (o?.pi) own.push("pi");
  if (o?.pi_flow != null) own.push("pi_flow");
  if (o?.pi_bar != null) own.push("pi_bar");
  if (o?.temp) own.push("temp");
  return {
    dose_g: o?.dose_g ?? base.dose_g,
    ratio: o?.ratio ?? base.ratio,
    time: o?.time ?? base.time,
    pi: o?.pi ?? base.pi,
    pi_flow: o?.pi_flow ?? base.pi_flow,
    pi_bar: o?.pi_bar ?? base.pi_bar,
    temp: o?.temp ?? base.temp,
    level,
    fallback: c.roast_level == null,
    own,
  };
}

export const mid = (r: [number, number]) => (r[0] + r[1]) / 2;

/** Ausbeute in Gramm für Dosis und Verhältnis, auf ganze Gramm */
export const yieldOf = (dose: number, ratio: number) => Math.round(dose * ratio);

/**
 * Zeit auf das Zielverhältnis umgerechnet: Bei gleichem Fluss dauert mehr Ausbeute länger. Ein 1:2,6-Shot in 30 s
 * entspricht bei 1:2,1 etwa 24 s. Der Faktor bleibt zwischen 0,75 und 1,33, sonst wäre es keine Schätzung mehr.
 */
export function normTime(t: number, ratio: number | null, target: ShotTarget): number {
  if (ratio == null || ratio <= 0) return t;
  const f = Math.min(1.33, Math.max(0.75, mid(target.ratio) / ratio));
  return t * f;
}

/** Sekunden vom Zielfenster: negativ = zu schnell, positiv = zu langsam, 0 im Fenster */
export function timeMiss(tn: number, target: ShotTarget): number {
  return tn < target.time[0] ? tn - target.time[0] : tn > target.time[1] ? tn - target.time[1] : 0;
}

/** Sekunden vom Preinfusionsfenster: negativ = zu kurz, positiv = zu lang, 0 im Fenster */
export function piMiss(pi: number, target: ShotTarget): number {
  return pi < target.pi[0] ? pi - target.pi[0] : pi > target.pi[1] ? pi - target.pi[1] : 0;
}

/** „7 + 29 s“: Preinfusion und Bezugszeit getrennt, ohne Preinfusion nur die Bezugszeit */
export const fmtShotTime = (time: number | null, pi: number | null | undefined, unit = " s") =>
  time == null ? "–" : pi != null && pi > 0 ? `${Math.round(pi)} + ${Math.round(time)}${unit}` : `${Math.round(time)}${unit}`;

const n1 = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
export const fmtRatio = (r: [number, number]) => (r[0] === r[1] ? `1:${n1(r[0])}` : `1:${n1(r[0])}–${n1(r[1])}`);
export const fmtWindow = (t: [number, number]) => (t[0] === t[1] ? `${t[0]} s` : `${t[0]}–${t[1]} s`);

/** „18 g → 36–40 g in 6–10 + 25–30 s“ (Preinfusion + Bezugszeit) */
export function targetLine(t: ShotTarget): string {
  const y0 = yieldOf(t.dose_g, t.ratio[0]);
  const y1 = yieldOf(t.dose_g, t.ratio[1]);
  const pi = t.pi[0] === t.pi[1] ? `${t.pi[0]}` : `${t.pi[0]}–${t.pi[1]}`;
  return `${n1(t.dose_g)} g → ${y0 === y1 ? y0 : `${y0}–${y1}`} g in ${pi} + ${fmtWindow(t.time)}`;
}

/** „4 ml/s bis 4 bar, höchstens 8 s“: so wird die Preinfusion in der Decent eingestellt */
export const piSetting = (flow: number, bar: number, secs: number) => `${n1(flow)} ml/s bis ${n1(bar)} bar, höchstens ${Math.round(secs)} s`;

/** Preinfusionszeit fürs Profil: Mitte des Fensters (die Decent bricht vorher ab, sobald der Druck erreicht ist) */
export const piSeconds = (t: ShotTarget) => Math.round(mid(t.pi));
/** Temperatur fürs Profil: Mitte des Fensters auf halbe Grad */
export const tempOf = (t: ShotTarget) => Math.round(mid(t.temp) * 2) / 2;
