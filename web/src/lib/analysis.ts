import { FLAVOR_BY_ID } from "../../../shared/flavors.ts";
import { CUP_KEYS, defaultScores, QUALITY_KEYS, type Scores } from "../../../shared/sca.ts";
import { isEspressoMethod } from "../../../shared/grind.ts";
import { bagAge, type Batch, type Brew, type Recipe, type ScaBrew } from "../../../shared/types.ts";
import { fmtBrewTime, fmtGrams, fmtNum, fmtRatio, fmtTemp, fmtTime } from "./format.ts";

export type BrewGroup = {
  key: string;
  recipe: Recipe | null;
  label: string;
  brews: ScaBrew[];
  scores: Scores;
  total: number;
  best: ScaBrew | null;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export function averageScores(brews: ScaBrew[]): Scores {
  const out = defaultScores();
  if (!brews.length) return out;
  for (const k of [...QUALITY_KEYS, ...CUP_KEYS]) out[k] = round2(brews.reduce((a, b) => a + b.scores[k], 0) / brews.length);
  out.defects = round2(brews.reduce((a, b) => a + (b.scores.defects || 0), 0) / brews.length);
  return out;
}

export function averageTotal(brews: ScaBrew[]): number {
  return brews.length ? round2(brews.reduce((a, b) => a + b.total, 0) / brews.length) : 0;
}

/** Nur SCA-Bögen: Schnellbewertungen zählen nicht in Profil und Score */
export function groupByRecipe(brews: ScaBrew[], recipes: Recipe[]): BrewGroup[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const map = new Map<string, ScaBrew[]>();
  for (const b of brews) {
    const key = b.recipe_id && byId.has(b.recipe_id) ? `r${b.recipe_id}` : "none";
    map.set(key, [...(map.get(key) ?? []), b]);
  }
  const groups: BrewGroup[] = [...map.entries()].map(([key, list]) => {
    const recipe = key === "none" ? null : (byId.get(Number(key.slice(1))) ?? null);
    const best = list.reduce<ScaBrew | null>((m, b) => (!m || b.total > m.total ? b : m), null);
    return {
      key,
      recipe,
      label: recipe ? recipe.name : "Ohne Rezept",
      brews: list,
      scores: averageScores(list),
      total: averageTotal(list),
      best,
    };
  });
  return groups.sort(
    (a, b) => Number(a.key === "none") - Number(b.key === "none") || b.brews.length - a.brews.length || a.label.localeCompare(b.label, "de"),
  );
}

export type XAxis = "days" | "time" | "temp" | "ratio";

export const X_AXES: { id: XAxis; label: string; title: string; fmt: (v: number) => string }[] = [
  { id: "days", label: "Röstalter", title: "Verlauf seit Röstung", fmt: (v) => `Tag ${Math.round(v)}` },
  { id: "time", label: "Bezugszeit", title: "Score nach Bezugszeit", fmt: (v) => fmtTime(v) },
  { id: "temp", label: "Temperatur", title: "Score nach Temperatur", fmt: (v) => fmtTemp(v) },
  { id: "ratio", label: "Verhältnis", title: "Score nach Verhältnis", fmt: (v) => `1:${fmtNum(v)}` },
];

export function xValue(b: Brew, axis: XAxis, batches: Map<number, Batch>): number | null {
  switch (axis) {
    case "days": {
      const batch = b.batch_id ? batches.get(b.batch_id) : undefined;
      return batch ? bagAge(batch, b.brewed_at) : null;
    }
    case "time":
      return b.time_s;
    case "temp":
      return b.temp_c;
    case "ratio":
      return b.dose_g && b.water_g ? Math.round((b.water_g / b.dose_g) * 10) / 10 : null;
  }
}

function mean(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export const isEspresso = isEspressoMethod;

/** Kenngrößen für die Kacheln: aus dem Rezept, sonst Mittelwerte der Bezüge */
export function groupParams(g: BrewGroup): { k: string; v: string }[] {
  const r = g.recipe;
  const dose = r?.dose_g ?? mean(g.brews.map((b) => b.dose_g));
  const water = r?.water_g ?? mean(g.brews.map((b) => b.water_g));
  const temp = r?.temp_c ?? mean(g.brews.map((b) => b.temp_c));
  const time = r?.time_s ?? mean(g.brews.map((b) => b.time_s));
  const grind = r?.grind || g.brews.find((b) => b.grind)?.grind || "";
  const espresso = isEspresso(r?.method);
  const out = [
    { k: "Methode", v: r?.method || "–" },
    { k: "Dosis", v: fmtGrams(dose == null ? null : Math.round(dose * 10) / 10) },
    { k: espresso ? "Ausbeute" : "Wasser", v: fmtGrams(water == null ? null : Math.round(water)) },
    { k: "Verhältnis", v: fmtRatio(dose, water) },
    { k: "Temperatur", v: fmtTemp(temp == null ? null : Math.round(temp * 10) / 10) },
    { k: "Zeit", v: fmtTime(time) },
    { k: "Mahlgrad", v: grind || "–" },
  ];
  return out.filter((p) => p.v !== "–" || p.k === "Dosis" || p.k === "Zeit");
}

export function topFlavors(brews: Brew[], n = 8): { id: string; label: string; category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of brews) for (const f of b.flavors) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => {
      const note = FLAVOR_BY_ID.get(id);
      return note ? { id, label: note.label, category: note.category, count } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "de"))
    .slice(0, n);
}

export function brewParamsLine(b: Brew): string {
  const parts: string[] = [];
  if (b.dose_g != null) parts.push(fmtGrams(b.dose_g));
  if (b.water_g != null) parts.push(fmtGrams(b.water_g));
  if (b.temp_c != null) parts.push(fmtTemp(b.temp_c));
  if (b.time_s != null) parts.push(fmtBrewTime(b));
  if (b.grind) parts.push(b.grind);
  return parts.join(" · ");
}
