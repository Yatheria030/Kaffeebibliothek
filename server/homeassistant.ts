// Home Assistant: Livewerte der Decent DE1 (Entitäten des de1app-MQTT-Plugins) lesen und die Maschine bzw. den Dampf schalten.
// Zugang im Setting `homeassistant` (JSON url, token), sonst HA_URL/HA_TOKEN. Der Token verlässt den Server nie.
import { machineRe, onConfig } from "./config.ts";
import { getSetting, setSetting } from "./store.ts";
import type { HaStatus, MachineLive } from "../shared/types.ts";

type Account = { url: string; token: string };
type Role = "state" | "substate" | "profile" | "head" | "mix" | "steam_temp" | "water" | "power" | "steam";
type Entity = {
  entity_id: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
  attributes?: Record<string, unknown>;
};

export class HaError extends Error {}

/** Entitäten der Maschine erkennen: Teile der ID aus den Einstellungen (`ha_match`, Standard „decent, de1“) */
const ROLES: [Role, RegExp][] = [
  ["substate", /^sensor\..*substate$/],
  ["state", /^sensor\..*_state$/],
  ["profile", /^select\..*profile/],
  ["head", /^sensor\..*head_temperature$/],
  ["mix", /^sensor\..*mix_temperature$/],
  ["steam_temp", /^sensor\..*steam_temperature$/],
  ["water", /^sensor\..*water_level$/],
  ["steam", /^switch\..*steam/],
  ["power", /^switch\./],
];
const DISCOVER_TTL = 10 * 60_000;
const LIVE_TTL = 2_000;
/** so lange ohne jede Meldung gelten die Werte als eingefroren; die Temperaturen melden sich sonst laufend */
const STALE_AFTER = 15 * 60_000;

function account(): { acc: Account | null; source: "env" | "db" | null } {
  const raw = getSetting("homeassistant");
  if (raw) {
    try {
      const a = JSON.parse(raw) as Account;
      if (a.url && a.token) return { acc: a, source: "db" };
    } catch {
      /* kaputter Eintrag: wie nicht gesetzt */
    }
  }
  const url = process.env.HA_URL?.trim();
  const token = process.env.HA_TOKEN?.trim();
  return url && token ? { acc: { url, token }, source: "env" } : { acc: null, source: null };
}

async function call(acc: Account, pathname: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(acc.url.replace(/\/+$/, "") + pathname, {
      method: init?.method ?? "GET",
      headers: { authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? "keine Antwort in 5 s" : e instanceof Error ? (e.cause as Error)?.message ?? e.message : String(e);
    throw new HaError(`Home Assistant nicht erreichbar (${why})`);
  }
  if (res.status === 401 || res.status === 403) throw new HaError("Home Assistant lehnt den Token ab");
  if (res.status === 404) return null;
  if (!res.ok) throw new HaError(`Home Assistant antwortet mit ${res.status}`);
  return res.json();
}

let found: { url: string; at: number; ids: Partial<Record<Role, string>> } | null = null;
onConfig(() => (found = null));

async function discover(acc: Account, force = false) {
  if (!force && found && found.url === acc.url && Date.now() - found.at < DISCOVER_TTL) return found.ids;
  const all = ((await call(acc, "/api/states")) ?? []) as Entity[];
  const ids: Partial<Record<Role, string>> = {};
  const machine = machineRe();
  for (const e of all.filter((x) => machine.test(x.entity_id)).sort((a, b) => a.entity_id.length - b.entity_id.length)) {
    const role = ROLES.find(([, re]) => re.test(e.entity_id))?.[0];
    if (role && !ids[role]) ids[role] = e.entity_id;
  }
  found = { url: acc.url, at: Date.now(), ids };
  return ids;
}

const num = (e: Entity | undefined) => {
  const n = e ? Number(e.state) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};
const val = (e: Entity | undefined) => (e && e.state !== "unavailable" && e.state !== "unknown" ? e.state : null);

const EMPTY: Omit<MachineLive, "configured" | "ok" | "error"> = {
  online: false, state: null, substate: null, profile: null, awake: null, steam: null,
  head_c: null, mix_c: null, steam_c: null, water_ml: null, can_power: false, can_steam: false, changed: null, updated: null, stale: false,
};

let cache: { at: number; value: Promise<MachineLive> } | null = null;

async function read(): Promise<MachineLive> {
  const { acc } = account();
  if (!acc) return { configured: false, ok: false, error: null, ...EMPTY };
  try {
    let ids = await discover(acc);
    const fetchAll = async () => {
      const roles = Object.keys(ids) as Role[];
      const got = await Promise.all(roles.map((r) => call(acc, `/api/states/${ids[r]}`) as Promise<Entity | null>));
      return { roles, got };
    };
    let { roles, got } = await fetchAll();
    // umbenannt oder gelöscht: einmal neu suchen
    if (!roles.length || got.some((e) => e == null)) {
      ids = await discover(acc, true);
      ({ roles, got } = await fetchAll());
    }
    const by = Object.fromEntries(roles.map((r, i) => [r, got[i] ?? undefined])) as Partial<Record<Role, Entity>>;
    if (!by.state) return { configured: true, ok: false, error: "Keine Decent in Home Assistant gefunden", ...EMPTY };
    const state = val(by.state);
    const online = state != null;
    // last_reported zählt auch Meldungen mit gleichem Wert (HA ab 2024.3), sonst last_updated
    const seen = got.map((e) => Date.parse(e?.last_reported ?? e?.last_updated ?? "")).filter(Number.isFinite);
    const latest = seen.length ? Math.max(...seen) : null;
    return {
      configured: true,
      ok: true,
      error: null,
      online,
      state,
      substate: val(by.substate),
      profile: val(by.profile),
      awake: online ? state !== "Sleep" : null,
      steam: val(by.steam) == null ? null : by.steam!.state === "on",
      head_c: num(by.head),
      mix_c: num(by.mix),
      steam_c: num(by.steam_temp),
      water_ml: num(by.water),
      can_power: Boolean(by.power && val(by.power) != null),
      can_steam: Boolean(by.steam && val(by.steam) != null),
      changed: by.state.last_changed ?? null,
      updated: latest == null ? null : new Date(latest).toISOString(),
      stale: online && latest != null && Date.now() - latest > STALE_AFTER,
    };
  } catch (e) {
    if (e instanceof HaError) return { configured: true, ok: false, error: e.message, ...EMPTY };
    throw e;
  }
}

/** Livewerte, mehrere Abfragen innerhalb von 2 s teilen sich eine Runde zu HA */
export function machineLive(): Promise<MachineLive> {
  if (!cache || Date.now() - cache.at > LIVE_TTL) cache = { at: Date.now(), value: read() };
  return cache.value;
}

/** Maschine wecken/schlafen legen (Schalter des Plugins, an = wach) oder Dampf an/aus */
export async function switchMachine(what: "power" | "steam", on: boolean): Promise<MachineLive> {
  const { acc } = account();
  if (!acc) throw new HaError("Home Assistant ist nicht eingerichtet");
  const id = (await discover(acc))[what];
  if (!id) throw new HaError(what === "power" ? "Kein Schalter für die Maschine gefunden" : "Kein Schalter für den Dampf gefunden");
  await call(acc, `/api/services/switch/turn_${on ? "on" : "off"}`, { method: "POST", body: { entity_id: id } });
  cache = null;
  return machineLive();
}

/** Zugang prüfen und speichern */
export async function connectHa(acc: Account): Promise<void> {
  const r = (await call(acc, "/api/")) as { message?: string } | null;
  if (!r?.message) throw new HaError("Unter dieser Adresse antwortet kein Home Assistant");
  setSetting("homeassistant", JSON.stringify({ url: acc.url.replace(/\/+$/, ""), token: acc.token }));
  found = null;
  cache = null;
}

export function disconnectHa() {
  setSetting("homeassistant", null);
  found = null;
  cache = null;
}

export function haStatus(): HaStatus {
  const { acc, source } = account();
  return { set: Boolean(acc), source, url: acc?.url ?? null, hint: acc ? `…${acc.token.slice(-4)}` : null };
}
