import { useQuery } from "@tanstack/react-query";
import { useDrinkWindows } from "../ui/ConfigForm.tsx";
import { ArrowRight, Package } from "lucide-react";
import { type ReactNode, useState } from "react";
import { addDays, byUrgency, DRINK_WINDOWS, freshness, freshnessLabel, isSoon, type Freshness } from "../../../shared/freshness.ts";
import { ROAST_FOR, ROAST_LEVELS, type RoastLevel, type StockItem } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDateShort, plural, todayIso } from "../lib/format.ts";
import { href } from "../lib/router.ts";
import { Artwork } from "../ui/Artwork.tsx";
import { CoffeeLink } from "../ui/CoffeeLink.tsx";
import { cx, EmptyState, LoadError, SectionTitle, Segmented, Spinner } from "../ui/controls.tsx";
import { LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";

type Entry = StockItem & { f: Freshness };

/** Erste Packung, die zu öffnen ist: trinkbereit und am dringendsten, sonst die, die als Erste trinkbereit wird; nur bewertbare */
function nextToOpen(sealed: Entry[]): Entry | null {
  const ready = sealed.find((e) => e.f.state !== "ruht" && e.f.state !== "unbekannt");
  if (ready) return ready;
  const resting = sealed.filter((e) => e.f.state === "ruht");
  const wait = (e: Entry) => (e.f.state === "ruht" ? e.f.ready - e.f.day : 0);
  return resting.sort((a, b) => wait(a) - wait(b))[0] ?? null;
}

function tone(f: Freshness): string {
  if (f.state === "flach") return "bg-bad-soft text-bad";
  if (isSoon(f)) return "bg-star/15 text-ink";
  return { ruht: "bg-fill text-ink2", hoch: "bg-good-soft text-good", spaet: "bg-fill text-ink", unbekannt: "bg-fill text-ink3" }[f.state];
}

function statusLine(e: Entry): string {
  const f = e.f;
  if (f.state === "unbekannt") {
    const m = f.missing.map((x) => `„${x}“`);
    const list = m.length > 1 ? `${m.slice(0, -1).join(", ")} und ${m[m.length - 1]}` : m[0];
    return `${list} ${m.length > 1 ? "fehlen" : "fehlt"}, darum keine Bewertung. Am Kaffee nachtragen.`;
  }
  const at = (d: number) => fmtDateShort(addDays(e.roast_date!, d));
  const left = f.end - f.day;
  switch (f.state) {
    case "ruht":
      return `Trinkbereit ab ${at(f.ready)}, gut bis ${at(f.end)}`;
    case "hoch":
      return `Bestes Fenster bis ${at(f.peak)}, gut bis ${at(f.end)}`;
    case "spaet":
      return `Noch gut bis ${at(f.end)}, ${left === 0 ? "heute letzter Tag" : `noch ${plural(left, "Tag", "Tage")}`}`;
    default:
      return `Seit ${at(f.end)} jenseits des Fensters, schmeckt zunehmend flacher`;
  }
}

export function StockPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["coffees", "stock"], queryFn: api.stock });
  const windows = useDrinkWindows();
  const today = todayIso();
  const entries: Entry[] = (data ?? [])
    .map((b) => ({ ...b, f: freshness(b, b.coffee, today, windows) }))
    .sort((a, b) => byUrgency(a.f, b.f));
  const next = nextToOpen(entries);
  const late = entries.filter((e) => isSoon(e.f)).length;
  const unrated = entries.filter((e) => e.f.state === "unbekannt").length;

  return (
    <>
      <Toolbar title="Lager" />
      <Page wide>
        <LargeTitle
          lift
          sub={
            entries.length
              ? `${plural(entries.length, "ungeöffnete Packung", "ungeöffnete Packungen")}${late ? `, ${late} ${late === 1 ? "sollte" : "sollten"} bald weg` : ""}${unrated ? `, ${unrated} nicht bewertbar` : ""}. Wer zuerst aus dem besten Fenster fällt, steht oben.`
              : "Ungeöffnete Packungen nach Trinkfenster"
          }
        >
          Lager
        </LargeTitle>

        {isLoading && (
          <div className="flex justify-center py-20">
            <Spinner size={24} />
          </div>
        )}
        {error && <LoadError what="Das Lager wurde" error={error} retry={() => void refetch()} />}
        {data && !entries.length && (
          <EmptyState icon={Package} title="Nichts im Lager" text="Neue Packungen legst du am Kaffee als Charge an, mit Röstdatum und Status ungeöffnet. Offene Packungen stehen unter „Gerade offen“." />
        )}

        {next && <NextCard e={next} more={entries.length - 1} />}

        {entries.length > 0 && (
          <StockSection title="Ungeöffnet" sub="In der Reihenfolge, in der du sie öffnen solltest.">
            {entries.map((e) => (
              <StockCard key={e.id} e={e} next={e.id === next?.id} />
            ))}
          </StockSection>
        )}

        {entries.length > 0 && <WindowTable />}
      </Page>
    </>
  );
}

function StockSection({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="@container flex flex-col gap-3">
      <SectionTitle sub={sub}>{title}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Pill({ f }: { f: Freshness }) {
  return <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[12.5px] font-bold whitespace-nowrap", tone(f))}>{freshnessLabel(f)}</span>;
}

function NextCard({ e, more }: { e: Entry; more: number }) {
  return (
    <CoffeeLink
      id={e.coffee.id}
      className="flex items-center gap-4 rounded-[22px] bg-card p-4 text-ink no-underline shadow-card hover:bg-hover sm:gap-5 sm:p-5"
    >
      <Artwork coffee={e.coffee} size="sm" rounded={14} className="size-20 shrink-0 sm:size-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[12px] font-bold tracking-[0.06em] text-accent uppercase">Als Nächstes öffnen</span>
        <span className="truncate text-[20px] leading-tight font-extrabold tracking-[-0.015em]">{e.coffee.name}</span>
        <span className="truncate text-[14px] text-ink2">
          {[e.coffee.roaster, e.roast_date && `Röstung ${fmtDateShort(e.roast_date)}`].filter(Boolean).join(" · ")}
        </span>
        <span className="text-[14px] text-ink2">
          {/* Die Zeile endet oft auf ein Datum mit Punkt, dann keinen zweiten setzen */}
          {more > 0 ? `${statusLine(e).replace(/\.$/, "")}. Danach ${more === 1 ? "noch eine Packung" : `noch ${more} Packungen`}.` : statusLine(e)}
        </span>
      </div>
      <ArrowRight size={18} className="shrink-0 text-ink3 max-sm:hidden" />
    </CoffeeLink>
  );
}

function StockCard({ e, next }: { e: Entry; next?: boolean }) {
  // Einzeln unteilbar, damit beim Umbruch der Trennpunkt am Zeilenende bleibt
  const meta = [
    e.roast_date ? `Röstung ${fmtDateShort(e.roast_date)}` : "Ohne Röstdatum",
    e.f.state !== "unbekannt" && `Tag ${e.f.day}`,
  ].filter((m): m is string => !!m);
  return (
    <CoffeeLink
      id={e.coffee.id}
      className={cx(
        "flex flex-col gap-3.5 rounded-[18px] bg-card p-4 text-ink no-underline shadow-card hover:bg-hover",
        next && "ring-2 ring-accent/60",
      )}
    >
      <div className="flex items-start gap-3">
        <Artwork coffee={e.coffee} size="xs" rounded={10} className="size-12 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {e.coffee.roaster && <span className="truncate text-[11.5px] font-bold tracking-[0.06em] text-ink2 uppercase">{e.coffee.roaster}</span>}
          <span className="line-clamp-2 text-[16px] leading-snug font-bold">{e.coffee.name}</span>
          <span className="tnum text-[13px] text-ink2">
            {meta.map((m, i) => (
              <span key={i} className="whitespace-nowrap">
                {m}
                {i < meta.length - 1 ? " · " : ""}
              </span>
            ))}
          </span>
        </div>
        <Pill f={e.f} />
      </div>
      {e.f.state !== "unbekannt" && <WindowBar f={e.f} />}
      <span className="text-[13px] leading-snug text-ink2">
        {statusLine(e)}
      </span>
    </CoffeeLink>
  );
}

type Window = { ready: number; peak: number; end: number };

/** Balken von Tag 0 bis `max`: Ruhezeit, bestes Fenster, noch gut; optional ein Strich für heute */
function Timeline({ w, max, day, className }: { w: Window; max: number; day?: number; className?: string }) {
  const pct = (d: number) => `${(Math.min(Math.max(d, 0), max) / max) * 100}%`;
  const seg = (from: number, to: number, cls: string) =>
    to > from && <div className={cx("absolute inset-y-0 rounded-[3px]", cls)} style={{ left: pct(from), width: `calc(${pct(to - from)} - 2px)` }} />;
  return (
    <div className={cx("relative h-2.5", className)} role="img" aria-label={day != null ? `Tag ${day} von ${w.end}` : `Tag ${w.ready} bis ${w.end}`}>
      <div className="absolute inset-0 rounded-[3px] bg-fill" />
      {seg(0, w.ready, "bg-ink4/50")}
      {seg(w.ready, w.peak, "bg-good")}
      {seg(w.peak, w.end, "bg-good/40")}
      {day != null && <div className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-card" style={{ left: pct(day) }} />}
    </div>
  );
}

/** Zeitstrahl einer Packung ab Röstung, Strich = heute */
function WindowBar({ f }: { f: Exclude<Freshness, { state: "unbekannt" }> }) {
  return <Timeline w={f} max={Math.max(f.end + 14, f.day + 4)} day={f.day} />;
}

const LEGEND = [
  { c: "bg-ink4/50", l: "Ruhezeit" },
  { c: "bg-good", l: "Bestes Fenster" },
  { c: "bg-good/40", l: "Noch gut" },
];

const weeks = (d: number) => {
  if (d < 7) return "unter 1 Woche";
  const w = Math.round((d / 7) * 2) / 2;
  return `≈ ${String(w).replace(".", ",")} ${w === 1 ? "Woche" : "Wochen"}`;
};

/** Übersicht der Trinkfenster je „Geröstet für“, umschaltbar nach Röstgrad */
function WindowTable() {
  const windows = useDrinkWindows();
  const [level, setLevel] = useState<RoastLevel>("mittel");
  const rows = (["filter", "omni", "espresso"] as const).map((id) => ({
    id,
    label: ROAST_FOR.find((r) => r.id === id)!.label,
    base: windows[id].mittel,
    w: windows[id][level],
  }));
  // Gemeinsame Achse in ganzen Wochen, damit die Zeilen vergleichbar bleiben
  const maxWeeks = Math.ceil((Math.max(...rows.map((r) => r.w.end)) + 4) / 28) * 4;
  const max = maxWeeks * 7;
  const ticks = Array.from({ length: maxWeeks / 4 + 1 }, (_, i) => i * 4);
  const cols = [
    { k: "ready", l: "Trinkbereit ab" },
    { k: "peak", l: "Am besten bis" },
    { k: "end", l: "Noch gut bis" },
  ] as const;
  const grid = "@4xl:grid @4xl:grid-cols-[7rem_repeat(3,7rem)_minmax(0,1fr)] @4xl:items-center @4xl:gap-x-5";

  return (
    <section className="@container flex flex-col gap-3">
      <SectionTitle
        sub={`Tage ab Röstdatum, ${JSON.stringify(windows) === JSON.stringify(DRINK_WINDOWS) ? "nach Röster-Empfehlungen" : "eigene Werte aus den Einstellungen"}`}
        action={
          <Segmented
            size="sm"
            label="Röstgrad"
            value={level}
            onChange={setLevel}
            options={ROAST_LEVELS.map((r) => ({ id: r.id, label: r.label }))}
          />
        }
      >
        Trinkfenster
      </SectionTitle>
      <div className="overflow-hidden rounded-[18px] bg-card shadow-card">
        <div className={cx("hidden px-5 pt-4 pb-2 text-[11.5px] font-bold tracking-[0.06em] text-ink3 uppercase", grid)}>
          <span>Geröstet für</span>
          {cols.map((c) => (
            <span key={c.k}>{c.l}</span>
          ))}
          <div className="relative h-4">
            {ticks.map((t) => (
              <span
                key={t}
                className="tnum absolute -translate-x-1/2 font-semibold whitespace-nowrap tracking-normal normal-case first:translate-x-0 last:-translate-x-full"
                style={{ left: `${((t * 7) / max) * 100}%` }}
              >
                {t === 0 ? "Röstung" : `${t} Wo.`}
              </span>
            ))}
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.id} className={cx("flex flex-col gap-3 border-t border-line px-4 py-4 first:border-t-0 sm:px-5 @4xl:first:border-t", grid)}>
            <span className="text-[16px] font-bold">{r.label}</span>
            <div className="grid grid-cols-3 gap-3 @4xl:contents">
              {cols.map((c) => {
                const d = r.w[c.k] - r.base[c.k];
                return (
                  <div key={c.k} className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-bold tracking-[0.06em] text-ink3 uppercase @4xl:hidden">{c.l}</span>
                    <span className="tnum flex items-baseline gap-1.5 text-[17px] font-extrabold tracking-[-0.01em]">
                      Tag {r.w[c.k]}
                      {d !== 0 && <span className="rounded-full bg-fill px-1.5 text-[11.5px] font-bold text-ink2">{d > 0 ? `+${d}` : `−${-d}`}</span>}
                    </span>
                    <span className="text-[12.5px] text-ink2">{weeks(r.w[c.k])}</span>
                  </div>
                );
              })}
            </div>
            <Timeline w={r.w} max={max} />
          </div>
        ))}
        <div className="flex flex-col gap-2.5 border-t border-line bg-fill/40 px-4 py-4 text-[13px] leading-snug text-ink2 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {LEGEND.map((x) => (
              <span key={x.l} className="flex items-center gap-1.5 font-semibold text-ink">
                <span className={cx("h-2.5 w-5 rounded-[3px]", x.c)} />
                {x.l}
              </span>
            ))}
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              <span className="h-3.5 w-[3px] rounded-full bg-ink" />
              Heute (an den Packungen)
            </span>
          </div>
          <p className="m-0">
            Abweichungen beziehen sich auf Mittel. Fehlt Röstdatum, „Geröstet für“ oder Röstgrad, bleibt die Packung unbewertet. Nach dem Fenster
            ist der Kaffee nicht schlecht, nur weniger aromatisch.{" "}
            <a href={href("/wissen/ruhezeit")} className="text-accent no-underline hover:underline">
              Mehr zu Ruhezeit und Lagerung
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
