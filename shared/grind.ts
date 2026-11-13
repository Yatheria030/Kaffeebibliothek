// Einstellhilfe: Mahlgrad als Zahl lesen, „guter“ Bezug, Zubereitungsgruppe. Server (Prognose) und Web (Verlauf, Hinweise) nutzen das.

import type { Compass } from "./compass.ts";
import type { ResolvedTarget } from "./shot.ts";
import { isSca, type Brew, type RoastFor } from "./types.ts";

/** Erste Zahl im Mahlgrad („12“, „2,5“, „22 Klicks“); null ohne Zahl */
export function grindNumber(grind: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(grind);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

export function isEspressoMethod(method: string | undefined | null): boolean {
  return /espresso|ristretto|lungo/i.test(method ?? "");
}

/** Verhältnis Wasser zu Kaffee, bis zu dem ein Bezug ohne Rezept als Espresso zählt (1:5) */
export const ESPRESSO_MAX_RATIO = 5;

/**
 * Zubereitung, für die ein Mahlgrad gilt: Espresso oder die Methode des Rezepts. Ohne Rezept nach dem Verhältnis
 * (bis 1:5 Espresso), ohne Verhältnis nach „Geröstet für“ (nur Filterröstungen zählen als Filter).
 */
export function methodKey(recipeMethod: string | null | undefined, roastFor: RoastFor | null, ratio?: number | null): string {
  if (isEspressoMethod(recipeMethod)) return "Espresso";
  if (recipeMethod) return recipeMethod;
  if (ratio != null && ratio > 0) return ratio <= ESPRESSO_MAX_RATIO ? "Espresso" : "Filter";
  return roastFor === "filter" ? "Filter" : "Espresso";
}

export const brewRatio = (b: { dose_g: number | null; water_g: number | null }) => (b.dose_g && b.water_g ? b.water_g / b.dose_g : null);

/** SCA-Score, ab dem ein Bezug als gelungen gilt (Exzellent beginnt bei 85, 84 lässt Luft für Tagesform) */
export const GOOD_SCA = 84;
export const GOOD_RATING = 4;

/** Gelungen: ausgewogen oder gut bewertet, und kein „zu …“ im Kurzurteil (ohne Urteil und ohne Sterne: unbekannt, also nein) */
export function isGoodBrew(b: Brew): boolean {
  if (b.taste.some((t) => t !== "ausgewogen")) return false;
  if (b.taste.includes("ausgewogen")) return true;
  return isSca(b) ? b.total >= GOOD_SCA : b.rating != null && b.rating >= GOOD_RATING;
}

/** Feinste Stufe, in der die Werte vorliegen (1, 0,5, 0,25 …), zum Runden der Prognose */
export function grindStep(values: number[]): number {
  const frac = values.map((v) => Math.round((v % 1) * 100) / 100).filter((f) => f > 0);
  if (!frac.length) return 1;
  if (frac.every((f) => f === 0.5)) return 0.5;
  if (frac.every((f) => [0.25, 0.5, 0.75].includes(f))) return 0.25;
  return 0.1;
}

export function roundGrind(v: number, step: number): number {
  return Math.round(Math.round(v / step) * step * 100) / 100;
}

export type GrindSimilar = { coffee_id: number; name: string; roaster: string; roast_date: string | null; grind: string; same_coffee: boolean };

/** Startwert für eine Tüte: Mahlkompass plus eigene Abweichung, ohne bekannte Mühle aus dem Modell oder Schnitt der Gruppe */
export type GrindPrediction = {
  method: string;
  grinder: string;
  /** Einheit der Mühle („µm“), leer ohne bekannte Mühle */
  unit: string;
  /** gerundet auf die Stufen, in denen du einstellst */
  value: number;
  raw: number;
  /** typische Abweichung (Kreuzvalidierung über Tüten), null bei zu wenig Daten */
  spread: number | null;
  /** kompass: nur Regeln; modell/schnitt: aus Bezügen gelernt (mit Mühle als Abweichung vom Kompass) */
  basis: "kompass" | "modell" | "schnitt";
  bags: number;
  samples: number;
  /** Einfluss pro Woche Röstalter (negativ = feiner), null ohne Datum */
  per_week: number | null;
  day: number | null;
  similar: GrindSimilar[];
  /** was die Prognose am stärksten verschiebt, z. B. „Röstgrad dunkel: +1,5“ */
  drivers: { label: string; effect: number }[];
  /** Regeln für die eigene Mühle, null bei fremder Mühle */
  compass: Compass | null;
  /** gelernte Abweichung vom Kompass (Kalibrierung, Geschmack), null ohne Daten oder ohne Kompass */
  offset: number | null;
  /** übliche Spanne um den Startwert */
  range: [number, number] | null;
  /** Espresso: Ziel dieses Kaffees (eigenes oder Standard seines Röstgrads), sonst null */
  target: ResolvedTarget | null;
  /** Espresso mit Kompass: Mahlgrad je Sekunde Bezugszeit (gelernt aus Tüten mit mehreren Shots, sonst Annahme der Mühle) */
  k: number | null;
  /** Shots, aus denen k gelernt ist (Paare innerhalb von Tüten) */
  k_pairs: number;
  /** Shots mit Zeit, die ins Modell eingingen */
  timed: number;
  /** Geschmack dieses Kaffees gegenüber dem Zeitziel (negativ = feiner), null ohne Kurzurteile */
  taste: number | null;
  taste_n: number;
};

/** Letzte Werte derselben Zubereitung über alle Kaffees, zum schnellen Ausfüllen eines ersten Bezugs */
export type BrewTemplate = { dose_g: number | null; water_g: number | null; temp_c: number | null; time_s: number | null; recipe_id: number | null };
