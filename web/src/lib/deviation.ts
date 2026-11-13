// Abweichung eines Bezugs vom zugewiesenen Rezept, je Wert in Prozent (Übersicht „Bezüge“)

import { grindNumber } from "../../../shared/grind.ts";
import type { BrewLogEntry } from "../../../shared/types.ts";
import { fmtBrewTime, fmtGrams, fmtTemp, fmtTime } from "./format.ts";

export type DevKey = "grind" | "dose" | "yield" | "time" | "temp";
export type Deviation = {
  key: DevKey;
  label: string;
  /** Wert des Bezugs, formatiert; null wenn er fehlt */
  value: string | null;
  /** Wert im Rezept, formatiert; null ohne Rezept oder ohne den Wert darin */
  target: string | null;
  /** (Bezug − Rezept) / Rezept × 100; null, wenn eins fehlt */
  pct: number | null;
};

const fmtGrind = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 2, useGrouping: false });

/** Mahlgrad des Bezugs, sonst der des Mahlvorgangs (µm) */
function brewGrind(b: BrewLogEntry): { text: string | null; n: number | null } {
  if (b.grind) return { text: b.grind, n: grindNumber(b.grind) };
  if (b.grinder?.grind_um != null) return { text: `${fmtGrind(b.grinder.grind_um)} µm`, n: b.grinder.grind_um };
  return { text: null, n: null };
}

const pct = (v: number | null | undefined, t: number | null | undefined) => (v != null && t != null && t !== 0 ? ((v - t) / t) * 100 : null);

export function deviations(b: BrewLogEntry): Deviation[] {
  const r = b.recipe;
  const g = brewGrind(b);
  return [
    { key: "grind", label: "Mahlgrad", value: g.text, target: r?.grind || null, pct: pct(g.n, r ? grindNumber(r.grind) : null) },
    { key: "dose", label: "Dosis", value: b.dose_g != null ? fmtGrams(b.dose_g) : null, target: r?.dose_g != null ? fmtGrams(r.dose_g) : null, pct: pct(b.dose_g, r?.dose_g) },
    {
      key: "yield",
      label: "Ausbeute",
      value: b.water_g != null ? fmtGrams(b.water_g) : null,
      target: r?.water_g != null ? fmtGrams(r.water_g) : null,
      pct: pct(b.water_g, r?.water_g),
    },
    { key: "time", label: "Zeit", value: b.time_s != null ? fmtBrewTime(b) : null, target: r?.time_s != null ? fmtTime(r.time_s) : null, pct: pct(b.time_s, r?.time_s) },
    { key: "temp", label: "Temp.", value: b.temp_c != null ? fmtTemp(b.temp_c) : null, target: r?.temp_c != null ? fmtTemp(r.temp_c) : null, pct: pct(b.temp_c, r?.temp_c) },
  ];
}

/** Mittlere Abweichung über alle vergleichbaren Werte (Betrag); null, wenn keiner vergleichbar ist */
export function meanDeviation(d: Deviation[]): number | null {
  const v = d.flatMap((x) => (x.pct == null ? [] : [Math.abs(x.pct)]));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** „+4 %“, „−12 %“, „±0 %“ */
export function fmtPct(p: number): string {
  const r = Math.round(p);
  if (r === 0) return "±0 %";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)} %`;
}

/** Farbe nach Betrag: bis 5 % nah am Rezept, bis 15 % spürbar, darüber deutlich daneben */
export function devTone(p: number): string {
  const a = Math.abs(p);
  if (a < 5) return "text-good";
  if (a < 15) return "text-ink";
  return "text-bad";
}
export function devPill(p: number): string {
  const a = Math.abs(p);
  if (a < 5) return "bg-good-soft text-good";
  if (a < 15) return "bg-star/15 text-ink";
  return "bg-bad-soft text-bad";
}
