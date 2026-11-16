import type { ConfigView } from "./config.ts";
import type { CoffeeProfile } from "./decent-profile.ts";
import type { Scores } from "./sca.ts";
import type { ShotOverride, ShotTargets } from "./shot.ts";

export type RoastLevel = "hell" | "mittel" | "dunkel";
export type RoastFor = "filter" | "espresso" | "omni";
export type BatchStatus = "ungeoeffnet" | "offen" | "leer";

export const ROAST_LEVELS: { id: RoastLevel; label: string; color: string }[] = [
  { id: "hell", label: "Hell", color: "#D9B88A" },
  { id: "mittel", label: "Mittel", color: "#A0683C" },
  { id: "dunkel", label: "Dunkel", color: "#4B2E22" },
];

export const ROAST_FOR: { id: RoastFor; label: string }[] = [
  { id: "filter", label: "Filter" },
  { id: "espresso", label: "Espresso" },
  { id: "omni", label: "Omni" },
];

/**
 * Auswahl in der Oberfläche: „Nachgetragen“ ist Status „leer“ mit `backfilled`. Zählt überall wie aufgebraucht,
 * aber Daten (Röstdatum, geöffnet am) werden nie vorbelegt, weil sie unbekannt sind.
 */
/** Arten der Aufbereitung; Einzelheiten (Fermentation, Trocknung, Anteile) stehen im Zusatz `process_detail` */
export const PROCESS_TYPES = [
  "Gewaschen", "Natural", "Honey", "Anaerob", "Carbonic Maceration", "Wet Hulled", "Semi-Washed", "Monsooned", "Entkoffeiniert", "Mischung",
];

const PROCESS_WORDS = /\b(gewaschen|washed|natural|honey|anaerob\w*|wet hulled|semi-washed|monsooned)\b/gi;

const PROCESS_ALIASES: Record<string, string> = {
  washed: "Gewaschen",
  "fully washed": "Gewaschen",
  nass: "Gewaschen",
  "nass aufbereitet": "Gewaschen",
  "dry process": "Natural",
  trocken: "Natural",
  "trocken aufbereitet": "Natural",
  anaerobic: "Anaerob",
  "wet-hulled": "Wet Hulled",
  "giling basah": "Wet Hulled",
  "semi washed": "Semi-Washed",
  monsoon: "Monsooned",
  "monsooned malabar": "Monsooned",
  "monsuniert": "Monsooned",
  decaf: "Entkoffeiniert",
  blend: "Mischung",
};

// Röstereien: „Kaffeemacher Rösterei“, „KAFFEEMACHER“ und „Kaffeemacher GmbH“ sind dieselbe. Füllwörter zählen nur, wenn sonst nichts bleibt
const ROASTER_FILLERS = new Set([
  "rosterei", "roesterei", "kaffeerosterei", "kaffeeroesterei", "roastery", "roasters", "roaster", "roasting", "roastworks",
  "coffee", "kaffee", "cafe", "co", "company", "the", "die", "gmbh", "ug", "kg", "ek", "ohg", "ltd", "inc", "llc",
]);

/** Vergleichsschlüssel ohne Leerzeichen: ohne Füllwörter und mit allen Wörtern („Wild Kaffee“ = „Wildkaffee“) */
export function roasterKeys(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const core = words.filter((w) => !ROASTER_FILLERS.has(w));
  return [...new Set([(core.length ? core : words).join(""), words.join("")])].filter(Boolean);
}

export function sameRoaster(a: string, b: string): boolean {
  const kb = roasterKeys(b);
  return roasterKeys(a).some((k) => kb.includes(k));
}

/** Neuen Namen auf eine bekannte Rösterei abbilden; `known` nach Häufigkeit sortiert, die erste passende gewinnt */
export function matchRoaster(name: string, known: string[]): string {
  const s = name.trim().replace(/\s+/g, " ");
  if (!s) return s;
  return known.find((r) => sameRoaster(r, s)) ?? s;
}

/** Bekannte Arten in fester Schreibweise („natural“, „Washed“ → Natural, Gewaschen), damit die Statistik sie zusammenfasst */
export function canonProcess(art: string): string {
  const s = art.trim().replace(/\s+/g, " ");
  const k = s.toLowerCase();
  return PROCESS_TYPES.find((p) => p.toLowerCase() === k) ?? PROCESS_ALIASES[k] ?? s;
}

/**
 * Altbestand aufteilen: „Gewaschen (24 Std. Fermentation)“ → Gewaschen + Zusatz, mehrere Arten → Mischung,
 * „Pulped Natural“ zählt als Honey.
 */
export function splitProcess(raw: string): [string, string] {
  const s = raw.trim();
  if (!s) return ["", ""];
  const top = s.replace(/\([^)]*\)/g, "");
  const kinds = new Set((top.match(PROCESS_WORDS) ?? []).map((w) => w.toLowerCase()));
  if (kinds.size > 1 && /,|\/|\+|%/.test(top)) return ["Mischung", s];
  const m = /^([^()]+?)\s*\((.+)\)$/.exec(s);
  const [art, detail] = m ? [m[1].trim(), m[2].trim()] : [s, ""];
  if (/^pulped natural$/i.test(art)) return ["Honey", detail ? `Pulped Natural, ${detail}` : "Pulped Natural"];
  const an = /^anaerob\w*\s+(.+)$/i.exec(art);
  if (an) return ["Anaerob", [an[1].charAt(0).toUpperCase() + an[1].slice(1), detail].filter(Boolean).join(", ")];
  return [canonProcess(art), detail];
}

export type BatchChoice = BatchStatus | "nachgetragen";
export const BATCH_CHOICES: { id: BatchChoice; label: string }[] = [
  { id: "ungeoeffnet", label: "Ungeöffnet" },
  { id: "offen", label: "Offen" },
  { id: "leer", label: "Aufgebraucht" },
  { id: "nachgetragen", label: "Nachgetragen" },
];
export const choiceOf = (b: { status: BatchStatus; backfilled: boolean }): BatchChoice =>
  b.status === "leer" && b.backfilled ? "nachgetragen" : b.status;
export const fromChoice = (c: BatchChoice): { status: BatchStatus; backfilled: boolean } =>
  c === "nachgetragen" ? { status: "leer", backfilled: true } : { status: c, backfilled: false };

export const BATCH_STATUS: { id: BatchStatus; label: string }[] = [
  { id: "ungeoeffnet", label: "Ungeöffnet" },
  { id: "offen", label: "Offen" },
  { id: "leer", label: "Aufgebraucht" },
];

export const BREW_METHODS = [
  "V60",
  "Kalita Wave",
  "Chemex",
  "Origami",
  "AeroPress",
  "French Press",
  "Clever Dripper",
  "Espresso",
  "Moka",
  "Kaltaufguss",
  "Sonstiges",
] as const;

/** Zubereitung, die der Röster für den Kaffee vorschlägt (Metadatum wie der Cup Score, kein eigenes Rezept) */
export type RoasterRecipe = {
  /** kurzer Name, z. B. „V60“ oder „Espresso“ */
  title: string;
  /** eine aus BREW_METHODS */
  method: string;
  dose_g: number | null;
  /** Wasser, bei Espresso die Ausbeute in der Tasse */
  water_g: number | null;
  temp_c: number | null;
  grind: string;
  /** Gesamtzeit in Sekunden */
  time_s: number | null;
  /** Ablauf: Bloom, Aufgüsse, Tipps */
  notes: string;
};

export type CoffeeFields = {
  name: string;
  roaster: string;
  country: string;
  region: string;
  farm: string;
  producer: string;
  varieties: string[];
  /** Art der Aufbereitung, eine aus PROCESS_TYPES (frei erweiterbar) */
  process: string;
  /** Zusatz zur Aufbereitung: Fermentation, Trocknung, Anteile bei Mischungen */
  process_detail: string;
  altitude: string;
  harvest: string;
  roast_level: RoastLevel | null;
  roast_for: RoastFor | null;
  roaster_notes: string[];
  description: string;
  weight_g: number | null;
  price_eur: number | null;
  /** Cup Score laut Röster (SCA-Skala, meist 80–90), keine eigene Bewertung */
  cup_score: number | null;
  roaster_recipes: RoasterRecipe[];
  url: string;
};

export type CoffeeSource = {
  kind: "url" | "name" | "photo" | "manual";
  input: string;
  at: string;
  model?: string;
};

export type Coffee = CoffeeFields & {
  id: number;
  image: string | null;
  color: string | null;
  source: CoffeeSource | null;
  wishlist: boolean;
  archived: boolean;
  /** Espresso-Ziel dieses Kaffees, null = Standard seines Röstgrads (`shared/shot.ts`) */
  shot_target: ShotOverride | null;
  created_at: string;
  updated_at: string;
};

export type CoffeeListItem = Coffee & {
  categories: string[];
  brew_count: number;
  best_score: number | null;
  avg_score: number | null;
  /** Schnitt der Schnellbewertungen (1–5), getrennt vom SCA-Score */
  avg_rating: number | null;
  rating_count: number;
  last_brewed_at: string | null;
  status: "offen" | "vorrat" | "leer" | "neu";
  open_batch: {
    id: number;
    roast_date: string | null;
    freezes: Freeze[];
  } | null;
};

/** Charge im Lager (ungeöffnet) mit dem, was die Lager-Seite vom Kaffee braucht */
export type StockItem = Batch & {
  coffee: Pick<Coffee, "id" | "name" | "roaster" | "image" | "color" | "roast_level" | "roast_for" | "weight_g">;
};

export type Batch = {
  id: number;
  coffee_id: number;
  roast_date: string | null;
  opened_at: string | null;
  weight_g: number | null;
  price_eur: number | null;
  status: BatchStatus;
  backfilled: boolean;
  /** Zeiten im Gefrierfach (YYYY-MM-DD, `to` leer = liegt noch drin), zählen nicht zum Röstalter */
  freezes: Freeze[];
  note: string;
  created_at: string;
  brew_count: number;
};

/** Ein Aufenthalt im Gefrierfach; bei -18 °C altert der Kaffee praktisch nicht, die Tage zählen nicht mit */
export type Freeze = { from: string; to: string | null };

export type Recipe = {
  id: number;
  name: string;
  method: string;
  dose_g: number | null;
  water_g: number | null;
  temp_c: number | null;
  grind: string;
  grinder: string;
  time_s: number | null;
  notes: string;
  archived: boolean;
  created_at: string;
};

export type RecipeListItem = Recipe & { brew_count: number; avg_score: number | null; avg_rating: number | null; coffee_count: number };

/** „sca“: voller Bogen mit Score. „quick“: Kurzurteil, 1–5 Sterne freiwillig, zählt nie in SCA-Durchschnitte, Bestenliste und Statistik-Scores */
export type BrewKind = "sca" | "quick";

export const RATING_LABELS = ["", "Schlecht", "Geht so", "Gut", "Sehr gut", "Hervorragend"] as const;

/** Kurzurteil zum Bezug, für beide Bewertungsarten; die Einstellhilfe für Espresso liest es */
export type TasteTag = "ausgewogen" | "sauer" | "bitter" | "duenn" | "kraeftig";
export const TASTE_TAGS: { id: TasteTag; label: string }[] = [
  { id: "ausgewogen", label: "Ausgewogen" },
  { id: "sauer", label: "Zu sauer" },
  { id: "bitter", label: "Zu bitter" },
  { id: "duenn", label: "Zu dünn" },
  { id: "kraeftig", label: "Zu kräftig" },
];
export const TASTE_LABEL = new Map(TASTE_TAGS.map((t) => [t.id, t.label]));

type BrewBase = {
  id: number;
  coffee_id: number;
  batch_id: number | null;
  recipe_id: number | null;
  brewed_at: string;
  dose_g: number | null;
  water_g: number | null;
  temp_c: number | null;
  grind: string;
  /** Bezugszeit ohne Preinfusion */
  time_s: number | null;
  /** Preinfusion in Sekunden, getrennt von der Bezugszeit (bei Maschinen ohne: null) */
  preinfusion_s: number | null;
  taste: TasteTag[];
  flavors: string[];
  comment: string;
  /** Mahlvorgang der Mühle (Mahlkönig Sync), aus dem Dosis, Mahlgrad und ggf. Zeit und Ausbeute stammen */
  grinder_event_id: number | null;
  /** Shot der Decent DE1, aus dem Zeit und Ausbeute stammen */
  machine_shot_id: number | null;
  created_at: string;
};

export type ScaBrew = BrewBase & { kind: "sca"; scores: Scores; total: number; rating: null };
/** Sterne sind freiwillig, das Kurzurteil ist die Hauptaussage */
export type QuickBrew = BrewBase & { kind: "quick"; scores: null; total: null; rating: number | null };
export type Brew = ScaBrew | QuickBrew;

export const isSca = (b: Brew): b is ScaBrew => b.kind === "sca";

/** €/kg aus Preis und Gewicht, null wenn eins fehlt */
export function pricePerKg(price: number | null | undefined, weight: number | null | undefined): number | null {
  return price != null && weight ? (price / weight) * 1000 : null;
}

export type CoffeeDetail = {
  coffee: Coffee;
  batches: Batch[];
  brews: Brew[];
  recipes: Recipe[];
  /** Decent-Profil des Kaffees (nicht unter „Gesehen“) */
  decent_profile?: CoffeeProfile | null;
};

export type ScrapeDraft = {
  fields: CoffeeFields;
  image_urls: string[];
  uploaded_image: string | null;
  notes: string;
  source: CoffeeSource;
  sources_used: string[];
};

/** Live-Ansicht beim Auslesen: Schritte, die Claude gerade macht */
export type ScrapeStep = {
  id: string;
  kind: "page" | "photo" | "search" | "fetch" | "filter" | "write";
  label: string;
  detail: string;
  state: "run" | "ok" | "fail";
  hits?: { title: string; url: string }[];
};

/** Was save_coffee bisher geschrieben hat (Texte können mitten im Wort enden) */
export type ScrapePartial = Partial<Omit<CoffeeFields, "url" | "roaster_recipes">> & {
  image_urls?: string[];
  roaster_recipes?: Pick<RoasterRecipe, "title" | "method">[];
};

/** NDJSON-Zeilen von POST /api/scrape mit accept: application/x-ndjson */
export type ScrapeEvent =
  | ({ t: "step" } & ScrapeStep)
  | { t: "fields"; fields: ScrapePartial }
  | { t: "images"; urls: string[] }
  | { t: "done"; draft: ScrapeDraft }
  | { t: "error"; message: string; status: number; uploaded_image: string | null };

/** Auslese-Auftrag im Server (`server/scrape-jobs.ts`), läuft auch ohne offene Seite weiter */
export type ScrapeJobInput = { url: string } | { name: string } | { image: true };
export type ScrapeJob = {
  id: string;
  /** Kurz für die Anzeige: Shop-Host, Name in Anführungszeichen oder „das Foto“ */
  what: string;
  input: ScrapeJobInput;
  /** Hochgeladenes Foto (Datei unter /images) */
  photo: string | null;
  started: number;
  finished: number | null;
  state: "run" | "done" | "error";
  name: string | null;
  roaster: string | null;
  image: string | null;
  /** Gerade laufender Schritt */
  activity: string | null;
  error: string | null;
};

export type Settings = {
  api_key: { set: boolean; source: "env" | "db" | null; hint: string | null };
  model: string;
  /** Profil der eigenen Mühle für den Mahlkompass (`shared/compass.ts`) oder „andere“ */
  grinder: string;
  /** Espresso-Ziel je Röstgrad, Standard für Kaffees ohne eigenes */
  shot_targets: ShotTargets;
  mahlkoenig: GrinderSyncStatus;
  decent: DecentStatus;
  homeassistant: HaStatus;
  /** Betriebswerte (Modell, Zeitzone, Sicherung, Abgleich, HA-Erkennung, Trinkfenster) */
  config: ConfigView;
  /** Erste Schritte erledigt (oder die Bibliothek ist schon belegt) */
  onboarded: boolean;
};

/** Home Assistant: Zugang (Token geht nie raus) */
export type HaStatus = { set: boolean; source: "env" | "db" | null; url: string | null; hint: string | null };
/** Livewerte der Maschine aus Home Assistant (de1app-MQTT-Plugin); null = Entität fehlt oder ohne Wert */
export type MachineLive = {
  configured: boolean;
  /** HA erreichbar und Maschine gefunden */
  ok: boolean;
  error: string | null;
  /** Maschine meldet sich (Zustand nicht „unavailable“) */
  online: boolean;
  state: string | null;
  substate: string | null;
  profile: string | null;
  awake: boolean | null;
  steam: boolean | null;
  head_c: number | null;
  mix_c: number | null;
  steam_c: number | null;
  water_ml: number | null;
  can_power: boolean;
  can_steam: boolean;
  /** letzte Änderung des Zustands */
  changed: string | null;
  /** jüngste Meldung irgendeiner Entität der Maschine */
  updated: string | null;
  /** seit 15 min keine Meldung: Werte sind eingefroren (de1app sendet nicht an MQTT) */
  stale: boolean;
};

/** Ein Mahlvorgang aus der Mahlkönig-Sync-Cloud; Zeit und Ausbeute nur mit Sync Scale oder Brühzeiteingabe */
/** Kurve eines Shots, auf höchstens ~250 Punkte ausgedünnt: Zeit (s), Druck (bar), Fluss (ml/s), Fluss nach Gewicht (g/s),
 * Gewicht (g), Temperatur im Korb (°C) und die Sollwerte des Profils */
export type ShotCurve = { t: number[]; p: number[]; f: number[]; fw: number[]; w: number[]; tb: number[]; pg: number[]; fg: number[] };

export type MachineShot = {
  id: number;
  shot_at: string;
  profile: string;
  beverage: string;
  dose_g: number | null;
  yield_g: number | null;
  /** Gesamtzeit laut de1app, mit Preinfusion */
  time_s: number | null;
  /** Preinfusion (bis zum ersten Schritt danach), 0 = Profil ohne; null = unbekannt */
  preinfusion_s: number | null;
  /** Solltemperatur des Profils (Median über den Shot) */
  temp_c: number | null;
  peak_bar: number | null;
  /** Mahlgrad, wie in der de1app eingetragen */
  grind: string;
  bean: string;
  brew_id: number | null;
  brew_coffee_id: number | null;
  brew_coffee: string | null;
};
export type MachineShotDetail = MachineShot & { curve: ShotCurve };
/** Archiv der de1app (alle Dateien aus history/, history_v2/ und den Profilen); `shots` zählt Zeitpunkte, nicht Dateien */
export type DecentArchive = { shots: number; profiles: number; first_shot: string | null; last_upload: string | null };
export type DecentStatus = { shots: number; last_shot: string | null; last_profile: string | null; archive: DecentArchive };

export type GrinderEvent = {
  id: number;
  ground_at: string;
  device: string;
  /** Scheibenabstand in µm, wie der Mahlgrad am Display */
  grind_um: number | null;
  grind_target_um: number | null;
  dose_g: number | null;
  dose_target_g: number | null;
  grind_s: number | null;
  recipe_index: number | null;
  recipe_mode: string;
  brew_time_target_s: number | null;
  brewed_at: string | null;
  yield_g: number | null;
  shot_s: number | null;
  quality: string;
  /** Bezug, der diesen Mahlvorgang nutzt */
  brew_id: number | null;
  brew_coffee_id: number | null;
  brew_coffee: string | null;
};

/** Bezug für die Übersicht „Bezüge“ (alle Kaffees): mit Kaffee, Rezept, Mahlvorgang und Shot, über die er zugeordnet ist */
export type BrewLogEntry = Brew & {
  coffee: { id: number; name: string; roaster: string };
  recipe: Recipe | null;
  grinder: Pick<GrinderEvent, "id" | "ground_at" | "grind_um" | "grind_target_um" | "dose_g" | "dose_target_g" | "grind_s"> | null;
  shot: Pick<MachineShot, "id" | "shot_at" | "profile" | "time_s" | "yield_g" | "temp_c" | "peak_bar"> | null;
};
/** Alle Bezüge und die Mahlvorgänge der letzten 90 Tage, die keinem Bezug gehören */
export type BrewLog = { brews: BrewLogEntry[]; free_events: GrinderEvent[] };

export type GrinderSyncStatus = {
  /** Cloud oder Mühle im Heimnetz eingerichtet */
  set: boolean;
  /** Cloud-Zugang hinterlegt */
  cloud: boolean;
  source: "env" | "db" | null;
  email: string | null;
  store_id: number | null;
  /** letzter erfolgreicher Abgleich (seit Serverstart) */
  last_sync: string | null;
  last_error: string | null;
  events: number;
  last_event: string | null;
  /** Mühle im Heimnetz (Adresse wie https://192.168.1.50), Abgleich und Fehler seit Serverstart */
  local_host: string | null;
  local_source: "env" | "db" | null;
  local_sync: string | null;
  local_error: string | null;
};

export type Stats = {
  coffees: number;
  brews: number;
  /** nur SCA-Bögen */
  avg_score: number | null;
  /** nur Schnellbewertungen */
  quick: { count: number; avg: number | null };
  best: { id: number; name: string; roaster: string; score: number } | null;
  by_country: { label: string; count: number; avg: number | null }[];
  by_process: { label: string; count: number; avg: number | null }[];
  by_roast: { label: string; count: number; avg: number | null }[];
  by_method: { label: string; count: number; avg: number | null }[];
  by_month: { month: string; brews: number; avg: number | null }[];
  top: { id: number; name: string; roaster: string; score: number; brews: number }[];
  grams_used: number;
  costs: CostStats;
};

/** Ausgaben aus Preis und Gewicht der Chargen; nachgetragene zählen nicht bei den Monaten (Datum unbekannt) */
export type CostStats = {
  /** Summe aller Chargen mit Preis */
  spent: number;
  batches_priced: number;
  /** gewichtet über alle Chargen mit Preis und Gewicht */
  per_kg: number | null;
  /** Schnitt über Bezüge mit Dosis und bekanntem €/kg */
  per_cup: number | null;
  cups_priced: number;
  /** letzte 12 Monate nach Röstdatum (sonst Anlegedatum) */
  by_month: { month: string; spent: number; batches: number }[];
  by_roaster: { label: string; per_kg: number; batches: number; avg: number | null }[];
  /** je Kaffee €/kg gegen Ø SCA-Score */
  value: { id: number; name: string; roaster: string; per_kg: number; avg: number }[];
};

export type BrewInput = {
  coffee_id: number;
  batch_id: number | null;
  recipe_id: number | null;
  brewed_at: string;
  dose_g: number | null;
  water_g: number | null;
  temp_c: number | null;
  grind: string;
  time_s: number | null;
  preinfusion_s?: number | null;
  kind: BrewKind;
  scores: Scores | null;
  rating: number | null;
  taste: TasteTag[];
  flavors: string[];
  comment: string;
  grinder_event_id?: number | null;
  machine_shot_id?: number | null;
};

export function emptyCoffeeFields(): CoffeeFields {
  return {
    name: "",
    roaster: "",
    country: "",
    region: "",
    farm: "",
    producer: "",
    varieties: [],
    process: "",
    process_detail: "",
    altitude: "",
    harvest: "",
    roast_level: null,
    roast_for: null,
    roaster_notes: [],
    description: "",
    weight_g: null,
    price_eur: null,
    cup_score: null,
    roaster_recipes: [],
    url: "",
  };
}

const FLAGS: Record<string, string> = {
  äthiopien: "🇪🇹", kenia: "🇰🇪", kolumbien: "🇨🇴", brasilien: "🇧🇷", ruanda: "🇷🇼", burundi: "🇧🇮",
  guatemala: "🇬🇹", "costa rica": "🇨🇷", honduras: "🇭🇳", "el salvador": "🇸🇻", nicaragua: "🇳🇮",
  panama: "🇵🇦", mexiko: "🇲🇽", peru: "🇵🇪", bolivien: "🇧🇴", ecuador: "🇪🇨", indonesien: "🇮🇩",
  jemen: "🇾🇪", indien: "🇮🇳", tansania: "🇹🇿", uganda: "🇺🇬", "demokratische republik kongo": "🇨🇩", kongo: "🇨🇩",
  "papua-neuguinea": "🇵🇬", vietnam: "🇻🇳", china: "🇨🇳", thailand: "🇹🇭", laos: "🇱🇦", myanmar: "🇲🇲",
  "osttimor": "🇹🇱", "timor-leste": "🇹🇱", jamaika: "🇯🇲", "dominikanische republik": "🇩🇴", haiti: "🇭🇹", kuba: "🇨🇺",
  hawaii: "🇺🇸", usa: "🇺🇸", malawi: "🇲🇼", sambia: "🇿🇲", simbabwe: "🇿🇼", kamerun: "🇨🇲", australien: "🇦🇺",
  philippinen: "🇵🇭", taiwan: "🇹🇼", nepal: "🇳🇵", venezuela: "🇻🇪", italien: "🇮🇹",
};

export function countryFlag(country: string): string {
  return FLAGS[country.trim().toLowerCase()] ?? "🌍";
}

/** ISO-3166-Code (zwei Buchstaben) zu einem bekannten Ländernamen, aus der Flagge abgeleitet; sonst null */
export function countryCode(country: string): string | null {
  const flag = FLAGS[country.trim().toLowerCase()];
  if (!flag) return null;
  return [...flag].map((ch) => String.fromCharCode(ch.codePointAt(0)! - 0x1f1e6 + 65)).join("");
}

/**
 * Kalendertag eines Datums oder Zeitpunkts: reine Daten bleiben, Zeitpunkte (UTC-ISO) zählen in der Ortszeit (Browser bzw. TZ des
 * Servers). Sonst wäre ein Bezug um 0:30 noch der Vortag
 */
export function localDay(iso: string): string {
  if (iso.length <= 10 || !iso.includes("T")) return iso.slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(fromIso: string | null, toIso: string): number | null {
  if (!fromIso) return null;
  const a = Date.parse(localDay(fromIso));
  const b = Date.parse(localDay(toIso));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Tage im Gefrierfach bis `at` (Tage; ein offener Aufenthalt zählt bis `at`) */
export function frozenDays(freezes: readonly Freeze[] | undefined, at: string): number {
  let n = 0;
  const end = localDay(at);
  for (const f of freezes ?? []) {
    const to = f.to && f.to < end ? f.to : end;
    n += Math.max(0, daysBetween(f.from, to) ?? 0);
  }
  return n;
}

/** Liegt die Tüte gerade im Gefrierfach? */
export const isFrozen = (b: { freezes?: readonly Freeze[] }): boolean => (b.freezes ?? []).some((f) => !f.to);

/** Seit wann sie gerade eingefroren ist */
export const frozenSince = (b: { freezes?: readonly Freeze[] }): string | null => (b.freezes ?? []).find((f) => !f.to)?.from ?? null;

/**
 * Alter einer Tüte in Tagen bei `at`: Tage seit Röstung ohne die Tage im Gefrierfach. Überall statt `daysBetween(roast_date, …)` nehmen,
 * wo es um das Altern des Kaffees geht (Trinkfenster, „Tag N“, Mahlgrad-Modell)
 */
export function bagAge(b: { roast_date: string | null; freezes?: readonly Freeze[] }, at: string): number | null {
  const d = daysBetween(b.roast_date, at);
  return d == null ? null : d - frozenDays(b.freezes, at);
}

/** Vorschlag von Claude für „Was passt zu mir?“ */
export type Suggestion = {
  name: string;
  roaster: string;
  url: string;
  country: string;
  process: string;
  varieties: string[];
  roast_level: RoastLevel | null;
  price_eur: number | null;
  weight_g: number | null;
  notes: string[];
  /** warum er passt, auf Deutsch, Bezug aufs Profil */
  reason: string;
};

export type Recommendations = { at: string; model: string; hint: string; headline: string[]; items: Suggestion[] };

/** NDJSON-Zeilen von POST /api/recommend */
export type RecommendEvent =
  | { t: "step"; label: string; detail: string }
  | { t: "ping" }
  | { t: "done"; result: Recommendations }
  | { t: "error"; message: string; status: number };
