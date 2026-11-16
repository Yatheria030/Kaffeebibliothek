import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, Eye, ChevronDown, ChevronRight, Coffee, LayoutGrid, List, Plus, SearchX, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { CATEGORY_BY_ID } from "../../../shared/flavors.ts";
import { bagAge, countryFlag, ROAST_FOR, ROAST_LEVELS, type CoffeeListItem } from "../../../shared/types.ts";
import { formatScore } from "../../../shared/sca.ts";
import { api } from "../api.ts";
import { todayIso } from "../lib/format.ts";
import { fileToDataUrl } from "../lib/image.ts";
import { navigate, type LibraryView } from "../lib/router.ts";
import {
  activeFilterCount,
  applyFilters,
  inView,
  resetFilters,
  setFilters,
  setPendingAdd,
  sortCoffees,
  SORTS,
  useFilters,
  type Filters,
} from "../lib/store.ts";
import { Artwork, RoastDot, ScoreCapsule } from "../ui/Artwork.tsx";
import { Button, cx, EmptyState, LoadError, Menu, Segmented } from "../ui/controls.tsx";
import { CoffeeLink } from "../ui/CoffeeLink.tsx";
import { toast } from "../ui/overlay.tsx";
import { LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { MachinePill } from "../ui/MachineLive.tsx";
import { fmtStars } from "../ui/Stars.tsx";

const TITLES: Record<LibraryView, string> = {
  alle: "Alle Kaffees",
  offen: "Gerade offen",
  gesehen: "Gesehen",
  aufgebraucht: "Aufgebraucht",
  archiv: "Archiv",
};

const roastLabel = (c: CoffeeListItem) => ROAST_LEVELS.find((r) => r.id === c.roast_level)?.label;

function originLine(c: CoffeeListItem) {
  return [c.country.trim(), c.process.trim()].filter(Boolean).join(" · ");
}

/** "https://…", "shop.de/kaffee" oder "www.…" gelten als Link */
export function asUrl(text: string): string | null {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t) && !/\s/.test(t)) return "https://" + t;
  return null;
}

// ---------- Hinzufügen per Ziehen ----------

/** Bild oder Link irgendwo auf die Bibliothek ziehen: öffnet „Hinzufügen“ vorbefüllt */
function usePageDrop(wishlist: boolean) {
  const [drag, setDrag] = useState(false);
  const depth = useRef(0);
  const go = (p: { url?: string; name?: string; image?: string }) => {
    setPendingAdd({ ...p, wishlist });
    navigate("/neu");
  };
  const accepts = (e: DragEvent) => [...e.dataTransfer.types].some((t) => t === "Files" || t === "text/uri-list" || t === "text/plain");
  return {
    drag,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        depth.current++;
        setDrag(true);
      },
      onDragOver: (e: DragEvent) => {
        if (accepts(e)) e.preventDefault();
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDrag(false);
      },
      onDrop: async (e: DragEvent) => {
        e.preventDefault();
        depth.current = 0;
        setDrag(false);
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
        if (f) {
          try {
            go({ image: await fileToDataUrl(f) });
          } catch (err) {
            toast(err instanceof Error ? err.message : "Foto nicht lesbar", "error");
          }
          return;
        }
        const t = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim().split("\n")[0]?.trim();
        if (!t) return;
        const url = asUrl(t);
        go(url ? { url } : { name: t });
      },
    },
  };
}

// ---------- Aktive Filter ----------

/**
 * Aktive Filter als Chips zum Entfernen. Nur unter lg: dort steckt die Seitenleiste im Drawer, und ohne diese Zeile sähe
 * man der Liste nicht an, warum sie kürzer ist. Mit fester Seitenleiste zeigt die Leiste selbst, was gewählt ist.
 */
function ActiveFilters({ f }: { f: Filters }) {
  const without = <T,>(list: T[], v: T) => list.filter((x) => x !== v);
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(f.q.trim() ? [{ key: "q", label: `„${f.q.trim()}“`, clear: () => setFilters({ q: "" }) }] : []),
    ...f.roasts.map((r) => ({
      key: `r-${r}`,
      label: ROAST_LEVELS.find((x) => x.id === r)?.label ?? r,
      clear: () => setFilters({ roasts: without(f.roasts, r) }),
    })),
    ...(f.roastFor !== "alle"
      ? [{ key: "for", label: `Für ${ROAST_FOR.find((x) => x.id === f.roastFor)?.label ?? f.roastFor}`, clear: () => setFilters({ roastFor: "alle" }) }]
      : []),
    ...f.countries.map((c) => ({ key: `c-${c}`, label: `${countryFlag(c)} ${c}`.trim(), clear: () => setFilters({ countries: without(f.countries, c) }) })),
    ...f.cats.map((c) => ({ key: `g-${c}`, label: CATEGORY_BY_ID.get(c)?.label ?? c, clear: () => setFilters({ cats: without(f.cats, c) }) })),
    ...(f.minScore > 0 ? [{ key: "min", label: `Score ab ${f.minScore.toFixed(1).replace(".", ",")}`, clear: () => setFilters({ minScore: 0 }) }] : []),
  ];
  if (!chips.length) return null;
  return (
    <div role="group" aria-label="Aktive Filter" className="-mt-3 flex flex-wrap items-center gap-1.5 lg:hidden">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          aria-label={`Filter ${c.label} entfernen`}
          className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-card pr-2 pl-3 text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2"
        >
          <span className="truncate">{c.label}</span>
          <X size={13} strokeWidth={2.6} className="shrink-0 text-ink3" aria-hidden="true" />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={resetFilters} className="h-8 rounded-full px-2.5 text-[13px] font-bold text-accent hover:bg-accent-soft">
          Alle zurücksetzen
        </button>
      )}
    </div>
  );
}

// ---------- Regal ----------

function GridItem({ c }: { c: CoffeeListItem }) {
  const roast = roastLabel(c);
  const origin = originLine(c);
  const day = c.open_batch ? bagAge(c.open_batch, todayIso()) : null;
  // Wo der Kaffee gerade steht: offen (mit Tag seit Röstung, wenn bekannt) oder ungeöffnet im Lager; Aufgebrauchtes bleibt ohne Zusatz
  const state = c.status === "offen" ? (day != null ? `Offen · Tag ${day}` : "Offen") : c.status === "vorrat" ? "Ungeöffnet" : null;
  return (
    <CoffeeLink
      id={c.id}
      className="group flex min-w-0 flex-col overflow-hidden rounded-[18px] bg-card text-ink no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_var(--c-line),0_8px_24px_-12px_rgba(0,0,0,0.18)]"
    >
      <Artwork coffee={c} size="md" rounded={0} fade className="aspect-[6/5] w-full">
        <ScoreCapsule score={c.best_score} stars={c.avg_rating} className="absolute top-2.5 right-2.5" />
        {c.wishlist && (
          <span className="absolute top-2.5 left-2.5 flex size-7 items-center justify-center rounded-full bg-card shadow-card">
            <Eye size={13} strokeWidth={2.4} className="text-accent" aria-label="Gesehen" />
          </span>
        )}
      </Artwork>
      <span className="flex min-w-0 flex-1 flex-col gap-1 px-3.5 pt-3 pb-3.5 sm:px-4 sm:pb-4">
        <span className="truncate text-[11px] font-bold tracking-[0.06em] text-ink2 uppercase sm:text-[12px]">{c.roaster || "–"}</span>
        <span className="line-clamp-2 text-[15px] leading-[1.25] font-extrabold tracking-[-0.01em] sm:text-[16px]">{c.name}</span>
        {origin && <span className="truncate text-[13px] text-ink2">{origin}</span>}
        {c.roaster_notes.length > 0 && <span className="truncate text-[13px] text-ink3 max-sm:hidden">{c.roaster_notes.join(", ")}</span>}
        {(roast || state) && (
          <span className="mt-auto flex items-center justify-between gap-2 pt-1.5">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-ink2">
              {roast && (
                <>
                  <RoastDot level={c.roast_level} size={9} />
                  <span className="truncate">{roast}</span>
                </>
              )}
            </span>
            {state && <span className={cx("tnum shrink-0 text-[12px]", c.status === "offen" ? "font-bold text-accent" : "text-ink3")}>{state}</span>}
          </span>
        )}
      </span>
    </CoffeeLink>
  );
}

function ListItem({ c }: { c: CoffeeListItem }) {
  const roast = roastLabel(c);
  return (
    <CoffeeLink id={c.id} className="flex items-center gap-3.5 px-4 py-2.5 text-ink no-underline hover:bg-hover">
      <Artwork coffee={c} size="xs" className="size-11" rounded={9} />
      <span className="flex min-w-0 flex-[2_1_160px] flex-col">
        <span className="truncate text-[14px] font-bold">{c.name}</span>
        <span className="truncate text-[12px] text-ink2">{c.roaster || "–"}</span>
      </span>
      <span className="hidden min-w-0 flex-[1_1_120px] truncate text-[13px] text-ink2 md:block">
        {c.country.trim() && <span className="mr-1">{countryFlag(c.country)}</span>}
        {originLine(c) || "–"}
      </span>
      <span className="hidden min-w-0 flex-[1_1_140px] truncate text-[13px] text-ink2 xl:block">{c.roaster_notes.join(", ")}</span>
      <span className="hidden w-[76px] shrink-0 items-center gap-1.5 text-[13px] text-ink2 sm:flex">
        {roast && (
          <>
            <RoastDot level={c.roast_level} />
            {roast}
          </>
        )}
      </span>
      <span className="tnum w-[52px] shrink-0 text-right text-[14px] font-extrabold">
        {c.best_score == null && c.avg_rating != null ? (
          <>
            {fmtStars(c.avg_rating)}
            <span className="font-semibold text-ink3">/5</span>
          </>
        ) : (
          formatScore(c.best_score)
        )}
      </span>
      <ChevronRight size={16} className="shrink-0 text-ink4" aria-hidden="true" />
    </CoffeeLink>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] sm:gap-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <div className="skeleton aspect-[6/5] rounded-[18px]" />
          <div className="skeleton h-3.5 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

// ---------- Seite ----------

export function Library({ view }: { view: LibraryView }) {
  const { data: coffees, isLoading, error, refetch } = useQuery({ queryKey: ["coffees"], queryFn: api.coffees });
  const f = useFilters();
  const active = activeFilterCount(f);

  const base = useMemo(() => (coffees ?? []).filter((c) => inView(c, view)), [coffees, view]);
  const shown = useMemo(() => sortCoffees(applyFilters(base, f), f.sort), [base, f]);
  const openCount = (coffees ?? []).filter((c) => inView(c, "offen")).length;
  const wishlistView = view === "gesehen";
  const { drag, handlers } = usePageDrop(wishlistView);
  const add = () => {
    setPendingAdd({ wishlist: wishlistView });
    navigate("/neu");
  };

  const sub = coffees
    ? [
        active > 0 ? `${shown.length} von ${base.length} Kaffees` : `${base.length} ${base.length === 1 ? "Kaffee" : "Kaffees"}`,
        view === "alle" && openCount > 0 ? `${openCount} offen` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : " ";

  const sortLabel = SORTS.find((s) => s.id === f.sort)?.label ?? "Sortierung";

  return (
    <>
      <Toolbar title={TITLES[view]} dot={active > 0}>
        <MachinePill />
        <Segmented
          label="Ansicht"
          size="sm"
          value={f.layout}
          onChange={(v) => setFilters({ layout: v })}
          options={[
            { id: "grid", label: <LayoutGrid size={14} strokeWidth={2.2} aria-label="Raster" />, title: "Raster" },
            { id: "list", label: <List size={15} strokeWidth={2.2} aria-label="Liste" />, title: "Liste" },
          ]}
        />
        <Menu
          label="Sortierung"
          items={SORTS.map((s) => ({ label: s.label, checked: s.id === f.sort, onSelect: () => setFilters({ sort: s.id }) }))}
          trigger={(p) => (
            <button
              type="button"
              {...p}
              aria-label={`Sortierung: ${sortLabel}`}
              className="flex h-[30px] items-center gap-1.5 rounded-[8px] bg-fill px-2.5 text-[13px] text-ink hover:bg-fill2"
            >
              <ArrowDownUp size={14} strokeWidth={2.2} className="text-ink2 sm:hidden" />
              <span className="hidden sm:inline">{sortLabel}</span>
              <ChevronDown size={11} strokeWidth={3} className="hidden text-ink2 sm:block" />
            </button>
          )}
        />
        <Button variant="primary" size="sm" icon={Plus} onClick={add}>
          Hinzufügen
        </Button>
      </Toolbar>

      <div {...handlers} className="relative min-h-[calc(100dvh-56px)]">
      {drag && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-start justify-center rounded-[20px] border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--c-accent-soft)_80%,transparent)] pt-[30vh]">
          <span className="rounded-[12px] bg-card px-4 py-2.5 text-[15px] font-bold text-accent shadow-card">
            Loslassen, um {wishlistView ? "ihn unter Gesehen abzulegen" : "den Kaffee hinzuzufügen"}
          </span>
        </div>
      )}
      <Page wide>
        <LargeTitle lift sub={sub}>{TITLES[view]}</LargeTitle>
        <ActiveFilters f={f} />

        {error ? <LoadError what="Die Bibliothek wurde" error={error} retry={() => void refetch()} /> : null}

        <section aria-label={TITLES[view]} className="flex flex-col gap-3.5">
          {isLoading ? (
            <SkeletonGrid />
          ) : !coffees ? null : base.length === 0 ? (
            <EmptyState
              icon={view === "gesehen" ? Eye : Coffee}
              title={
                view === "alle"
                  ? coffees.length === 0
                    ? "Noch keine Kaffees"
                    : "Alles unter Gesehen oder im Archiv"
                  : view === "gesehen"
                    ? "Noch nichts gesehen"
                    : view === "offen"
                      ? "Gerade ist nichts offen"
                      : view === "aufgebraucht"
                        ? "Noch nichts aufgebraucht"
                        : "Archiv ist leer"
              }
              text={
                view === "alle" && coffees.length === 0
                  ? "Per Link, Name oder Foto der Packung. Du kannst ein Bild oder einen Link auch einfach hierher ziehen."
                  : view === "gesehen"
                    ? "Kaffees, die dir irgendwo begegnet sind, legst du hier ab. Mit der ersten Charge wandern sie in die Bibliothek."
                    : view === "offen"
                      ? "Sobald eine Charge geöffnet ist, erscheint der Kaffee hier."
                      : undefined
              }
              action={
                (view === "alle" && coffees.length === 0) || view === "gesehen" ? (
                  <Button variant="primary" icon={Plus} onClick={add}>
                    {view === "gesehen" ? "Kaffee ablegen" : "Kaffee hinzufügen"}
                  </Button>
                ) : undefined
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Keine Treffer"
              text="Kein Kaffee passt zu Suche und Filtern."
              action={<Button onClick={resetFilters}>Filter zurücksetzen</Button>}
            />
          ) : f.layout === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] sm:gap-4">
              {shown.map((c) => (
                <GridItem key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[16px] bg-card shadow-card [&>*+*]:border-t [&>*+*]:border-sep">
              {shown.map((c) => (
                <ListItem key={c.id} c={c} />
              ))}
            </div>
          )}
        </section>
      </Page>
      </div>
    </>
  );
}
