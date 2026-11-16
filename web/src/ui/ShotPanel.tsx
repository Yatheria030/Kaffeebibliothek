import { ArrowDown, ArrowUp, Check, Clock3, Crosshair, Droplets, Scale } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { GrinderProfile } from "../../../shared/compass.ts";
import { brewRatio, grindNumber, isGoodBrew } from "../../../shared/grind.ts";
import { fmtRatio, fmtSec, fmtWindow, mid, timeShifted, normTime, piMiss, piSeconds, piSetting, targetLine, timeMiss, type ResolvedTarget } from "../../../shared/shot.ts";
import { TASTE_LABEL, type Brew } from "../../../shared/types.ts";
import { ratioMiss, type NextShot } from "../lib/dialin.ts";
import { fmtDateShort, fmtNum } from "../lib/format.ts";
import { Tip, useWidth } from "./charts.tsx";
import { cx } from "./controls.tsx";
import { fmtG, fmtU, MoveChip } from "./DialIn.tsx";

type Shot = { dose_g: number | null; water_g: number | null; time_s: number | null; preinfusion_s?: number | null; grind: string };

const n2 = (v: number) => fmtNum(Math.round(v * 100) / 100);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Zustand eines Werts gegen sein Fenster: Symbol und Wort, nie nur Farbe */
function Status({ miss, words, delta }: { miss: number | null; words: [string, string]; delta?: string }) {
  if (miss == null) return <span className="text-[13px] font-semibold text-ink3">noch offen</span>;
  const ok = miss === 0;
  const Icon = ok ? Check : miss < 0 ? ArrowDown : ArrowUp;
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-bold whitespace-nowrap",
        ok ? "bg-good-soft text-good" : "bg-warn/15 text-warn",
      )}
    >
      <Icon size={15} strokeWidth={2.6} aria-hidden="true" />
      {ok ? "Im Ziel" : miss < 0 ? words[0] : words[1]}
      {delta && <span className="tnum font-semibold opacity-80">{delta}</span>}
    </span>
  );
}

/**
 * Messleiste: Spur über den Bereich, Zielfenster als Band, Wert als Punkt. Optional ein zweiter, hohler Punkt für den
 * gemessenen Wert, wenn der volle Punkt umgerechnet ist (Zeit aufs Zielverhältnis).
 */
function Gauge({
  domain,
  band,
  value,
  raw,
  ok,
  fmt,
  label,
}: {
  domain: [number, number];
  band: [number, number];
  value: number | null;
  raw?: number | null;
  ok: boolean;
  fmt: (v: number) => string;
  label: string;
}) {
  const [ref, w] = useWidth(320);
  const pad = 10;
  const x = (v: number) => pad + ((clamp(v, domain[0], domain[1]) - domain[0]) / (domain[1] - domain[0])) * (w - 2 * pad);
  const y = 34;
  const color = value == null ? "var(--c-ink4)" : ok ? "var(--c-green)" : "var(--c-orange)";
  const b0 = x(band[0]);
  const b1 = x(band[1]);
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={64} role="img" aria-label={label} className="block overflow-visible">
        <rect x={pad} y={y - 4} width={w - 2 * pad} height={8} rx={4} fill="var(--c-fill2)" />
        <rect x={b0} y={y - 9} width={Math.max(2, b1 - b0)} height={18} rx={6} fill="var(--c-green-soft)" stroke="var(--c-green)" strokeOpacity={0.45} />
        <text x={b0} y={y + 26} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--c-ink2)" className="tnum">
          {fmt(band[0])}
        </text>
        <text x={b1} y={y + 26} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--c-ink2)" className="tnum">
          {fmt(band[1])}
        </text>
        {raw != null && value != null && Math.abs(x(raw) - x(value)) > 3 && (
          <>
            <line x1={x(raw)} x2={x(value)} y1={y} y2={y} stroke={color} strokeWidth={2} strokeDasharray="3 3" />
            <circle cx={x(raw)} cy={y} r={6} fill="var(--c-card)" stroke={color} strokeWidth={2} />
          </>
        )}
        {value != null && (
          <>
            <circle cx={x(value)} cy={y} r={9} fill={color} stroke="var(--c-card)" strokeWidth={2.5} />
            <text x={clamp(x(value), 24, w - 24)} y={y - 15} textAnchor="middle" fontSize={13} fontWeight={800} fill="var(--c-ink)" className="tnum">
              {fmt(value)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

function Metric({ icon, label, big, unit, sub, status, children, className }: { className?: string; icon: ReactNode; label: string; big: string; unit?: string; sub?: ReactNode; status: ReactNode; children: ReactNode }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-1.5">
          <span className="tnum font-display text-[44px] leading-none font-extrabold tracking-[-0.035em]">{big}</span>
          {unit && <span className="text-[18px] font-bold text-ink3">{unit}</span>}
        </div>
        {status}
      </div>
      <div className="min-h-[18px] text-[13px] leading-snug text-ink2">{sub}</div>
      {children}
    </div>
  );
}

type Point = { key: string; x: number; y: number; raw: number; now: boolean; good: boolean; b?: Brew; ratio: number | null };

/**
 * Diese Tüte: jeder Shot als Punkt, Mahlgrad (oder Reihenfolge) gegen die aufs Ziel umgerechnete Zeit, Zielfenster als Band.
 * Mit gelernter Steigung k eine Linie vom jüngsten Shot zum Mahlgrad, der die Fenstermitte treffen sollte.
 */
function BagChart({
  points,
  target,
  profile,
  goal,
  anchor,
  byGrind,
  piNow,
}: {
  points: Point[];
  target: ResolvedTarget;
  profile: GrinderProfile | null;
  goal: number | null;
  anchor: Point | null;
  byGrind: boolean;
  piNow: number | null;
}) {
  const [ref, w] = useWidth(520);
  const [hover, setHover] = useState<string | null>(null);
  const h = 250;
  const m = { l: 40, r: 16, t: 14, b: 50 };
  const unit = profile?.unit ?? "";
  const tMid = mid(target.time);


  const xs = [...points.map((p) => p.x), ...(goal != null ? [goal] : [])];
  const ys = [...points.map((p) => p.y), target.time[0], target.time[1]];
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  const xp = Math.max((x1 - x0) * 0.12, byGrind ? (profile?.nudge ?? 1) * 2 : 0.6);
  x0 -= xp;
  x1 += xp;
  const y0 = Math.floor(Math.min(...ys) - 3);
  const y1 = Math.ceil(Math.max(...ys) + 3);
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
  const Y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0)) * (h - m.t - m.b);

  const yTicks: number[] = [];
  const ys0 = Math.ceil(y0 / 5) * 5;
  for (let v = ys0; v <= y1; v += 5) yTicks.push(v);
  const xTicks: number[] = [];
  if (byGrind) {
    const span = x1 - x0;
    const step = [1, 2, 5, 10, 20, 50, 100].find((s) => span / s <= Math.max(3, Math.floor((w - 60) / 70))) ?? 100;
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) xTicks.push(v);
  } else points.forEach((p) => xTicks.push(p.x));

  const hp = points.find((p) => p.key === hover) ?? null;

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
      <svg width={w} height={h} role="img" aria-label={`Shots dieser Tüte: ${points.length}, Zeit gegen ${byGrind ? "Mahlgrad" : "Reihenfolge"}`} className="block">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--c-grid)" />
            <text x={m.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="var(--c-ink3)" className="tnum">
              {v} s
            </text>
          </g>
        ))}
        <rect x={m.l} y={Y(target.time[1])} width={w - m.l - m.r} height={Y(target.time[0]) - Y(target.time[1])} fill="var(--c-green-soft)" />
        <line x1={m.l} x2={w - m.r} y1={Y(tMid)} y2={Y(tMid)} stroke="var(--c-green)" strokeOpacity={0.5} strokeDasharray="4 4" />
        <text x={w - m.r - 6} y={Y(target.time[1]) - 6} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--c-green)">
          Ziel {fmtWindow(target.time)}
        </text>
        {xTicks.map((v) => (
          <text key={v} x={X(v)} y={h - m.b + 20} textAnchor="middle" fontSize={12} fill="var(--c-ink3)" className="tnum">
            {byGrind ? fmtG(v) : `#${v}`}
          </text>
        ))}
        <text x={w - m.r} y={h - 4} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--c-ink3)">
          {byGrind ? `Mahlgrad${unit ? ` in ${unit}` : ""} · ${profile?.coarserUp === false ? "gröber ← → feiner" : "feiner ← → gröber"}` : "Shots dieser Tüte"}
        </text>
        {/* Verlauf in Reihenfolge */}
        {points.length > 1 && (
          <polyline
            points={points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}
            fill="none"
            stroke="var(--c-chart-muted)"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}
        {goal != null && anchor && (
          <g>
            <line x1={X(anchor.x)} y1={Y(anchor.y)} x2={X(goal)} y2={Y(tMid)} stroke="var(--c-accent)" strokeWidth={2} strokeDasharray="5 4" />
            <path d={`M ${X(goal)} ${Y(tMid) - 8} l 8 8 l -8 8 l -8 -8 z`} fill="var(--c-accent)" stroke="var(--c-card)" strokeWidth={2} />
            <text x={X(goal)} y={Y(tMid) + 26} textAnchor="middle" fontSize={12} fontWeight={800} fill="var(--c-accent)" className="tnum">
              ≈ {fmtU(goal, unit)}
            </text>
          </g>
        )}
        {points.map((p) => (
          <circle
            key={p.key}
            cx={X(p.x)}
            cy={Y(p.y)}
            r={p.now ? 9 : 6}
            fill={p.now ? "var(--c-accent)" : p.good ? "var(--c-green)" : "var(--c-card)"}
            stroke={p.now ? "var(--c-card)" : p.good ? "var(--c-card)" : "var(--c-ink3)"}
            strokeWidth={p.now ? 2.5 : 2}
          />
        ))}
        {/* Trefferflächen größer als die Punkte */}
        {points.map((p) => (
          <circle key={`hit-${p.key}`} cx={X(p.x)} cy={Y(p.y)} r={16} fill="transparent" onPointerEnter={() => setHover(p.key)} onClick={() => setHover(p.key)} />
        ))}
      </svg>
      {hp && (
        <Tip x={X(hp.x)} y={Y(hp.y)} w={w} h={h} below={Y(hp.y) < 70}>
          <div className="font-bold">{hp.now ? "Dieser Shot" : hp.b ? fmtDateShort(hp.b.brewed_at) : ""}</div>
          {byGrind && <div className="tnum">Mahlgrad {fmtU(hp.x, unit)}</div>}
          <div className="tnum">
            {(hp.now ? piNow : hp.b?.preinfusion_s) ? `${fmtSec((hp.now ? piNow : hp.b?.preinfusion_s)!)} + ` : ""}
            {fmtSec(hp.raw)} s{timeShifted(hp.y, hp.raw) ? ` ≙ ${fmtSec(hp.y)} s bei ${fmtRatio(target.ratio)}` : ""}
            {hp.ratio != null ? ` · 1:${n2(hp.ratio)}` : ""}
          </div>
          {hp.b && hp.b.taste.length > 0 && <div className="text-ink2">{hp.b.taste.map((t) => TASTE_LABEL.get(t)).join(", ")}</div>}
        </Tip>
      )}
    </div>
  );
}

/** Live unter der Bezugszeit: Verhältnis und Zeit groß gegen das Ziel, darunter alle Shots dieser Tüte */
export function ShotPanel({
  target,
  p,
  bag,
  profile,
  k,
  next,
}: {
  target: ResolvedTarget;
  p: Shot;
  /** frühere Shots dieser Tüte (gleiche Zubereitung), neueste zuerst */
  bag: Brew[];
  profile: GrinderProfile | null;
  /** gelerntes k, null = nur die Annahme der Mühle */
  k: number | null;
  /** „Nächster Shot“ aus `nextShot` (dieselbe Rechnung wie Karte und Tipp im Dialog) */
  next: NextShot | null;
}) {
  const ratio = brewRatio(p);
  const rm = ratio != null ? ratioMiss(ratio, target) : null;
  const tn = p.time_s != null ? normTime(p.time_s, ratio, target) : null;
  const tm = tn != null ? timeMiss(tn, target) : null;
  const shifted = tn != null && p.time_s != null && timeShifted(tn, p.time_s);
  const tDelta = tm != null && tm !== 0 ? `${tm > 0 ? "+" : "−"}${fmtSec(Math.abs(tm))} s` : undefined;
  const pi = p.preinfusion_s ?? null;
  const pm = pi != null ? piMiss(pi, target) : null;
  const pDelta = pm != null && pm !== 0 ? `${pm > 0 ? "+" : "−"}${Math.abs(Math.round(pm))} s` : undefined;
  const pDomain: [number, number] = [Math.max(0, Math.min(target.pi[0] - 5, (pi ?? 99) - 2)), Math.max(target.pi[1] + 5, (pi ?? 0) + 2)];

  const rDomain: [number, number] = [Math.min(target.ratio[0] - 0.6, (ratio ?? 99) - 0.15), Math.max(target.ratio[1] + 0.6, (ratio ?? 0) + 0.15)];
  const rawT = p.time_s ?? 0;
  const tDomain: [number, number] = [
    Math.min(target.time[0] - 10, (tn ?? 99) - 2, p.time_s != null ? rawT - 2 : 99),
    Math.max(target.time[1] + 10, (tn ?? 0) + 2, rawT + 2),
  ];

  // Punkte: frühere Shots mit Zeit, dazu der aktuelle, sobald er eine Zeit hat
  const past = [...bag].reverse().filter((b) => b.time_s != null);
  const nowGrind = grindNumber(p.grind);
  const byGrind = profile != null && past.every((b) => grindNumber(b.grind) != null) && (p.time_s == null || nowGrind != null);
  const points: Point[] = past.map((b, i) => ({
    key: `b${b.id}`,
    x: byGrind ? grindNumber(b.grind)! : i + 1,
    y: normTime(b.time_s!, brewRatio(b), target),
    raw: b.time_s!,
    now: false,
    good: isGoodBrew(b),
    b,
    ratio: brewRatio(b),
  }));
  if (tn != null && p.time_s != null) points.push({ key: "now", x: byGrind ? nowGrind! : points.length + 1, y: tn, raw: p.time_s, now: true, good: false, ratio });

  // Nächster Shot kommt fertig aus `nextShot`; Anker ist der Shot, von dem er ausgeht (der jetzige oder ein früherer der Tüte)
  const anchor = next ? (points.find((pt) => (next.brew.id === -1 ? pt.now : pt.b?.id === next.brew.id)) ?? null) : null;
  const step = profile?.step ?? 1;
  const goal = byGrind && next ? next.value : null;
  const move = goal != null && next ? next.move : null;
  const finer = next?.finer ?? false;
  // Raute und Linie im Diagramm nur, wenn die Zeit den Weg bestimmt (zur Fenstermitte)
  const chartGoal = next?.why === "zeit" ? goal : null;
  const kText = k != null ? `Gelernt: ${fmtNum(k)} ${profile?.unit || "Stufen"} je Sekunde` : `Annahme ${fmtNum(profile?.shotK ?? 1)} ${profile?.unit || "Stufen"} je Sekunde, bis eine Tüte zwei Shots zum Vergleich hat`;

  return (
    <section className="flex flex-col overflow-hidden rounded-[18px] bg-card shadow-card" aria-label="Shot-Analyse">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-sep px-5 py-3">
        <span className="text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Ziel</span>
        <span className="tnum text-[15px] font-bold">{targetLine(target)}</span>
      </div>
      <div className={cx("grid grid-cols-1 gap-x-8 gap-y-6 px-5 py-5 @xl:grid-cols-2", goal != null ? "@5xl:grid-cols-4" : "@3xl:grid-cols-3")}>
        <Metric
          icon={<Scale size={14} strokeWidth={2.4} aria-hidden="true" />}
          label="Verhältnis"
          big={ratio != null ? `1:${n2(ratio)}` : "–"}
          sub={
            p.dose_g != null && p.water_g != null ? (
              <span className="tnum">
                {fmtNum(p.dose_g)} g → {fmtNum(p.water_g)} g · Ziel {fmtRatio(target.ratio)}
              </span>
            ) : (
              "Dosis und Ausbeute eintragen"
            )
          }
          status={<Status miss={rm} words={["zu kurz", "zu lang"]} />}
        >
          <Gauge domain={rDomain} band={target.ratio} value={ratio} ok={rm === 0} fmt={(v) => `1:${n2(v)}`} label={`Verhältnis gegen Ziel ${fmtRatio(target.ratio)}`} />
        </Metric>
        <Metric
          icon={<Clock3 size={14} strokeWidth={2.4} aria-hidden="true" />}
          label="Zeit"
          big={p.time_s != null ? fmtSec(p.time_s) : "–"}
          unit="s"
          sub={
            p.time_s == null ? (
              "Bezugszeit eintragen"
            ) : shifted ? (
              <span className="tnum">
                ≙ <b className="text-ink">{fmtSec(tn!)} s</b> bei {fmtRatio(target.ratio)} (auf dein Zielverhältnis umgerechnet)
              </span>
            ) : (
              <span className="tnum">Fenster {fmtWindow(target.time)}</span>
            )
          }
          status={<Status miss={tm} words={["zu schnell", "zu langsam"]} delta={tDelta} />}
        >
          <Gauge
            domain={tDomain}
            band={target.time}
            value={tn}
            raw={shifted ? p.time_s : null}
            ok={tm === 0}
            fmt={(v) => `${Math.round(v)} s`}
            label={`Zeit gegen Fenster ${fmtWindow(target.time)}`}
          />
        </Metric>
        <Metric
          icon={<Droplets size={14} strokeWidth={2.4} aria-hidden="true" />}
          label="Preinfusion"
          big={pi != null ? fmtSec(pi) : "–"}
          unit="s"
          sub={
            pi == null ? (
              <span>Preinfusion eintragen (zählt nicht zur Bezugszeit). Decent: {piSetting(target.pi_flow, target.pi_bar, piSeconds(target))}</span>
            ) : pm! < 0 ? (
              <span>
                Fenster {fmtWindow(target.pi)}. Länger vorbrühen: Der Puck sättigt sich gleichmäßiger, weniger Kanäle, mehr Süße. Decent:{" "}
                {piSetting(target.pi_flow, target.pi_bar, piSeconds(target))}
              </span>
            ) : pm! > 0 ? (
              <span>
                Fenster {fmtWindow(target.pi)}. Kürzer vorbrühen: Der Puck ist längst satt, die Zeit zieht eher Bitteres. Decent:{" "}
                {piSetting(target.pi_flow, target.pi_bar, piSeconds(target))}
              </span>
            ) : (
              <span className="tnum">
                Fenster {fmtWindow(target.pi)} · {piSetting(target.pi_flow, target.pi_bar, piSeconds(target))}
              </span>
            )
          }
          status={<Status miss={pm} words={["zu kurz", "zu lang"]} delta={pDelta} />}
        >
          <Gauge
            domain={pDomain}
            band={target.pi}
            value={pi}
            ok={pm === 0}
            fmt={(v) => `${Math.round(v)} s`}
            label={`Preinfusion gegen Fenster ${fmtWindow(target.pi)}`}
          />
        </Metric>
        {goal != null && move != null && next && (
          <Metric
            icon={<Crosshair size={14} strokeWidth={2.4} aria-hidden="true" />}
            label="Nächster Shot"
            big={fmtG(goal)}
            unit={profile?.unit}
            sub={
              <span className="tnum">
                vom {next.brew.id === -1 ? "jetzigen" : "letzten"} Shot ({fmtU(next.from, profile?.unit ?? "")}
                {anchor ? `, ${fmtSec(anchor.raw)} s${timeShifted(anchor.y, anchor.raw) ? ` ≙ ${fmtSec(anchor.y)} s` : ""}` : ""})
                {next.why === "zeit" ? ` zur Fenstermitte ${fmtNum(mid(target.time))} s` : next.why === "geschmack" ? " nach dem Geschmack" : ", Mahlgrad gleich"}
              </span>
            }
            status={<MoveChip move={move} finer={finer} unit={profile?.unit ?? ""} step={step} hold={next.why === "halten"} />}
          >
            <p className="m-0 text-[12px] leading-snug text-ink3">
              {kText}.{chartGoal != null ? " Rauten-Linie im Diagramm darunter." : ""}
            </p>
          </Metric>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-sep px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Diese Tüte</span>
          <span className="text-[12px] text-ink3">
            {points.length ? `${points.length} ${points.length === 1 ? "Shot" : "Shots"}, Zeit aufs Zielverhältnis umgerechnet` : ""}
          </span>
          {points.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink2">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-accent" aria-hidden="true" />
                Jetzt
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-good" aria-hidden="true" />
                Gelungen
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border-2 border-ink3" aria-hidden="true" />
                Andere
              </span>
              {byGrind && chartGoal != null && (
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rotate-45 bg-accent" aria-hidden="true" />
                  Ziel-Mahlgrad ({k != null ? `gelernt ${fmtNum(k)}` : `Annahme ${fmtNum(profile?.shotK ?? 1)}`} {profile?.unit || "Stufen"}/s)
                </span>
              )}
            </span>
          )}
        </div>
        {points.length ? (
          <BagChart points={points} target={target} profile={profile} goal={chartGoal} anchor={anchor} byGrind={byGrind} piNow={pi} />
        ) : (
          <p className="m-0 py-6 text-center text-[13px] text-ink3">Erster Shot dieser Tüte. Mit der Zeit erscheint er hier, jeder weitere kommt dazu.</p>
        )}
      </div>
    </section>
  );
}
