import type { AppConfig } from "../../shared/config.ts";
import type { ShotOverride, ShotTargets } from "../../shared/shot.ts";
import type {
  MachineLive,
  Batch,
  BrewInput,
  BrewLog,
  CoffeeDetail,
  CoffeeFields,
  CoffeeListItem,
  CoffeeSource,
  GrinderEvent,
  GrinderSyncStatus,
  MachineShot,
  MachineShotDetail,
  DecentStatus,
  RecipeListItem,
  RoasterRecipe,
  ScrapeDraft,
  ScrapeEvent,
  ScrapeJob,
  RecommendEvent,
  Recommendations,
  Settings,
  Stats,
  StockItem,
} from "../../shared/types.ts";
import type { BrewTemplate, GrindPrediction } from "../../shared/grind.ts";
import type { CoffeeProfile, ProfileParams } from "../../shared/decent-profile.ts";

export type BackupList = { enabled: boolean; list: { name: string; size: number; at: string }[] };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Server nicht erreichbar", 0, {});
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(data.error ?? `Fehler ${res.status}`), res.status, data);
  return data as T;
}

export type CoffeeInput = CoffeeFields & {
  image: string | null;
  color: string | null;
  wishlist: boolean;
  archived: boolean;
  source: CoffeeSource | null;
  first_batch?: {
    roast_date: string | null;
    weight_g: number | null;
    price_eur: number | null;
    status: Batch["status"];
  } | null;
};

export type BatchInput = Pick<Batch, "roast_date" | "opened_at" | "weight_g" | "price_eur" | "status" | "note"> & { freezes?: Batch["freezes"] };

export type RecipeInput = {
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
};

export const api = {
  coffees: () => req<CoffeeListItem[]>("GET", "/coffees"),
  scrapeJobs: () => req<ScrapeJob[]>("GET", "/scrape/jobs"),
  startScrapeJob: (input: { url?: string; name?: string; image?: string }) => req<ScrapeJob>("POST", "/scrape/jobs", input),
  removeScrapeJob: (id: string) => req<void>("DELETE", `/scrape/jobs/${encodeURIComponent(id)}`),
  coffee: (id: number) => req<CoffeeDetail>("GET", `/coffees/${id}`),
  createCoffee: (c: CoffeeInput) => req<{ id: number }>("POST", "/coffees", c),
  updateCoffee: (id: number, c: CoffeeInput) => req<{ id: number }>("PUT", `/coffees/${id}`, c),
  patchCoffee: (id: number, p: { wishlist?: boolean; archived?: boolean; color?: string | null; shot_target?: ShotOverride | null }) =>
    req<{ id: number }>("PATCH", `/coffees/${id}`, p),
  deleteCoffee: (id: number) => req<{ ok: true }>("DELETE", `/coffees/${id}`),
  decentProfile: (id: number) => req<CoffeeProfile>("GET", `/coffees/${id}/decent-profile`),
  saveDecentProfile: (id: number, p: Partial<ProfileParams>) => req<CoffeeProfile>("PUT", `/coffees/${id}/decent-profile`, p),

  createBatch: (coffeeId: number, b: BatchInput) => req<{ id: number }>("POST", `/coffees/${coffeeId}/batches`, b),
  updateBatch: (id: number, b: BatchInput) => req<{ id: number }>("PUT", `/batches/${id}`, b),
  freezeBatch: (id: number, on: boolean, date?: string) => req<{ id: number }>("POST", `/batches/${id}/freeze`, { on, date: date ?? null }),
  deleteBatch: (id: number) => req<{ ok: true }>("DELETE", `/batches/${id}`),

  recipes: () => req<RecipeListItem[]>("GET", "/recipes"),
  createRecipe: (r: RecipeInput) => req<{ id: number }>("POST", "/recipes", r),
  updateRecipe: (id: number, r: RecipeInput) => req<{ id: number }>("PUT", `/recipes/${id}`, r),
  deleteRecipe: (id: number) => req<{ ok: true }>("DELETE", `/recipes/${id}`),

  createBrew: (b: BrewInput) => req<{ id: number }>("POST", "/brews", b),
  updateBrew: (id: number, b: BrewInput) => req<{ id: number }>("PUT", `/brews/${id}`, b),
  deleteBrew: (id: number) => req<{ ok: true }>("DELETE", `/brews/${id}`),

  uploadImage: (data: string) => req<{ file: string }>("POST", "/images", { data }),
  fetchImage: (url: string) => req<{ file: string }>("POST", "/images", { url }),
  /** Fremdes Bild als Blob über den Server, ohne es dort zu speichern */
  proxyImage: async (url: string, signal?: AbortSignal): Promise<Blob> => {
    const res = await fetch("/api/images/proxy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), signal });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError(String(data.error ?? `Fehler ${res.status}`), res.status, data);
    }
    return res.blob();
  },

  scrapeRecipes: (input: { url: string; name: string; roaster: string }) => req<{ recipes: RoasterRecipe[] }>("POST", "/scrape/recipes", input),
  scrape: (input: { url?: string; name?: string; image?: string }, signal?: AbortSignal) =>
    req<ScrapeDraft>("POST", "/scrape", input, signal),

  settings: () => req<Settings>("GET", "/settings"),
  saveSettings: (s: { api_key?: string | null; grinder?: string; shot_targets?: ShotTargets | null; onboarded?: boolean; config?: Partial<AppConfig> }) => req<Settings>("PUT", "/settings", s),
  stats: () => req<Stats>("GET", "/stats"),
  grinderEvents: (q: { since?: string; around?: string; hours?: number; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v == null ? [] : [[k, String(v)]])));
    return req<{ events: GrinderEvent[]; status: GrinderSyncStatus }>("GET", `/grinder/events${p.size ? `?${p}` : ""}`);
  },
  grinderSync: () => req<GrinderSyncStatus>("POST", "/grinder/sync"),
  grinderConnect: (a: { email: string; password: string; store_id: number | null }) => req<Settings>("PUT", "/grinder/account", a),
  grinderDisconnect: () => req<Settings>("DELETE", "/grinder/account"),
  grinderLocal: (host: string) => req<Settings>("PUT", "/grinder/local", { host }),
  grinderLocalDisconnect: () => req<Settings>("DELETE", "/grinder/local"),
  machineShots: (q: { since?: string; around?: string; hours?: number; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v == null ? [] : [[k, String(v)]])));
    return req<{ shots: MachineShot[]; status: DecentStatus }>("GET", `/decent/shots${p.size ? `?${p}` : ""}`);
  },
  machineShot: (id: number) => req<MachineShotDetail>("GET", `/decent/shots/${id}`),
  machineLive: () => req<MachineLive>("GET", "/ha/machine"),
  machineSwitch: (what: "power" | "steam", on: boolean) => req<MachineLive>("POST", `/ha/${what}`, { on }),
  haConnect: (a: { url: string; token: string }) => req<Settings>("PUT", "/ha/account", a),
  haDisconnect: () => req<Settings>("DELETE", "/ha/account"),
  /** Schlüssel unter „coffees“, damit jede Änderung an Kaffees und Chargen das Lager mit auffrischt */
  stock: () => req<StockItem[]>("GET", "/stock"),
  /** Schlüssel ["coffees", "brews"]: Speichern eines Bezugs frischt über „coffees“ mit auf */
  brewLog: () => req<BrewLog>("GET", "/brews"),
  backups: () => req<BackupList>("GET", "/backups"),
  grind: (q: { coffee_id: number; batch_id: number | null; method: string; grinder: string }) =>
    req<{ prediction: GrindPrediction | null; template: BrewTemplate | null }>(
      "GET",
      `/grind?${new URLSearchParams({ coffee_id: String(q.coffee_id), batch_id: String(q.batch_id ?? ""), method: q.method, grinder: q.grinder })}`,
    ),
  recommendations: () => req<{ result: Recommendations | null }>("GET", "/recommend"),
};

/** „Was passt zu mir?“ mit Zwischenschritten (NDJSON wie beim Auslesen) */
export async function recommendLive(hint: string, onEvent: (e: RecommendEvent) => void, signal?: AbortSignal): Promise<Recommendations> {
  let res: Response;
  try {
    res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ hint }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Server nicht erreichbar", 0, {});
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(String(data.error ?? `Fehler ${res.status}`), res.status, data);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let result: Recommendations | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let e: RecommendEvent;
    try {
      e = JSON.parse(line) as RecommendEvent;
    } catch {
      return;
    }
    if (e.t === "error") throw new ApiError(e.message, e.status, {});
    if (e.t === "done") result = e.result;
    onEvent(e);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  handle(buf);
  if (!result) throw new ApiError("Verbindung zum Server abgebrochen. Bitte erneut versuchen.", 0, {});
  return result;
}

/**
 * Auslesen mit Zwischenständen: liest NDJSON-Zeilen und meldet jede an onEvent.
 * Liefert den Entwurf oder wirft ApiError wie der normale Weg.
 */
/** NDJSON-Antwort von /api/scrape oder /api/scrape/jobs/:id lesen, bis „done“ (Entwurf) oder „error“ (Ausnahme) */
async function readScrapeStream(res: Response, onEvent: (e: ScrapeEvent) => void): Promise<ScrapeDraft> {
  if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(String(data.error ?? `Fehler ${res.status}`), res.status, data);
    return data as ScrapeDraft; // Server ohne Stream-Unterstützung
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let result: ScrapeDraft | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let e: ScrapeEvent;
    try {
      e = JSON.parse(line) as ScrapeEvent;
    } catch {
      return;
    }
    if (e.t === "error") throw new ApiError(e.message, e.status, { uploaded_image: e.uploaded_image });
    if (e.t === "done") result = e.draft;
    onEvent(e);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  handle(buf);
  if (!result) throw new ApiError("Verbindung zum Server abgebrochen. Bitte erneut versuchen.", 0, {});
  return result;
}

async function ndjson(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: { ...init.headers, accept: "application/x-ndjson" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Server nicht erreichbar", 0, {});
  }
}

/** Auslese-Auftrag verfolgen: erst der bisherige Stand, dann live bis zum Ende. Abbrechen trennt nur, der Auftrag läuft weiter */
export async function followScrapeJob(id: string, onEvent: (e: ScrapeEvent) => void, signal?: AbortSignal): Promise<ScrapeDraft> {
  const res = await ndjson(`/api/scrape/jobs/${encodeURIComponent(id)}`, { signal });
  return readScrapeStream(res, onEvent);
}

export const imageUrl = (file: string) => `/images/${file}`;
