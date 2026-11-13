// Decent DE1: Plugin in den Einstellungen, Shots im Bewertungsdialog übernehmen (Zeit, Ausbeute, Temperatur, Kurve)
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Coffee, Link2, Puzzle, Undo2, Unlink } from "lucide-react";
import { useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import type { DecentStatus, MachineShot, ShotCurve } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDateShort, fmtRelative } from "../lib/format.ts";
import { fmtShotTime } from "../../../shared/shot.ts";
import { Button, Spinner } from "./controls.tsx";
import { CoffeeLink } from "./CoffeeLink.tsx";
import { Tip, useWidth } from "./charts.tsx";
import { Group, Row } from "./form.tsx";
import { Stat, when } from "./GrinderSync.tsx";

const n1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function useMachineShots(enabled: boolean, q: { since?: string; around?: string; hours?: number }) {
  return useQuery({
    queryKey: ["decent", "shots", q],
    queryFn: () => api.machineShots({ ...q, limit: 40 }),
    enabled,
    // die Maschine schickt selbst, der Dialog fragt nur nach
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

function shotLine(s: MachineShot): string {
  return [
    s.time_s != null ? fmtShotTime(s.time_s - (s.preinfusion_s ?? 0), s.preinfusion_s) : null,
    s.dose_g != null && s.yield_g != null ? `${n1.format(s.dose_g)} → ${n1.format(s.yield_g)} g` : s.yield_g != null ? `${n1.format(s.yield_g)} g` : null,
    s.temp_c != null ? `${n1.format(s.temp_c)} °C` : null,
    s.profile || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------- Einstellungen ----------

export function DecentSettings({ status }: { status: DecentStatus }) {
  const recent = useQuery({ queryKey: ["decent", "shots", { recent: true }], queryFn: () => api.machineShots({ limit: 5 }), enabled: status.shots > 0 });
  const s = recent.data?.status ?? status;
  return (
    <Group
      title="Decent DE1"
      footer={
        <>
          Das Plugin für die de1app schickt jeden Espresso mit Kurve hierher, im Bewertungsdialog kommen Zeit, Ausbeute und Temperatur dann von
          der Maschine. Einrichten: ZIP laden, den Ordner <span className="font-semibold">kaffeebibliothek</span> auf dem Tablet nach{" "}
          <span className="font-semibold">de1plus/plugins/</span> kopieren, de1app neu starten und unter Einstellungen → Erweiterungen
          einschalten. Die Adresse dieser Seite ist schon eingetragen. Shots unter 8 Sekunden und Reinigungen landen nicht im Dialog. Dazu
          schickt das Plugin die ganze Historie der App (alle Shots mit Kurven, Einstellungen und Notizen, dazu die Profile) einmal und danach
          jede neue oder geänderte Datei; sie liegt vollständig im Archiv, Passwörter und Tokens ausgenommen.
        </>
      }
    >
      <Row label="Shots">
        {s.shots > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[15px] text-ink2">
            <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden="true" />
            <span className="tnum truncate">
              {s.shots}
              {s.last_shot ? ` · zuletzt ${fmtRelative(s.last_shot)}` : ""}
            </span>
          </span>
        ) : (
          <span className="text-[15px] text-ink3">Noch keiner angekommen</span>
        )}
      </Row>
      <Row label="Archiv">
        {s.archive.shots + s.archive.profiles > 0 ? (
          <span className="tnum min-w-0 truncate text-[15px] text-ink2">
            {s.archive.shots} Shots
            {s.archive.first_shot && (
              <span className="max-sm:hidden">
                {` seit ${new Date(s.archive.first_shot).toLocaleDateString("de-DE", { month: "short", year: "numeric" })}`}
              </span>
            )}
            {s.archive.profiles ? ` · ${s.archive.profiles} Profile` : ""}
          </span>
        ) : (
          <span className="text-[15px] text-ink3">Historie noch nicht übertragen</span>
        )}
      </Row>
      <Row label="Plugin">
        <a href="/api/decent/plugin.zip" download className="no-underline">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[14px] font-medium text-accent hover:bg-fill2">
            <Puzzle size={15} strokeWidth={2.2} aria-hidden="true" />
            ZIP laden
          </span>
        </a>
      </Row>
      {(recent.data?.shots.length ?? 0) > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {recent.data!.shots.map((x) => (
            <li key={x.id} className="grid grid-cols-1 gap-0.5 border-t border-sep px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
              <span className="tnum min-w-0 text-[14px] font-semibold">
                {when(x.shot_at)}
                <span className="font-normal text-ink2"> · {shotLine(x)}</span>
              </span>
              <span className="min-w-0 truncate text-[13px] text-ink3 sm:text-right">
                {x.brew_coffee_id != null ? (
                  <CoffeeLink id={x.brew_coffee_id} className="text-accent no-underline">
                    {x.brew_coffee}
                  </CoffeeLink>
                ) : (
                  "kein Bezug"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}

// ---------- Kurve ----------

const SERIES = [
  { key: "p", goal: "pg", label: "Druck", unit: "bar", color: "var(--c-pressure)" },
  { key: "f", goal: "fg", label: "Fluss", unit: "ml/s", color: "var(--c-flow)" },
  { key: "fw", goal: null, label: "Fluss Waage", unit: "g/s", color: "var(--c-weight)" },
] as const;

/** Pfad, Lücken bei Sollwert 0 (dort regelt die Maschine nach der anderen Größe) */
function path(t: number[], v: number[], X: (x: number) => number, Y: (y: number) => number, gaps: boolean): string {
  let d = "";
  let pen = false;
  for (let i = 0; i < t.length && i < v.length; i++) {
    if (gaps && !(v[i] > 0)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${X(t[i]).toFixed(1)},${Y(v[i]).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Druck und Fluss auf einer Achse (beide 0–10), Sollwerte gestrichelt; Gewicht und Temperatur stehen als Zahl daneben */
export function ShotChart({ curve }: { curve: ShotCurve }) {
  const [ref, W] = useWidth(600);
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const m = { l: 30, r: 10, t: 10, b: 24 };
  const t = curve.t;
  const tMax = Math.max(1, t[t.length - 1] ?? 1);
  const shown = SERIES.filter((s) => curve[s.key].some((v) => v > 0));
  const yMax = useMemo(() => {
    const all = [...curve.p, ...curve.f, ...curve.fw, ...curve.pg, ...curve.fg];
    return Math.max(10, Math.ceil(Math.max(0, ...all.filter((v) => v < 20)) / 2) * 2);
  }, [curve]);
  const X = (x: number) => m.l + (x / tMax) * (W - m.l - m.r);
  const Y = (y: number) => m.t + (1 - Math.min(y, yMax) / yMax) * (H - m.t - m.b);
  const xStep = tMax > 45 ? 10 : 5;
  const xs = Array.from({ length: Math.floor(tMax / xStep) + 1 }, (_, i) => i * xStep);
  const ys = Array.from({ length: yMax / 2 + 1 }, (_, i) => i * 2);

  const move = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const tt = ((x - m.l) / (W - m.l - m.r)) * tMax;
    let best = 0;
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - tt) < Math.abs(t[best] - tt)) best = i;
    setHover(best);
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="relative">
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`Shot-Kurve über ${Math.round(tMax)} Sekunden: ${shown.map((s) => s.label).join(", ")}`}
          className="block touch-none select-none"
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={() => setHover(null)}
        >
          {ys.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} style={{ stroke: v === 0 ? "var(--c-ink4)" : "var(--c-grid)" }} strokeWidth="1" />
              {v % (yMax > 12 ? 4 : 2) === 0 && (
                <text x={m.l - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" style={{ fill: "var(--c-ink3)" }}>
                  {v}
                </text>
              )}
            </g>
          ))}
          {xs.map((v) => (
            <text key={v} x={X(v)} y={H - 6} textAnchor={v === 0 ? "start" : "middle"} fontSize="11" style={{ fill: "var(--c-ink3)" }}>
              {v} s
            </text>
          ))}
          {shown.map((s) =>
            s.goal && curve[s.goal].some((v) => v > 0) ? (
              <path key={`${s.key}-goal`} d={path(t, curve[s.goal], X, Y, true)} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.55" />
            ) : null,
          )}
          {shown.map((s) => (
            <path key={s.key} d={path(t, curve[s.key], X, Y, false)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover != null && (
            <g>
              <line x1={X(t[hover])} x2={X(t[hover])} y1={m.t} y2={H - m.b} style={{ stroke: "var(--c-ink4)" }} strokeWidth="1" />
              {shown.map((s) => (
                <circle key={s.key} cx={X(t[hover])} cy={Y(curve[s.key][hover] ?? 0)} r="4" fill={s.color} style={{ stroke: "var(--c-card)" }} strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
        {hover != null && (
          <Tip x={X(t[hover])} y={m.t} w={W} h={H} below>
            <div className="tnum flex flex-col gap-0.5">
              <span className="font-semibold">{n1.format(t[hover])} s</span>
              {shown.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.label} {n1.format(curve[s.key][hover] ?? 0)} {s.unit}
                </span>
              ))}
              {curve.w.length > 0 && <span className="text-ink2">Gewicht {n1.format(curve.w[hover] ?? 0)} g</span>}
              {curve.tb.length > 0 && <span className="text-ink2">Siebträger {n1.format(curve.tb[hover] ?? 0)} °C</span>}
            </div>
          </Tip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink2">
        {shown.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full" style={{ background: s.color }} />
            {s.label} ({s.unit})
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="4" aria-hidden="true">
            <line x1="1" y1="2" x2="17" y2="2" style={{ stroke: "var(--c-ink3)" }} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
          </svg>
          Soll
        </span>
      </div>
    </div>
  );
}

// ---------- Bewertungsdialog ----------

/** Karte „Von der Maschine“: übernommener Shot groß mit Kurve, darunter andere zur Auswahl */
export function MachineCard({
  shots,
  loading,
  selected,
  brewId,
  onPick,
  onUndo,
  onRelease,
  canUndo,
}: {
  shots: MachineShot[];
  loading: boolean;
  selected: number | null;
  brewId: number | null;
  onPick: (s: MachineShot) => void;
  onUndo: () => void;
  onRelease: () => void;
  canUndo: boolean;
}) {
  const [more, setMore] = useState(false);
  const sel = shots.find((s) => s.id === selected) ?? null;
  const detail = useQuery({ queryKey: ["decent", "shot", selected], queryFn: () => api.machineShot(selected!), enabled: selected != null, staleTime: Infinity });
  const others = shots.filter((s) => s.id !== selected);
  const listed = sel && !more ? [] : others.slice(0, more ? 12 : 4);

  return (
    <section className="flex flex-col gap-1.5" aria-label="Von der Maschine">
      <div className="flex items-center gap-2 px-1 pb-0.5">
        <h3 className="m-0 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Von der Maschine</h3>
        {loading && <Spinner size={13} />}
      </div>
      <div className="overflow-hidden rounded-[16px] bg-card shadow-card">
        {sel ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
              <Link2 size={15} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[14px] font-semibold">
                Gezogen {when(sel.shot_at)}
                {sel.profile && <span className="font-normal text-ink3"> · {sel.profile}</span>}
              </span>
              <span className="flex gap-1">
                {canUndo ? (
                  <Button size="sm" variant="plain" icon={Undo2} onClick={onUndo}>
                    Rückgängig
                  </Button>
                ) : (
                  <Button size="sm" variant="plain" icon={Unlink} onClick={onRelease}>
                    Lösen
                  </Button>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-sep bg-sep @lg:grid-cols-4">
              <Stat
                label="Zeit"
                value={sel.time_s != null ? fmtShotTime(sel.time_s - (sel.preinfusion_s ?? 0), sel.preinfusion_s, "") : "–"}
                unit={sel.time_s != null ? "s" : undefined}
                sub={sel.time_s != null && sel.preinfusion_s ? `Preinf. + Bezug = ${Math.round(sel.time_s)} s` : null}
              />
              <Stat
                label="Ausbeute"
                value={sel.yield_g != null ? n1.format(sel.yield_g) : "–"}
                unit={sel.yield_g != null ? "g" : undefined}
                sub={sel.yield_g != null && sel.dose_g ? `aus ${n1.format(sel.dose_g)} g · 1:${n1.format(sel.yield_g / sel.dose_g)}` : sel.yield_g == null ? "ohne Waage" : null}
              />
              <Stat label="Temperatur" value={sel.temp_c != null ? n1.format(sel.temp_c) : "–"} unit={sel.temp_c != null ? "°C" : undefined} sub="Soll, Mittel" />
              <Stat label="Spitzendruck" value={sel.peak_bar != null ? n1.format(sel.peak_bar) : "–"} unit={sel.peak_bar != null ? "bar" : undefined} />
            </div>
            <div className="border-t border-sep px-4 pt-3 pb-3">
              {detail.data ? (
                <ShotChart curve={detail.data.curve} />
              ) : (
                <div className="flex h-[200px] items-center justify-center">{detail.isError ? <span className="text-[13px] text-ink3">Kurve nicht geladen</span> : <Spinner size={18} />}</div>
              )}
            </div>
            {sel.brew_id != null && sel.brew_id !== brewId && (
              <p className="m-0 border-t border-sep px-4 py-2 text-[12px] text-ink2">
                Hing bisher an einem Bezug von {sel.brew_coffee ?? "einem anderen Kaffee"}; beim Sichern wechselt er hierher.
              </p>
            )}
          </>
        ) : (
          <p className="m-0 flex items-center gap-2 px-4 py-3 text-[14px] text-ink2">
            <Coffee size={15} className="shrink-0 text-ink3" aria-hidden="true" />
            {loading && !shots.length
              ? "Shots werden geholt …"
              : shots.length
                ? "Keiner übernommen. Wähle den Shot zu diesem Bezug:"
                : "Kein Shot in diesem Zeitraum. Neue erscheinen hier von selbst."}
          </p>
        )}
        {listed.length > 0 && (
          <ul className="m-0 flex list-none flex-col border-t border-sep p-0">
            {listed.map((s) => {
              const taken = s.brew_id != null && s.brew_id !== brewId;
              return (
                <li key={s.id} className="flex items-center gap-3 border-t border-sep px-4 py-2 first:border-t-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="tnum truncate text-[14px] font-semibold">
                      {when(s.shot_at)}
                      <span className="font-normal text-ink2"> · {shotLine(s) || "ohne Werte"}</span>
                    </span>
                    {taken && <span className="truncate text-[12px] text-ink3">schon bei {s.brew_coffee ?? "einem Bezug"}</span>}
                  </span>
                  <Button size="sm" variant={taken ? "plain" : "secondary"} onClick={() => onPick(s)}>
                    Übernehmen
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {others.length > (sel ? 0 : 4) && (
          <div className="flex justify-center border-t border-sep px-2 py-1">
            <Button size="sm" variant="plain" onClick={() => setMore((x) => !x)}>
              {more ? "Weniger" : sel ? "Anderen Shot wählen" : `Ältere (${fmtDateShort(others[others.length - 1].shot_at)} …)`}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
