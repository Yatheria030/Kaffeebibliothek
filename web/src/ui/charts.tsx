import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { formatScore } from "../../../shared/sca.ts";
import { cx } from "./controls.tsx";

const ACCENT = "var(--c-accent)";
const MUTED = "var(--c-chart-muted)";
const GRID = "var(--c-grid)";
const SURFACE = "var(--c-card)";

export function Tip({ x, y, w, h, children, below }: { x: number; y: number; w: number; h: number; children: ReactNode; below?: boolean }) {
  const left = (x / w) * 100;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-max max-w-[240px] rounded-[10px] bg-[color-mix(in_srgb,var(--c-card)_94%,transparent)] px-3 py-2 text-[12px] leading-snug text-ink shadow-pop frost"
      style={{
        left: `${left}%`,
        top: `${(y / h) * 100}%`,
        transform: `translate(${left > 70 ? "-100%" : left < 30 ? "0" : "-50%"}, ${below ? "14px" : "calc(-100% - 14px)"})`,
      }}
    >
      {children}
    </div>
  );
}

/** Breite des Containers in px, damit Diagramme in echten Pixeln zeichnen statt zu skalieren */
export function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.clientWidth) || fallback);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

export function Legend({ items }: { items: { label: string; swatch: "dot" | "dash" | "dot-muted" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.swatch === "dash" ? (
            <svg width="18" height="4" aria-hidden="true">
              <line x1="1" y1="2" x2="17" y2="2" stroke={MUTED} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
            </svg>
          ) : (
            <span className="size-2 rounded-full" style={{ background: it.swatch === "dot" ? ACCENT : MUTED }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------- Netzdiagramm für die sieben SCA-Attribute (Skala 6–10) ----------

export function Radar({
  axes,
  primary,
  compare,
  primaryLabel,
  compareLabel,
}: {
  axes: string[];
  primary: number[];
  compare?: number[] | null;
  primaryLabel: string;
  compareLabel?: string;
}) {
  const W = 480;
  const H = 360;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const [box, width] = useWidth(W);
  // Schmal: Schrift im viewBox hochrechnen, damit sie real nicht unter ~11,5 px fällt
  const s = Math.min(1, width / W);
  const R = s < 0.8 ? 100 : 122;
  const fs = Math.max(13, 11.5 / s);
  const n = axes.length;
  const [hover, setHover] = useState<number | null>(null);
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0, Math.min(1.3, (v - 6) / 4));
    return [cx0 + Math.cos(a) * R * k, cy0 + Math.sin(a) * R * k] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ");

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div ref={box} className="relative w-full max-w-[460px]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible" role="img" aria-label={`Geschmacksprofil ${primaryLabel}`}>
          {[7, 8, 9, 10].map((v) => (
            <polygon key={v} points={poly(axes.map(() => v))} fill="none" style={{ stroke: GRID }} strokeWidth="1" />
          ))}
          {axes.map((label, i) => {
            const [x2, y2] = pt(i, 10);
            const [lx, ly] = pt(i, 11.15);
            const anchor = Math.abs(lx - cx0) < 10 ? "middle" : lx > cx0 ? "start" : "end";
            return (
              <g key={label}>
                <line x1={cx0} y1={cy0} x2={x2} y2={y2} style={{ stroke: GRID }} strokeWidth="1" />
                <text
                  x={lx}
                  y={ly}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={fs}
                  style={{ fill: hover === i ? "var(--c-ink)" : "var(--c-ink2)", fontWeight: hover === i ? 600 : 400 }}
                >
                  {label}
                </text>
              </g>
            );
          })}
          {[7, 8, 9].map((v) => {
            const [x, y] = pt(0, v);
            return (
              <text key={v} x={x + 5} y={y} fontSize={Math.max(10, 10 / s)} dominantBaseline="middle" style={{ fill: "var(--c-ink3)" }}>
                {v}
              </text>
            );
          })}
          {compare && (
            <polygon
              points={poly(compare)}
              fill="none"
              style={{ stroke: MUTED }}
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          )}
          <polygon
            points={poly(primary)}
            style={{ fill: ACCENT, stroke: ACCENT }}
            fillOpacity="0.12"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {primary.map((v, i) => {
            const [x, y] = pt(i, v);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={hover === i ? 6 : 4.5} style={{ fill: ACCENT, stroke: SURFACE }} strokeWidth="2" />
                <circle
                  cx={x}
                  cy={y}
                  r="16"
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${axes[i]}: ${formatScore(v)}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="cursor-default outline-none"
                />
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <Tip x={pt(hover, primary[hover])[0]} y={pt(hover, primary[hover])[1]} w={W} h={H}>
            <div className="font-semibold">{axes[hover]}</div>
            <div className="tnum mt-0.5 flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: ACCENT }} />
              {primaryLabel}: {formatScore(primary[hover])}
            </div>
            {compare && (
              <div className="tnum flex items-center gap-1.5 text-ink2">
                <span className="size-2 rounded-full" style={{ background: MUTED }} />
                {compareLabel}: {formatScore(compare[hover])}
              </div>
            )}
          </Tip>
        )}
      </div>
      <Legend
        items={[
          { label: primaryLabel, swatch: "dot" },
          ...(compare && compareLabel ? [{ label: compareLabel, swatch: "dash" as const }] : []),
        ]}
      />
    </div>
  );
}

// ---------- Score über eine Größe (Tage, Zeit, Temperatur, Verhältnis) ----------

export type ScorePoint = {
  id: number;
  x: number;
  y: number;
  selected: boolean;
  title: string;
  sub: string;
};

function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

export function ScoreChart({
  points,
  xFmt,
  selectedLabel,
  onPick,
  yFmt = formatScore,
  line = true,
  otherLabel = "Andere Rezepte",
  label,
}: {
  points: ScorePoint[];
  xFmt: (v: number) => string;
  selectedLabel: string;
  onPick?: (id: number) => void;
  /** Wert im Tooltip, Standard SCA-Score */
  yFmt?: (v: number) => string;
  /** Linie durch den Schnitt der gewählten Punkte je x; aus für reine Punktwolken */
  line?: boolean;
  otherLabel?: string;
  label?: string;
}) {
  const [box, W] = useWidth(640);
  const H = W < 480 ? 220 : 250;
  const m = { l: 36, r: 14, t: 14, b: 30 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<ScorePoint | null>(null);

  const g = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x0 === x1) {
      x0 -= 1;
      x1 += 1;
    }
    const xStep = niceStep(x1 - x0, W < 480 ? 4 : 6);
    x0 = Math.floor(x0 / xStep) * xStep;
    x1 = Math.ceil(x1 / xStep) * xStep;
    let y0 = Math.floor(Math.min(...ys) - 0.5);
    let y1 = Math.ceil(Math.max(...ys) + 0.5);
    if (y1 - y0 < 4) {
      const mid = (y0 + y1) / 2;
      y0 = Math.floor(mid - 2);
      y1 = Math.ceil(mid + 2);
    }
    const yStep = niceStep(y1 - y0, 4);
    y0 = Math.floor(y0 / yStep) * yStep;
    y1 = Math.ceil(y1 / yStep) * yStep;
    const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const xTicks: number[] = [];
    for (let v = x0; v <= x1 + 1e-9; v += xStep) xTicks.push(Math.round(v * 100) / 100);
    const yTicks: number[] = [];
    for (let v = y0; v <= y1 + 1e-9; v += yStep) yTicks.push(Math.round(v * 100) / 100);
    // Linie: Mittelwert je x der gewählten Gruppe
    const sel = new Map<number, number[]>();
    if (line) for (const p of points) if (p.selected) sel.set(p.x, [...(sel.get(p.x) ?? []), p.y]);
    const path = [...sel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([x, v]) => [X(x), Y(v.reduce((a, b) => a + b, 0) / v.length)] as const);
    return { X, Y, xTicks, yTicks, line: path, base: H - m.b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, W, H, line]);

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / W;
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    let best: ScorePoint | null = null;
    let bd = Infinity;
    for (const p of points) {
      const d = Math.hypot(g.X(p.x) - px, g.Y(p.y) - py) * scale;
      // gewählte Punkte gewinnen bei Gleichstand
      const dd = d - (p.selected ? 4 : 0);
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    setHover(bd <= 32 ? best : null);
  };

  const others = points.filter((p) => !p.selected);
  const mine = points.filter((p) => p.selected);
  const linePts = g.line.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area =
    g.line.length > 1
      ? `${g.line[0][0].toFixed(1)},${g.base} ${linePts} ${g.line[g.line.length - 1][0].toFixed(1)},${g.base}`
      : "";

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className={cx("block w-full touch-pan-y select-none", hover && onPick && "cursor-pointer")}
          role="img"
          aria-label={label ?? `Score je Bezug, ${selectedLabel} hervorgehoben`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover && onPick?.(hover.id)}
        >
          {g.yTicks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={g.Y(v)} y2={g.Y(v)} style={{ stroke: GRID }} strokeWidth="1" />
              <text x={m.l - 8} y={g.Y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" style={{ fill: "var(--c-ink3)" }}>
                {Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}
              </text>
            </g>
          ))}
          {g.xTicks.map((v) => {
            // Randbeschriftung nach innen ausrichten, sonst wird sie abgeschnitten
            const x = g.X(v);
            const anchor = x > W - 30 ? "end" : "middle";
            return (
              <text key={v} x={anchor === "end" ? W - 2 : x} y={H - 8} textAnchor={anchor} fontSize="11" style={{ fill: "var(--c-ink3)" }}>
                {xFmt(v)}
              </text>
            );
          })}
          {hover && (
            <line
              x1={g.X(hover.x)}
              x2={g.X(hover.x)}
              y1={m.t}
              y2={g.base}
              style={{ stroke: "var(--c-ink4)" }}
              strokeWidth="1"
            />
          )}
          {area && <polygon points={area} style={{ fill: ACCENT }} fillOpacity="0.1" />}
          {g.line.length > 1 && (
            <polyline points={linePts} fill="none" style={{ stroke: ACCENT }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {others.map((p) => (
            <circle
              key={p.id}
              cx={g.X(p.x)}
              cy={g.Y(p.y)}
              r={hover?.id === p.id ? 6 : 4.5}
              style={{ fill: MUTED, stroke: SURFACE }}
              strokeWidth="2"
            />
          ))}
          {mine.map((p) => (
            <circle
              key={p.id}
              cx={g.X(p.x)}
              cy={g.Y(p.y)}
              r={hover?.id === p.id ? 6.5 : 5}
              style={{ fill: ACCENT, stroke: SURFACE }}
              strokeWidth="2"
            />
          ))}
        </svg>
        {hover && (
          <Tip x={g.X(hover.x)} y={g.Y(hover.y)} w={W} h={H} below={g.Y(hover.y) < 80}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-semibold">{hover.title}</span>
              <span className="tnum font-semibold">{yFmt(hover.y)}</span>
            </div>
            <div className="text-ink2">{xFmt(hover.x)}</div>
            {hover.sub && <div className="text-ink2">{hover.sub}</div>}
          </Tip>
        )}
      </div>
      <Legend
        items={[
          { label: selectedLabel, swatch: "dot" },
          ...(others.length ? [{ label: otherLabel, swatch: "dot-muted" as const }] : []),
        ]}
      />
    </div>
  );
}

// ---------- Waagrechte Balken (Statistik) ----------

export function BarList({
  rows,
  unit,
  fmt = String,
}: {
  rows: { label: string; value: number; sub?: string; lead?: ReactNode }[];
  /** Einzahl und Mehrzahl */
  unit: [string, string];
  /** Anzeige des Werts, Standard ganze Zahl (z. B. Euro mit Komma) */
  fmt?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    // Ein Raster für alle Zeilen (subgrid): sonst hängt die Balkenspur je Zeile von der Breite des Werts ab
    <ul className="m-0 grid list-none grid-cols-[minmax(88px,34%)_minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 p-0">
      {rows.map((r, i) => (
        <li
          key={r.label}
          className="col-span-3 grid grid-cols-subgrid items-center"
          onPointerEnter={() => setHover(i)}
          onPointerLeave={() => setHover(null)}
        >
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            {r.lead}
            <span className="truncate">{r.label}</span>
          </span>
          <span className="h-[10px] rounded-[4px] bg-fill">
            <span
              className="block h-[10px] rounded-[4px] transition-[filter]"
              style={{ width: `${(r.value / max) * 100}%`, background: ACCENT, filter: hover === i ? "brightness(1.12)" : undefined }}
            />
          </span>
          <span className="tnum min-w-[4.5rem] text-right text-[13px]">
            <span className="font-semibold">{fmt(r.value)}</span> <span className="text-ink3">{r.value === 1 ? unit[0] : unit[1]}</span>
            {r.sub && <span className="block text-[11px] text-ink3">{r.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Säulen je Monat ----------

export function Columns({ data, label = "Bezüge je Monat" }: { data: { key: string; label: string; value: number; tip: ReactNode }[]; label?: string }) {
  const [box, W] = useWidth(640);
  const H = W < 480 ? 180 : 200;
  const m = { l: 30, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.value));
  // Gezählt wird in ganzen Bezügen: keine halben Schritte auf der Achse
  const step = Math.max(1, Math.ceil(niceStep(max, 4)));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const slot = (W - m.l - m.r) / Math.max(1, data.length);
  const bw = Math.min(24, slot * 0.6);
  const Y = (v: number) => H - m.b - (v / top) * (H - m.t - m.b);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} style={{ stroke: v === 0 ? "var(--c-ink4)" : GRID }} strokeWidth="1" />
            <text x={m.l - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" style={{ fill: "var(--c-ink3)" }}>
              {v}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = m.l + slot * i + slot / 2;
          const h = Math.max(0, Y(0) - Y(d.value));
          const r = Math.min(4, h / 2, bw / 2);
          const x0 = x - bw / 2;
          const y0 = Y(d.value);
          const path =
            h > 0
              ? `M${x0},${Y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${Y(0)} Z`
              : "";
          return (
            <g key={d.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={m.l + slot * i} y={m.t} width={slot} height={H - m.t - m.b} fill="transparent" />
              {path && <path d={path} style={{ fill: ACCENT, filter: hover === i ? "brightness(1.12)" : undefined }} />}
              <text x={x} y={H - 8} textAnchor="middle" fontSize="11" style={{ fill: hover === i ? "var(--c-ink)" : "var(--c-ink3)" }}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tip x={m.l + slot * hover + slot / 2} y={Y(data[hover].value)} w={W} h={H}>
          {data[hover].tip}
        </Tip>
      )}
    </div>
  );
}
