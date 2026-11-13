// Decent-Profil je Kaffee: eine eigene Datei in profiles/ der de1app („# Rösterei - Kaffee“, Datei beginnt mit „_“), damit kein
// vorhandenes Profil am Tablet überschrieben wird. Gespeichert sind alle Profilvariablen der de1app (Vorlage: das Profil, mit dem der
// Kaffee zuletzt bezogen wurde), die App ändert nur die Werte unten. Server (Datei, Abgleich) und Web (Karte, Abweichung) nutzen das.

import { mid, piSeconds, tempOf, yieldOf, type ShotTarget } from "./shot.ts";

/** Profilvariablen der de1app (`profile_vars` in vars.tcl), in dieser Reihenfolge in die Datei */
export const PROFILE_VARS = [
  "advanced_shot", "espresso_temperature_steps_enabled", "author", "read_only", "espresso_hold_time", "preinfusion_time",
  "espresso_pressure", "espresso_decline_time", "pressure_end", "espresso_temperature", "espresso_temperature_0", "espresso_temperature_1",
  "espresso_temperature_2", "espresso_temperature_3", "settings_profile_type", "flow_profile_preinfusion", "flow_profile_preinfusion_time",
  "flow_profile_hold", "flow_profile_hold_time", "flow_profile_decline", "flow_profile_decline_time", "flow_profile_minimum_pressure",
  "preinfusion_flow_rate", "profile_notes", "final_desired_shot_volume", "final_desired_shot_weight", "final_desired_shot_weight_advanced",
  "tank_desired_water_temperature", "final_desired_shot_volume_advanced", "profile_title", "profile_language", "preinfusion_stop_pressure",
  "profile_hide", "final_desired_shot_volume_advanced_count_start", "beverage_type", "maximum_pressure", "maximum_pressure_range_advanced",
  "maximum_flow_range_advanced", "maximum_flow", "maximum_pressure_range_default", "maximum_flow_range_default", "insert_preinfusion_pause",
  "profile_grinder_dose_weight", "profile_grinder_setting",
] as const;

export type ProfileVars = Record<string, string>;

/** Die Werte, die die App am Profil verwaltet */
export type ProfileParams = {
  /** Preinfusion höchstens (s); die Decent bricht vorher ab, wenn der Druck erreicht ist */
  pi_s: number | null;
  /** Fluss der Preinfusion (ml/s) */
  pi_flow: number | null;
  /** Abbruchdruck der Preinfusion (bar) */
  pi_bar: number | null;
  /** Wassertemperatur (°C) */
  temp: number | null;
  /** Druck im Bezug (bar) */
  pressure: number | null;
  /** Stopp bei Gewicht (g) */
  weight: number | null;
  /** Dosis (g, steht im Profil als Hinweis) */
  dose: number | null;
};

export type ParamKey = keyof ProfileParams;

/** Fürs Web: Profil ohne die übrigen Variablen */
export type CoffeeProfile = {
  filename: string;
  title: string;
  params: ProfileParams;
  /** Profiltyp der de1app: settings_2a Druck, 2b Fluss, 2c erweitert (dort gelten die einfachen Werte nicht) */
  type: string;
  updated_at: string;
  source: "app" | "decent";
  /** zuletzt vom Tablet gekommen */
  seen_at: string | null;
};

/** Gespeichert in `coffees.decent_profile` */
export type StoredProfile = { filename: string; vars: ProfileVars; updated_at: number; source: "app" | "decent"; seen: number | null };

const num = (v: string | undefined) => {
  const n = v == null || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function paramsOf(v: ProfileVars): ProfileParams {
  const dose = num(v.profile_grinder_dose_weight);
  return {
    pi_s: num(v.preinfusion_time),
    pi_flow: num(v.preinfusion_flow_rate),
    pi_bar: num(v.preinfusion_stop_pressure),
    temp: num(v.espresso_temperature),
    pressure: num(v.espresso_pressure),
    weight: num(v.final_desired_shot_weight),
    dose: dose && dose > 0 ? dose : null,
  };
}

const str = (n: number) => String(Math.round(n * 10) / 10);

/** Werte ins Profil schreiben; Temperaturstufen behalten ihren Abstand zur Grundtemperatur (Temperatur-Boost der Preinfusion) */
export function applyParams(v: ProfileVars, p: Partial<ProfileParams>): ProfileVars {
  const o = { ...v };
  if (p.pi_s != null) o.preinfusion_time = str(p.pi_s);
  if (p.pi_flow != null) o.preinfusion_flow_rate = str(p.pi_flow);
  if (p.pi_bar != null) o.preinfusion_stop_pressure = str(p.pi_bar);
  if (p.pressure != null) o.espresso_pressure = str(p.pressure);
  if (p.weight != null) {
    o.final_desired_shot_weight = str(p.weight);
    o.final_desired_shot_weight_advanced = str(p.weight);
  }
  if (p.dose != null) o.profile_grinder_dose_weight = str(p.dose);
  if (p.temp != null) {
    const old = num(v.espresso_temperature);
    for (const k of ["espresso_temperature_0", "espresso_temperature_1", "espresso_temperature_2", "espresso_temperature_3"]) {
      const t = num(v[k]);
      o[k] = str(old != null && t != null ? p.temp + (t - old) : p.temp);
    }
    o.espresso_temperature = str(p.temp);
  }
  return o;
}

/** Empfehlung aus dem Espresso-Ziel des Kaffees */
export function recommendedParams(t: ShotTarget): ProfileParams {
  return {
    pi_s: piSeconds(t),
    pi_flow: t.pi_flow,
    pi_bar: t.pi_bar,
    temp: tempOf(t),
    pressure: null,
    weight: yieldOf(t.dose_g, mid(t.ratio)),
    dose: t.dose_g,
  };
}

/** Bereich, in dem ein Wert noch zur Empfehlung passt (Fenster des Ziels), sonst nur der Punkt */
export function paramWindow(k: ParamKey, t: ShotTarget): [number, number] | null {
  if (k === "pi_s") return t.pi;
  if (k === "temp") return t.temp;
  if (k === "weight") return [yieldOf(t.dose_g, t.ratio[0]), yieldOf(t.dose_g, t.ratio[1])];
  return null;
}

export const PREFIX = "# ";
export const profileTitle = (c: { roaster: string | null; name: string }) => `${PREFIX}${[c.roaster?.trim(), c.name.trim()].filter(Boolean).join(" - ")}`;

/** Dateiname wie `::profile::filename_from_title` der de1app; „# …“ ergibt „_…“, das kollidiert mit keinem eigenen Profil */
export function filenameFromTitle(title: string): string {
  return title
    .replace(/\s+/g, "_")
    .replace(/\/+/g, "__")
    .replace(/[\u0000-\u001f;:?<>(){}[\]|!@#$%^&*+=~`,.'"]+/g, "")
    .slice(0, 60);
}

/** Vorgabe ohne jede Vorlage vom Tablet: Druckprofil wie die eigenen (Preinfusion mit Temperatur-Boost, 9 bar halten) */
export const BASE_VARS: ProfileVars = {
  advanced_shot: "",
  espresso_temperature_steps_enabled: "1",
  author: "Kaffeebibliothek",
  read_only: "0",
  espresso_hold_time: "40",
  preinfusion_time: "8",
  espresso_pressure: "9.0",
  espresso_decline_time: "0",
  pressure_end: "5.0",
  espresso_temperature: "93.0",
  espresso_temperature_0: "93.0",
  espresso_temperature_1: "93.0",
  espresso_temperature_2: "93.0",
  espresso_temperature_3: "93.0",
  settings_profile_type: "settings_2a",
  flow_profile_preinfusion: "4",
  flow_profile_preinfusion_time: "5",
  flow_profile_hold: "2",
  flow_profile_hold_time: "8",
  flow_profile_decline: "1.2",
  flow_profile_decline_time: "17",
  flow_profile_minimum_pressure: "4",
  preinfusion_flow_rate: "4.0",
  profile_notes: "",
  final_desired_shot_volume: "36",
  final_desired_shot_weight: "36",
  final_desired_shot_weight_advanced: "36",
  tank_desired_water_temperature: "0",
  final_desired_shot_volume_advanced: "0",
  profile_title: "",
  profile_language: "de",
  preinfusion_stop_pressure: "4.0",
  profile_hide: "0",
  final_desired_shot_volume_advanced_count_start: "2",
  beverage_type: "espresso",
  maximum_pressure: "0",
  maximum_pressure_range_advanced: "0.6",
  maximum_flow_range_advanced: "0.6",
  maximum_flow: "0",
  maximum_pressure_range_default: "0.9",
  maximum_flow_range_default: "1.0",
};
