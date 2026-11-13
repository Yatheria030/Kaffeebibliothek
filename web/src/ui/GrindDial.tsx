import { Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { grinderBase, roundTo, type GrinderProfile } from "../../../shared/compass.ts";
import { grindNumber } from "../../../shared/grind.ts";
import { cx } from "./controls.tsx";
import { fmtG, fmtU } from "./DialIn.tsx";

export type DialMarkKind = "kompass" | "good" | "last" | "tip";
export type DialMark = { value: number; kind: DialMarkKind; label: string };

export const MARK_COLOR: Record<DialMarkKind, string> = {
  kompass: "var(--c-accent)",
  good: "var(--c-green)",
  tip: "var(--c-star)",
  last: "var(--c-ink3)",
};

const H = 58;

/**
 * Mahlgrad-Regler für eine bekannte Mühle: Maßband unter einer festen Nadel, ziehen (mit Schwung), Mausrad, Pfeiltasten,
 * Antippen springt an die Stelle. Markierungen für Kompass, letzten guten Bezug, Tipp und letzten Bezug, die Spanne als Band.
 * Darunter große ±-Tasten und Sprung-Chips, damit morgens ein Daumen reicht. Die Zahl lässt sich auch tippen.
 */
export function GrindDial({
  id,
  value,
  onChange,
  profile,
  method,
  marks,
  range,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number) => void;
  profile: GrinderProfile;
  method: string;
  marks: DialMark[];
  range: [number, number] | null;
}) {
  const base = grinderBase(profile, method);
  const ppu = base.ppu;
  const minor = base.major / 10;
  const clamp = (v: number) => Math.min(profile.max, Math.max(profile.min, v));
  const snap = (v: number) => clamp(roundTo(v, minor >= 1 ? Math.max(profile.step, 1) : profile.step));
  const kompass = marks.find((m) => m.kind === "kompass");
  const anchor = value ?? kompass?.value ?? base.value;

  // Schwebende Lage während Ziehen und Schwung, sonst der Wert
  const [pos, setPos] = useState<number | null>(null);
  const view = pos ?? anchor;
  const [w, setW] = useState(320);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean; samples: { t: number; x: number }[] } | null>(null);
  const anim = useRef<number | null>(null);
  const last = useRef<number | null>(value);
  last.current = value;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const stopAnim = () => {
    if (anim.current != null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  useEffect(() => stopAnim, []);

  /** Wert setzen; beim Überqueren eines Hauptstrichs oder einer Markierung kurz vibrieren (Android) */
  const commit = (raw: number) => {
    const v = snap(raw);
    const prev = last.current;
    if (v === prev) return;
    if (prev != null) {
      const crossed = Math.floor(prev / base.major) !== Math.floor(v / base.major) || marks.some((m) => (m.value - prev) * (m.value - v) <= 0 && m.value !== prev);
      if (crossed) navigator.vibrate?.(4);
    }
    last.current = v;
    onChange(v);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    stopAnim();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: view, moved: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    d.samples = [...d.samples.filter((s) => e.timeStamp - s.t < 90), { t: e.timeStamp, x: e.clientX }];
    const p = clamp(d.start - dx / ppu);
    setPos(p);
    commit(p);
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // Antippen: an die Stelle springen
      const rect = e.currentTarget.getBoundingClientRect();
      commit(view + (e.clientX - rect.left - rect.width / 2) / ppu);
      setPos(null);
      return;
    }
    const first = d.samples[0];
    const dt = e.timeStamp - first.t;
    let v = dt > 0 ? -(e.clientX - first.x) / dt / ppu : 0; // Einheiten je ms
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || Math.abs(v) < 0.02) {
      setPos(null);
      return;
    }
    let p = clamp(d.start - (e.clientX - d.x) / ppu);
    let t0 = performance.now();
    const step = (t: number) => {
      const dt2 = Math.min(32, t - t0);
      t0 = t;
      p = clamp(p + v * dt2);
      v *= Math.pow(0.93, dt2 / 16);
      setPos(p);
      commit(p);
      if (Math.abs(v) < 0.004 || p <= profile.min || p >= profile.max) {
        anim.current = null;
        setPos(null);
        return;
      }
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  // Mausrad und Trackpad: passiver Listener geht nicht, sonst scrollt die Seite mit
  const wheelAcc = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelAcc.current += e.deltaMode === 1 ? d * 30 : d;
      const n = Math.trunc(wheelAcc.current / 30);
      if (!n) return;
      wheelAcc.current -= n * 30;
      commit((last.current ?? anchor) + n * minor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onKey = (e: React.KeyboardEvent) => {
    const cur = last.current ?? anchor;
    const map: Record<string, number> = { ArrowLeft: -minor, ArrowDown: -minor, ArrowRight: minor, ArrowUp: minor, PageDown: -base.major, PageUp: base.major };
    if (e.key in map) {
      e.preventDefault();
      commit(cur + map[e.key] * (e.shiftKey ? 5 : 1));
    } else if (e.key === "Home" && kompass) {
      e.preventDefault();
      commit(kompass.value);
    }
  };

  // Maßband
  const half = w / 2 / ppu;
  const from = Math.floor((view - half) / minor) * minor;
  const ticks: number[] = [];
  for (let t = from; t <= view + half + minor; t += minor) if (t >= profile.min && t <= profile.max) ticks.push(Math.round(t * 100) / 100);
  const xOf = (v: number) => w / 2 + (v - view) * ppu;
  const shown = dedupe(marks);
  const inRange = value != null && range != null && value >= range[0] && value <= range[1];
  const delta = value != null && kompass ? Math.round((value - kompass.value) * 100) / 100 : null;

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <label htmlFor={id} className="text-[15px]">
            {profile.name}
          </label>
          <span className="text-[12px] text-ink3">
            {base.label} · {profile.unit} ab Nullpunkt
          </span>
        </div>
        <Readout value={value} unit={profile.unit} onChange={(v) => commit(v)} accent={inRange} />
      </div>

      <div
        ref={box}
        id={id}
        role="slider"
        tabIndex={0}
        aria-label={`Mahlgrad in ${profile.unit}`}
        aria-valuemin={profile.min}
        aria-valuemax={profile.max}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value != null ? `${fmtG(value)} ${profile.unit}` : "nicht gesetzt"}
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setPos(null);
        }}
        className="relative cursor-grab touch-pan-y overflow-hidden rounded-[12px] bg-card2 outline-none select-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        style={{ height: H }}
      >
        <svg
          width={w}
          height={H}
          className="absolute inset-0"
          style={{ maskImage: "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)" }}
          aria-hidden="true"
        >
          {range && <rect x={xOf(range[0])} y={0} width={Math.max(0, (range[1] - range[0]) * ppu)} height={H} fill="var(--c-accent-soft)" />}
          {ticks.map((t) => {
            const major = Math.abs(t / base.major - Math.round(t / base.major)) < 1e-6;
            const mid = !major && Math.abs((t * 2) / base.major - Math.round((t * 2) / base.major)) < 1e-6;
            const x = xOf(t);
            return (
              <g key={t}>
                <line x1={x} x2={x} y1={0} y2={major ? 22 : mid ? 15 : 9} stroke={major ? "var(--c-ink3)" : "var(--c-ink4)"} strokeWidth={major ? 1.5 : 1} />
                {major && (
                  <text x={x} y={H - 9} textAnchor="middle" className="tnum" fontSize={11} fontWeight={600} fill="var(--c-ink3)">
                    {fmtG(t)}
                  </text>
                )}
              </g>
            );
          })}
          {shown.map((m) => (
            <g key={m.kind}>
              <line x1={xOf(m.value)} x2={xOf(m.value)} y1={0} y2={34} stroke={MARK_COLOR[m.kind]} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.75} />
              <circle cx={xOf(m.value)} cy={30} r={4} fill={MARK_COLOR[m.kind]} />
            </g>
          ))}
        </svg>
        {/* Markierungen außerhalb der Skala: Pfeil am Rand, antippen springt hin */}
        {shown
          .filter((m) => Math.abs(m.value - view) > half - 2 / ppu)
          .map((m) => {
            const left = m.value < view;
            return (
              <button
                key={`edge-${m.kind}`}
                type="button"
                tabIndex={-1}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => commit(m.value)}
                className={cx(
                  "absolute top-1/2 z-10 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-2 text-[11px] font-semibold text-ink2 shadow-card",
                  left ? "left-1.5" : "right-1.5",
                )}
              >
                {left && <span aria-hidden="true">‹</span>}
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: MARK_COLOR[m.kind] }} aria-hidden="true" />
                <span className="tnum">{fmtG(m.value)}</span>
                {!left && <span aria-hidden="true">›</span>}
              </button>
            );
          })}
        {/* Nadel */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-ink" />
        <div className="pointer-events-none absolute top-0 left-1/2 size-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-ink" />
      </div>

      <div className="flex items-center gap-2">
        <NudgeButton label={`${fmtU(minor * 5, profile.unit)} feiner`} onClick={() => commit((last.current ?? anchor) - minor * 5)} double />
        <NudgeButton label={`${fmtU(minor, profile.unit)} feiner`} onClick={() => commit((last.current ?? anchor) - minor)} />
        <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
          <span className="text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">feiner · gröber</span>
          {delta != null && (
            <span className={cx("tnum text-[12px] font-semibold", delta === 0 ? "text-accent" : "text-ink2")}>
              {delta === 0 ? "= Kompass" : `${delta > 0 ? "+" : "−"}${fmtG(Math.abs(delta))} zum Kompass`}
            </span>
          )}
        </div>
        <NudgeButton label={`${fmtU(minor, profile.unit)} gröber`} onClick={() => commit((last.current ?? anchor) + minor)} plus />
        <NudgeButton label={`${fmtU(minor * 5, profile.unit)} gröber`} onClick={() => commit((last.current ?? anchor) + minor * 5)} plus double />
      </div>

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((m) => (
            <button
              key={m.kind}
              type="button"
              onClick={() => commit(m.value)}
              aria-pressed={value === m.value}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
                value === m.value ? "bg-ink text-bg" : "bg-fill text-ink hover:bg-fill2",
              )}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: MARK_COLOR[m.kind] }} aria-hidden="true" />
              {m.label}
              <span className="tnum font-bold">{fmtG(m.value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pro Art eine Markierung; gleiche Werte nur einmal, die wichtigere zuerst */
function dedupe(marks: DialMark[]): DialMark[] {
  const order: DialMarkKind[] = ["tip", "good", "kompass", "last"];
  const out: DialMark[] = [];
  for (const k of order) {
    const m = marks.find((x) => x.kind === k);
    if (m && !out.some((o) => o.value === m.value)) out.push(m);
  }
  return out;
}

function NudgeButton({ label, onClick, plus, double }: { label: string; onClick: () => void; plus?: boolean; double?: boolean }) {
  const Icon = plus ? Plus : Minus;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-0.5 rounded-[12px] bg-fill px-2 text-ink hover:bg-fill2 active:scale-95 active:bg-fill2"
    >
      <Icon size={16} strokeWidth={2.6} aria-hidden="true" />
      {double && <Icon size={16} strokeWidth={2.6} aria-hidden="true" className="-ml-2" />}
    </button>
  );
}

/** Große Zahl; antippen zum Eintippen */
function Readout({ value, unit, onChange, accent }: { value: number | null; unit: string; onChange: (v: number) => void; accent: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  const done = () => {
    const v = edit != null ? grindNumber(edit) : null;
    if (v != null) onChange(v);
    setEdit(null);
  };
  if (edit != null)
    return (
      <input
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        inputMode="decimal"
        aria-label={`Mahlgrad in ${unit}`}
        value={edit}
        onChange={(e) => setEdit(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            done();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setEdit(null);
          }
        }}
        className="field tnum h-11 w-28 text-right text-[26px] font-extrabold"
      />
    );
  return (
    <button
      type="button"
      onClick={() => setEdit(value != null ? fmtG(value) : "")}
      title="Wert eintippen"
      className="-my-1 flex items-baseline gap-1 rounded-[10px] px-1.5 py-0.5 hover:bg-hover"
    >
      <span className={cx("tnum font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]", accent ? "text-accent" : value == null && "text-ink3")}>
        {value != null ? fmtG(value) : "–"}
      </span>
      <span className="text-[15px] font-bold text-ink2">{unit}</span>
    </button>
  );
}
