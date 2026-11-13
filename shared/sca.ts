// SCA-Cupping-Bogen (Grundlage auch für die Sensorik-Bögen der Meisterschaften):
// sieben Attribute je 6–10 in 0,25er-Schritten, dazu Gleichmäßigkeit, Sauberkeit
// und Süße (je Tasse 2 Punkte, 5 Tassen = 10), minus Defekte.

export type ScoreKey =
  | "aroma"
  | "flavor"
  | "aftertaste"
  | "acidity"
  | "body"
  | "balance"
  | "overall"
  | "uniformity"
  | "cleanCup"
  | "sweetness";

export type Scores = Record<ScoreKey, number> & { defects: number };

export const QUALITY_KEYS = ["aroma", "flavor", "aftertaste", "acidity", "body", "balance", "overall"] as const;
export const CUP_KEYS = ["uniformity", "cleanCup", "sweetness"] as const;

export const SCORE_LABELS: Record<ScoreKey, string> = {
  aroma: "Duft/Aroma",
  flavor: "Geschmack",
  aftertaste: "Nachgeschmack",
  acidity: "Säure",
  body: "Körper",
  balance: "Balance",
  overall: "Gesamteindruck",
  uniformity: "Gleichmäßigkeit",
  cleanCup: "Sauberkeit",
  sweetness: "Süße",
};

export const SCORE_HINTS: Record<ScoreKey, string> = {
  aroma: "Trockener Duft und nasses Aroma",
  flavor: "Intensität, Qualität und Komplexität im Mund",
  aftertaste: "Länge und Qualität nach dem Schlucken",
  acidity: "Helle, angenehme Säure statt spitz oder flach",
  body: "Mundgefühl: Gewicht und Textur",
  balance: "Zusammenspiel von Geschmack, Säure und Körper",
  overall: "Persönliches Gesamturteil",
  uniformity: "Schmecken alle Tassen gleich?",
  cleanCup: "Frei von Fehlnoten?",
  sweetness: "Spürbare Süße",
};

export const QUALITY_MIN = 6;
export const QUALITY_MAX = 10;
export const QUALITY_STEP = 0.25;

export function defaultScores(): Scores {
  return {
    aroma: 7.5,
    flavor: 7.5,
    aftertaste: 7.5,
    acidity: 7.5,
    body: 7.5,
    balance: 7.5,
    overall: 7.5,
    uniformity: 10,
    cleanCup: 10,
    sweetness: 10,
    defects: 0,
  };
}

export function totalScore(s: Scores): number {
  const sum =
    QUALITY_KEYS.reduce((a, k) => a + s[k], 0) + CUP_KEYS.reduce((a, k) => a + s[k], 0) - (s.defects || 0);
  return Math.round(sum * 100) / 100;
}

/** Stufen eines Qualitätsattributs auf dem SCA-Bogen */
export const QUALITY_LEVELS = [
  { min: 6, label: "Gut" },
  { min: 7, label: "Sehr gut" },
  { min: 8, label: "Exzellent" },
  { min: 9, label: "Herausragend" },
] as const;

export function qualityLevel(v: number): string {
  return [...QUALITY_LEVELS].reverse().find((l) => v >= l.min)?.label ?? QUALITY_LEVELS[0].label;
}

/** Stufengrenzen des Gesamtscores, von unten nach oben */
export const GRADE_STEPS = [80, 85, 90] as const;

export function scoreGrade(total: number): { label: string; tone: "top" | "great" | "good" | "low" } {
  if (total >= 90) return { label: "Herausragend", tone: "top" };
  if (total >= 85) return { label: "Exzellent", tone: "great" };
  if (total >= 80) return { label: "Sehr gut", tone: "good" };
  return { label: "Unter Specialty", tone: "low" };
}

export function clampScores(input: Partial<Scores>): Scores {
  const d = defaultScores();
  const out = { ...d };
  for (const k of QUALITY_KEYS) {
    const v = Number(input[k]);
    out[k] = Number.isFinite(v)
      ? Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, Math.round(v / QUALITY_STEP) * QUALITY_STEP))
      : d[k];
  }
  for (const k of CUP_KEYS) {
    const v = Number(input[k]);
    out[k] = Number.isFinite(v) ? Math.min(10, Math.max(0, Math.round(v / 2) * 2)) : d[k];
  }
  const def = Number(input.defects);
  out.defects = Number.isFinite(def) ? Math.min(40, Math.max(0, Math.round(def))) : 0;
  return out;
}

export function formatScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toFixed(2).replace(".", ",");
}
