// Einstellhilfe: Verlauf je Tüte, letzter gelungener Mahlgrad, Hinweis aus festen Regeln (Espresso). Ohne Cloud.

import { roundTo, type GrinderProfile } from "../../../shared/compass.ts";
import { brewRatio, grindNumber, isGoodBrew, methodKey } from "../../../shared/grind.ts";
import { fmtRatio, fmtWindow, mid, normTime, piMiss, piSeconds, piSetting, timeMiss, yieldOf, type ShotTarget } from "../../../shared/shot.ts";
import { daysBetween, type Batch, type Brew, type Coffee, type Recipe } from "../../../shared/types.ts";
import { fmtNum } from "./format.ts";

export function brewMethod(b: Brew, recipes: Recipe[], coffee: Pick<Coffee, "roast_for">): string {
  const r = b.recipe_id != null ? recipes.find((x) => x.id === b.recipe_id) : undefined;
  return methodKey(r?.method ?? null, coffee.roast_for, brewRatio(b));
}

export function brewGrinder(b: Brew, recipes: Recipe[]): string {
  return (b.recipe_id != null ? recipes.find((x) => x.id === b.recipe_id)?.grinder : "") ?? "";
}

export const ratioOf = brewRatio;

/** Letzter gelungener Bezug dieser Tüte mit dieser Zubereitung, der einen Mahlgrad hat */
export function lastGoodGrind(brews: Brew[], batchId: number | null, method: string, recipes: Recipe[], coffee: Pick<Coffee, "roast_for">): Brew | null {
  if (batchId == null) return null;
  return (
    brews
      .filter((b) => b.batch_id === batchId && b.grind.trim() && isGoodBrew(b) && brewMethod(b, recipes, coffee) === method)
      .sort((a, b) => b.brewed_at.localeCompare(a.brewed_at))[0] ?? null
  );
}

/**
 * steps: wie weit der Mahlgrad wandern soll in Tipp-Schritten der Mühle (1 = eine Stufe), nur bei feiner/gröber;
 * amount: stattdessen genau so viele Einheiten der Mühle (aus den Sekunden bis zum Zielfenster)
 */
export type DialHint = { tone: "ok" | "finer" | "coarser" | "info"; title: string; text: string; steps?: number; amount?: number };

const r1 = (v: number) => `1:${fmtNum(Math.round(v * 10) / 10)}`;

/** Ausbeute liegt außerhalb des Zielverhältnisses (mit etwas Luft fürs Ablesen der Waage) */
export const ratioMiss = (ratio: number | null, t: ShotTarget) => (ratio == null ? 0 : ratio < t.ratio[0] - 0.05 ? -1 : ratio > t.ratio[1] + 0.05 ? 1 : 0);

/**
 * Hinweis für den nächsten Shot aus dem letzten Bezug, gemessen am Ziel des Kaffees. Zuerst die Zeit (objektiv, auf das
 * Zielverhältnis umgerechnet): außerhalb des Fensters sagt sie, wie weit der Mahlgrad wandern soll, k Einheiten je Sekunde.
 * Im Fenster entscheidet der Geschmack: sauer heißt unterextrahiert (feiner, heißer oder mehr Ausbeute), bitter überextrahiert.
 */
export function espressoHint(b: Brew | null, target: ShotTarget, k: number | null, profile: GrinderProfile | null): DialHint | null {
  if (!b) return null;
  const t = b.time_s;
  const ratio = ratioOf(b);
  const sour = b.taste.includes("sauer");
  const bitter = b.taste.includes("bitter");
  const good = isGoodBrew(b);
  const tn = t != null ? normTime(t, ratio, target) : null;
  const miss = tn != null ? timeMiss(tn, target) : 0;
  const rMiss = ratioMiss(ratio, target);
  const win = fmtWindow(target.time);
  const rt = fmtRatio(target.ratio);
  const unit = profile?.unit ?? "";
  // Weg bis zur Mitte des Fensters in Einheiten der Mühle, mindestens eine Stufe, höchstens vier Tipp-Schritte
  const amountFor = (sec: number) =>
    profile ? Math.max(profile.step, Math.min(4 * profile.nudge, roundTo(Math.abs(sec) * (k ?? profile.shotK), profile.step))) : undefined;
  const howFar = (a: number | undefined, dir: string) => (a != null ? `Etwa ${fmtNum(a)}\u202f${unit} ${dir}` : `Eine Stufe ${dir}`);
  // Preinfusion: eigenes Fenster je Röstgrad; zu kurz macht sauer und Kanäle, zu lang bitter. Erst sie richten, dann den Mahlgrad
  const pi = b.preinfusion_s;
  const pm = pi != null ? piMiss(pi, target) : 0;
  const piWin = fmtWindow(target.pi);
  // So stellt man die Preinfusion in der Decent ein: Fluss bis Abbruchdruck, höchstens so lange
  const piDecent = (secs: number) => ` In der Decent: Preinfusion ${piSetting(target.pi_flow, target.pi_bar, secs)}.`;
  const ts = pi ? `${pi} + ${t}` : `${t}`;
  const tText = t != null && tn != null && ratio != null && rMiss !== 0 ? `${ts} s bei ${r1(ratio)} (auf ${rt} gerechnet etwa ${Math.round(tn)} s)` : `${ts} s`;
  const half = profile ? Math.max(profile.step, roundTo(profile.nudge / 2, profile.step)) : undefined;

  if (sour && bitter)
    return {
      tone: "info",
      title: "Sauer und bitter zugleich",
      text: `Spricht für ungleichmäßige Extraktion (Channeling): Verteilung und Tampen prüfen, Mahlgrad erst einmal lassen.${pm < 0 ? ` Preinfusion ${pi} s ist kürzer als ${piWin}: länger vorbrühen, ein satter Puck bildet weniger Kanäle.${piDecent(Math.max(piSeconds(target), target.pi[0]))}` : ""}`,
    };

  if (tn != null && miss < 0) {
    const a = amountFor(mid(target.time) - tn);
    const why = sour ? " und sauer: unterextrahiert" : bitter ? ", trotzdem bitter: oft Channeling, Verteilung prüfen" : good ? ". Schmeckt, liegt aber nicht im Ziel" : "";
    return { tone: "finer", steps: 1, amount: a, title: good ? "Schmeckt, läuft aber schnell" : "Feiner mahlen", text: `${tText} ist schneller als dein Ziel ${win}${why}. ${howFar(a, "feiner")}, Rest gleich lassen.` };
  }
  if (tn != null && miss > 0) {
    const a = amountFor(mid(target.time) - tn);
    const why = bitter ? " und bitter: überextrahiert" : sour ? ", trotzdem sauer: oft Channeling, Verteilung prüfen" : good ? ". Schmeckt, liegt aber nicht im Ziel" : "";
    return { tone: "coarser", steps: 1, amount: a, title: good ? "Schmeckt, läuft aber langsam" : "Gröber mahlen", text: `${tText} ist langsamer als dein Ziel ${win}${why}. ${howFar(a, "gröber")}.` };
  }

  const inWin = t != null ? `Im Zeitfenster (${ts} s)` : null;
  if (sour) {
    if (t == null) return { tone: "finer", steps: 1, title: "Feiner mahlen", text: `Zu sauer: unterextrahiert. Eine Stufe feiner. Mit Bezugszeit wird der Tipp genauer (Ziel ${win}).` };
    if (rMiss < 0) return { tone: "info", title: "Mehr Ausbeute", text: `${inWin}, aber ${r1(ratio!)} ist kürzer als dein Ziel ${rt}. Länger laufen lassen, Mahlgrad gleich.` };
    if (pm < 0)
      return { tone: "info", title: "Länger vorbrühen", text: `${inWin} und trotzdem sauer, die Preinfusion (${pi} s) ist kürzer als ${piWin}. Erst sie verlängern, Mahlgrad gleich lassen.${piDecent(piSeconds(target))}` };
    return { tone: "finer", steps: 0.5, amount: half, title: "Etwas feiner oder heißer", text: `${inWin} und trotzdem sauer: Dieser Kaffee will etwas feiner oder 1–2 °C mehr. Das merkt sich der Startwert als seinen Geschmack.` };
  }
  if (bitter) {
    if (t == null) return { tone: "coarser", steps: 1, title: "Gröber mahlen", text: `Zu bitter: überextrahiert. Eine Stufe gröber. Mit Bezugszeit wird der Tipp genauer (Ziel ${win}).` };
    if (rMiss > 0) return { tone: "info", title: "Weniger Ausbeute", text: `${inWin}, aber ${r1(ratio!)} ist länger als dein Ziel ${rt}. Früher stoppen, Mahlgrad gleich.` };
    if (pm > 0)
      return { tone: "info", title: "Kürzer vorbrühen", text: `${inWin} und trotzdem bitter, die Preinfusion (${pi} s) ist länger als ${piWin}. Erst sie kürzen, Mahlgrad gleich lassen.${piDecent(piSeconds(target))}` };
    return { tone: "coarser", steps: 0.5, amount: half, title: "Etwas gröber oder kühler", text: `${inWin} und trotzdem bitter: Dieser Kaffee will etwas gröber oder 1–2 °C weniger. Das merkt sich der Startwert als seinen Geschmack.` };
  }
  if (b.taste.includes("duenn")) return { tone: "info", title: "Mehr Körper", text: "Zu dünn: Dosis leicht erhöhen oder kürzeres Verhältnis, Mahlgrad so anpassen, dass die Zeit bleibt." };
  if (b.taste.includes("kraeftig")) return { tone: "info", title: "Etwas strecken", text: "Zu kräftig: Verhältnis verlängern (mehr Ausbeute) oder Dosis leicht senken." };
  if (rMiss !== 0 && ratio != null)
    return {
      tone: "info",
      title: rMiss < 0 ? "Mehr Ausbeute" : "Weniger Ausbeute",
      text: `${r1(ratio)} liegt ${rMiss < 0 ? "unter" : "über"} deinem Ziel ${rt}: bei ${fmtNum(b.dose_g ?? target.dose_g)} g Dosis ${yieldOf(b.dose_g ?? target.dose_g, target.ratio[0])}–${yieldOf(b.dose_g ?? target.dose_g, target.ratio[1])} g in die Tasse.`,
    };
  if (good) return { tone: "ok", title: t != null ? "Im Ziel" : "Passt", text: `Mahlgrad ${b.grind || "–"} beibehalten.${t != null ? ` ${ts} s in ${win}, ${ratio != null ? r1(ratio) : rt}.` : ` Mit Bezugszeit prüft der Tipp auch das Ziel ${win}.`}` };
  if (t == null) return { tone: "info", title: "Zeit fehlt", text: `Mit Bezugszeit und Kurzurteil (zu sauer, zu bitter …) gibt es hier einen Hinweis. Ziel: ${win}.` };
  return { tone: "info", title: "Im Zeitfenster", text: "Wie schmeckt er? Mit einem Kurzurteil beim nächsten Bezug wird der Hinweis genauer." };
}

/** Mahlgrad für den nächsten Versuch aus dem Hinweis: letzter Bezug plus Weg aus dem Hinweis (nur bei bekannter Mühle) */
export function tipGrind(hint: DialHint | null, last: Brew | null, profile: GrinderProfile | null): number | null {
  if (!hint || (!hint.steps && !hint.amount) || !last || !profile || (hint.tone !== "finer" && hint.tone !== "coarser")) return null;
  const g = grindNumber(last.grind);
  if (g == null) return null;
  const dir = (hint.tone === "finer") === profile.coarserUp ? -1 : 1;
  return roundTo(g + dir * (hint.amount ?? hint.steps! * profile.nudge), profile.step);
}

/** Punkte für den Mahlgrad-Verlauf: x Tag seit Röstung, y Mahlgrad als Zahl */
export function grindPoints(
  brews: Brew[],
  batches: Map<number, Batch>,
  method: string,
  recipes: Recipe[],
  coffee: Pick<Coffee, "roast_for">,
): { brew: Brew; day: number; grind: number }[] {
  return brews
    .filter((b) => brewMethod(b, recipes, coffee) === method)
    .map((b) => {
      const batch = b.batch_id != null ? batches.get(b.batch_id) : undefined;
      const day = batch ? daysBetween(batch.roast_date, b.brewed_at) : null;
      const grind = grindNumber(b.grind);
      return day != null && grind != null ? { brew: b, day, grind } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}
