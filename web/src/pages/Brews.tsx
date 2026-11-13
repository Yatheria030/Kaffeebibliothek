import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Cog, History } from "lucide-react";
import { useMemo, useState } from "react";
import { isGoodBrew } from "../../../shared/grind.ts";
import { formatScore } from "../../../shared/sca.ts";
import { isSca, type Brew, type BrewLogEntry, type CoffeeDetail, type GrinderEvent } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { deviations, devPill, devTone, fmtPct, meanDeviation, type Deviation } from "../lib/deviation.ts";
import { fmtGrams, plural } from "../lib/format.ts";
import { CoffeeLink } from "../ui/CoffeeLink.tsx";
import { Button, cx, EmptyState, LoadError, SectionTitle, Segmented, Spinner } from "../ui/controls.tsx";
import { SelectField } from "../ui/form.tsx";
import { LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { StarsValue } from "../ui/Stars.tsx";
import { BrewSheet } from "./BrewSheet.tsx";

type Show = "alle" | "bezuege" | "frei";
/** Rezeptfilter: alle, ohne Rezept oder eine Rezept-ID */
type RecipeFilter = "alle" | "ohne" | number;

type Item = { kind: "brew"; at: string; brew: BrewLogEntry; dev: Deviation[] } | { kind: "event"; at: string; event: GrinderEvent };

const PAGE = 120;
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const fmtUm = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 1, useGrouping: false })} µm`;
const fmtS = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;

export function BrewsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["coffees", "brews"], queryFn: api.brewLog });
  const [show, setShow] = useState<Show>("alle");
  const [recipe, setRecipe] = useState<RecipeFilter>("alle");
  const [limit, setLimit] = useState(PAGE);
  const [edit, setEdit] = useState<{ detail: CoffeeDetail; brew: Brew } | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const brews = data?.brews ?? [];
  const free = data?.free_events ?? [];

  // Rezepte mit Zahl der Bezüge und mittlerer Abweichung, häufigstes zuerst
  const recipes = useMemo(() => {
    const m = new Map<number, { id: number; name: string; n: number; devs: number[] }>();
    for (const b of brews) {
      if (!b.recipe) continue;
      const r = m.get(b.recipe.id) ?? { id: b.recipe.id, name: b.recipe.name, n: 0, devs: [] };
      r.n += 1;
      const d = meanDeviation(deviations(b));
      if (d != null) r.devs.push(d);
      m.set(b.recipe.id, r);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de"));
  }, [brews]);
  const withoutRecipe = brews.filter((b) => !b.recipe).length;
  const linked = brews.filter((b) => b.grinder).length;

  const items = useMemo(() => {
    const list: Item[] = [];
    if (show !== "frei")
      for (const b of brews) {
        if (recipe === "ohne" ? b.recipe : recipe !== "alle" && b.recipe?.id !== recipe) continue;
        list.push({ kind: "brew", at: b.brewed_at, brew: b, dev: deviations(b) });
      }
    // Freie Mahlvorgänge haben kein Rezept, beim Rezeptfilter fallen sie weg
    if (show !== "bezuege" && recipe === "alle") for (const e of free) list.push({ kind: "event", at: e.ground_at, event: e });
    return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [brews, free, show, recipe]);

  const days = useMemo(() => {
    const out: { key: string; label: string; items: Item[] }[] = [];
    for (const it of items.slice(0, limit)) {
      const d = new Date(it.at);
      const key = dayKey(d);
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(it);
      else out.push({ key, label: day.format(d), items: [it] });
    }
    return out;
  }, [items, limit]);

  const openBrew = async (b: BrewLogEntry) => {
    setOpening(b.id);
    try {
      const detail = await qc.fetchQuery({ queryKey: ["coffee", b.coffee_id], queryFn: () => api.coffee(b.coffee_id) });
      const brew = detail.brews.find((x) => x.id === b.id);
      if (brew) setEdit({ detail, brew });
    } finally {
      setOpening(null);
    }
  };

  const recipeOptions: { value: string; label: string }[] = [
    { value: "alle", label: "Alle Rezepte" },
    ...recipes.map((r) => ({ value: String(r.id), label: `${r.name} (${r.n})` })),
    ...(withoutRecipe ? [{ value: "ohne", label: `Ohne Rezept (${withoutRecipe})` }] : []),
  ];

  return (
    <>
      <Toolbar title="Bezüge" />
      <Page wide>
        <LargeTitle
          lift
          sub={
            data
              ? `${plural(brews.length, "Bezug", "Bezüge")} über alle Kaffees, ${linked} mit Mahlvorgang${free.length ? `, ${plural(free.length, "freier Mahlvorgang", "freie Mahlvorgänge")} in 90 Tagen` : ""}. Prozent zeigen die Abweichung vom zugewiesenen Rezept.`
              : "Alle Bezüge und Mahlvorgänge mit Rezept und Abweichung"
          }
        >
          Bezüge
        </LargeTitle>

        {isLoading && (
          <div className="flex justify-center py-20">
            <Spinner size={24} />
          </div>
        )}
        {error && <LoadError what="Die Bezüge wurden" error={error} retry={() => void refetch()} />}
        {data && !brews.length && !free.length && (
          <EmptyState icon={History} title="Noch keine Bezüge" text="Bezüge trägst du am Kaffee ein, Mahlvorgänge kommen von der Mühle." />
        )}

        {recipes.length > 0 && (
          <section className="@container flex flex-col gap-3">
            <SectionTitle sub="Wie weit die Bezüge im Mittel vom Rezept liegen. Antippen filtert die Liste.">Nach Rezept</SectionTitle>
            <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
              {recipes.map((r) => {
                const avg = r.devs.length ? r.devs.reduce((a, b) => a + b, 0) / r.devs.length : null;
                const on = recipe === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setRecipe(on ? "alle" : r.id);
                      setLimit(PAGE);
                    }}
                    className={cx(
                      "flex items-center gap-3 rounded-[16px] bg-card px-4 py-3 text-left shadow-card hover:bg-hover",
                      on && "ring-2 ring-accent/60",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-bold">{r.name}</span>
                      <span className="text-[12.5px] text-ink2">{plural(r.n, "Bezug", "Bezüge")}</span>
                    </span>
                    {avg != null && (
                      <span className="flex shrink-0 flex-col items-end">
                        <span className={cx("tnum text-[18px] leading-tight font-extrabold", devTone(avg))}>Ø {Math.round(avg)} %</span>
                        <span className="text-[11px] font-bold tracking-[0.06em] text-ink3 uppercase">Abweichung</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {(brews.length > 0 || free.length > 0) && (
          <section className="@container flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented<Show>
                label="Anzeigen"
                value={show}
                onChange={(v) => {
                  setShow(v);
                  setLimit(PAGE);
                }}
                options={[
                  { id: "alle", label: "Alles" },
                  { id: "bezuege", label: "Bezüge" },
                  { id: "frei", label: "Freie Mahlvorgänge" },
                ]}
              />
              <SelectField
                label="Rezept"
                value={String(recipe)}
                onChange={(v) => {
                  setRecipe(v === "alle" || v === "ohne" ? v : Number(v));
                  setLimit(PAGE);
                }}
                options={recipeOptions}
              />
            </div>

            {!items.length && <p className="m-0 px-1 py-6 text-center text-[14px] text-ink2">Nichts für diese Auswahl.</p>}

            {days.map((d) => (
              <div key={d.key} className="flex flex-col gap-2">
                <h3 className="m-0 px-1 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">{d.label}</h3>
                <div className="overflow-hidden rounded-[16px] bg-card shadow-card [&>*+*]:border-t [&>*+*]:border-sep">
                  {d.items.map((it) =>
                    it.kind === "brew" ? (
                      <BrewRow key={`b${it.brew.id}`} b={it.brew} dev={it.dev} busy={opening === it.brew.id} onOpen={() => void openBrew(it.brew)} />
                    ) : (
                      <EventRow key={`e${it.event.id}`} e={it.event} />
                    ),
                  )}
                </div>
              </div>
            ))}

            {items.length > limit && (
              <div className="flex justify-center">
                <Button onClick={() => setLimit((l) => l + PAGE)}>Weitere {Math.min(PAGE, items.length - limit)} zeigen</Button>
              </div>
            )}
          </section>
        )}
      </Page>

      {edit && <BrewSheet open onClose={() => setEdit(null)} detail={edit.detail} brew={edit.brew} />}
    </>
  );
}

function Rating({ b }: { b: Brew }) {
  if (isSca(b)) return <span className="tnum text-[15px] font-semibold">{formatScore(b.total)}</span>;
  if (b.rating != null) return <StarsValue value={b.rating} className="text-[15px] font-semibold" />;
  if (isGoodBrew(b)) return <span className="text-[13px] font-bold text-good">Passt</span>;
  return null;
}

/** Wert des Bezugs groß, darunter die Abweichung vom Rezept */
function Metric({ d, hasRecipe }: { d: Deviation; hasRecipe: boolean }) {
  return (
    <span className="flex min-w-0 flex-col" title={d.target ? `Rezept: ${d.target}` : undefined}>
      <span className="truncate text-[10px] font-bold tracking-[0.02em] text-ink3 uppercase @md:text-[10.5px] @md:tracking-[0.06em]">{d.label}</span>
      <span className={cx("tnum truncate text-[14px] font-semibold", !d.value && "text-ink4")}>{d.value ?? "–"}</span>
      {d.pct != null ? (
        <span className={cx("tnum self-start rounded-full px-1.5 text-[11.5px] font-bold", devPill(d.pct))}>{fmtPct(d.pct)}</span>
      ) : (
        <span className="text-[11.5px] text-ink4">{hasRecipe && d.value && !d.target ? "nicht im Rezept" : " "}</span>
      )}
    </span>
  );
}

function BrewRow({ b, dev, busy, onOpen }: { b: BrewLogEntry; dev: Deviation[]; busy: boolean; onOpen: () => void }) {
  const avg = meanDeviation(dev);
  const g = b.grinder;
  const sources = [
    g &&
      [`Mühle ${time.format(new Date(g.ground_at))}`, g.grind_um != null && fmtUm(g.grind_um), g.dose_g != null && fmtGrams(g.dose_g), g.grind_s != null && `${fmtS(g.grind_s)} gemahlen`]
        .filter(Boolean)
        .join(" · "),
    b.shot && [`Decent ${time.format(new Date(b.shot.shot_at))}`, b.shot.profile, b.shot.peak_bar != null && `${b.shot.peak_bar.toFixed(1).replace(".", ",")} bar`].filter(Boolean).join(" · "),
  ].filter((s): s is string => !!s);
  return (
    <div className="relative flex flex-col gap-3 px-4 py-3 hover:bg-hover @4xl:flex-row @4xl:items-center @4xl:gap-5">
      {/* Ganze Zeile öffnet den Bezug; der Kaffee-Link liegt darüber */}
      <button type="button" onClick={onOpen} aria-label={`Bezug ${b.coffee.name} bearbeiten`} className="absolute inset-0 cursor-pointer" />
      <div className="pointer-events-none flex min-w-0 items-start gap-3 @4xl:flex-1">
        <span className="tnum w-[44px] shrink-0 pt-px text-[14px] font-semibold">{time.format(new Date(b.brewed_at))}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <CoffeeLink id={b.coffee_id} className="pointer-events-auto relative min-w-0 truncate text-[15px] font-bold text-ink no-underline hover:underline">
              {b.coffee.name}
            </CoffeeLink>
            {b.coffee.roaster && <span className="truncate text-[12.5px] text-ink3 max-sm:hidden">{b.coffee.roaster}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {b.recipe ? (
              <span className="max-w-full truncate rounded-full bg-accent-soft px-2 py-px text-[12px] font-bold text-accent">{b.recipe.name}</span>
            ) : (
              <span className="rounded-full bg-fill px-2 py-px text-[12px] font-semibold text-ink3">Ohne Rezept</span>
            )}
            {avg != null && <span className={cx("tnum text-[12.5px] font-bold", devTone(avg))}>Ø {Math.round(avg)} % vom Rezept</span>}
          </span>
          {sources.map((s) => (
            <span key={s} className="flex min-w-0 items-center gap-1 text-[12px] text-ink2">
              <Cog size={12} className="shrink-0 text-ink3" aria-hidden="true" />
              <span className="truncate">{s}</span>
            </span>
          ))}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 @4xl:hidden">
          <Rating b={b} />
          {busy ? <Spinner size={14} /> : <ChevronRight size={16} className="text-ink4" aria-hidden="true" />}
        </span>
      </div>
      <div className="pointer-events-none grid grid-cols-5 gap-x-1.5 pl-[56px] @md:gap-x-2 max-sm:pl-0 @4xl:w-[460px] @4xl:shrink-0 @4xl:pl-0">
        {dev.map((d) => (
          <Metric key={d.key} d={d} hasRecipe={b.recipe != null} />
        ))}
      </div>
      <span className="pointer-events-none hidden w-[64px] shrink-0 items-center justify-end gap-1.5 @4xl:flex">
        <Rating b={b} />
        {busy ? <Spinner size={14} /> : <ChevronRight size={16} className="text-ink4" aria-hidden="true" />}
      </span>
    </div>
  );
}

function EventRow({ e }: { e: GrinderEvent }) {
  const cells: { label: string; value: string | null }[] = [
    { label: "Mahlgrad", value: e.grind_um != null ? fmtUm(e.grind_um) : null },
    { label: "Dosis", value: e.dose_g != null ? fmtGrams(e.dose_g) : null },
    { label: "Ausbeute", value: e.yield_g != null ? fmtGrams(e.yield_g) : null },
    { label: "Zeit", value: e.shot_s != null ? fmtS(e.shot_s) : null },
    { label: "Mahldauer", value: e.grind_s != null ? fmtS(e.grind_s) : null },
  ];
  return (
    <div className="flex flex-col gap-3 bg-fill/40 px-4 py-3 @4xl:flex-row @4xl:items-center @4xl:gap-5">
      <div className="flex min-w-0 items-start gap-3 @4xl:flex-1">
        <span className="tnum w-[44px] shrink-0 pt-px text-[14px] font-semibold text-ink2">{time.format(new Date(e.ground_at))}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-semibold text-ink2">Mahlvorgang ohne Bezug</span>
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-ink3">
            <Cog size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate">
              {[
                e.device || "Mühle",
                e.grind_target_um != null && `Ziel ${fmtUm(e.grind_target_um)}`,
                e.dose_target_g != null && `Ziel ${fmtGrams(e.dose_target_g)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </span>
      </div>
      <div className="grid grid-cols-5 gap-x-1.5 pl-[56px] @md:gap-x-2 max-sm:pl-0 @4xl:w-[460px] @4xl:shrink-0 @4xl:pl-0">
        {cells.map((c) => (
          <span key={c.label} className="flex min-w-0 flex-col">
            <span className="truncate text-[10px] font-bold tracking-[0.02em] text-ink3 uppercase @md:text-[10.5px] @md:tracking-[0.06em]">{c.label}</span>
            <span className={cx("tnum truncate text-[14px] font-semibold text-ink2", !c.value && "text-ink4")}>{c.value ?? "–"}</span>
            <span className="text-[11.5px]">{" "}</span>
          </span>
        ))}
      </div>
      <span className="hidden w-[64px] shrink-0 @4xl:block" />
    </div>
  );
}
