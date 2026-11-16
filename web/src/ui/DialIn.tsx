import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Check, Compass as CompassIcon, Crosshair, Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import { DEFAULT_GRINDER, grinderProfile, type GrinderProfile } from "../../../shared/compass.ts";
import { grindNumber, isGoodBrew, type GrindPrediction } from "../../../shared/grind.ts";
import { formatScore } from "../../../shared/sca.ts";
import { bagAge, isSca, TASTE_LABEL, type Batch, type Brew, type CoffeeDetail } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { brewGrinder, brewMethod, espressoHint, grindPoints, lastGoodGrind, learnedK, nextShot, ratioMiss, ratioOf, type DialHint, type NextShot } from "../lib/dialin.ts";
import { fmtSec, mid, normTime, timeShifted, timeMiss, type ShotTarget } from "../../../shared/shot.ts";
import { ShotTargetLine, ShotTargetSheet, useShotTarget } from "./ShotTarget.tsx";
import { fmtBrewTime, fmtDateShort, fmtNum, fmtTime, todayIso } from "../lib/format.ts";
import { ScoreChart, type ScorePoint } from "./charts.tsx";
import { Card, cx, SectionTitle, Segmented } from "./controls.tsx";

/** Ohne Tausenderpunkt: der Wert landet als Text im Bezug und wird von grindNumber zurückgelesen („1.500“ wäre 1,5) */
export const fmtG = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 2, useGrouping: false });
/** Wert mit Einheit der Mühle („118 µm“), ohne Einheit bei fremder Mühle */
export const fmtU = (v: number, unit: string) => `${fmtG(v)}${unit ? `\u202f${unit}` : ""}`;
const signed = (v: number, unit: string) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmtU(Math.abs(v), unit)}`;

/** Profil der eigenen Mühle laut Einstellungen, solange das Rezept keine andere nennt */
export function useGrinderProfile(recipeGrinder: string | null | undefined): GrinderProfile | null {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 5 * 60_000 });
  return grinderProfile(data?.grinder ?? DEFAULT_GRINDER, recipeGrinder);
}

export function DialHintBox({ hint, compact, next }: { hint: DialHint; compact?: boolean; next?: string | null }) {
  const Icon = hint.tone === "ok" ? Check : hint.tone === "finer" ? ArrowDownRight : hint.tone === "coarser" ? ArrowUpRight : Lightbulb;
  return (
    <div className={cx("flex items-start gap-3 rounded-[14px] px-4 py-3", hint.tone === "ok" ? "bg-good-soft" : "bg-accent-soft")}>
      <Icon size={18} strokeWidth={2.3} className={cx("mt-[1px] shrink-0", hint.tone === "ok" ? "text-good" : "text-accent")} aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5 leading-snug">
        <span className={cx("font-bold", compact ? "text-[14px]" : "text-[15px]")}>
          {hint.title}
          {next && <span className="tnum"> → {next}</span>}
        </span>
        <span className="text-[13px] text-ink2">{hint.text}</span>
      </div>
    </div>
  );
}

/** Chip zum nächsten Mahlgrad: „3 µm feiner“ oder „Bleib dabei“, Symbol und Wort statt nur Farbe */
export function MoveChip({ move, finer, unit, step, hold }: { move: number; finer: boolean; unit: string; step: number; hold?: boolean }) {
  const stay = Math.abs(move) < step / 2;
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-bold whitespace-nowrap",
        stay ? "bg-good-soft text-good" : "bg-accent-soft text-accent",
      )}
    >
      {stay ? (
        <>
          <Check size={15} strokeWidth={2.6} aria-hidden="true" />
          {hold ? "Mahlgrad gleich" : "Bleib dabei"}
        </>
      ) : (
        <>
          {finer ? <ArrowDown size={15} strokeWidth={2.6} aria-hidden="true" /> : <ArrowUp size={15} strokeWidth={2.6} aria-hidden="true" />}
          <span className="tnum">
            {fmtG(Math.abs(move))} {unit} {finer ? "feiner" : "gröber"}
          </span>
        </>
      )}
    </span>
  );
}

/** Kaffee-Detail: nächster Shot groß wie in der Shot-Analyse, darunter der Hinweis als Begründung */
function NextShotBox({ next, hint, target, profile, k }: { next: NextShot; hint: DialHint | null; target: ShotTarget; profile: GrinderProfile; k: number | null }) {
  const u = profile.unit;
  const from = `${fmtU(next.from, u)}${next.brew.time_s != null ? `, ${fmtBrewTime(next.brew)}` : ""}`;
  const shifted = next.time != null && next.brew.time_s != null && timeShifted(next.time, next.brew.time_s);
  const sub =
    next.why === "zeit"
      ? `Vom letzten Shot (${from}${shifted ? ` ≙ ${fmtSec(next.time!)} s` : ""}) zur Fenstermitte ${fmtNum(mid(target.time))} s`
      : next.why === "geschmack"
        ? `Vom letzten Shot (${from}) nach dem Geschmack`
        : `Letzter Shot ${from}`;
  return (
    <div className={cx("@container flex flex-col gap-3 rounded-[14px] px-4 pt-3.5 pb-3.5", next.stay ? "bg-good-soft" : "bg-accent-soft")}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={cx("flex items-center gap-1.5 text-[12px] font-bold tracking-[0.06em] uppercase", next.stay ? "text-good" : "text-accent")}>
            <Crosshair size={15} strokeWidth={2.4} aria-hidden="true" />
            Nächster Shot
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="tnum font-display text-[44px] leading-none font-extrabold tracking-[-0.035em]">{fmtG(next.value)}</span>
            {u && <span className="text-[18px] font-bold text-ink3">{u}</span>}
          </span>
        </div>
        <span className="rounded-full bg-card">
          <MoveChip move={next.move} finer={next.finer} unit={u} step={profile.step} hold={next.why === "halten"} />
        </span>
      </div>
      <span className="tnum text-[13px] leading-snug text-ink2">{sub}</span>
      {hint && (
        <span className="flex flex-col gap-0.5 border-t border-ink/10 pt-2.5 text-[13px] leading-snug">
          <span className="font-bold">{hint.title}</span>
          <span className="text-ink2">{hint.text}</span>
        </span>
      )}
      {next.why === "zeit" && (
        <span className="text-[12px] text-ink3">
          {k != null ? `Gelernt: ${fmtNum(k)} ${u || "Stufen"} je Sekunde.` : `Annahme ${fmtNum(profile.shotK)} ${u || "Stufen"} je Sekunde, bis eine Tüte zwei Shots zum Vergleich hat.`}
        </span>
      )}
    </div>
  );
}

const bagsText = (n: number) => (n === 1 ? "einer Tüte" : `${n} Tüten`);

/** Text zur Prognose: woher der Startwert kommt */
export function predictionText(p: GrindPrediction): string {
  if (p.compass) {
    if (p.basis === "kompass") return `Aus Röstung, Herkunft und Röstalter${p.compass.rough ? ", grobe Orientierung" : ""}`;
    if (p.basis === "schnitt") return `Mit deiner Abweichung aus ${bagsText(p.bags)}`;
    return `Mit Modell aus ${p.bags} Tüten${p.spread != null ? `, meist auf ±${fmtU(Math.max(Math.round(p.spread * 10) / 10, 0.1), p.unit)} genau` : ""}`;
  }
  return p.basis === "modell"
    ? `geschätzt aus ${p.bags} Tüten${p.spread != null ? `, meist auf ±${fmtG(Math.max(Math.round(p.spread * 10) / 10, 0.1))} genau` : ""}`
    : `Schnitt aus ${bagsText(p.bags)}, zum Lernen braucht es drei`;
}

/** Kurzform der Gründe in einer Zeile, für den Bewertungsdialog */
export function compassLine(p: GrindPrediction): string {
  const parts = (p.compass?.factors ?? []).map((f) => `${f.label} ${signed(Math.round(f.effect), p.unit)}`);
  if (p.offset != null && Math.abs(p.offset) >= 0.5) parts.push(`deine Mühle ${signed(Math.round(p.offset), p.unit)}`);
  if (p.taste != null && Math.abs(p.taste) >= 0.5) parts.push(`dein Geschmack ${signed(Math.round(p.taste), p.unit)}`);
  return parts.join(" · ");
}

/** Runder Strichabstand für etwa `n` Striche über `span` */
function niceStep(span: number, n = 4): number {
  const raw = span / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

type PathStep = { key: string; label: string; from: number | null; to: number; delta: number | null; kind: "start" | "rule" | "learned" | "taste" | "end" };

/**
 * Mahlkompass als Pfad auf einer gemeinsamen Achse: vom Ausgangswert der Zubereitung schiebt jede Regel den Punkt
 * feiner (links) oder gröber (rechts), dazu die gelernte Abweichung, unten der Startwert mit seiner Spanne.
 */
export function CompassPath({ p }: { p: GrindPrediction }) {
  const c = p.compass;
  if (!c) return null;
  let cur = c.base;
  const steps: PathStep[] = [{ key: "start", label: `Ausgang ${c.base_label}`, from: null, to: c.base, delta: null, kind: "start" }];
  for (const f of c.factors) {
    steps.push({ key: f.key, label: f.label, from: cur, to: cur + f.effect, delta: f.effect, kind: "rule" });
    cur += f.effect;
  }
  if (p.offset != null && Math.abs(p.offset) >= 0.5) {
    steps.push({ key: "offset", label: "Deine Mühle", from: cur, to: cur + p.offset, delta: p.offset, kind: "learned" });
    cur += p.offset;
  }
  if (p.taste != null && Math.abs(p.taste) >= 0.5) {
    steps.push({ key: "taste", label: "Dein Geschmack", from: cur, to: cur + p.taste, delta: p.taste, kind: "taste" });
    cur += p.taste;
  }
  steps.push({ key: "end", label: "Startwert", from: null, to: p.value, delta: null, kind: "end" });

  const vals = [...steps.flatMap((s) => [s.to, s.from ?? s.to]), ...(p.range ?? [])];
  const span0 = Math.max(...vals) - Math.min(...vals);
  const pad = Math.max(span0 * 0.08, 1);
  const lo = Math.min(...vals) - pad;
  const hi = Math.max(...vals) + pad;
  const tick = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / tick) * tick; t <= hi; t += tick) ticks.push(Math.round(t * 100) / 100);
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const w = (a: number, b: number) => `${(Math.abs(b - a) / (hi - lo)) * 100}%`;
  const cols = "grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3.25rem] @md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem]";

  const Track = ({ children }: { children?: React.ReactNode }) => (
    <span className="relative block h-full min-h-7" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} className="absolute inset-y-0 w-px bg-sep" style={{ left: x(t) }} />
      ))}
      {children}
    </span>
  );

  return (
    <div
      role="img"
      aria-label={`${steps.map((s) => (s.delta != null ? `${s.label} ${signed(Math.round(s.delta), c.unit)}` : `${s.label} ${fmtU(s.to, c.unit)}`)).join(", ")}`}
      className="flex min-w-0 flex-col"
    >
      <div className={cx("grid gap-x-3", cols)}>
        <span />
        <span className="relative h-5" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="tnum absolute top-0 -translate-x-1/2 text-[11px] font-semibold text-ink3" style={{ left: x(t) }}>
              {fmtG(t)}
            </span>
          ))}
        </span>
        <span />
      </div>
      {steps.map((s) => {
        const end = s.kind === "end";
        return (
          <div key={s.key} className={cx("grid items-stretch gap-x-3 text-[13px]", cols, end && "font-bold")}>
            <span className={cx("truncate py-1.5", end ? "text-ink" : s.kind === "learned" || s.kind === "taste" ? "font-semibold text-ink" : "text-ink2")} title={s.label}>
              {s.label}
            </span>
            <Track>
              {end && p.range && (
                <span
                  className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full bg-accent-soft ring-1 ring-accent/40"
                  style={{ left: x(p.range[0]), width: w(p.range[0], p.range[1]) }}
                />
              )}
              {s.from != null && (
                <span
                  className={cx("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full", s.kind === "learned" ? "bg-star" : s.kind === "taste" ? "bg-good" : "bg-accent")}
                  style={{ left: x(Math.min(s.from, s.to)), width: w(s.from, s.to) }}
                />
              )}
              <span
                className={cx(
                  "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  end ? "size-3.5 bg-accent ring-3 ring-card2" : s.kind === "start" ? "size-2.5 bg-ink2" : s.kind === "learned" ? "size-2.5 bg-star" : s.kind === "taste" ? "size-2.5 bg-good" : "size-2.5 bg-accent",
                )}
                style={{ left: x(s.to) }}
              />
            </Track>
            <span className={cx("tnum py-1.5 text-right", end ? "text-accent" : "font-semibold")}>
              {s.delta != null ? signed(Math.round(s.delta), c.unit) : fmtU(Math.round(s.to * 100) / 100, c.unit)}
            </span>
          </div>
        );
      })}
      <div className={cx("grid gap-x-3", cols)}>
        <span />
        <span className="flex justify-between pt-1 text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase" aria-hidden="true">
          <span>← feiner</span>
          <span>gröber →</span>
        </span>
        <span />
      </div>
    </div>
  );
}

export function PredictionDetails({ p }: { p: GrindPrediction }) {
  const drivers = p.compass ? [] : p.drivers;
  const timed = p.compass && p.timed > 0;
  return (
    <div className="flex flex-col gap-1.5 text-[12px] text-ink2">
      {timed && (
        <span>
          Gelernt aus {p.timed === 1 ? "einem Shot" : `${p.timed} Shots`} mit Zeit, jeder aufs Zeitziel umgerechnet
          {p.k != null &&
            `: ${fmtU(p.k, p.unit)} je Sekunde${p.k_pairs > 0 ? ` (aus ${p.k_pairs === 1 ? "einem Vergleich" : `${p.k_pairs} Vergleichen`} in derselben Tüte)` : " (Annahme, bis eine Tüte zwei Shots mit verschiedenem Mahlgrad hat)"}`}
          .
        </span>
      )}
      {p.taste != null && p.taste_n > 0 && Math.abs(p.taste) >= 0.5 && (
        <span>
          Geschmack dieses Kaffees: {p.taste < 0 ? "etwas feiner" : "etwas gröber"} als das Zeitziel ({signed(Math.round(p.taste), p.unit)}, aus{" "}
          {p.taste_n === 1 ? "einem Urteil" : `${p.taste_n} Urteilen`}), gilt nur für ihn.
        </span>
      )}
      {drivers.length > 0 && (
        <span>
          Verschiebt den Wert: {drivers.map((d) => `${d.label} ${d.effect > 0 ? "+" : "−"}${fmtG(Math.abs(d.effect))}`).join(" · ")}
        </span>
      )}
      {p.per_week != null && Math.abs(p.per_week) >= 0.05 && (
        <span>
          Mit dem Röstalter wandert der Wert pro Woche um etwa {p.per_week < 0 ? "−" : "+"}
          {fmtU(Math.abs(p.per_week), p.unit)} {p.compass ? "zusätzlich zum Kompass" : "auf der Skala deiner Mühle"}
        </span>
      )}
      {p.similar.length > 0 && (
        <span>
          Ähnlich:{" "}
          {p.similar
            .map((s) => `${s.same_coffee ? "dieser Kaffee" : s.name}${s.roast_date ? ` (${fmtDateShort(s.roast_date)})` : ""} → ${s.grind}`)
            .join(" · ")}
        </span>
      )}
    </div>
  );
}

/** Startwert für eine Tüte vom Server (Mahlkompass und lokales Modell) samt Vorlage für einen ersten Bezug */
export function useGrindPrediction(q: { coffee_id: number; batch_id: number | null; method: string; grinder: string }, enabled: boolean) {
  return useQuery({
    queryKey: ["grind", q.coffee_id, q.batch_id, q.method, q.grinder],
    queryFn: () => api.grind(q),
    enabled,
    staleTime: 60_000,
  });
}

/** Kasten „Mahlkompass“: Startwert groß mit Spanne, daneben (schmal darunter) der Weg dorthin */
/** tight: schon ab 32rem Wert und Pfad nebeneinander (Kaffee-Detail, Karte neben dem Geschmack) */
export function CompassBox({ p, title, details = true, tight }: { p: GrindPrediction; title: string; details?: boolean; tight?: boolean }) {
  const c = p.compass;
  const source = !c || p.basis !== "kompass" ? predictionText(p) : null;
  return (
    <div className="@container flex flex-col gap-3 rounded-[14px] bg-card2 px-4 pt-3.5 pb-3">
      <div
        className={cx(
          "grid gap-y-4",
          tight ? "gap-x-5 @lg:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] @lg:items-center" : "gap-x-8 @2xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] @2xl:items-center",
        )}
      >
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.04em] text-accent uppercase">
            <CompassIcon size={15} strokeWidth={2.3} aria-hidden="true" />
            {title}
          </span>
          <span className="flex items-baseline gap-1">
            <span className="tnum font-display text-[38px] leading-none font-extrabold tracking-[-0.03em]">{fmtG(p.value)}</span>
            <span className="text-[15px] font-bold text-ink2">{p.unit}</span>
          </span>
          {p.range && (
            <span className="tnum text-[13px] text-ink2">
              Spanne {fmtG(p.range[0])}–{fmtU(p.range[1], p.unit)}
            </span>
          )}
          {c && (
            <span className="text-[12px] text-ink3">
              {c.grinder} · {c.method}
            </span>
          )}
          {c?.rough && <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold text-ink2">Grobe Orientierung</span>}
          {source && <span className="text-[12px] leading-snug text-ink2">{source}</span>}
        </div>
        {details && c && <CompassPath p={p} />}
      </div>
      {details && <PredictionDetails p={p} />}
    </div>
  );
}

/**
 * Kaffee-Detail: Mahlgrad je Tüte über das Röstalter, letzte Bezüge der Tüte mit Zeit, Verhältnis und Urteil,
 * Hinweis für den nächsten Shot (Espresso) und für eine frische Tüte der geschätzte Startwert.
 */
export function DialInCard({ data, batchFilter, className, onPick }: { data: CoffeeDetail; batchFilter: number | "all"; className?: string; onPick: (b: Brew) => void }) {
  const c = data.coffee;
  const batchMap = useMemo(() => new Map(data.batches.map((b) => [b.id, b])), [data.batches]);
  const methods = useMemo(() => {
    const count = new Map<string, number>();
    for (const b of data.brews) if (b.grind.trim()) count.set(brewMethod(b, data.recipes, c), (count.get(brewMethod(b, data.recipes, c)) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => Number(b[0] === "Espresso") - Number(a[0] === "Espresso") || b[1] - a[1]).map(([m]) => m);
  }, [data, c]);
  const profile = useGrinderProfile(null);
  const target = useShotTarget(c);
  const [editTarget, setEditTarget] = useState(false);
  // Ohne Bezüge mit Mahlgrad: Zubereitungen für den Kompass nach „Geröstet für“
  const choices = methods.length || !profile || c.wishlist || c.archived ? methods : c.roast_for === "filter" ? ["Filter", "Espresso"] : c.roast_for === "omni" ? ["Espresso", "Filter"] : ["Espresso"];
  const [method, setMethod] = useState<string | null>(null);
  const m = method && choices.includes(method) ? method : choices[0];

  // Tüte: gewählte Charge, sonst die offene, sonst die jüngste mit Bezügen dieser Zubereitung
  const bag: Batch | null = useMemo(() => {
    if (batchFilter !== "all") return batchMap.get(batchFilter) ?? null;
    const open = data.batches.find((b) => b.status === "offen");
    if (open) return open;
    const withBrews = data.brews.filter((b) => b.batch_id != null && m && brewMethod(b, data.recipes, c) === m).sort((a, b) => b.brewed_at.localeCompare(a.brewed_at))[0];
    if (withBrews) return batchMap.get(withBrews.batch_id!) ?? null;
    // Neue Tüte: die nächste ungeöffnete (älteste Röstung zuerst)
    return [...data.batches].filter((b) => b.status === "ungeoeffnet").sort((a, b) => (a.roast_date ?? "9").localeCompare(b.roast_date ?? "9"))[0] ?? null;
  }, [batchFilter, batchMap, data, m, c]);

  const bagBrews = useMemo(
    () => (bag && m ? data.brews.filter((b) => b.batch_id === bag.id && brewMethod(b, data.recipes, c) === m).sort((a, b) => b.brewed_at.localeCompare(a.brewed_at)) : []),
    [bag, m, data, c],
  );
  const good = bag && m ? lastGoodGrind(data.brews, bag.id, m, data.recipes, c) : null;
  const grinder = bagBrews.map((b) => brewGrinder(b, data.recipes)).find(Boolean) ?? "";
  const fresh = bag != null && bag.status !== "leer" && !good;
  // Kompass auch ohne Tüte (neuer Kaffee), solange nichts Gelungenes vorliegt
  const wantPred = Boolean(m && !good && (fresh || (!bag && profile)));
  // Für Espresso auch ohne frische Tüte: k (Mahlgrad je Sekunde) für den Tipp
  const q = useGrindPrediction({ coffee_id: c.id, batch_id: bag?.id ?? null, method: m ?? "", grinder }, wantPred || (m === "Espresso" && profile != null));
  const pred = q.data?.prediction ?? null;

  if (!m) return null;
  const pts = grindPoints(data.brews, batchMap, m, data.recipes, c);
  const points: ScorePoint[] = pts.map(({ brew, day, grind }) => ({
    id: brew.id,
    x: day,
    y: grind,
    selected: brew.batch_id === bag?.id,
    title: fmtDateShort(brew.brewed_at),
    sub: [brew.grind, brew.time_s != null ? fmtBrewTime(brew) : null, verdict(brew)].filter(Boolean).join(" · "),
  }));
  const espresso = m === "Espresso";
  // k erst abwarten, sonst springt die Empfehlung von der Annahme auf den gelernten Wert (ohne Profil fragt niemand danach)
  const kReady = q.data !== undefined || q.isError || q.fetchStatus === "idle";
  const k = learnedK(pred);
  const hint = espresso && kReady ? espressoHint(bagBrews[0] ?? null, target, k, profile) : null;
  const next = espresso && kReady ? nextShot(bagBrews, hint, target, k, profile) : null;
  const bagLabel = bag ? (bag.roast_date ? `Tüte vom ${fmtDateShort(bag.roast_date)}` : "Tüte ohne Röstdatum") : "Keine Tüte";

  return (
    <Card className={cx("flex flex-col gap-4", className)}>
      <SectionTitle
        sub={`${bagLabel}${bag?.roast_date ? ` · heute Tag ${bagAge(bag, todayIso())}` : ""}.${points.length > 1 ? " Andere Tüten grau." : ""}`}
        action={
          choices.length > 1 ? (
            <div className="no-scrollbar max-w-full overflow-x-auto">
              <Segmented label="Zubereitung" size="sm" value={m} onChange={setMethod} options={choices.map((x) => ({ id: x, label: x }))} />
            </div>
          ) : undefined
        }
      >
        Einstellen{choices.length === 1 ? ` · ${m}` : ""}
      </SectionTitle>

      {good && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[12px] font-bold tracking-[0.04em] text-ink2 uppercase">Letzter guter Mahlgrad</span>
          <span className="tnum text-[22px] font-extrabold">{good.grind}</span>
          <span className="text-[12px] text-ink3">vom {fmtDateShort(good.brewed_at)}{!next || next.value === grindNumber(good.grind) ? ", wird beim nächsten Bezug vorgeschlagen" : ""}</span>
        </div>
      )}
      {espresso && <ShotTargetLine target={target} onEdit={() => setEditTarget(true)} />}
      <ShotTargetSheet coffee={c} open={editTarget} onClose={() => setEditTarget(false)} />
      {wantPred && pred && <CompassBox tight p={pred} title={pred.compass ? "Mahlkompass" : bag ? "Startwert für diese Tüte" : "Startwert"} />}
      {next && profile ? <NextShotBox next={next} hint={hint} target={target} profile={profile} k={k} /> : hint && <DialHintBox hint={hint} />}

      {points.length > 1 && (
        <ScoreChart
          points={points}
          xFmt={(v) => `Tag ${Math.round(v)}`}
          yFmt={fmtG}
          selectedLabel={bagLabel}
          otherLabel="Andere Tüten"
          label="Mahlgrad je Bezug über das Röstalter"
          onPick={(id) => {
            const b = data.brews.find((x) => x.id === id);
            if (b) onPick(b);
          }}
        />
      )}

      {bagBrews.length > 0 ? (
        <div className="@container overflow-hidden rounded-[14px] bg-card2">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))] gap-x-4 px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase @lg:grid-cols-[90px_repeat(3,72px)_minmax(0,1fr)]">
            <span>Bezug</span>
            <span className="text-right">Mahlgrad</span>
            <span className="text-right">Zeit</span>
            <span className="text-right">Verh.</span>
            <span className="hidden @lg:block">Urteil</span>
          </div>
          {bagBrews.slice(0, 8).map((b) => {
            const r = ratioOf(b);
            // Espresso: Zeit und Verhältnis am Ziel messen (grün im Ziel, gelb daneben)
            const tOk = espresso && b.time_s != null ? timeMiss(normTime(b.time_s, r, target), target) === 0 : null;
            const rOk = espresso && r != null ? ratioMiss(r, target) === 0 : null;
            const day = bag ? bagAge(bag, b.brewed_at) : null;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onPick(b)}
                className="grid w-full grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))] items-center gap-x-4 border-t border-sep px-4 py-2 text-left text-[13px] hover:bg-hover @lg:grid-cols-[90px_repeat(3,72px)_minmax(0,1fr)]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="tnum font-semibold">{fmtDateShort(b.brewed_at)}</span>
                  <span className="truncate text-[12px] text-ink3 @lg:hidden">{[day != null ? `Tag ${day}` : null, verdict(b)].filter(Boolean).join(" · ")}</span>
                  <span className="hidden text-[12px] text-ink3 @lg:block">{day != null ? `Tag ${day}` : ""}</span>
                </span>
                <span className={cx("tnum text-right font-semibold", isGoodBrew(b) && "text-good")}>{b.grind || "–"}</span>
                <span className={cx("tnum text-right", tOk === true && "text-good", tOk === false && "text-star")}>{fmtBrewTime(b)}</span>
                <span className={cx("tnum text-right", rOk === true && "text-good", rOk === false && "text-star")}>{r != null ? `1:${fmtNum(Math.round(r * 10) / 10)}` : "–"}</span>
                <span className="hidden truncate text-ink2 @lg:block">{verdict(b) || <span className="text-ink3">–</span>}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-ink2">
          {bag
            ? "In dieser Tüte noch kein Bezug mit Mahlgrad."
            : data.batches.length
              ? "Wähle eine Charge, um ihren Verlauf zu sehen."
              : "Noch keine Charge. Mit Röstdatum rechnet der Kompass das Röstalter mit ein."}
        </p>
      )}
      {pts.length > 0 && (
        <span className="text-[12px] text-ink3">
          {espresso && profile
            ? "Zeit und Verhältnis grün im Ziel, gelb daneben; Mahlgrad grün bei gelungenen Bezügen. Der Startwert lernt aus jedem Shot mit Zeit (über alle Kaffees) und aus deinen Urteilen (nur für diesen Kaffee)."
            : "Grün markiert gelungene Bezüge (ausgewogen, ab 4 Sternen oder SCA ab 84). Aus ihnen lernt der Startwert für neue Tüten, über alle Kaffees mit gleicher Zubereitung."}
        </span>
      )}
    </Card>
  );
}

function verdict(b: Brew): string {
  const rating = isSca(b) ? `SCA ${formatScore(b.total)}` : b.rating != null ? `${b.rating} ★` : "";
  const taste = b.taste.map((t) => TASTE_LABEL.get(t) ?? t).join(", ");
  return [taste, rating].filter(Boolean).join(" · ");
}
