import { bagAge, frozenDays, isFrozen, type Freeze, type RoastFor, type RoastLevel } from "./types.ts";

export type DrinkWindow = { ready: number; peak: number; end: number };

/**
 * Trinkfenster ab Röstdatum in Tagen je „Geröstet für“ und Röstgrad: ab `ready` trinkbereit, bestes Fenster bis `peak`, danach noch gut
 * bis `end` (verschlossen bzw. im Hopper, ohne eigene Regel fürs Öffnen), dann wird der Kaffee allmählich flacher.
 * Quellen (Stand 11/2026): Simon & Bearns (Ruhe nach Röstgrad), Partners Coffee, Tim Wendelboe, La Cabra, Scott Rao, Hoffmann (4–8 Wochen
 * je nach Röstgrad). Omni liegt zwischen Filter und Espresso, mittel wie Wildkaffee (7–30 Tage). „Noch gut bis“ hängt nur vom Röstgrad ab.
 * Werte wie im Wiki-Artikel „Ruhezeit“, beides zusammen pflegen.
 */
export const DRINK_WINDOWS: Record<RoastFor, Record<RoastLevel, DrinkWindow>> = {
  filter: {
    hell: { ready: 7, peak: 35, end: 70 },
    mittel: { ready: 5, peak: 28, end: 56 },
    dunkel: { ready: 3, peak: 14, end: 35 },
  },
  omni: {
    hell: { ready: 10, peak: 38, end: 70 },
    mittel: { ready: 7, peak: 30, end: 56 },
    dunkel: { ready: 4, peak: 18, end: 35 },
  },
  espresso: {
    hell: { ready: 14, peak: 42, end: 70 },
    mittel: { ready: 9, peak: 30, end: 56 },
    dunkel: { ready: 5, peak: 21, end: 35 },
  },
};

/** So viele Tage vor dem Ende heißt es „Bald aufbrauchen“ */
export const SOON_DAYS = 7;

/** Was für eine Bewertung fehlt, in der Reihenfolge der Anzeige */
export type Missing = "Röstdatum" | "Geröstet für" | "Röstgrad";

export type Freshness =
  | { state: "unbekannt"; missing: Missing[] }
  | {
      state: "ruht" | "hoch" | "spaet" | "flach";
      /** Alter: Tage seit Röstung ohne die Tage im Gefrierfach */
      day: number;
      /** Tage im Gefrierfach bis heute */
      frozen: number;
      /** liegt gerade im Gefrierfach: das Alter steht, Daten gelten „wenn heute aufgetaut“ */
      frozenNow: boolean;
      ready: number;
      peak: number;
      end: number;
      /** Ende als Datum (YYYY-MM-DD), um die Gefriertage verschoben */
      endDate: string;
      /** Datum, an dem die Tüte Tag `d` erreicht (Röstung + d + Gefriertage bis heute) */
      dateOf: (d: number) => string;
    };

export const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso.slice(0, 10)) + n * 86_400_000).toISOString().slice(0, 10);

/** Ohne Röstdatum, „Geröstet für“ oder Röstgrad gibt es keine Bewertung, auch keine geratene */
export function freshness(
  b: { roast_date: string | null; freezes?: readonly Freeze[] },
  coffee: { roast_for: RoastFor | null; roast_level: RoastLevel | null },
  today: string,
  /** eigene Fenster aus den Einstellungen (`config.drink_windows`), sonst die recherchierten */
  windows: Record<RoastFor, Record<RoastLevel, DrinkWindow>> = DRINK_WINDOWS,
): Freshness {
  const day = bagAge(b, today);
  const missing: Missing[] = [];
  if (day == null) missing.push("Röstdatum");
  if (!coffee.roast_for) missing.push("Geröstet für");
  if (!coffee.roast_level) missing.push("Röstgrad");
  if (day == null || !coffee.roast_for || !coffee.roast_level) return { state: "unbekannt", missing };
  const w = windows[coffee.roast_for][coffee.roast_level];
  const state = day < w.ready ? "ruht" : day <= w.peak ? "hoch" : day <= w.end ? "spaet" : "flach";
  const frozen = frozenDays(b.freezes, today);
  const frozenNow = isFrozen(b);
  // Eingefroren: ab heute rechnen, als würde sie heute aufgetaut (sonst lägen die Daten in der Vergangenheit)
  const dateOf = (d: number) => (frozenNow ? addDays(today, d - day) : addDays(b.roast_date!, d + frozen));
  return { state, day, frozen, frozenNow, ...w, endDate: dateOf(w.end), dateOf };
}

/** Kurz vor dem Ende oder schon jenseits davon: sollte bald weg */
export const isSoon = (f: Freshness): boolean =>
  f.state !== "unbekannt" && !f.frozenNow && (f.state === "flach" || (f.state === "spaet" && f.end - f.day <= SOON_DAYS));

/** Kurzform des Zustands, für Lager-Karten und die Kennzahl am Kaffee */
export function freshnessLabel(f: Freshness): string {
  if (f.state !== "unbekannt" && f.frozenNow) return "Eingefroren";
  switch (f.state) {
    case "ruht":
      return f.ready - f.day === 1 ? "Ruht noch 1 Tag" : `Ruht noch ${f.ready - f.day} Tage`;
    case "hoch":
      return "Bestes Fenster";
    case "spaet":
      return isSoon(f) ? "Bald aufbrauchen" : "Nach dem Hoch";
    case "flach":
      return "Wird flacher";
    default:
      return "Nicht bewertbar";
  }
}

/**
 * Reihenfolge zum Aufbrauchen: wer zuerst aus dem besten Fenster fällt, zuerst (schon darüber hinaus ganz oben), bei Gleichstand das
 * frühere Ende; eingefrorene danach, nicht bewertbare am Ende
 */
export function byUrgency(a: Freshness, b: Freshness): number {
  // Eingefrorene altern nicht: nach den offenen Fristen, vor den nicht bewertbaren
  const rank = (f: Freshness) => (f.state === "unbekannt" ? 2 : f.frozenNow ? 1 : 0);
  if (rank(a) !== rank(b) || a.state === "unbekannt" || b.state === "unbekannt") return rank(a) - rank(b);
  return a.peak - a.day - (b.peak - b.day) || a.end - a.day - (b.end - b.day);
}

/**
 * Auftauzeit einer geschlossenen Tüte bei Raumtemperatur nach Gewicht, bis der Kern Raumtemperatur hat (vorher öffnen zieht
 * Kondenswasser in die Bohnen). Faustwerte: 250 g gut 2 h, 350 g 3–4 h, 1 kg einen halben Tag
 */
export function thawTime(g: number | null): string {
  if (g == null || g <= 0) return "2–4 h";
  if (g <= 150) return "1–2 h";
  if (g <= 300) return "2–3 h";
  if (g <= 500) return "3–4 h";
  if (g <= 750) return "4–6 h";
  return "6–8 h";
}
