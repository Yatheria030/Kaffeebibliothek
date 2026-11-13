import { useEffect, useMemo, useRef, useState } from "react";
import { formatScore } from "../../../shared/sca.ts";
import { countryCode, countryFlag } from "../../../shared/types.ts";
import { plural } from "../lib/format.ts";
import { Tip } from "./charts.tsx";
import { cx, Spinner } from "./controls.tsx";

/**
 * Weltkarte der Herkunftsländer, offline: Umrisse aus `lib/worldmap.json` (Natural Earth 1:110m, Equal Earth, ohne Antarktis),
 * erzeugt einmalig aus world-atlas; die Datei wird erst geladen, wenn die Karte zu sehen ist.
 */
type MapData = { w: number; h: number; countries: [iso: string, d: string][] };
export type MapRow = { label: string; count: number; avg: number | null };
export type MapMode = "count" | "avg";

// Länder ohne Kaffee und ohne SCA-Wert: aus Schrift- und Kartenfarbe gemischt, damit beide Modi genug Kontrast haben
const LAND = "color-mix(in srgb, var(--c-ink) 9%, var(--c-card))";
const UNRATED = "color-mix(in srgb, var(--c-ink) 24%, var(--c-card))";
const shade = (pct: number) => `color-mix(in srgb, var(--c-accent) ${pct}%, ${LAND})`;

let cache: MapData | null = null;
const loadMap = () => import("../lib/worldmap.json").then((m) => (cache = m.default as unknown as MapData));

/** Ländername (wie im Kaffee erfasst) → ISO-Code: bekannte Kaffeeländer über die Flagge, sonst über die deutschen Namen des Browsers */
function resolver(codes: string[]) {
  const de = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(["de"], { type: "region" });
    for (const c of codes) {
      const n = names.of(c);
      if (n) de.set(n.toLowerCase(), c);
    }
  } catch {
    // ohne Intl.DisplayNames nur die bekannten Länder
  }
  return (label: string) => countryCode(label) ?? de.get(label.trim().toLowerCase()) ?? null;
}

export function WorldMap({ rows, mode, onPick }: { rows: MapRow[]; mode: MapMode; onPick: (label: string) => void }) {
  const [map, setMap] = useState<MapData | null>(cache);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ row: MapRow; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (map) return;
    let live = true;
    loadMap().then(
      (m) => live && setMap(m),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [map]);

  const { byIso, missing, max, lo, hi } = useMemo(() => {
    const byIso = new Map<string, MapRow>();
    const missing: MapRow[] = [];
    if (!map) return { byIso, missing, max: 1, lo: 0, hi: 0 };
    const codes = new Set(map.countries.map(([c]) => c));
    const resolve = resolver([...codes]);
    for (const r of rows) {
      if (!r.label.trim() || r.label === "Unbekannt") continue;
      const iso = resolve(r.label);
      // mehrere Schreibweisen eines Landes zusammenfassen
      if (iso && codes.has(iso)) {
        const prev = byIso.get(iso);
        byIso.set(iso, prev ? mergeRows(prev, r) : r);
      } else missing.push(r);
    }
    const all = [...byIso.values(), ...missing];
    const avgs = all.flatMap((r) => (r.avg != null ? [r.avg] : []));
    return { byIso, missing, max: Math.max(1, ...all.map((r) => r.count)), lo: Math.min(...avgs), hi: Math.max(...avgs) };
  }, [map, rows]);

  if (failed) return <p className="m-0 rounded-[12px] bg-card2 px-4 py-6 text-center text-[14px] text-ink2">Die Karte ließ sich nicht laden.</p>;
  if (!map)
    return (
      <div className="flex aspect-[919/431] items-center justify-center">
        <Spinner size={20} />
      </div>
    );

  // Anteil 0–1 für die Farbstärke: Anzahl wurzelskaliert (ein Land mit vielen Kaffees soll die anderen nicht verblassen lassen)
  const share = (r: MapRow): number | null => {
    if (mode === "count") return Math.sqrt(r.count / max);
    if (r.avg == null) return null;
    return hi - lo < 0.5 ? 1 : (r.avg - lo) / (hi - lo);
  };
  const fill = (r: MapRow | undefined) => {
    if (!r) return LAND;
    const s = share(r);
    if (s == null) return UNRATED;
    return shade(Math.round(28 + 72 * s));
  };
  const show = (row: MapRow, e: { clientX: number; clientY: number }) => {
    const b = box.current?.getBoundingClientRect();
    if (b) setHover({ row, x: e.clientX - b.left, y: e.clientY - b.top });
  };
  const w = box.current?.clientWidth ?? 1;
  const h = box.current?.clientHeight ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${map.w} ${map.h}`} className="block h-auto w-full" role="group" aria-label="Weltkarte der Herkunftsländer">
          {map.countries.map(([iso, d], i) => {
            const r = byIso.get(iso);
            if (!r) return <path key={i} d={d} style={{ fill: LAND, stroke: "var(--c-card)" }} strokeWidth="0.5" aria-hidden="true" />;
            return (
              <path
                key={i}
                d={d}
                role="button"
                tabIndex={0}
                aria-label={`${r.label}: ${label(r)}. In der Bibliothek zeigen`}
                className="cursor-pointer outline-none transition-[filter] hover:brightness-110 focus-visible:brightness-110"
                style={{ fill: fill(r), stroke: hover?.row === r ? "var(--c-ink)" : "var(--c-card)" }}
                strokeWidth={hover?.row === r ? 1.2 : 0.5}
                onPointerMove={(e) => show(r, e)}
                onFocus={(e) => {
                  const b = (e.target as SVGPathElement).getBoundingClientRect();
                  show(r, { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 });
                }}
                onBlur={() => setHover(null)}
                onClick={() => onPick(r.label)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(r.label);
                  }
                }}
              />
            );
          })}
        </svg>
        {hover && (
          <Tip x={hover.x} y={hover.y} w={w} h={h}>
            <span className="font-semibold">
              {countryFlag(hover.row.label)} {hover.row.label}
            </span>
            <br />
            {label(hover.row)}
          </Tip>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-ink3">
        <span className="flex items-center gap-2">
          {mode === "count" ? "1" : lo === Infinity ? "–" : formatScore(lo)}
          <span
            aria-hidden="true"
            className="h-2 w-24 rounded-full"
            style={{ background: `linear-gradient(90deg, ${shade(28)}, var(--c-accent))` }}
          />
          {mode === "count" ? plural(max, "Kaffee", "Kaffees") : hi === -Infinity ? "–" : formatScore(hi)}
          {mode === "avg" && (
            <span className="flex items-center gap-1.5 pl-2">
              <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: UNRATED }} />
              ohne SCA-Bogen
            </span>
          )}
        </span>
        <span>Land antippen filtert die Bibliothek</span>
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink3">
          <span>Nicht auf der Karte:</span>
          {missing.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onPick(r.label)}
              className={cx("rounded-full bg-fill px-2.5 py-1 text-[12px] text-ink hover:bg-hover")}
            >
              {countryFlag(r.label)} {r.label} · {r.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function label(r: MapRow) {
  return [plural(r.count, "Kaffee", "Kaffees"), r.avg != null ? `Ø ${formatScore(r.avg)}` : null].filter(Boolean).join(" · ");
}

function mergeRows(a: MapRow, b: MapRow): MapRow {
  const avg = a.avg != null && b.avg != null ? (a.avg * a.count + b.avg * b.count) / (a.count + b.count) : (a.avg ?? b.avg);
  return { label: a.count >= b.count ? a.label : b.label, count: a.count + b.count, avg };
}
