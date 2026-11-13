import { db } from "./db.ts";
import { getSetting } from "./store.ts";
import { compass, grinderProfile, type Compass, type GrinderProfile } from "../shared/compass.ts";
import {
  brewRatio,
  grindNumber,
  grindStep,
  isGoodBrew,
  methodKey,
  roundGrind,
  type BrewTemplate,
  type GrindPrediction,
  type GrindSimilar,
} from "../shared/grind.ts";
import { mid, normTime, parseShotOverride, parseShotTargets, shotTargetOf, type ResolvedTarget } from "../shared/shot.ts";
import { daysBetween, ROAST_FOR, type Brew, type RoastFor, type RoastLevel } from "../shared/types.ts";

/**
 * Mahlgrad-Prognose für eine neue Tüte. Lernt aus allen gelungenen Bezügen derselben Zubereitung (und Mühle):
 * Ridge-Regression über die Merkmale des Kaffees (Röstgrad, Höhe, Aufbereitung, Land, Varietäten, Rösterei,
 * „Geröstet für“, der Kaffee selbst) und das Röstalter am Bezugstag. Jede Tüte zählt gleich viel, egal wie viele
 * Bezüge sie hat. Die Stärke der Regularisierung wählt eine Kreuzvalidierung, die je eine Tüte weglässt.
 * Bei weniger als drei Tüten gibt es nur den Schnitt. Alles lokal, wird bei jeder Anfrage neu gerechnet (ein paar Dutzend Zeilen).
 *
 * Mit bekannter Mühle (Mahlkompass, `shared/compass.ts`) lernt das Modell nicht den Mahlgrad selbst, sondern die Abweichung
 * vom Kompass: Ohne Daten gilt der Kompass, mit Daten kommen Kalibrierung der Mühle und eigener Geschmack dazu, und die
 * Regularisierung zieht zum Kompass statt zum Schnitt.
 *
 * Espresso mit Kompass: Die Bezugszeit ist der objektive Teil. Jeder Shot mit Zeit zählt, auch ein misslungener: Sein
 * Mahlgrad wird um die Sekunden bis zur Mitte des Zielfensters verschoben (Zeit vorher aufs Zielverhältnis umgerechnet),
 * so entsteht „der Mahlgrad, der das Ziel getroffen hätte“. Wie viel µm eine Sekunde ist, lernt das Modell aus Shots
 * derselben Tüte mit verschiedenem Mahlgrad (Annahme der Mühle als Vorwissen). Weit danebenliegende Shots zählen weniger.
 * Der Geschmack ist je Kaffee verschieden und wird nicht übertragen: „zu sauer“ im Zeitfenster heißt, dieser Kaffee will
 * feiner als das Zeitziel, „zu bitter“ gröber. Das ergibt einen eigenen, gedämpften Versatz nur für diesen Kaffee.
 */

type Row = Record<string, unknown>;
type Bag = {
  batch_id: number;
  coffee_id: number;
  name: string;
  roaster: string;
  roast_date: string | null;
  roast_level: RoastLevel | null;
  roast_for: RoastFor | null;
  process: string;
  process_detail: string;
  country: string;
  varieties: string[];
  altitude: number | null;
  altitude_text: string;
};
/**
 * y: Zielgröße des Modells (Mahlgrad, mit Kompass die Abweichung davon); value: Mahlgrad als Zahl; w: Gewicht innerhalb der Tüte;
 * good: gelungener Bezug (nur die zeigen die ähnlichen Tüten)
 */
type Sample = { bag: Bag; y: number; grind: string; value: number; day: number | null; at: string; w: number; good: boolean };
/** Espresso-Shot mit Zeit: tn = Zeit aufs Zielverhältnis umgerechnet */
type Shot = { bag: Bag; g: number; tn: number; target: ResolvedTarget; brew: Brew; good: boolean; grind: string; day: number | null; at: string };

const ROAST_ORD: Record<RoastLevel, number> = { hell: 0, mittel: 1, dunkel: 2 };

/** „1800–2000 m“ → 1,9 km; Zahlen unter 100 gelten als Fehlangabe */
function altitudeKm(s: string): number | null {
  const nums = (s.replace(/\./g, "").match(/\d{3,4}/g) ?? []).map(Number).filter((n) => n >= 100 && n <= 3500);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length / 1000 : null;
}

const parse = <T>(v: unknown, fb: T): T => {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};

function bagOf(r: Row): Bag {
  return {
    batch_id: Number(r.batch_id),
    coffee_id: Number(r.coffee_id),
    name: String(r.name),
    roaster: String(r.roaster ?? ""),
    roast_date: (r.roast_date as string) ?? null,
    roast_level: (r.roast_level as RoastLevel) ?? null,
    roast_for: (r.roast_for as RoastFor) ?? null,
    process: String(r.process ?? ""),
    process_detail: String(r.process_detail ?? ""),
    country: String(r.country ?? "").trim(),
    varieties: parse<string[]>(r.varieties, []),
    altitude: altitudeKm(String(r.altitude ?? "")),
    altitude_text: String(r.altitude ?? ""),
  };
}

/** Kategorische Merkmale einer Tüte als Spaltennamen mit lesbarer Beschriftung */
function cats(b: Bag): [string, string][] {
  const out: [string, string][] = [[`coffee:${b.coffee_id}`, `Dieser Kaffee`]];
  if (b.process) out.push([`process:${b.process.toLowerCase()}`, `Aufbereitung ${b.process}`]);
  if (b.country) out.push([`country:${b.country.toLowerCase()}`, `Herkunft ${b.country}`]);
  if (b.roaster) out.push([`roaster:${b.roaster.toLowerCase()}`, `Rösterei ${b.roaster}`]);
  if (b.roast_for) out.push([`for:${b.roast_for}`, `Geröstet für ${ROAST_FOR.find((r) => r.id === b.roast_for)?.label ?? b.roast_for}`]);
  for (const v of b.varieties) out.push([`variety:${v.toLowerCase()}`, `Varietät ${v}`]);
  return out;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

type Model = { cols: string[]; mean: number[]; scale: number[]; beta: number[]; intercept: number; impute: Record<string, number> };

const NUM = ["roast", "alt", "day"] as const;

/** Kategorie-Schlüssel je Tüte nur einmal bilden, die Kreuzvalidierung fragt sie sonst tausendfach ab */
const catKeys = new WeakMap<Bag, Set<string>>();
const keysOf = (b: Bag) => {
  let k = catKeys.get(b);
  if (!k) catKeys.set(b, (k = new Set(cats(b).map(([c]) => c))));
  return k;
};

function rawVector(s: { bag: Bag; day: number | null }, cols: string[], impute: Record<string, number>): number[] {
  const set = keysOf(s.bag);
  return cols.map((c) => {
    if (c === "roast") return s.bag.roast_level ? ROAST_ORD[s.bag.roast_level] : impute.roast;
    if (c === "alt") return s.bag.altitude ?? impute.alt;
    if (c === "day") return s.day ?? impute.day;
    return set.has(c) ? 1 : 0;
  });
}

/** Ein Modell je λ: Die Summen hängen nicht von λ ab, also einmal aufbauen und nur mehrfach lösen */
function fitAll(samples: Sample[], lambdas: number[]): Model[] {
  // Gewicht: jede Tüte zusammen 1, innerhalb der Tüte nach Gewicht des Bezugs
  const perBag = new Map<number, number>();
  for (const s of samples) perBag.set(s.bag.batch_id, (perBag.get(s.bag.batch_id) ?? 0) + s.w);
  const w = samples.map((s) => s.w / perBag.get(s.bag.batch_id)!);
  const W = w.reduce((a, b) => a + b, 0);
  const wmean = (vals: (number | null)[], fb: number) => {
    let sum = 0;
    let ws = 0;
    vals.forEach((v, i) => {
      if (v != null) {
        sum += v * w[i];
        ws += w[i];
      }
    });
    return ws ? sum / ws : fb;
  };
  const impute = {
    roast: wmean(samples.map((s) => (s.bag.roast_level ? ROAST_ORD[s.bag.roast_level] : null)), 1),
    alt: wmean(samples.map((s) => s.bag.altitude), 1.6),
    day: wmean(samples.map((s) => s.day), 14),
  };
  const catCols = [...new Set(samples.flatMap((s) => [...keysOf(s.bag)]))].sort();
  const cols = [...NUM, ...catCols];
  const n = cols.length;
  const ym = samples.reduce((a, s, i) => a + s.y * w[i], 0) / W;
  // Normalgleichungen dünn aufbauen (Merkmale sind fast alle 0/1), zentriert wird danach:
  // Σ w (x−m)(x−m)ᵀ = Σ w x xᵀ − W m mᵀ und Σ w (x−m)(y−ȳ) = Σ w x (y−ȳ). So bleibt es bei Tausenden Shots schnell.
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  const mean = new Array(n).fill(0);
  samples.forEach((s, i) => {
    const row = rawVector(s, cols, impute);
    const nz: number[] = [];
    for (let j = 0; j < n; j++) if (row[j]) nz.push(j);
    const dy = w[i] * (s.y - ym);
    for (const r of nz) {
      mean[r] += w[i] * row[r];
      b[r] += row[r] * dy;
      const wr = w[i] * row[r];
      for (const c of nz) S[r][c] += wr * row[c];
    }
  });
  for (let j = 0; j < n; j++) mean[j] /= W;
  // Zahlen auf Standardabweichung, 0/1-Spalten bleiben (so wirkt die Regularisierung auf alle ähnlich).
  // Konstante Spalte (z. B. alle Tüten mittel): Rundungsrest statt 0, sonst explodiert die Vorhersage für andere Werte
  const scale = cols.map((c, j) => {
    if (!(NUM as readonly string[]).includes(c)) return 1;
    const v = S[j][j] / W - mean[j] ** 2;
    return v > 1e-9 ? Math.sqrt(v) : 1;
  });
  const A = S.map((row, r) => row.map((v, c) => (v - W * mean[r] * mean[c]) / (scale[r] * scale[c])));
  const bs = b.map((v, r) => v / scale[r]);
  return lambdas.map((lambda) => {
    const beta = solve(
      A.map((row, r) => row.map((v, c) => (r === c ? v + lambda : v))),
      bs,
    );
    return { cols, mean, scale, beta, intercept: ym, impute };
  });
}

function predict(m: Model, s: { bag: Bag; day: number | null }): number {
  const x = rawVector(s, m.cols, m.impute);
  return m.intercept + x.reduce((a, v, j) => a + ((v - m.mean[j]) / m.scale[j]) * m.beta[j], 0);
}

const LAMBDAS = [0.1, 0.3, 1, 2, 3, 5, 10, 30, 100];

/**
 * Kreuzvalidierung: jede Tüte einmal weglassen und aus den übrigen vorhersagen, Fehler je Tüte. Qualität vor Rechenzeit:
 * keine Zusammenfassung zu Teilen, auch bei vielen Tüten (400 Tüten etwa 3 s, danach aus dem Speicher)
 */
function crossValidate(samples: Sample[], bags: number[]): { lambda: number; rmse: number } {
  const byBag = new Map<number, Sample[]>();
  for (const s of samples) byBag.set(s.bag.batch_id, [...(byBag.get(s.bag.batch_id) ?? []), s]);
  const se = LAMBDAS.map(() => 0);
  for (const id of bags) {
    const models = fitAll(samples.filter((s) => s.bag.batch_id !== id), LAMBDAS);
    const test = byBag.get(id) ?? [];
    const ws = test.reduce((a, s) => a + s.w, 0);
    models.forEach((m, li) => {
      const err = test.reduce((a, s) => a + (s.y - predict(m, s)) * s.w, 0) / ws;
      se[li] += err * err;
    });
  }
  let best = { lambda: 3, rmse: Infinity };
  LAMBDAS.forEach((lambda, li) => {
    const rmse = Math.sqrt(se[li] / bags.length);
    if (rmse < best.rmse) best = { lambda, rmse };
  });
  return best;
}

function bagSimilarity(a: Bag, b: Bag): number {
  let s = 0;
  if (a.coffee_id === b.coffee_id) s += 5;
  if (a.roaster && a.roaster === b.roaster) s += 1;
  if (a.process && a.process === b.process) s += 1;
  if (a.roast_level && a.roast_level === b.roast_level) s += 1.5;
  if (a.roast_for && a.roast_for === b.roast_for) s += 1;
  if (a.country && a.country === b.country) s += 1;
  if (a.varieties.some((v) => b.varieties.includes(v))) s += 1;
  return s;
}

const BAG_SQL = `t.id AS batch_id, c.id AS coffee_id, c.name, c.roaster, t.roast_date, c.roast_level, c.roast_for, c.process, c.process_detail,
  c.country, c.varieties, c.altitude, c.shot_target`;

const compassOf = (p: GrinderProfile, method: string, b: Bag, day: number | null): Compass =>
  compass(p, method, { roast_level: b.roast_level, roast_for: b.roast_for, process: b.process, process_detail: b.process_detail, varieties: b.varieties, altitude: b.altitude_text }, day);

/** Gewicht einer Tüte im Schnitt: gleicher Kaffee zählt doppelt */
function bagMean(samples: Sample[], ids: number[], coffeeId: number, val: (s: Sample) => number): { sum: number; ws: number } {
  let sum = 0;
  let ws = 0;
  for (const id of ids) {
    const list = samples.filter((s) => s.bag.batch_id === id);
    const wgt = list[0].bag.coffee_id === coffeeId ? 2 : 1;
    sum += (list.reduce((a, s) => a + val(s) * s.w, 0) / list.reduce((a, s) => a + s.w, 0)) * wgt;
    ws += wgt;
  }
  return { sum, ws };
}

/**
 * Mahlgrad je Sekunde Bezugszeit aus Shots derselben Tüte mit verschiedenem Mahlgrad (Steigung innerhalb der Tüten),
 * mit der Annahme der Mühle als Vorwissen im Gewicht von etwa zwei Shots im Abstand von drei Tipp-Schritten.
 * Die Tage seit dem ersten Shot der Tüte laufen als zweite Größe mit: Im Hopper altern die Bohnen, man mahlt mit der Zeit
 * feiner bei ähnlicher Zeit. Ohne diese Größe sähe das wie „feiner bringt kaum Zeit“ aus und k (µm je Sekunde) fiele zu groß aus.
 */
function learnK(shots: Shot[], p: GrinderProfile): { k: number; pairs: number } {
  const dir = p.coarserUp ? 1 : -1;
  const byBag = new Map<number, Shot[]>();
  for (const s of shots) byBag.set(s.bag.batch_id, [...(byBag.get(s.bag.batch_id) ?? []), s]);
  const dayOf = (s: Shot) => Date.parse(s.at.slice(0, 10)) / 86_400_000;
  let scc = 0;
  let sct = 0;
  let sdd = 0;
  let scd = 0;
  let sdt = 0;
  let pairs = 0;
  for (const list of byBag.values()) {
    if (list.length < 2) continue;
    const cm = list.reduce((a, s) => a + dir * s.g, 0) / list.length;
    const tm = list.reduce((a, s) => a + s.tn, 0) / list.length;
    const dm = list.reduce((a, s) => a + dayOf(s), 0) / list.length;
    for (const s of list) {
      const c = dir * s.g - cm;
      const d = dayOf(s) - dm;
      const t = s.tn - tm;
      scc += c * c;
      sct += c * t;
      sdd += d * d;
      scd += c * d;
      sdt += d * t;
    }
    pairs += list.length - 1;
  }
  const lambda = (3 * p.nudge) ** 2;
  // Drift bleibt nahe null, bis Shots über mehrere Tage sie tragen (Gewicht wie ein Shot drei Tage neben dem Schnitt)
  const lambdaD = 9;
  // Steigung Sekunden je Einheit gröber (Vorwissen −1/k) und je Tag im Hopper, gemeinsam gelöst
  const a = scc + lambda;
  const b = scd;
  const d = sdd + lambdaD;
  const r1 = sct + lambda * (-1 / p.shotK);
  const r2 = sdt;
  const det = a * d - b * b;
  const beta = (r1 * d - b * r2) / det;
  const k = beta < 0 ? Math.min(3 * p.shotK, Math.max(p.shotK / 3, -1 / beta)) : p.shotK;
  return { k: Math.round(k * 100) / 100, pairs };
}

/** Sekunden bis zur Mitte des Zielfensters (positiv = Shot war zu schnell) */
const shotDt = (s: Shot) => mid(s.target.time) - s.tn;

/** Mahlgrad, der die Mitte des Zielfensters getroffen hätte; die Verschiebung bleibt unter vier Tipp-Schritten */
function timeGrind(s: Shot, k: number, p: GrinderProfile): number {
  const dir = p.coarserUp ? 1 : -1;
  const cap = 4 * p.nudge;
  return s.g - dir * Math.max(-cap, Math.min(cap, k * shotDt(s)));
}

/**
 * Geschmack dieses Kaffees gegenüber dem Zeitziel, in Einheiten der Mühle (negativ = feiner). Je Shot: „zu sauer“ heißt,
 * der Kaffee will mindestens einen Tipp-Schritt feiner als gezogen, zählt aber nur, soweit die Zeit das nicht schon erklärt;
 * „zu bitter“ spiegelbildlich; gelungen zieht halb zum gezogenen Mahlgrad. Gedämpft wie ein Schnitt mit einem Shot „passt“.
 */
function tasteOffset(shots: Shot[], k: number, p: GrinderProfile): { taste: number; n: number } | null {
  const dir = p.coarserUp ? 1 : -1;
  const h = p.nudge;
  let sum = 0;
  let n = 0;
  for (const s of shots) {
    const sour = s.brew.taste.includes("sauer");
    const bitter = s.brew.taste.includes("bitter");
    const c = dir * s.g;
    const cT = dir * timeGrind(s, k, p);
    let d: number | null = null;
    if (sour && !bitter) d = Math.min(0, c - h - cT);
    else if (bitter && !sour) d = Math.max(0, c + h - cT);
    else if (s.good) d = 0.5 * (c - cT);
    if (d == null) continue;
    sum += d;
    n++;
  }
  if (!n) return null;
  const t = Math.max(-3 * h, Math.min(3 * h, sum / (n + 1)));
  return { taste: Math.round(dir * t * 10) / 10, n };
}

type Learned = { samples: Sample[]; shots: Shot[]; k: number | null; kPairs: number; model: { cv: { lambda: number; rmse: number }; m: Model } | null };

/**
 * Was aus allen Bezügen einer Zubereitung gelernt wird, hängt nicht von der Tüte ab, für die gefragt wird. Es bleibt im
 * Speicher, bis sich irgendetwas in der Datenbank ändert: `total_changes()` zählt die Änderungen dieser Verbindung,
 * `data_version` springt bei Änderungen anderer (z. B. ein Skript am Container). So rechnet die Kreuzvalidierung einmal je
 * Datenstand statt bei jedem Öffnen eines Kaffees.
 */
const learnCache = { stamp: "", map: new Map<string, Learned>() };

function learnFrom(o: { method: string; grinder: string; setting: string | null; profile: GrinderProfile | null; timeMode: boolean }): Learned {
  const own = (db.prepare(`SELECT total_changes() AS n`).get() as Row).n;
  const other = (db.prepare(`PRAGMA data_version`).get() as Row).data_version;
  const stamp = `${own}:${other}`;
  if (stamp !== learnCache.stamp) learnCache.map.clear();
  learnCache.stamp = stamp;
  const key = [o.method, o.setting ?? "", o.profile?.id ?? "", o.profile ? "" : o.grinder.trim().toLowerCase(), o.timeMode].join("|");
  const hit = learnCache.map.get(key);
  if (hit) return hit;

  const targets = parseShotTargets(getSetting("shot_targets"));
  const targetOf = (r: Row) => shotTargetOf({ roast_level: (r.roast_level as RoastLevel) ?? null, shot_target: parseShotOverride(r.shot_target) }, targets);
  const rows = db
    .prepare(
      `SELECT ${BAG_SQL}, b.brewed_at, b.grind, b.kind, b.total, b.rating, b.taste, b.dose_g, b.water_g, b.time_s, r.method AS r_method,
              COALESCE(r.grinder, '') AS r_grinder
       FROM brews b JOIN batches t ON t.id = b.batch_id JOIN coffees c ON c.id = b.coffee_id LEFT JOIN recipes r ON r.id = b.recipe_id
       WHERE b.grind != ''`,
    )
    .all() as Row[];

  const grinder = o.grinder.trim().toLowerCase();
  const samples: Sample[] = [];
  const shots: Shot[] = [];
  const compassFor = (bag: Bag, day: number | null) => compassOf(o.profile!, o.method, bag, day).raw;
  for (const r of rows) {
    const ratio = brewRatio({ dose_g: r.dose_g == null ? null : Number(r.dose_g), water_g: r.water_g == null ? null : Number(r.water_g) });
    if (methodKey((r.r_method as string) || null, (r.roast_for as RoastFor) ?? null, ratio) !== o.method) continue;
    const g = String(r.r_grinder).trim();
    if (o.profile) {
      // Nur Bezüge auf derselben Mühle (Rezept ohne Mühle zählt als die eigene)
      if (grinderProfile(o.setting, g) !== o.profile) continue;
    } else if (grinder && g && g.toLowerCase() !== grinder) continue; // Mühle nur unterscheiden, wenn beide eine nennen
    const brew = {
      kind: r.kind,
      total: r.total == null ? null : Number(r.total),
      rating: r.rating == null ? null : Number(r.rating),
      taste: parse<string[]>(r.taste, []),
    } as unknown as Brew;
    const good = isGoodBrew(brew);
    const grind = grindNumber(String(r.grind));
    if (grind == null) continue;
    const bag = bagOf(r);
    const day = daysBetween(bag.roast_date, String(r.brewed_at));
    const t = r.time_s == null ? null : Number(r.time_s);
    if (o.timeMode && t != null && t > 0) {
      const tg = targetOf(r);
      shots.push({ bag, g: grind, tn: normTime(t, ratio, tg), target: tg, brew, good, grind: String(r.grind), day, at: String(r.brewed_at) });
      continue;
    }
    if (!good) continue;
    // Mit Kompass lernt das Modell die Abweichung vom Kompass; gelungene Shots ohne Zeit zählen bei Espresso halb
    const y = o.profile ? grind - compassFor(bag, day) : grind;
    samples.push({ bag, y, grind: String(r.grind), value: grind, day, at: String(r.brewed_at), w: o.timeMode ? 0.5 : 1, good });
  }

  // Shots mit Zeit: Mahlgrad aufs Zeitziel verschoben, Gewicht fällt mit dem Abstand zum Fenster
  const learnedK = o.timeMode ? learnK(shots, o.profile!) : null;
  const k = learnedK?.k ?? null;
  for (const s of shots) {
    const dt = shotDt(s);
    const y = timeGrind(s, k!, o.profile!) - compassFor(s.bag, s.day);
    samples.push({ bag: s.bag, y, grind: s.grind, value: s.g, day: s.day, at: s.at, w: 1 / (1 + (dt / 8) ** 2), good: s.good });
  }

  const res: Learned = { samples, shots, k, kPairs: learnedK?.pairs ?? 0, model: null };
  learnCache.map.set(key, res);
  return res;
}

/** Startwert für eine Tüte (batch_id) oder einen Kaffee ohne Tüte, für die Zubereitung `method` und Mühle `grinder` */
export function predictGrind(opts: { coffee_id: number; batch_id: number | null; method: string; grinder: string; today: string }): GrindPrediction | null {
  const target = opts.batch_id
    ? (db.prepare(`SELECT ${BAG_SQL} FROM batches t JOIN coffees c ON c.id = t.coffee_id WHERE t.id = ? AND c.id = ?`).get(opts.batch_id, opts.coffee_id) as
        | Row
        | undefined)
    : (db.prepare(`SELECT 0 AS batch_id, c.id AS coffee_id, c.name, c.roaster, NULL AS roast_date, c.roast_level, c.roast_for, c.process, c.process_detail,
         c.country, c.varieties, c.altitude, c.shot_target FROM coffees c WHERE c.id = ?`).get(opts.coffee_id) as Row | undefined);
  if (!target) return null;
  const tBag = bagOf(target);
  const setting = getSetting("grinder");
  const profile = grinderProfile(setting, opts.grinder);
  const espresso = opts.method === "Espresso";
  const targets = parseShotTargets(getSetting("shot_targets"));
  const targetOf = (r: Row) => shotTargetOf({ roast_level: (r.roast_level as RoastLevel) ?? null, shot_target: parseShotOverride(r.shot_target) }, targets);
  const shotTarget = espresso ? targetOf(target) : null;
  // Zeit gegen Ziel nur mit bekannter Mühle: dort ist klar, wie weit eine Sekunde den Mahlgrad verschiebt
  const timeMode = Boolean(profile && espresso);

  const learned = learnFrom({ method: opts.method, grinder: opts.grinder, setting, profile, timeMode });
  const { samples, shots, k } = learned;
  const taste = timeMode && k != null ? tasteOffset(shots.filter((s) => s.bag.coffee_id === tBag.coffee_id), k, profile!) : null;
  const tasteVal = taste?.taste ?? 0;

  const day = tBag.roast_date ? daysBetween(tBag.roast_date, opts.today) : null;
  const comp = profile ? compassOf(profile, opts.method, tBag, day) : null;
  const unit = profile?.unit ?? "";
  const shotInfo = { target: shotTarget, k, k_pairs: learned.kPairs, timed: shots.length, taste: taste?.taste ?? null, taste_n: taste?.n ?? 0 };

  if (!samples.length) {
    if (!comp || !profile) return null;
    return {
      method: opts.method,
      grinder: profile.name,
      unit,
      value: comp.value,
      raw: comp.raw,
      spread: null,
      basis: "kompass",
      bags: 0,
      samples: 0,
      per_week: null,
      day,
      similar: [],
      drivers: [],
      compass: comp,
      offset: null,
      range: comp.range,
      ...shotInfo,
    };
  }

  const bagIds = [...new Set(samples.map((s) => s.bag.batch_id))];
  const step = profile ? profile.step : grindStep(samples.map((s) => s.value));

  // Letzter gelungener Mahlgrad je Tüte, für die ähnlichen Tüten
  const lastByBag = new Map<number, Sample>();
  for (const s of samples) {
    if (!s.good) continue;
    const cur = lastByBag.get(s.bag.batch_id);
    if (!cur || s.at > cur.at) lastByBag.set(s.bag.batch_id, s);
  }
  const similar: GrindSimilar[] = [...lastByBag.values()]
    .filter((s) => s.bag.batch_id !== tBag.batch_id)
    .map((s) => ({ s, score: bagSimilarity(tBag, s.bag) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.at.localeCompare(a.s.at))
    .slice(0, 3)
    .map(({ s }) => ({
      coffee_id: s.bag.coffee_id,
      name: s.bag.name,
      roaster: s.bag.roaster,
      roast_date: s.bag.roast_date,
      grind: s.grind,
      same_coffee: s.bag.coffee_id === tBag.coffee_id,
    }));

  const base = {
    method: opts.method,
    grinder: profile?.name ?? opts.grinder,
    unit,
    bags: bagIds.length,
    samples: samples.length,
    day,
    similar,
    compass: comp,
    ...shotInfo,
  };
  const withRange = (value: number, spread: number | null): [number, number] | null =>
    comp ? [roundGrind(comp.range[0] + value - comp.value, step), roundGrind(comp.range[1] + value - comp.value, step)] : spread != null ? [value - spread, value + spread] : null;

  if (bagIds.length < 3) {
    const { sum, ws } = bagMean(samples, bagIds, tBag.coffee_id, (s) => s.y);
    if (comp) {
      // Abweichung vom Kompass, mit einer halben Tüte „keine Abweichung“ gedämpft
      const offset = Math.round((sum / (ws + 0.5)) * 10) / 10;
      const raw = comp.raw + offset + tasteVal;
      const value = roundGrind(raw, step);
      return { ...base, value, raw: Math.round(raw * 10) / 10, spread: null, basis: "schnitt", per_week: null, drivers: [], offset, range: withRange(value, null) };
    }
    // Zu wenig zum Lernen: Schnitt der Tüten
    const raw = sum / ws;
    return { ...base, value: roundGrind(raw, step), raw, spread: null, basis: "schnitt", per_week: null, drivers: [], offset: null, range: null };
  }

  learned.model ??= (() => {
    const cv = crossValidate(samples, bagIds);
    return { cv, m: fitAll(samples, [cv.lambda])[0] };
  })();
  const { cv, m } = learned.model;
  const own = predict(m, { bag: tBag, day });
  const raw = (comp?.raw ?? 0) + own + tasteVal;
  const dayIdx = m.cols.indexOf("day");
  const perWeek = samples.some((s) => s.day != null) ? Math.round(((m.beta[dayIdx] / m.scale[dayIdx]) * 7) * 100) / 100 : null;

  // Was die Tüte gegenüber dem Schnitt verschiebt
  const x = rawVector({ bag: tBag, day }, m.cols, m.impute);
  const labels = new Map(cats(tBag));
  const drivers = m.cols
    .map((c, j) => {
      const effect = ((x[j] - m.mean[j]) / m.scale[j]) * m.beta[j];
      let label = labels.get(c) ?? c;
      if (c === "roast") label = tBag.roast_level ? `Röstgrad ${tBag.roast_level}` : "Röstgrad";
      if (c === "alt") label = tBag.altitude ? `Höhe ${Math.round(tBag.altitude * 1000)} m` : "Höhe";
      if (c === "day") label = day != null ? `Röstalter Tag ${day}` : "Röstalter";
      const missing = (c === "roast" && !tBag.roast_level) || (c === "alt" && tBag.altitude == null) || (c === "day" && day == null);
      return { label, effect: Math.round(effect * 100) / 100, missing, cat: !(NUM as readonly string[]).includes(c), on: x[j] === 1 };
    })
    .filter((d) => !d.missing && (!d.cat || d.on) && Math.abs(d.effect) >= step / 4)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, 3)
    .map(({ label, effect }) => ({ label, effect }));

  const value = roundGrind(raw, step);
  const spread = Math.round(cv.rmse * 100) / 100;
  return {
    ...base,
    value,
    raw: Math.round(raw * 100) / 100,
    spread,
    basis: "modell",
    per_week: perWeek,
    drivers,
    offset: comp ? Math.round(own * 10) / 10 : null,
    range: comp ? [roundGrind(value - Math.max(spread, profile!.nudge), step), roundGrind(value + Math.max(spread, profile!.nudge), step)] : withRange(value, spread),
  };
}

/** Letzter Bezug derselben Zubereitung über alle Kaffees: Dosis, Wasser, Temperatur, Zeit für einen ersten Bezug */
export function brewTemplate(method: string): BrewTemplate | null {
  const rows = db
    .prepare(
      `SELECT b.dose_g, b.water_g, b.temp_c, b.time_s, b.recipe_id, r.method AS r_method, c.roast_for
       FROM brews b JOIN coffees c ON c.id = b.coffee_id LEFT JOIN recipes r ON r.id = b.recipe_id
       ORDER BY b.brewed_at DESC LIMIT 200`,
    )
    .all() as Row[];
  const num = (v: unknown) => (v == null ? null : Number(v));
  for (const r of rows) {
    const t = { dose_g: num(r.dose_g), water_g: num(r.water_g), temp_c: num(r.temp_c), time_s: num(r.time_s), recipe_id: num(r.recipe_id) };
    if (methodKey((r.r_method as string) || null, (r.roast_for as RoastFor) ?? null, brewRatio(t)) !== method) continue;
    if (t.dose_g == null && t.water_g == null && t.temp_c == null) continue;
    return t;
  }
  return null;
}
