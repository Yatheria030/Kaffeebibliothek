// Mahlkönig Sync: Mahlvorgänge der E64 WS aus der Cloud holen (Mahlgrad, Dosis, mit Waage oder Brühzeiteingabe auch Zeit und
// Ausbeute). Schnittstelle wie das Web-Dashboard sync.mahlkoenig.com sie nutzt (vgl. die Home-Assistant-Integration ha-mahlkoenig-sync).
import { cfg, onConfig } from "./config.ts";
import { db, tx } from "./db.ts";
import { getSetting, setSetting } from "./store.ts";
import type { GrinderEvent, GrinderSyncStatus } from "../shared/types.ts";
import { GrinderLocalError, grinderHost, localEvents } from "./grinder-local.ts";

const BASE = (process.env.MAHLKOENIG_URL ?? "https://sync.mahlkoenig.com").replace(/\/+$/, "");
const AUTH_PATH = "/api/security-service/auth/token";
const QUERY_PATH = "/api/dashboard-service/shot-history/query";
/** Stores, die das Konto verwaltet (so lädt das Admin-Dashboard die Auswahl); `comp` im Token ist die Firma, nicht der Store */
const STORES_PATH = "/api/admin-service/store/query-managed";
const TOKEN_KEYS = ["access_token", "accessToken", "token", "id_token", "jwt"];
/** Token lebt ~600 s, nach 480 s neu anmelden */
const TOKEN_TTL = 480_000;
/** Abgleiche nicht öfter als alle 25 s (Dialog fragt alle 30 s), im Hintergrund alle 10 min */
const MIN_GAP = 25_000;
const PAGE = 100;
const MAX_PAGES = 20;
/** erster Abgleich reicht 90 Tage zurück, danach ab dem letzten bekannten Mahlvorgang minus 2 Tage (Brühdaten kommen verzögert) */
const OVERLAP_DAYS = 2;

export type GrinderAccount = { email: string; password: string; store_id: number | null };

export class GrinderSyncError extends Error {
  constructor(
    message: string,
    readonly auth = false,
  ) {
    super(message);
  }
}

function account(): { acc: GrinderAccount | null; source: "env" | "db" | null } {
  const raw = getSetting("mahlkoenig");
  if (raw) {
    try {
      const a = JSON.parse(raw) as GrinderAccount;
      if (a.email && a.password) return { acc: { email: a.email, password: a.password, store_id: a.store_id ?? null }, source: "db" };
    } catch {
      /* kaputter Eintrag: wie nicht gesetzt */
    }
  }
  const email = process.env.MAHLKOENIG_EMAIL?.trim();
  const password = process.env.MAHLKOENIG_PASSWORD;
  if (email && password) {
    const sid = Number(process.env.MAHLKOENIG_STORE_ID);
    return { acc: { email, password, store_id: Number.isInteger(sid) && sid > 0 ? sid : null }, source: "env" };
  }
  return { acc: null, source: null };
}

/** Mühle im Heimnetz: Setting `mahlkoenig_local` (JSON host), sonst MAHLKOENIG_HOST */
function localHost(): { host: string | null; source: "env" | "db" | null } {
  const raw = getSetting("mahlkoenig_local");
  if (raw) {
    try {
      const h = (JSON.parse(raw) as { host?: string }).host;
      if (h) return { host: h, source: "db" };
    } catch {
      /* kaputter Eintrag: wie nicht gesetzt */
    }
  }
  const env = grinderHost(process.env.MAHLKOENIG_HOST ?? "");
  return env ? { host: env, source: "env" } : { host: null, source: null };
}

// ---------- Cloud ----------

let token: { value: string; at: number; email: string; store: number | null; info: unknown } | null = null;
/** Store-ID, die aus Token oder Antwort erkannt wurde (für Zugang aus der Umgebung ohne Store-ID) */
let foundStore: { email: string; id: number } | null = null;

async function post(pathname: string, body: unknown, auth?: string): Promise<Response> {
  try {
    return await fetch(BASE + pathname, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? "keine Antwort in 20 s" : e instanceof Error ? e.message : String(e);
    throw new GrinderSyncError(`Mahlkönig Sync nicht erreichbar (${why})`);
  }
}

async function login(acc: GrinderAccount): Promise<string> {
  const res = await post(AUTH_PATH, { username: acc.email, password: acc.password });
  if ([400, 401, 403].includes(res.status)) throw new GrinderSyncError("Anmeldung abgelehnt: E-Mail oder Passwort stimmt nicht", true);
  if (!res.ok) throw new GrinderSyncError(`Anmeldung bei Mahlkönig Sync fehlgeschlagen (HTTP ${res.status})`);
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const value = data && TOKEN_KEYS.map((k) => data[k]).find((v): v is string => typeof v === "string" && v.length > 0);
  if (!value) throw new GrinderSyncError("Mahlkönig Sync hat kein Token geliefert", true);
  const rest = Object.fromEntries(Object.entries(data).filter(([k]) => !TOKEN_KEYS.includes(k) && !/token/i.test(k)));
  token = { value, at: Date.now(), email: acc.email, store: storeIn(rest), info: rest };
  return value;
}

async function freshToken(acc: GrinderAccount): Promise<string> {
  if (token && token.email === acc.email && Date.now() - token.at < TOKEN_TTL) return token.value;
  return login(acc);
}

/** Store-ID irgendwo in einem Objekt (JWT-Inhalt, Datensatz) finden */
function storeIn(v: unknown, depth = 0): number | null {
  if (!v || typeof v !== "object" || depth > 5) return null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^(store|shop|location)_?ids?$/i.test(k)) {
      const n = Number(Array.isArray(x) ? x[0] : x);
      if (Number.isInteger(n) && n > 0) return n;
    }
    // Liste von Stores: stores: [{ id: 3868, … }]
    if (/^(stores?|shops?)$/i.test(k) && x && typeof x === "object") {
      const first = (Array.isArray(x) ? x[0] : x) as Record<string, unknown> | undefined;
      const n = Number(first?.id ?? first?.storeId);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  for (const x of Object.values(v as Record<string, unknown>)) {
    const n = storeIn(x, depth + 1);
    if (n) return n;
  }
  return null;
}

function tokenPayload(t: string): unknown {
  try {
    return JSON.parse(Buffer.from(t.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Aufbau eines Objekts fürs Log: Schlüssel und Typen, Zahlen mit Wert, Texte nur mit Länge (keine E-Mail, kein Token) */
function shapeOf(v: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `(${v.length})`] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
  if (typeof v === "string") return `string(${v.length})`;
  return v;
}

const isoMinute = (d: Date) => d.toISOString().slice(0, 19) + ".000Z";

async function query(acc: GrinderAccount, storeId: number | null, from: Date, first: number, size: number): Promise<unknown[]> {
  const body = {
    storeId,
    grinderId: null,
    cloudDate: { from: isoMinute(from), to: null },
    pager: { firstResult: first, pageSize: size },
    orderBy: "brew.cloudDate",
    orderDir: "DESC",
  };
  let res = await post(QUERY_PATH, body, await freshToken(acc));
  // Token mittendrin abgelaufen: einmal neu anmelden
  if (res.status === 401 || res.status === 403) res = await post(QUERY_PATH, body, await login(acc));
  if (storeId == null && res.status >= 400 && res.status < 500) {
    const text = (await res.text().catch(() => "")).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>").slice(0, 300);
    console.warn("[mahlkoenig] Store-ID nicht erkannt", JSON.stringify({
      login: shapeOf(token?.info), jwt: shapeOf(tokenPayload(token?.value ?? "")), query: { status: res.status, body: text },
    }));
    throw new GrinderSyncError("Store-ID nicht erkannt, bitte von Hand eintragen", true);
  }
  if (res.status === 401 || res.status === 403) throw new GrinderSyncError(`Kein Zugriff auf Store-ID ${storeId}`, true);
  if (!res.ok) throw new GrinderSyncError(`Mahlkönig Sync antwortet mit HTTP ${res.status}`);
  const data = (await res.json().catch(() => null)) as unknown;
  const items = Array.isArray(data) ? data : (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new GrinderSyncError("Unerwartete Antwort von Mahlkönig Sync");
  return items;
}

/** Zahlen unter Schlüsseln wie comp, orgId, organisationIds: Mahlkönig nennt die Store-ID im Token nicht beim Namen */
function storeCandidates(v: unknown, out = new Set<number>(), depth = 0): Set<number> {
  if (!v || typeof v !== "object" || depth > 5) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^(comp(any)?(_?id)?|(default)?_?org(ani[sz]ation)?_?ids?)$/i.test(k)) {
      for (const y of Array.isArray(x) ? x : [x]) {
        const n = Number(y);
        if (Number.isInteger(n) && n > 0) out.add(n);
      }
    } else storeCandidates(x, out, depth + 1);
  }
  return out;
}

/** Kandidaten der Reihe nach abfragen, nur einer mit Mahlvorgängen zählt (die Cloud nimmt auch fremde Zahlen an und liefert dann nichts) */
async function probeStores(acc: GrinderAccount, sources: unknown[]): Promise<number | null> {
  const from = new Date(Date.now() - cfg().sync_days * 86_400_000);
  for (const c of storeCandidates(sources)) {
    try {
      if ((await query(acc, c, from, 0, 1)).length) {
        console.log(`[mahlkoenig] Store-ID ${c} hat Mahlvorgänge`);
        return c;
      }
    } catch (e) {
      console.log(`[mahlkoenig] Store-ID ${c} abgelehnt: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}

/** Store-IDs des Kontos aus der Cloud; null, wenn die Liste nicht zu bekommen ist */
async function managedStores(acc: GrinderAccount): Promise<number[] | null> {
  const body = { orderBy: "info.name", orderDir: "ASC", pager: { firstResult: 0, pageSize: 50 } };
  try {
    let res = await post(STORES_PATH, body, await freshToken(acc));
    if (res.status === 401 || res.status === 403) res = await post(STORES_PATH, body, await login(acc));
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { items?: { storeId?: unknown }[] } | null;
    const ids = (data?.items ?? []).map((x) => Number(x.storeId)).filter((n) => Number.isInteger(n) && n > 0);
    return ids.length ? ids : null;
  } catch (e) {
    if (e instanceof GrinderSyncError && e.auth) throw e;
    return null;
  }
}

/** Store-ID: aus der Store-Liste des Kontos (eine eingetragene gilt, wenn sie darin steht), sonst eingetragen, sonst aus dem Token,
 * sonst ein Kandidat mit Mahlvorgängen, sonst aus einer Abfrage ohne Store-ID */
async function resolveStore(acc: GrinderAccount): Promise<number | null> {
  if (foundStore?.email === acc.email) return foundStore.id;
  const stores = await managedStores(acc);
  let id: number | null;
  if (stores) id = acc.store_id && stores.includes(acc.store_id) ? acc.store_id : stores[0];
  else if (acc.store_id) id = acc.store_id;
  else {
    const t = await freshToken(acc);
    id = token?.store ?? storeIn(tokenPayload(t)) ?? (await probeStores(acc, [token?.info, tokenPayload(t)]));
    if (!id) id = storeIn((await query(acc, null, new Date(Date.now() - cfg().sync_days * 86_400_000), 0, 1))[0]);
  }
  if (id) foundStore = { email: acc.email, id };
  // gespeicherte Store-ID, die nicht zum Konto gehört (früher die Firmen-ID aus dem Token), berichtigen
  if (id && stores && acc.store_id && acc.store_id !== id && account().source === "db") {
    console.log(`[mahlkoenig] Store-ID ${acc.store_id} → ${id} (aus der Store-Liste des Kontos)`);
    setSetting("mahlkoenig", JSON.stringify({ ...acc, store_id: id }));
  }
  return id;
}

// ---------- Umrechnen und Speichern ----------

function get(rec: unknown, p: string): unknown {
  let cur = rec;
  for (const part of p.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur ?? null;
}
const num = (rec: unknown, p: string) => {
  const v = get(rec, p);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
/** mg → g und ms → s auf eine Nachkommastelle */
const milli = (rec: unknown, p: string) => {
  const v = num(rec, p);
  return v == null ? null : Math.round(v / 100) / 10;
};
const str = (rec: unknown, p: string) => {
  const v = get(rec, p);
  return v == null || typeof v === "object" ? "" : String(v);
};
const date = (rec: unknown, p: string) => {
  const v = get(rec, p);
  const t = typeof v === "string" || typeof v === "number" ? Date.parse(String(v)) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export type EventRow = Omit<GrinderEvent, "id" | "brew_id" | "brew_coffee_id" | "brew_coffee"> & { uuid: string; raw: string };

export function toEvent(rec: unknown): EventRow | null {
  const ground_at = date(rec, "grind.cloudDate") ?? date(rec, "brew.cloudDate");
  if (!ground_at) return null;
  const uuid = str(rec, "grind.eventUuid") || str(rec, "brew.eventUuid") || `${ground_at}|${str(rec, "grind.deviceId")}`;
  const brewed = get(rec, "brew") != null;
  return {
    uuid,
    ground_at,
    device: str(rec, "grind.device.type") || str(rec, "grind.device.name"),
    grind_um: num(rec, "grind.payload.dddActual"),
    grind_target_um: num(rec, "grind.payload.dddRecipe"),
    dose_g: milli(rec, "grind.payload.weightActual"),
    dose_target_g: milli(rec, "grind.payload.weightRecipe"),
    grind_s: milli(rec, "grind.payload.durationActual"),
    recipe_index: num(rec, "grind.payload.recipeIndex"),
    recipe_mode: str(rec, "grind.payload.recipeMode"),
    brew_time_target_s: milli(rec, "grind.payload.brewTimeRecipe"),
    brewed_at: brewed ? date(rec, "brew.cloudDate") : null,
    yield_g: milli(rec, "brew.payload.mass"),
    shot_s: milli(rec, "brew.payload.duration"),
    quality: str(rec, "brew.shotQuality.overall"),
    raw: JSON.stringify(rec),
  };
}

const COLS = [
  "uuid", "ground_at", "device", "grind_um", "grind_target_um", "dose_g", "dose_target_g", "grind_s", "recipe_index", "recipe_mode",
  "brew_time_target_s", "brewed_at", "yield_g", "shot_s", "quality", "raw",
] as const;

/** Einfügen oder aktualisieren, aber nur bei echter Änderung schreiben: sonst verwirft jeder Abgleich das gelernte Mahlgrad-Modell */
function upsert(rows: EventRow[]): number {
  const st = db.prepare(
    `INSERT INTO grinder_events (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})
     ON CONFLICT(uuid) DO UPDATE SET ${COLS.filter((c) => c !== "uuid").map((c) => `${c} = excluded.${c}`).join(", ")}
     WHERE grinder_events.raw != excluded.raw`,
  );
  let changed = 0;
  tx(() => {
    for (const r of rows) changed += Number(st.run(...COLS.map((c) => r[c] ?? null)).changes);
  });
  return changed;
}

// ---------- Abgleich ----------

const state: { last_sync: string | null; last_error: string | null; started: number; running: Promise<void> | null } = {
  last_sync: null,
  last_error: null,
  started: 0,
  running: null,
};
const local: { last_sync: string | null; last_error: string | null } = { last_sync: null, last_error: null };

async function run(acc: GrinderAccount) {
  const last = (db.prepare(`SELECT MAX(ground_at) AS at FROM grinder_events`).get() as { at: string | null }).at;
  const from = last ? new Date(Date.parse(last) - OVERLAP_DAYS * 86_400_000) : new Date(Date.now() - cfg().sync_days * 86_400_000);
  const storeId = await resolveStore(acc);
  const rows: EventRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const items = await query(acc, storeId, from, page * PAGE, PAGE);
    for (const it of items) {
      const r = toEvent(it);
      if (r) rows.push(r);
    }
    if (items.length < PAGE) break;
  }
  upsert(rows);
}

/** Abgleich anstoßen (Cloud und Mühle im Heimnetz, je nachdem was eingerichtet ist); gleichzeitige Aufrufe teilen sich einen Lauf,
 *  ohne force höchstens alle 25 s. Wirft nie, Fehler stehen im Status */
export function syncGrinder(force = false): Promise<void> {
  if (state.running) return state.running;
  const { acc } = account();
  const { host } = localHost();
  if ((!acc && !host) || (!force && Date.now() - state.started < MIN_GAP)) return Promise.resolve();
  state.started = Date.now();
  const cloud = acc
    ? run(acc)
        .then(() => {
          state.last_sync = new Date().toISOString();
          state.last_error = null;
        })
        .catch((e: unknown) => {
          state.last_error = e instanceof Error ? e.message : String(e);
          if (!(e instanceof GrinderSyncError)) console.error("Mahlkönig-Abgleich:", e);
        })
    : null;
  const lan = host
    ? localEvents(host)
        .then((rows) => {
          upsert(rows);
          local.last_sync = new Date().toISOString();
          local.last_error = null;
        })
        .catch((e: unknown) => {
          local.last_error = e instanceof Error ? e.message : String(e);
          if (!(e instanceof GrinderLocalError)) console.error("Mühle im Heimnetz:", e);
        })
    : null;
  state.running = Promise.all([cloud, lan]).then(() => {
    state.running = null;
  });
  return state.running;
}

/** Mühle im Heimnetz prüfen (Datenbank einmal laden), dann speichern und übernehmen */
export async function connectLocal(input: string): Promise<void> {
  const host = grinderHost(input);
  if (!host) throw new GrinderLocalError("Adresse der Mühle nicht lesbar, z. B. 192.168.1.50");
  const rows = await localEvents(host);
  setSetting("mahlkoenig_local", JSON.stringify({ host }));
  upsert(rows);
  local.last_sync = new Date().toISOString();
  local.last_error = null;
}

export function disconnectLocal() {
  setSetting("mahlkoenig_local", null);
  local.last_sync = null;
  local.last_error = null;
}

/** Zugang prüfen (anmelden, eine Abfrage), dann speichern und den ersten Abgleich starten */
export async function connectGrinder(acc: GrinderAccount): Promise<void> {
  token = null;
  foundStore = null;
  const storeId = await resolveStore(acc);
  await query(acc, storeId, new Date(Date.now() - 86_400_000), 0, 1);
  setSetting("mahlkoenig", JSON.stringify({ ...acc, store_id: storeId ?? acc.store_id }));
  state.last_error = null;
  state.started = 0;
  void syncGrinder(true);
}

/** Zugang entfernen; die geholten Mahlvorgänge bleiben (Bezüge verweisen darauf) */
export function disconnectGrinder() {
  setSetting("mahlkoenig", null);
  token = null;
  foundStore = null;
  state.last_sync = null;
  state.last_error = null;
}

export function grinderStatus(): GrinderSyncStatus {
  const { acc, source } = account();
  const agg = db.prepare(`SELECT COUNT(*) AS n, MAX(ground_at) AS at FROM grinder_events`).get() as { n: number; at: string | null };
  const lan = localHost();
  return {
    set: Boolean(acc || lan.host),
    cloud: Boolean(acc),
    source,
    email: acc?.email ?? null,
    store_id: acc?.store_id ?? (foundStore && foundStore.email === acc?.email ? foundStore.id : null),
    last_sync: state.last_sync,
    last_error: state.last_error,
    events: Number(agg.n),
    last_event: agg.at,
    local_host: lan.host,
    local_source: lan.source,
    local_sync: local.last_sync,
    local_error: local.last_error,
  };
}

/** Mahlvorgänge mit dem Bezug, der sie nutzt: ab `since` (neueste zuerst) oder ±`hours` um `around` */
export function listGrinderEvents(q: { since?: string; around?: string; hours?: number; limit?: number }): GrinderEvent[] {
  const where: string[] = [];
  const args: string[] = [];
  if (q.around && Number.isFinite(Date.parse(q.around))) {
    const t = Date.parse(q.around);
    const h = (q.hours ?? 6) * 3_600_000;
    where.push(`e.ground_at BETWEEN ? AND ?`);
    args.push(new Date(t - h).toISOString(), new Date(t + h).toISOString());
  } else if (q.since && Number.isFinite(Date.parse(q.since))) {
    where.push(`e.ground_at >= ?`);
    args.push(new Date(Date.parse(q.since)).toISOString());
  }
  const rows = db
    .prepare(
      `SELECT e.id, e.ground_at, e.device, e.grind_um, e.grind_target_um, e.dose_g, e.dose_target_g, e.grind_s, e.recipe_index, e.recipe_mode,
         e.brew_time_target_s, e.brewed_at, e.yield_g, e.shot_s, e.quality, b.id AS brew_id, b.coffee_id AS brew_coffee_id, c.name AS brew_coffee
       FROM grinder_events e LEFT JOIN brews b ON b.grinder_event_id = e.id LEFT JOIN coffees c ON c.id = b.coffee_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY e.ground_at DESC LIMIT ?`,
    )
    .all(...args, Math.min(200, Math.max(1, q.limit ?? 30))) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r }) as unknown as GrinderEvent);
}

/** Hintergrund-Abgleich, nur wenn Zugang oder Mühle hinterlegt sind */
let every: NodeJS.Timeout | null = null;
/** Hintergrund-Abgleich alle `sync_min` Minuten (Einstellungen), neu getaktet bei jeder Änderung */
export function scheduleGrinderSync() {
  setTimeout(() => void syncGrinder(true), 15_000).unref();
  const plan = () => {
    if (every) clearInterval(every);
    every = setInterval(() => void syncGrinder(), cfg().sync_min * 60_000).unref();
  };
  plan();
  onConfig(plan);
}
