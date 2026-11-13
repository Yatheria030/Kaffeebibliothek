import { DRINK_WINDOWS, type DrinkWindow } from "./freshness.ts";
import type { RoastFor, RoastLevel } from "./types.ts";

/**
 * Einstellbare Betriebswerte (Setting `config`, JSON). Jeder Wert ist optional: null heißt Standard, der kommt aus der Umgebung
 * (ältere Installationen) oder ist eingebaut. Nur DATA_DIR, PORT und HOST bleiben Umgebung, weil sie vor der Datenbank feststehen müssen.
 */
export type DrinkWindows = Record<RoastFor, Record<RoastLevel, DrinkWindow>>;

export type AppConfig = {
  /** Modell für Auslesen und Empfehlungen */
  model: string | null;
  /** IANA-Zeitzone, z. B. Europe/Berlin; bestimmt die Uhrzeit der Sicherung und „heute“ auf dem Server */
  timezone: string | null;
  /** Ordner für die nächtliche Sicherung auf dem Server (absolut) */
  backup_dir: string | null;
  /** nächtliche Sicherung aus, auch wenn ein Ordner bekannt ist */
  backup_off: boolean | null;
  /** Uhrzeit „HH:MM“ */
  backup_time: string | null;
  /** so viele Sicherungen bleiben liegen */
  backup_keep: number | null;
  /** Abgleich der Mühle alle n Minuten */
  sync_min: number | null;
  /** so viele Tage zurück holt der erste Abgleich (Cloud und Heimnetz) */
  sync_days: number | null;
  /** Teile der Entitäts-IDs, an denen Home Assistant die Maschine erkennt, kommagetrennt */
  ha_match: string | null;
  /** eigene Trinkfenster statt der recherchierten */
  drink_windows: DrinkWindows | null;
};

export type ConfigKey = keyof AppConfig;
export type Effective = Omit<{ [K in ConfigKey]-?: NonNullable<AppConfig[K]> }, "backup_dir"> & { backup_dir: string | null };

export const BUILTIN = {
  model: "claude-opus-5-5",
  backup_time: "02:30",
  backup_keep: 14,
  sync_min: 10,
  sync_days: 90,
  ha_match: "decent, de1",
} as const;

export type ConfigView = {
  /** was in den Einstellungen steht (null = Standard) */
  saved: AppConfig;
  /** was gilt */
  effective: Effective;
  /** was ohne Eintrag gelten würde, mit Herkunft */
  defaults: Effective;
  sources: Partial<Record<ConfigKey, "env" | "builtin">>;
};

export const EMPTY_CONFIG: AppConfig = {
  model: null,
  timezone: null,
  backup_dir: null,
  backup_off: null,
  backup_time: null,
  backup_keep: null,
  sync_min: null,
  sync_days: null,
  ha_match: null,
  drink_windows: null,
};

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fenster müssen aufsteigen: trinkbereit ≤ bestes Ende ≤ noch gut */
export function validWindow(w: DrinkWindow): boolean {
  return [w.ready, w.peak, w.end].every((n) => Number.isInteger(n) && n >= 0 && n <= 365) && w.ready <= w.peak && w.peak <= w.end;
}

export const windowsOf = (c: { drink_windows: DrinkWindows | null } | null | undefined): DrinkWindows => c?.drink_windows ?? DRINK_WINDOWS;

/** „decent, de1“ → Muster: Teil der ID zwischen Trennzeichen oder als Wortanfang („decent“ trifft auch sensor.decent_state) */
export function machinePattern(list: string): RegExp {
  const parts = list
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length) return /(?!)/;
  return new RegExp(parts.map((p) => (p.length <= 3 ? `(^|[._])${p}([._]|$)` : p)).join("|"), "i");
}
