import { fmtSec } from "../../../shared/shot.ts";

const dDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const dShort = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const dTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const dMonth = new Intl.DateTimeFormat("de-DE", { month: "short" });
const dMonthYear = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

function toDate(iso: string): Date | null {
  // Reine Datumswerte (YYYY-MM-DD) als lokale Zeit lesen, sonst verrutscht der Tag.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00") : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = toDate(iso);
  return d ? dDate.format(d) : "–";
}

/** "24.10." im laufenden Jahr, sonst mit Jahr */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = toDate(iso);
  if (!d) return "–";
  return d.getFullYear() === new Date().getFullYear() ? dShort.format(d).replace(/\.?$/, ".") : dDate.format(d);
}

export function fmtDateTime(iso: string): string {
  const d = toDate(iso);
  return d ? `${fmtDateShort(iso)} · ${dTime.format(d)}` : "–";
}

export function fmtMonth(ym: string): string {
  const d = toDate(ym + "-01");
  return d ? dMonth.format(d).replace(".", "") : ym;
}

export function fmtMonthLong(ym: string): string {
  const d = toDate(ym + "-01");
  return d ? dMonthYear.format(d) : ym;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = toDate(iso);
  if (!d) return "–";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  if (days > 1 && days < 7) return `vor ${days} Tagen`;
  return fmtDateShort(iso);
}

const n1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/** Cup Score des Rösters, z. B. „85 Punkte“ oder „86,25 Punkte“ */
export function fmtCupScore(v: number): string {
  return `${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Punkte`;
}

export function fmtNum(v: number | null | undefined, digits: 0 | 1 = 1): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return digits === 0 ? n0.format(v) : n1.format(v);
}

export function fmtGrams(v: number | null | undefined): string {
  return v == null ? "–" : `${n1.format(v)} g`;
}

export function fmtEuro(v: number | null | undefined): string {
  return v == null ? "–" : `${n2.format(v)} €`;
}

export function fmtTemp(v: number | null | undefined): string {
  return v == null ? "–" : `${n1.format(v)} °C`;
}

/** Sekunden als m:ss, unter einer Minute als "28 s" oder "26,8 s" */
export function fmtTime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "–";
  if (s < 59.95) return `${fmtSec(s)} s`;
  return timeInput(s);
}

/** Bezugszeit mit Preinfusion davor: „7 + 26,8 s“, ohne Preinfusion wie `fmtTime` */
export function fmtBrewTime(b: { time_s: number | null; preinfusion_s?: number | null }): string {
  if (b.time_s == null) return "–";
  return b.preinfusion_s ? `${fmtSec(b.preinfusion_s)} + ${fmtTime(b.time_s)}` : fmtTime(b.time_s);
}

/** Für Eingabefelder: immer m:ss */
export function timeInput(s: number | null | undefined): string {
  if (s == null) return "";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Für Sekundenfelder (Espresso): „26,8“ */
export const secondsInput = (s: number | null | undefined) => (s == null ? "" : fmtSec(s));

/** "26,8", "26.8", "27", "27s" -> Sekunden auf Zehntel; "0:27" geht auch */
export function parseSeconds(str: string): number | null {
  const t = str.trim().replace(/\s*s$/i, "");
  const d = t.match(/^(\d{1,3})(?:[.,](\d))?$/);
  if (d) return Number(d[1]) + (d[2] ? Number(d[2]) / 10 : 0);
  return /:/.test(t) ? parseTime(t) : null;
}

/** "3:05", "3.05", "185", "28s" -> Sekunden; "2,5" sind 2,5 Minuten; Sekunden über 59 ungültig */
export function parseTime(str: string): number | null {
  const t = str.trim().replace(/\s*s$/i, "");
  if (!t) return null;
  const d = t.match(/^(\d{1,3})[.,](\d)$/);
  if (d) return Math.round((Number(d[1]) + Number(d[2]) / 10) * 60);
  const m = t.match(/^(\d{1,3})[:.,](\d{1,2})$/);
  if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  return /^\d{1,5}$/.test(t) ? Number(t) : null;
}

/** "16,5" -> 16.5, "1.000" -> 1000 (Punkt mit drei Ziffern ist der Tausenderpunkt); leer -> null */
export function parseNum(str: string): number | null {
  const raw = str.trim().replace(/\s/g, "");
  const t = /^[1-9]\d{0,2}(\.\d{3})+(,\d*)?$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function numInput(v: number | null | undefined): string {
  return v == null ? "" : String(v).replace(".", ",");
}

export function fmtRatio(dose: number | null, water: number | null): string {
  if (!dose || !water) return "–";
  return `1:${n1.format(water / dose)}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Wert für <input type="datetime-local"> */
export function localDateTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalDateTime(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
