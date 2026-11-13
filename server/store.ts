import type { SQLInputValue } from "node:sqlite";
import type { z } from "zod";
import { db, tx } from "./db.ts";
import type {
  Batch,
  Brew,
  BrewLog,
  BrewLogEntry,
  Coffee,
  CostStats,
  CoffeeDetail,
  CoffeeListItem,
  Recipe,
  RecipeListItem,
  Stats,
  StockItem,
} from "../shared/types.ts";
import { canonProcess, matchRoaster } from "../shared/types.ts";
import { parseShotOverride } from "../shared/shot.ts";
import { categoriesForNotes, FLAVOR_BY_ID } from "../shared/flavors.ts";
import { clampScores, totalScore } from "../shared/sca.ts";
import type {
  batchInputSchema,
  brewInputSchema,
  coffeeInputSchema,
  coffeePatchSchema,
  recipeInputSchema,
} from "./schemas.ts";

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const now = () => new Date().toISOString();

function mapCoffee(r: Row): Coffee {
  return {
    id: Number(r.id),
    name: String(r.name),
    roaster: String(r.roaster),
    country: String(r.country),
    region: String(r.region),
    farm: String(r.farm),
    producer: String(r.producer),
    varieties: json(r.varieties, []),
    process: String(r.process),
    process_detail: String(r.process_detail ?? ""),
    altitude: String(r.altitude),
    harvest: String(r.harvest),
    roast_level: (r.roast_level as Coffee["roast_level"]) ?? null,
    roast_for: (r.roast_for as Coffee["roast_for"]) ?? null,
    roaster_notes: json(r.roaster_notes, []),
    description: String(r.description),
    weight_g: numOrNull(r.weight_g),
    price_eur: numOrNull(r.price_eur),
    cup_score: numOrNull(r.cup_score),
    roaster_recipes: json(r.roaster_recipes, []),
    url: String(r.url),
    image: (r.image as string) ?? null,
    color: (r.color as string) ?? null,
    source: json(r.source, null),
    wishlist: Boolean(r.wishlist),
    archived: Boolean(r.archived),
    shot_target: parseShotOverride(r.shot_target),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function mapBatch(r: Row): Batch {
  return {
    id: Number(r.id),
    coffee_id: Number(r.coffee_id),
    roast_date: (r.roast_date as string) ?? null,
    opened_at: (r.opened_at as string) ?? null,
    weight_g: numOrNull(r.weight_g),
    price_eur: numOrNull(r.price_eur),
    status: r.status as Batch["status"],
    backfilled: Boolean(r.backfilled),
    note: String(r.note),
    created_at: String(r.created_at),
    brew_count: Number(r.brew_count ?? 0),
  };
}

function mapRecipe(r: Row): Recipe {
  return {
    id: Number(r.id),
    name: String(r.name),
    method: String(r.method),
    dose_g: numOrNull(r.dose_g),
    water_g: numOrNull(r.water_g),
    temp_c: numOrNull(r.temp_c),
    grind: String(r.grind),
    grinder: String(r.grinder),
    time_s: numOrNull(r.time_s),
    notes: String(r.notes),
    archived: Boolean(r.archived),
    created_at: String(r.created_at),
  };
}

function mapBrew(r: Row): Brew {
  const base = {
    id: Number(r.id),
    coffee_id: Number(r.coffee_id),
    batch_id: numOrNull(r.batch_id),
    recipe_id: numOrNull(r.recipe_id),
    brewed_at: String(r.brewed_at),
    dose_g: numOrNull(r.dose_g),
    water_g: numOrNull(r.water_g),
    temp_c: numOrNull(r.temp_c),
    grind: String(r.grind),
    time_s: numOrNull(r.time_s),
    preinfusion_s: numOrNull(r.preinfusion_s),
    taste: json(r.taste, []),
    flavors: json(r.flavors, []),
    comment: String(r.comment),
    grinder_event_id: numOrNull(r.grinder_event_id),
    machine_shot_id: numOrNull(r.machine_shot_id),
    created_at: String(r.created_at),
  };
  return r.kind === "quick"
    ? { ...base, kind: "quick", scores: null, total: null, rating: r.rating == null ? null : Number(r.rating) }
    : { ...base, kind: "sca", scores: clampScores(json(r.scores, {})), total: Number(r.total), rating: null };
}

// ---------- Kaffees ----------

/** Ungeöffnete Chargen ohne nachgetragene (offene stehen unter „Gerade offen“); Sortierung nach Trinkfenster macht die Oberfläche */
export function listStock(): StockItem[] {
  const rows = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM brews b WHERE b.batch_id = t.id) AS brew_count,
         c.name AS c_name, c.roaster AS c_roaster, c.image AS c_image, c.color AS c_color, c.roast_level AS c_roast_level, c.roast_for AS c_roast_for
       FROM batches t JOIN coffees c ON c.id = t.coffee_id
       WHERE t.status = 'ungeoeffnet' AND t.backfilled = 0
       ORDER BY t.roast_date, t.id`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    ...mapBatch(r),
    coffee: {
      id: Number(r.coffee_id),
      name: String(r.c_name),
      roaster: String(r.c_roaster),
      image: (r.c_image as string) ?? null,
      color: (r.c_color as string) ?? null,
      roast_level: (r.c_roast_level as StockItem["coffee"]["roast_level"]) ?? null,
      roast_for: (r.c_roast_for as StockItem["coffee"]["roast_for"]) ?? null,
    },
  }));
}

export function listCoffees(): CoffeeListItem[] {
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM brews b WHERE b.coffee_id = c.id) AS brew_count,
         (SELECT MAX(total) FROM brews b WHERE b.coffee_id = c.id) AS best_score,
         (SELECT AVG(total) FROM brews b WHERE b.coffee_id = c.id) AS avg_score,
         (SELECT AVG(rating) FROM brews b WHERE b.coffee_id = c.id) AS avg_rating,
         (SELECT COUNT(rating) FROM brews b WHERE b.coffee_id = c.id) AS rating_count,
         (SELECT MAX(brewed_at) FROM brews b WHERE b.coffee_id = c.id) AS last_brewed_at,
         (SELECT COUNT(*) FROM batches t WHERE t.coffee_id = c.id) AS batch_count,
         (SELECT COUNT(*) FROM batches t WHERE t.coffee_id = c.id AND t.status = 'offen') AS open_count,
         (SELECT COUNT(*) FROM batches t WHERE t.coffee_id = c.id AND t.status = 'ungeoeffnet') AS sealed_count
       FROM coffees c
       ORDER BY c.updated_at DESC`,
    )
    .all() as Row[];

  const openBatches = db
    .prepare(
      `SELECT t.id, t.coffee_id, t.roast_date
       FROM batches t WHERE t.status = 'offen'
       ORDER BY t.roast_date DESC, t.id DESC`,
    )
    .all() as Row[];
  const openByCoffee = new Map<number, Row>();
  for (const b of openBatches) if (!openByCoffee.has(Number(b.coffee_id))) openByCoffee.set(Number(b.coffee_id), b);

  const brewFlavors = db.prepare(`SELECT coffee_id, flavors FROM brews`).all() as Row[];
  const flavorCats = new Map<number, Set<string>>();
  for (const b of brewFlavors) {
    const set = flavorCats.get(Number(b.coffee_id)) ?? new Set<string>();
    for (const id of json<string[]>(b.flavors, [])) {
      const n = FLAVOR_BY_ID.get(id);
      if (n && n.category !== "sonstiges") set.add(n.category);
    }
    flavorCats.set(Number(b.coffee_id), set);
  }

  return rows.map((r) => {
    const c = mapCoffee(r);
    const ob = openByCoffee.get(c.id);
    const cats = new Set(categoriesForNotes(c.roaster_notes));
    for (const x of flavorCats.get(c.id) ?? []) cats.add(x);
    const status: CoffeeListItem["status"] =
      Number(r.open_count) > 0
        ? "offen"
        : Number(r.sealed_count) > 0
          ? "vorrat"
          : Number(r.batch_count) > 0
            ? "leer"
            : "neu";
    return {
      ...c,
      categories: [...cats],
      brew_count: Number(r.brew_count),
      best_score: numOrNull(r.best_score),
      avg_score: r.avg_score == null ? null : Math.round(Number(r.avg_score) * 100) / 100,
      avg_rating: r.avg_rating == null ? null : Math.round(Number(r.avg_rating) * 10) / 10,
      rating_count: Number(r.rating_count),
      last_brewed_at: (r.last_brewed_at as string) ?? null,
      status,
      open_batch: ob
        ? {
            id: Number(ob.id),
            roast_date: (ob.roast_date as string) ?? null,
          }
        : null,
    };
  });
}

export function getCoffee(id: number): CoffeeDetail | null {
  const r = db.prepare(`SELECT * FROM coffees WHERE id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  const batches = (
    db
      .prepare(
        `SELECT t.*,
           (SELECT COUNT(*) FROM brews b WHERE b.batch_id = t.id) AS brew_count
         FROM batches t WHERE t.coffee_id = ?
         ORDER BY t.roast_date DESC, t.id DESC`,
      )
      .all(id) as Row[]
  ).map(mapBatch);
  const brews = (
    db.prepare(`SELECT * FROM brews WHERE coffee_id = ? ORDER BY brewed_at DESC, id DESC`).all(id) as Row[]
  ).map(mapBrew);
  const recipeIds = [...new Set(brews.map((b) => b.recipe_id).filter((x): x is number => x != null))];
  const recipes = recipeIds.length
    ? (
        db
          .prepare(`SELECT * FROM recipes WHERE id IN (${recipeIds.map(() => "?").join(",")})`)
          .all(...recipeIds) as Row[]
      ).map(mapRecipe)
    : [];
  return { coffee: mapCoffee(r), batches, brews, recipes };
}

type CoffeeInput = z.infer<typeof coffeeInputSchema>;

/** Röstereien im Bestand, häufigste zuerst (bei Gleichstand die kürzere Schreibweise) */
export function knownRoasters(): string[] {
  return (
    db.prepare(`SELECT roaster FROM coffees WHERE roaster != '' GROUP BY roaster ORDER BY COUNT(*) DESC, LENGTH(roaster), roaster`).all() as {
      roaster: string;
    }[]
  ).map((r) => r.roaster);
}

function coffeeParams(c: CoffeeInput): Record<string, SQLInputValue> {
  return {
    name: c.name,
    roaster: matchRoaster(c.roaster, knownRoasters()),
    country: c.country,
    region: c.region,
    farm: c.farm,
    producer: c.producer,
    varieties: JSON.stringify(c.varieties),
    process: canonProcess(c.process),
    process_detail: c.process_detail,
    altitude: c.altitude,
    harvest: c.harvest,
    roast_level: c.roast_level,
    roast_for: c.roast_for,
    roaster_notes: JSON.stringify(c.roaster_notes),
    description: c.description,
    weight_g: c.weight_g,
    price_eur: c.price_eur,
    cup_score: c.cup_score,
    roaster_recipes: JSON.stringify(c.roaster_recipes),
    url: c.url,
    image: c.image,
    color: c.color,
    source: c.source ? JSON.stringify(c.source) : null,
    wishlist: c.wishlist ? 1 : 0,
    archived: c.archived ? 1 : 0,
  };
}

const COFFEE_COLS = [
  "name", "roaster", "country", "region", "farm", "producer", "varieties", "process", "process_detail", "altitude",
  "harvest",
  "roast_level", "roast_for", "roaster_notes", "description", "weight_g", "price_eur", "cup_score", "roaster_recipes", "url", "image",
  "color",
  "source", "wishlist", "archived",
];

export function createCoffee(c: CoffeeInput): number {
  return tx(() => {
    const res = db
      .prepare(
        `INSERT INTO coffees (${COFFEE_COLS.join(", ")}) VALUES (${COFFEE_COLS.map((k) => ":" + k).join(", ")})`,
      )
      .run(coffeeParams(c));
    const id = Number(res.lastInsertRowid);
    if (c.first_batch) {
      db.prepare(
        `INSERT INTO batches (coffee_id, roast_date, opened_at, weight_g, price_eur, status, backfilled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        c.first_batch.roast_date,
        c.first_batch.status === "offen" ? now().slice(0, 10) : null,
        c.first_batch.weight_g ?? c.weight_g,
        c.first_batch.price_eur ?? c.price_eur,
        c.first_batch.status,
        backfilledFlag(c.first_batch),
      );
    }
    return id;
  });
}

export function updateCoffee(id: number, c: CoffeeInput): boolean {
  const cols = COFFEE_COLS.filter((k) => k !== "source");
  const p = coffeeParams(c);
  delete p.source;
  const res = db
    .prepare(`UPDATE coffees SET ${cols.map((k) => `${k} = :${k}`).join(", ")}, updated_at = :now WHERE id = :id`)
    .run({ ...p, now: now(), id });
  return Number(res.changes) > 0;
}

export function patchCoffee(id: number, p: z.infer<typeof coffeePatchSchema>): boolean {
  const sets: string[] = [];
  const params: Record<string, SQLInputValue> = { id };
  if (p.wishlist !== undefined) {
    sets.push("wishlist = :wishlist");
    params.wishlist = p.wishlist ? 1 : 0;
  }
  if (p.archived !== undefined) {
    sets.push("archived = :archived");
    params.archived = p.archived ? 1 : 0;
  }
  if (p.color !== undefined) {
    sets.push("color = :color");
    params.color = p.color;
  }
  if (p.shot_target !== undefined) {
    sets.push("shot_target = :shot_target");
    const o = parseShotOverride(p.shot_target);
    params.shot_target = o ? JSON.stringify(o) : null;
  }
  if (!sets.length) return true;
  const res = db.prepare(`UPDATE coffees SET ${sets.join(", ")} WHERE id = :id`).run(params);
  return Number(res.changes) > 0;
}

export function deleteCoffee(id: number): string | null | false {
  const r = db.prepare(`SELECT image FROM coffees WHERE id = ?`).get(id) as Row | undefined;
  if (!r) return false;
  db.prepare(`DELETE FROM coffees WHERE id = ?`).run(id);
  return (r.image as string) ?? null;
}

export function imageInUse(file: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM coffees WHERE image = ?`).get(file));
}

function touchCoffee(id: number) {
  db.prepare(`UPDATE coffees SET updated_at = ? WHERE id = ?`).run(now(), id);
}

// ---------- Chargen ----------

type BatchInput = z.infer<typeof batchInputSchema>;

/** Nachgetragen gibt es nur bei aufgebrauchten Chargen */
const backfilledFlag = (b: { status: string; backfilled: boolean }) => (b.status === "leer" && b.backfilled ? 1 : 0);

export function createBatch(coffeeId: number, b: BatchInput): number | null {
  if (!db.prepare(`SELECT 1 FROM coffees WHERE id = ?`).get(coffeeId)) return null;
  const res = db
    .prepare(
      `INSERT INTO batches (coffee_id, roast_date, opened_at, weight_g, price_eur, status, backfilled, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(coffeeId, b.roast_date, b.opened_at, b.weight_g, b.price_eur, b.status, backfilledFlag(b), b.note);
  // Eine Charge heißt: gekauft, also nicht mehr nur auf der Merkliste.
  db.prepare(`UPDATE coffees SET wishlist = 0 WHERE id = ?`).run(coffeeId);
  touchCoffee(coffeeId);
  return Number(res.lastInsertRowid);
}

export function updateBatch(id: number, b: BatchInput): boolean {
  const res = db
    .prepare(
      `UPDATE batches SET roast_date = ?, opened_at = ?, weight_g = ?, price_eur = ?, status = ?, backfilled = ?, note = ?
       WHERE id = ?`,
    )
    .run(b.roast_date, b.opened_at, b.weight_g, b.price_eur, b.status, backfilledFlag(b), b.note, id);
  return Number(res.changes) > 0;
}

export function deleteBatch(id: number): boolean {
  return Number(db.prepare(`DELETE FROM batches WHERE id = ?`).run(id).changes) > 0;
}

// ---------- Rezepte ----------

type RecipeInput = z.infer<typeof recipeInputSchema>;

export function listRecipes(): RecipeListItem[] {
  const rows = db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM brews b WHERE b.recipe_id = r.id) AS brew_count,
         (SELECT AVG(total) FROM brews b WHERE b.recipe_id = r.id) AS avg_score,
         (SELECT AVG(rating) FROM brews b WHERE b.recipe_id = r.id) AS avg_rating,
         (SELECT COUNT(DISTINCT coffee_id) FROM brews b WHERE b.recipe_id = r.id) AS coffee_count
       FROM recipes r ORDER BY r.archived, r.name COLLATE NOCASE`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    ...mapRecipe(r),
    brew_count: Number(r.brew_count),
    avg_score: r.avg_score == null ? null : Math.round(Number(r.avg_score) * 100) / 100,
    avg_rating: r.avg_rating == null ? null : Math.round(Number(r.avg_rating) * 10) / 10,
    coffee_count: Number(r.coffee_count),
  }));
}

export function createRecipe(r: RecipeInput): number {
  const res = db
    .prepare(
      `INSERT INTO recipes (name, method, dose_g, water_g, temp_c, grind, grinder, time_s, notes, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.name, r.method, r.dose_g, r.water_g, r.temp_c, r.grind, r.grinder, r.time_s, r.notes, r.archived ? 1 : 0);
  return Number(res.lastInsertRowid);
}

export function updateRecipe(id: number, r: RecipeInput): boolean {
  const res = db
    .prepare(
      `UPDATE recipes SET name = ?, method = ?, dose_g = ?, water_g = ?, temp_c = ?, grind = ?, grinder = ?,
         time_s = ?, notes = ?, archived = ? WHERE id = ?`,
    )
    .run(r.name, r.method, r.dose_g, r.water_g, r.temp_c, r.grind, r.grinder, r.time_s, r.notes, r.archived ? 1 : 0, id);
  return Number(res.changes) > 0;
}

export function deleteRecipe(id: number): boolean {
  return Number(db.prepare(`DELETE FROM recipes WHERE id = ?`).run(id).changes) > 0;
}

// ---------- Bezüge ----------

type BrewInput = z.infer<typeof brewInputSchema>;

function brewParams(b: BrewInput) {
  const scores = b.kind === "sca" && b.scores ? clampScores(b.scores) : null;
  const flavors = [...new Set(b.flavors.filter((f) => FLAVOR_BY_ID.has(f)))];
  // „Ausgewogen“ schließt die Abweichungen aus
  const taste = b.taste.includes("ausgewogen") ? ["ausgewogen"] : [...new Set(b.taste)];
  return [
    b.coffee_id,
    b.batch_id,
    b.recipe_id,
    b.brewed_at,
    b.dose_g,
    b.water_g,
    b.temp_c,
    b.grind,
    b.time_s,
    b.preinfusion_s ?? null,
    scores ? "sca" : "quick",
    scores ? JSON.stringify(scores) : null,
    scores ? totalScore(scores) : null,
    scores ? null : b.rating,
    JSON.stringify(taste),
    JSON.stringify(flavors),
    b.comment,
    b.grinder_event_id ?? null,
    b.machine_shot_id ?? null,
  ] as SQLInputValue[];
}

function checkBrewRefs(b: BrewInput): string | null {
  if (!db.prepare(`SELECT 1 FROM coffees WHERE id = ?`).get(b.coffee_id)) return "Kaffee nicht gefunden";
  if (b.batch_id != null && !db.prepare(`SELECT 1 FROM batches WHERE id = ? AND coffee_id = ?`).get(b.batch_id, b.coffee_id))
    return "Charge gehört nicht zu diesem Kaffee";
  if (b.recipe_id != null && !db.prepare(`SELECT 1 FROM recipes WHERE id = ?`).get(b.recipe_id)) return "Rezept nicht gefunden";
  if (b.grinder_event_id != null && !db.prepare(`SELECT 1 FROM grinder_events WHERE id = ?`).get(b.grinder_event_id)) return "Mahlvorgang nicht gefunden";
  if (b.machine_shot_id != null && !db.prepare(`SELECT 1 FROM machine_shots WHERE id = ?`).get(b.machine_shot_id)) return "Shot der Maschine nicht gefunden";
  return null;
}

/** Ein Mahlvorgang gehört zu höchstens einem Bezug: beim Zuordnen von einem anderen lösen */
function claimGrinderEvent(eventId: number | null | undefined, brewId: number | null) {
  if (eventId == null) return;
  db.prepare(`UPDATE brews SET grinder_event_id = NULL WHERE grinder_event_id = ? AND id IS NOT ?`).run(eventId, brewId);
}

/** Ebenso ein Shot der Decent */
function claimMachineShot(shotId: number | null | undefined, brewId: number | null) {
  if (shotId == null) return;
  db.prepare(`UPDATE brews SET machine_shot_id = NULL WHERE machine_shot_id = ? AND id IS NOT ?`).run(shotId, brewId);
}

/** Alle Bezüge über alle Kaffees, neueste zuerst, mit Kaffee, Rezept, Mahlvorgang und Shot; dazu freie Mahlvorgänge der letzten 90 Tage */
export function brewLog(): BrewLog {
  const rows = db
    .prepare(
      `SELECT b.*, c.name AS c_name, c.roaster AS c_roaster,
         e.ground_at AS e_at, e.grind_um AS e_grind, e.grind_target_um AS e_target, e.dose_g AS e_dose, e.dose_target_g AS e_dose_target, e.grind_s AS e_s,
         s.shot_at AS s_at, s.profile AS s_profile, s.time_s AS s_time, s.yield_g AS s_yield, s.temp_c AS s_temp, s.peak_bar AS s_bar
       FROM brews b JOIN coffees c ON c.id = b.coffee_id
         LEFT JOIN grinder_events e ON e.id = b.grinder_event_id LEFT JOIN machine_shots s ON s.id = b.machine_shot_id
       ORDER BY b.brewed_at DESC, b.id DESC`,
    )
    .all() as Row[];
  const recipes = new Map((db.prepare(`SELECT * FROM recipes`).all() as Row[]).map((r) => [Number(r.id), mapRecipe(r)]));
  const brews: BrewLogEntry[] = rows.map((r) => {
    const b = mapBrew(r);
    return {
      ...b,
      coffee: { id: b.coffee_id, name: String(r.c_name), roaster: String(r.c_roaster ?? "") },
      recipe: b.recipe_id != null ? (recipes.get(b.recipe_id) ?? null) : null,
      grinder:
        b.grinder_event_id != null && r.e_at != null
          ? {
              id: b.grinder_event_id,
              ground_at: String(r.e_at),
              grind_um: numOrNull(r.e_grind),
              grind_target_um: numOrNull(r.e_target),
              dose_g: numOrNull(r.e_dose),
              dose_target_g: numOrNull(r.e_dose_target),
              grind_s: numOrNull(r.e_s),
            }
          : null,
      shot:
        b.machine_shot_id != null && r.s_at != null
          ? {
              id: b.machine_shot_id,
              shot_at: String(r.s_at),
              profile: String(r.s_profile ?? ""),
              time_s: numOrNull(r.s_time),
              yield_g: numOrNull(r.s_yield),
              temp_c: numOrNull(r.s_temp),
              peak_bar: numOrNull(r.s_bar),
            }
          : null,
    };
  });
  const free = db
    .prepare(
      `SELECT e.id, e.ground_at, e.device, e.grind_um, e.grind_target_um, e.dose_g, e.dose_target_g, e.grind_s, e.recipe_index, e.recipe_mode,
         e.brew_time_target_s, e.brewed_at, e.yield_g, e.shot_s, e.quality, NULL AS brew_id, NULL AS brew_coffee_id, NULL AS brew_coffee
       FROM grinder_events e WHERE e.ground_at >= ? AND NOT EXISTS (SELECT 1 FROM brews b WHERE b.grinder_event_id = e.id)
       ORDER BY e.ground_at DESC LIMIT 500`,
    )
    .all(new Date(Date.now() - 90 * 86_400_000).toISOString()) as Row[];
  return { brews, free_events: free.map((r) => ({ ...r }) as unknown as BrewLog["free_events"][number]) };
}

export function createBrew(b: BrewInput): number | string {
  const err = checkBrewRefs(b);
  if (err) return err;
  claimGrinderEvent(b.grinder_event_id, null);
  claimMachineShot(b.machine_shot_id, null);
  const res = db
    .prepare(
      `INSERT INTO brews (coffee_id, batch_id, recipe_id, brewed_at, dose_g, water_g, temp_c, grind, time_s, preinfusion_s, kind, scores, total, rating, taste, flavors,
         comment, grinder_event_id, machine_shot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...brewParams(b));
  touchCoffee(b.coffee_id);
  return Number(res.lastInsertRowid);
}

export function updateBrew(id: number, b: BrewInput): boolean | string {
  const err = checkBrewRefs(b);
  if (err) return err;
  const p = brewParams(b);
  claimGrinderEvent(b.grinder_event_id, id);
  claimMachineShot(b.machine_shot_id, id);
  const res = db
    .prepare(
      `UPDATE brews SET coffee_id = ?, batch_id = ?, recipe_id = ?, brewed_at = ?, dose_g = ?, water_g = ?, temp_c = ?,
         grind = ?, time_s = ?, preinfusion_s = ?, kind = ?, scores = ?, total = ?, rating = ?, taste = ?, flavors = ?, comment = ?, grinder_event_id = ?,
         machine_shot_id = ? WHERE id = ?`,
    )
    .run(...p, id);
  return Number(res.changes) > 0;
}

export function deleteBrew(id: number): boolean {
  return Number(db.prepare(`DELETE FROM brews WHERE id = ?`).run(id).changes) > 0;
}

// ---------- Einstellungen ----------

export function getSetting(key: string): string | null {
  const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as Row | undefined;
  return r ? String(r.value) : null;
}

export function setSetting(key: string, value: string | null) {
  if (value == null || value === "") db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  else
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      key,
      value,
    );
}

// ---------- Statistik ----------

function grouped(sql: string): { label: string; count: number; avg: number | null }[] {
  return (db.prepare(sql).all() as Row[]).map((r) => ({
    label: String(r.label || "Unbekannt"),
    count: Number(r.count),
    avg: r.avg == null ? null : Math.round(Number(r.avg) * 100) / 100,
  }));
}

export function stats(): Stats {
  const base = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM coffees WHERE archived = 0 AND wishlist = 0) AS coffees,
              (SELECT COUNT(*) FROM brews) AS brews,
              (SELECT AVG(total) FROM brews) AS avg,
              (SELECT COUNT(rating) FROM brews) AS quick,
              (SELECT AVG(rating) FROM brews) AS rating,
              (SELECT COALESCE(SUM(dose_g), 0) FROM brews) AS grams`,
    )
    .get() as Row;
  const top = (
    db
      .prepare(
        `SELECT c.id, c.name, c.roaster, MAX(b.total) AS score, COUNT(b.id) AS brews
         FROM coffees c JOIN brews b ON b.coffee_id = c.id
         WHERE b.total IS NOT NULL
         GROUP BY c.id ORDER BY score DESC LIMIT 8`,
      )
      .all() as Row[]
  ).map((r) => ({ id: Number(r.id), name: String(r.name), roaster: String(r.roaster), score: Number(r.score), brews: Number(r.brews) }));
  return {
    coffees: Number(base.coffees),
    brews: Number(base.brews),
    avg_score: base.avg == null ? null : Math.round(Number(base.avg) * 100) / 100,
    quick: { count: Number(base.quick), avg: base.rating == null ? null : Math.round(Number(base.rating) * 10) / 10 },
    costs: costStats(),
    grams_used: Math.round(Number(base.grams)),
    best: top[0] ? { id: top[0].id, name: top[0].name, roaster: top[0].roaster, score: top[0].score } : null,
    top,
    by_country: grouped(
      `SELECT c.country AS label, COUNT(DISTINCT c.id) AS count, AVG(b.total) AS avg
       FROM coffees c LEFT JOIN brews b ON b.coffee_id = c.id WHERE c.archived = 0 AND c.wishlist = 0
       GROUP BY c.country ORDER BY count DESC, label`,
    ),
    by_process: grouped(
      `SELECT c.process AS label, COUNT(DISTINCT c.id) AS count, AVG(b.total) AS avg
       FROM coffees c LEFT JOIN brews b ON b.coffee_id = c.id WHERE c.archived = 0 AND c.wishlist = 0
       GROUP BY c.process ORDER BY count DESC, label`,
    ),
    by_roast: grouped(
      `SELECT CASE c.roast_level WHEN 'hell' THEN 'Hell' WHEN 'mittel' THEN 'Mittel' WHEN 'dunkel' THEN 'Dunkel' ELSE '' END AS label,
         COUNT(DISTINCT c.id) AS count, AVG(b.total) AS avg
       FROM coffees c LEFT JOIN brews b ON b.coffee_id = c.id WHERE c.archived = 0 AND c.wishlist = 0
       GROUP BY c.roast_level ORDER BY CASE c.roast_level WHEN 'hell' THEN 1 WHEN 'mittel' THEN 2 WHEN 'dunkel' THEN 3 ELSE 4 END`,
    ),
    by_method: grouped(
      `SELECT COALESCE(NULLIF(r.method, ''), 'Ohne Rezept') AS label, COUNT(b.id) AS count, AVG(b.total) AS avg
       FROM brews b LEFT JOIN recipes r ON r.id = b.recipe_id
       GROUP BY label ORDER BY count DESC`,
    ),
    by_month: (
      db
        .prepare(
          `SELECT substr(brewed_at, 1, 7) AS month, COUNT(*) AS brews, AVG(total) AS avg
           FROM brews GROUP BY month ORDER BY month DESC LIMIT 12`,
        )
        .all() as Row[]
    )
      .map((r) => ({
        month: String(r.month),
        brews: Number(r.brews),
        avg: r.avg == null ? null : Math.round(Number(r.avg) * 100) / 100,
      }))
      .reverse(),
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Kosten aus den Chargen: Preis der Charge, Gewicht der Charge (sonst Packungsgröße des Kaffees).
 * Pro Tasse: Dosis × €/kg der Charge, ohne Charge die Angaben am Kaffee.
 */
function costStats(): CostStats {
  const batches = db
    .prepare(
      `SELECT t.id, t.coffee_id, t.price_eur AS price, COALESCE(t.weight_g, c.weight_g) AS weight, t.backfilled,
         COALESCE(t.roast_date, substr(t.created_at, 1, 10)) AS day, c.roaster
       FROM batches t JOIN coffees c ON c.id = t.coffee_id
       WHERE t.price_eur IS NOT NULL`,
    )
    .all() as Row[];
  let spent = 0;
  let kgPrice = 0;
  let kgWeight = 0;
  const months = new Map<string, { spent: number; batches: number }>();
  const roasters = new Map<string, { price: number; weight: number; batches: number }>();
  const coffeeKg = new Map<number, { price: number; weight: number }>();
  const batchKg = new Map<number, number>();
  for (const b of batches) {
    const price = Number(b.price);
    const weight = b.weight == null ? 0 : Number(b.weight);
    spent += price;
    if (!b.backfilled) {
      const m = String(b.day).slice(0, 7);
      const e = months.get(m) ?? { spent: 0, batches: 0 };
      months.set(m, { spent: e.spent + price, batches: e.batches + 1 });
    }
    if (weight > 0) {
      kgPrice += price;
      kgWeight += weight;
      batchKg.set(Number(b.id), (price / weight) * 1000);
      const label = String(b.roaster) || "Unbekannt";
      const r = roasters.get(label) ?? { price: 0, weight: 0, batches: 0 };
      roasters.set(label, { price: r.price + price, weight: r.weight + weight, batches: r.batches + 1 });
      const c = coffeeKg.get(Number(b.coffee_id)) ?? { price: 0, weight: 0 };
      coffeeKg.set(Number(b.coffee_id), { price: c.price + price, weight: c.weight + weight });
    }
  }

  // Kaffees ohne bepreiste Charge: Angaben am Kaffee (Shop-Preis), damit auch Bezüge ohne Charge zählen
  const fallback = new Map<number, number>();
  for (const c of db.prepare(`SELECT id, price_eur, weight_g FROM coffees WHERE price_eur IS NOT NULL AND weight_g > 0`).all() as Row[])
    fallback.set(Number(c.id), (Number(c.price_eur) / Number(c.weight_g)) * 1000);
  const perKgOfCoffee = (id: number) => {
    const c = coffeeKg.get(id);
    return c ? (c.price / c.weight) * 1000 : (fallback.get(id) ?? null);
  };

  let cupSum = 0;
  let cups = 0;
  for (const b of db.prepare(`SELECT coffee_id, batch_id, dose_g FROM brews WHERE dose_g > 0`).all() as Row[]) {
    const kg = (b.batch_id != null ? batchKg.get(Number(b.batch_id)) : undefined) ?? perKgOfCoffee(Number(b.coffee_id));
    if (kg == null) continue;
    cupSum += (kg * Number(b.dose_g)) / 1000;
    cups++;
  }

  const avgByRoaster = new Map(
    (db.prepare(`SELECT c.roaster, AVG(b.total) AS avg FROM brews b JOIN coffees c ON c.id = b.coffee_id GROUP BY c.roaster`).all() as Row[]).map(
      (r) => [String(r.roaster) || "Unbekannt", r.avg == null ? null : r2(Number(r.avg))],
    ),
  );
  const value = (
    db
      .prepare(`SELECT c.id, c.name, c.roaster, AVG(b.total) AS avg FROM coffees c JOIN brews b ON b.coffee_id = c.id WHERE b.total IS NOT NULL GROUP BY c.id`)
      .all() as Row[]
  )
    .map((r) => ({ id: Number(r.id), name: String(r.name), roaster: String(r.roaster), per_kg: perKgOfCoffee(Number(r.id)), avg: r2(Number(r.avg)) }))
    .filter((v): v is CostStats["value"][number] => v.per_kg != null)
    .map((v) => ({ ...v, per_kg: r2(v.per_kg) }));

  const now = new Date();
  const by_month: CostStats["by_month"] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = months.get(key);
    by_month.push({ month: key, spent: r2(m?.spent ?? 0), batches: m?.batches ?? 0 });
  }

  return {
    spent: r2(spent),
    batches_priced: batches.length,
    per_kg: kgWeight ? r2((kgPrice / kgWeight) * 1000) : null,
    per_cup: cups ? Math.round((cupSum / cups) * 1000) / 1000 : null,
    cups_priced: cups,
    by_month,
    by_roaster: [...roasters.entries()]
      .map(([label, r]) => ({ label, per_kg: r2((r.price / r.weight) * 1000), batches: r.batches, avg: avgByRoaster.get(label) ?? null }))
      .sort((a, b) => b.per_kg - a.per_kg),
    value,
  };
}

export function exportAll() {
  return {
    exported_at: now(),
    coffees: (db.prepare(`SELECT * FROM coffees`).all() as Row[]).map(mapCoffee),
    batches: (db.prepare(`SELECT * FROM batches`).all() as Row[]).map(mapBatch),
    recipes: (db.prepare(`SELECT * FROM recipes`).all() as Row[]).map(mapRecipe),
    brews: (db.prepare(`SELECT * FROM brews`).all() as Row[]).map(mapBrew),
    grinder_events: db
      .prepare(
        `SELECT id, uuid, ground_at, device, grind_um, grind_target_um, dose_g, dose_target_g, grind_s, recipe_index, recipe_mode, brew_time_target_s,
           brewed_at, yield_g, shot_s, quality FROM grinder_events ORDER BY ground_at`,
      )
      .all(),
    machine_shots: db
      .prepare(`SELECT id, uuid, shot_at, profile, beverage, dose_g, yield_g, time_s, preinfusion_s, temp_c, peak_bar, grind, bean
           FROM machine_shots ORDER BY shot_at`)
      .all(),
  };
}
