import { GRINDERS, NO_GRINDER } from "../shared/compass.ts";
import { z } from "zod";
import { TIME_RE } from "../shared/config.ts";
import { tenth } from "../shared/shot.ts";

z.config(z.locales.de());

const text = (max = 500) => z.string().trim().max(max).default("");
const num = z.number().finite().nullable().default(null);
// Rückprobe: „2026-02-31“ hätte Date.parse still zum 3. März gemacht
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "kein gültiges Datum");
const isoDate = day.nullable().default(null);
/** Zeiten im Gefrierfach: aufsteigend, ohne Überlappung, höchstens die letzte noch offen */
const freezes = z
  .array(z.object({ from: day, to: day.nullable().default(null) }))
  .max(50)
  .superRefine((a, ctx) => {
    a.forEach((f, i) => {
      if (f.to && f.to < f.from) ctx.addIssue({ code: "custom", message: "Gefrierfach: „Aufgetaut“ liegt vor „Eingefroren“", path: [i] });
      if (!f.to && i < a.length - 1) ctx.addIssue({ code: "custom", message: "Gefrierfach: nur der letzte Zeitraum darf offen sein", path: [i] });
      const prev = a[i - 1];
      if (prev?.to && f.from < prev.to) ctx.addIssue({ code: "custom", message: "Gefrierfach: Zeiträume überschneiden sich", path: [i] });
    });
  });
/** Zeitpunkt, gespeichert immer als UTC-ISO (Sortierung und Paarung vergleichen Strings) */
const instant = z
  .string()
  .min(10)
  .max(40)
  .refine((s) => {
    const t = Date.parse(s);
    return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.UTC(2200, 0, 1);
  }, "kein gültiger Zeitpunkt")
  .transform((s) => new Date(s).toISOString());

export const roasterRecipeSchema = z.object({
  title: text(80),
  method: text(60),
  dose_g: z.number().positive().max(2000).nullable().default(null),
  water_g: z.number().positive().max(20_000).nullable().default(null),
  temp_c: z.number().min(0).max(100).nullable().default(null),
  grind: text(120),
  time_s: z.number().int().nonnegative().max(24 * 3600).nullable().default(null),
  notes: text(2000),
});

export const coffeeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  roaster: text(200),
  country: text(100),
  region: text(200),
  farm: text(200),
  producer: text(200),
  varieties: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  process: text(100),
  process_detail: text(400),
  altitude: text(100),
  harvest: text(100),
  roast_level: z.enum(["hell", "mittel", "dunkel"]).nullable().default(null),
  roast_for: z.enum(["filter", "espresso", "omni"]).nullable().default(null),
  roaster_notes: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  description: text(4000),
  weight_g: z.number().int().positive().max(100_000).nullable().default(null),
  price_eur: z.number().nonnegative().max(100_000).nullable().default(null),
  cup_score: z.number().min(0).max(100).nullable().default(null),
  roaster_recipes: z.array(roasterRecipeSchema).max(8).default([]),
  url: text(2000),
});

export const coffeeInputSchema = coffeeFieldsSchema.extend({
  image: z
    .string()
    .regex(/^[a-z0-9-]+\.(jpg|png|webp|gif|avif)$/)
    .nullable()
    .default(null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  wishlist: z.boolean().default(false),
  archived: z.boolean().default(false),
  source: z
    .object({
      kind: z.enum(["url", "name", "photo", "manual"]),
      input: z.string().max(2000),
      at: z.string().max(40),
      model: z.string().max(80).optional(),
    })
    .nullable()
    .default(null),
  first_batch: z
    .object({
      roast_date: isoDate,
      weight_g: z.number().int().positive().max(100_000).nullable().default(null),
      price_eur: z.number().nonnegative().max(100_000).nullable().default(null),
      status: z.enum(["ungeoeffnet", "offen", "leer"]).default("offen"),
      backfilled: z.boolean().default(false),
    })
    .nullable()
    .optional(),
});

export const coffeePatchSchema = z.object({
  wishlist: z.boolean().optional(),
  archived: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  shot_target: z
    .object({
      dose_g: z.number().min(5).max(40).nullable(),
      ratio: z.tuple([z.number().min(0.5).max(6), z.number().min(0.5).max(6)]).nullable(),
      time: z.tuple([z.number().int().min(5).max(120), z.number().int().min(5).max(120)]).nullable(),
      pi: z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]).nullable().optional(),
      pi_flow: z.number().min(0.5).max(10).nullable().optional(),
      pi_bar: z.number().min(0.5).max(12).nullable().optional(),
      temp: z.tuple([z.number().min(70).max(100), z.number().min(70).max(100)]).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const batchInputSchema = z.object({
  roast_date: isoDate,
  opened_at: isoDate,
  weight_g: z.number().int().positive().max(100_000).nullable().default(null),
  price_eur: z.number().nonnegative().max(100_000).nullable().default(null),
  status: z.enum(["ungeoeffnet", "offen", "leer"]).default("offen"),
  backfilled: z.boolean().default(false),
  /** fehlt das Feld, bleiben die gespeicherten Zeiten (ältere Clients) */
  freezes: freezes.optional(),
  note: text(1000),
});
export const freezeSchema = z.object({ on: z.boolean(), date: isoDate });

export const recipeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  method: text(60),
  dose_g: num,
  water_g: num,
  temp_c: num,
  grind: text(60),
  grinder: text(80),
  time_s: z.number().int().nonnegative().max(86_400).nullable().default(null),
  notes: text(2000),
  archived: z.boolean().default(false),
});

const quality = z.number().min(6).max(10);
const cup = z.number().min(0).max(10);

export const brewInputSchema = z
  .object({
  coffee_id: z.number().int().positive(),
  batch_id: z.number().int().positive().nullable().default(null),
  recipe_id: z.number().int().positive().nullable().default(null),
  brewed_at: instant,
  dose_g: num,
  water_g: num,
  temp_c: num,
  grind: text(60),
  // Zehntel wie von Mühle und Maschine geliefert
  time_s: z.number().nonnegative().max(86_400).transform(tenth).nullable().default(null),
  preinfusion_s: z.number().nonnegative().max(600).transform(tenth).nullable().default(null),
  grinder_event_id: z.number().int().positive().nullable().default(null),
  machine_shot_id: z.number().int().positive().nullable().default(null),
  kind: z.enum(["sca", "quick"]).default("sca"),
  scores: z
    .object({
      aroma: quality,
      flavor: quality,
      aftertaste: quality,
      acidity: quality,
      body: quality,
      balance: quality,
      overall: quality,
      uniformity: cup,
      cleanCup: cup,
      sweetness: cup,
      defects: z.number().min(0).max(40).default(0),
    })
    .nullable()
    .default(null),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  taste: z.array(z.enum(["ausgewogen", "sauer", "bitter", "duenn", "kraeftig"])).max(5).default([]),
  flavors: z.array(z.string().max(60)).max(40).default([]),
  comment: text(2000),
  })
  .refine((b) => (b.kind === "sca" ? b.scores != null : b.rating != null || b.taste.length > 0), {
    message: "SCA-Bogen braucht alle Werte, Schnellbewertung ein Kurzurteil oder Sterne",
  });

export const recipesScrapeSchema = z.object({ url: z.string().trim().min(4).max(2000), name: text(200), roaster: text(200) });

export const scrapeInputSchema = z
  .object({
    url: z.string().trim().max(2000).optional(),
    name: z.string().trim().max(300).optional(),
    image: z
      .string()
      .max(12_000_000)
      .regex(/^data:image\/(jpeg|png|webp|gif);base64,/)
      .optional(),
  })
  .refine((v) => Boolean(v.url || v.name || v.image), "Link, Name oder Foto angeben");

const shotTargetSchema = z.object({
  dose_g: z.number().min(5).max(40),
  ratio: z.tuple([z.number().min(0.5).max(6), z.number().min(0.5).max(6)]).refine(([a, b]) => a <= b, "Verhältnis: von ≤ bis"),
  time: z.tuple([z.number().int().min(5).max(120), z.number().int().min(5).max(120)]).refine(([a, b]) => a <= b, "Zeit: von ≤ bis"),
  pi: z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]).refine(([a, b]) => a <= b, "Preinfusion: von ≤ bis").optional(),
  pi_flow: z.number().min(0.5).max(10).optional(),
  pi_bar: z.number().min(0.5).max(12).optional(),
  temp: z.tuple([z.number().min(70).max(100), z.number().min(70).max(100)]).refine(([a, b]) => a <= b, "Temperatur: von ≤ bis").optional(),
});

/** Decent-Profil am Kaffee: nur die Werte, die die App verwaltet; fehlende bleiben */
export const decentProfileSchema = z.object({
  pi_s: z.number().int().min(0).max(60).optional(),
  pi_flow: z.number().min(0.5).max(10).optional(),
  pi_bar: z.number().min(0.5).max(12).optional(),
  temp: z.number().min(70).max(100).optional(),
  pressure: z.number().min(1).max(12).optional(),
  weight: z.number().min(5).max(200).optional(),
  dose: z.number().min(5).max(40).optional(),
});

export const grinderAccountSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  store_id: z.number().int().positive().nullable().default(null),
});

export const grinderLocalSchema = z.object({ host: z.string().trim().min(3).max(200) });

export const haAccountSchema = z.object({
  url: z.string().trim().url().max(300),
  token: z.string().trim().min(20).max(1000),
});
export const haSwitchSchema = z.object({ on: z.boolean() });

export const recommendInputSchema = z.object({ hint: text(300) });

export const settingsInputSchema = z.object({
  api_key: z.string().trim().max(400).nullable().optional(),
  grinder: z.enum([NO_GRINDER, ...GRINDERS.map((g) => g.id)]).optional(),
  /** null setzt alle Röstgrade auf die eingebauten Werte zurück */
  shot_targets: z.record(z.enum(["hell", "mittel", "dunkel"]), shotTargetSchema).nullable().optional(),
  onboarded: z.boolean().optional(),
  config: z
    .object({
      model: z.string().trim().max(100).nullable(),
      timezone: z.string().trim().max(60).nullable(),
      backup_dir: z.string().trim().max(400).nullable(),
      backup_off: z.boolean().nullable(),
      backup_time: z.string().regex(TIME_RE, "Uhrzeit als HH:MM").nullable(),
      backup_keep: z.number().int().min(1).max(365).nullable(),
      sync_min: z.number().int().min(1).max(1440).nullable(),
      sync_days: z.number().int().min(1).max(3650).nullable(),
      ha_match: z.string().trim().max(200).nullable(),
      drink_windows: z
        .record(z.enum(["filter", "omni", "espresso"]), z.record(z.enum(["hell", "mittel", "dunkel"]), z.object({ ready: z.number().int(), peak: z.number().int(), end: z.number().int() })))
        .nullable(),
    })
    .partial()
    .optional(),
});
