import path from "node:path";
import { BUILTIN, EMPTY_CONFIG, machinePattern, validTimezone, validWindow, type AppConfig, type ConfigKey, type ConfigView, type Effective } from "../shared/config.ts";
import { DRINK_WINDOWS } from "../shared/freshness.ts";
import { getSetting, setSetting } from "./store.ts";

/**
 * Betriebswerte aus dem Setting `config`; was dort fehlt, kommt aus der Umgebung (SCRAPE_MODEL, TZ, BACKUP_DIR, BACKUP_KEEP), sonst eingebaut.
 * Wer etwas davon nutzt, liest es bei jedem Gebrauch über `cfg()` und hört bei Bedarf per `onConfig` auf Änderungen.
 */

/** Zeitzone beim Start, bevor eine aus den Einstellungen sie überschreibt */
const ENV_TZ = process.env.TZ?.trim() || null;
const SYSTEM_TZ = ENV_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

function envDefaults(): { values: Effective; sources: ConfigView["sources"] } {
  const keep = Number(process.env.BACKUP_KEEP);
  const env = {
    model: process.env.SCRAPE_MODEL?.trim() || null,
    timezone: ENV_TZ,
    backup_dir: process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : null,
    backup_keep: Number.isInteger(keep) && keep > 0 ? keep : null,
  };
  const sources: ConfigView["sources"] = {};
  for (const k of ["model", "timezone", "backup_dir", "backup_keep", "backup_time", "sync_min", "sync_days", "ha_match", "drink_windows"] as ConfigKey[])
    sources[k] = (env as Record<string, unknown>)[k] != null ? "env" : "builtin";
  return {
    values: {
      model: env.model ?? BUILTIN.model,
      timezone: env.timezone ?? SYSTEM_TZ,
      backup_dir: env.backup_dir,
      backup_off: false,
      backup_time: BUILTIN.backup_time,
      backup_keep: env.backup_keep ?? BUILTIN.backup_keep,
      sync_min: BUILTIN.sync_min,
      sync_days: BUILTIN.sync_days,
      ha_match: BUILTIN.ha_match,
      drink_windows: DRINK_WINDOWS,
    },
    sources,
  };
}

let cached: { raw: string | null; saved: AppConfig } | null = null;

function saved(): AppConfig {
  const raw = getSetting("config");
  if (cached && cached.raw === raw) return cached.saved;
  let parsed: Partial<AppConfig> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Partial<AppConfig>) : {};
  } catch {
    /* kaputter Eintrag: wie leer */
  }
  const s = { ...EMPTY_CONFIG, ...parsed };
  cached = { raw, saved: s };
  return s;
}

export function cfg(): Effective {
  const s = saved();
  const d = envDefaults().values;
  const out = { ...d };
  for (const k of Object.keys(EMPTY_CONFIG) as ConfigKey[]) if (s[k] != null) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

export function configView(): ConfigView {
  const d = envDefaults();
  return { saved: saved(), effective: cfg(), defaults: d.values, sources: d.sources };
}

export class ConfigError extends Error {}

/** Teilweise ändern: undefined lässt den Wert, null nimmt den Standard */
export function saveConfig(patch: Partial<AppConfig>) {
  const next: AppConfig = { ...saved() };
  for (const [k, v] of Object.entries(patch) as [ConfigKey, unknown][]) {
    if (v === undefined) continue;
    (next as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() || null : v;
  }
  if (next.timezone && !validTimezone(next.timezone)) throw new ConfigError(`Zeitzone „${next.timezone}“ unbekannt, z. B. Europe/Berlin`);
  if (next.backup_dir && !path.isAbsolute(next.backup_dir)) throw new ConfigError("Ordner für die Sicherung bitte als absoluten Pfad angeben, z. B. /backups");
  if (next.backup_dir) next.backup_dir = path.resolve(next.backup_dir);
  if (next.ha_match && machinePattern(next.ha_match).source === "(?!)") next.ha_match = null;
  if (next.drink_windows) {
    for (const byLevel of Object.values(next.drink_windows))
      for (const w of Object.values(byLevel)) if (!validWindow(w)) throw new ConfigError("Trinkfenster: Tage aufsteigend angeben (trinkbereit ≤ am besten bis ≤ noch gut bis)");
    if (JSON.stringify(next.drink_windows) === JSON.stringify(DRINK_WINDOWS)) next.drink_windows = null;
  }
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v != null));
  setSetting("config", Object.keys(clean).length ? JSON.stringify(clean) : null);
  applyTimezone();
  for (const fn of listeners) fn();
}

const listeners: (() => void)[] = [];
export const onConfig = (fn: () => void) => listeners.push(fn);

/** Node übernimmt eine geänderte TZ sofort für Date */
export function applyTimezone() {
  const tz = cfg().timezone;
  if (process.env.TZ !== tz) process.env.TZ = tz;
}

export const machineRe = () => machinePattern(cfg().ha_match);
