import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  Eye,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  Coffee,
  GraduationCap,
  History,
  LayoutGrid,
  Package,
  PackageOpen,
  PanelLeft,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FLAVOR_WHEEL } from "../../../shared/flavors.ts";
import { countryFlag, ROAST_FOR, ROAST_LEVELS, type CoffeeListItem } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { href, navigate, viewPath, type LibraryView, type Route } from "../lib/router.ts";
import { activeFilterCount, applyFilters, inView, resetFilters, setFilters, useFilters, useRecent } from "../lib/store.ts";
import { Artwork } from "./Artwork.tsx";
import { CoffeeLink } from "./CoffeeLink.tsx";
import { cx, IconButton, Segmented } from "./controls.tsx";

// ---------- Kontext: Seitenleiste als Drawer öffnen ----------

const ShellCtx = createContext<{ openSidebar: () => void }>({ openSidebar: () => {} });
export const ShellProvider = ShellCtx.Provider;

/** Wie weit die Seite gescrollt ist: 0 oben, 1 sobald sie sich unter die Leiste schiebt, 2 wenn der große Titel weg ist */
function useScrollStage(): 0 | 1 | 2 {
  const read = () => (window.scrollY > 40 ? 2 : window.scrollY > 4 ? 1 : 0);
  const [stage, setStage] = useState<0 | 1 | 2>(read);
  useEffect(() => {
    const on = () => setStage(read());
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return stage;
}

const APP_NAME = "Kaffeebibliothek";

/** Titel des Browser-Tabs (und des Verlaufs): „Seite · Kaffeebibliothek“ */
function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}

/**
 * Obere Leiste. Ganz oben liegt sie ohne eigene Fläche auf dem Seitengrund, damit sie mit dem großen Titel eine Einheit
 * bildet. Beim Scrollen wird sie milchig mit Trennlinie und zeigt `title`, sobald der große Titel verschwunden ist; auf dem
 * Handy nur, wenn die Leiste sonst leer ist (neben Bedienelementen reicht der Platz nicht).
 * `tab` benennt den Browser-Tab auf Seiten ohne `title` (Detailseiten mit Zurück-Link), `dot` markiert den Knopf der
 * Seitenleiste, solange dort etwas aktiv ist, das man bei geschlossener Leiste nicht sieht (Filter).
 */
export function Toolbar({ children, title, tab, dot }: { children?: ReactNode; title?: string; tab?: string; dot?: boolean }) {
  const { openSidebar } = useContext(ShellCtx);
  const stage = useScrollStage();
  usePageTitle(tab ?? title);
  return (
    <div
      className={cx(
        "sticky top-0 z-30 border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-200",
        stage > 0 ? "frost border-sep bg-[var(--c-toolbar)]" : "border-transparent",
      )}
    >
      {/* rechts bündig mit dem Seiteninhalt (Page: px-4 sm:px-6 lg:px-8), links etwas weniger für den Icon-Knopf der Seitenleiste */}
      <div className="flex h-[52px] items-center gap-2 pr-4 pl-3 sm:pr-6 sm:pl-5 lg:px-8">
        <span className="relative flex shrink-0 lg:hidden">
          <IconButton label={dot ? "Seitenleiste einblenden, Filter aktiv" : "Seitenleiste einblenden"} icon={PanelLeft} onClick={openSidebar} />
          {dot && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-bg" />}
        </span>
        {title != null && (
          <span
            aria-hidden={stage < 2}
            className={cx(
              "min-w-0 flex-[1_1_auto] truncate text-[17px] font-extrabold tracking-[-0.01em] transition-opacity duration-200",
              stage < 2 && "opacity-0",
              children != null && "max-sm:opacity-0", // auf dem Handy reicht der Platz neben Bedienelementen nicht
            )}
          >
            {title}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href={href(to)}
      className="-ml-1.5 flex h-8 min-w-0 items-center rounded-full pr-2.5 text-[15px] text-accent no-underline hover:bg-accent-soft"
    >
      <ChevronLeft size={22} strokeWidth={2.2} className="shrink-0" />
      <span className="truncate">{children}</span>
    </a>
  );
}

export function Page({ children, narrow, wide }: { children: ReactNode; narrow?: boolean; wide?: boolean }) {
  return (
    <div
      className={cx(
        "mx-auto flex w-full flex-col gap-6 px-4 pt-5 pb-16 sm:px-6 lg:px-8",
        narrow ? "max-w-[760px]" : wide ? "max-w-[1720px]" : "max-w-[1240px]",
      )}
    >
      {children}
    </div>
  );
}

/** Versatz für `lift`, auch für Hüllen, in denen der Titel mit anderem in einer Zeile steht */
export const LIFT = "lg:-mt-[66.5px]";

/**
 * Großer Seitentitel. `lift`: ab lg (Seitenleiste fest, links in der Leiste nichts) rückt er hoch auf Höhe der Bedienelemente
 * der durchsichtigen Leiste, statt darunter eine leere Zeile zu lassen. Nur auf Seiten, deren Toolbar links leer ist. 66,5 px statt 64:
 * die Versalmitte (nicht die Zeilenbox) steht so auf der Mitte der Leistenknöpfe.
 */
export function LargeTitle({ children, sub, lift }: { children: ReactNode; sub?: ReactNode; lift?: boolean }) {
  return (
    <div className={cx("flex flex-col gap-1", lift && LIFT)}>
      <h1 className="m-0 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.025em] sm:text-[34px]">{children}</h1>
      {sub && <p className="m-0 text-[15px] text-ink2">{sub}</p>}
    </div>
  );
}

// ---------- Seitenleiste ----------

const NAV: { view: LibraryView; label: string; icon: LucideIcon }[] = [
  { view: "alle", label: "Alle Kaffees", icon: LayoutGrid },
  { view: "offen", label: "Gerade offen", icon: Coffee },
  { view: "gesehen", label: "Gesehen", icon: Eye },
  { view: "aufgebraucht", label: "Aufgebraucht", icon: PackageOpen },
  { view: "archiv", label: "Archiv", icon: Archive },
];

function SideHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-[22px] items-center justify-between px-2.5 pb-1.5">
      <span className="text-[11px] leading-4 font-bold tracking-[0.06em] text-ink2 uppercase">{children}</span>
      {action}
    </div>
  );
}

function SideLink({
  to,
  icon: Icon,
  label,
  count,
  active,
  onNavigate,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  count?: number | string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={href(to)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] no-underline",
        active ? "bg-selected font-bold text-accent" : "font-semibold text-ink hover:bg-hover",
      )}
    >
      <Icon size={16} strokeWidth={2.2} className={cx("shrink-0", active ? "text-accent" : "text-ink2")} />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tnum text-[12px] font-normal text-ink3">{count}</span>}
    </a>
  );
}

function ToggleRow({
  checked,
  onClick,
  lead,
  label,
  count,
  dim,
}: {
  checked: boolean;
  onClick: () => void;
  lead: ReactNode;
  label: string;
  count?: number;
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onClick}
      className={cx(
        "flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] font-semibold hover:bg-hover",
        dim ? "text-ink3" : "text-ink",
        checked && "bg-selected",
      )}
    >
      <span className={cx("flex w-4 shrink-0 justify-center", dim && "opacity-40")}>{lead}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tnum text-[12px] text-ink3">{count}</span>}
      <Check size={14} strokeWidth={2.6} className={cx("shrink-0 text-accent", !checked && "invisible")} />
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate?: () => void }) {
  const { data: coffees = [] } = useQuery({ queryKey: ["coffees"], queryFn: api.coffees });
  const { data: stock = [] } = useQuery({ queryKey: ["coffees", "stock"], queryFn: api.stock });
  const f = useFilters();
  const recent = useRecent();
  const view: LibraryView = route.name === "library" ? route.view : "alle";
  const onLibrary = route.name === "library";
  const [allCountries, setAllCountries] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const fixed = !onNavigate; // feste Leiste ab lg, sonst die Kopie im Drawer

  // „/“ springt ins Suchfeld der festen Leiste, solange nichts anderes Text annimmt und kein Dialog offen ist
  useEffect(() => {
    if (!fixed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]") || document.querySelector('[aria-modal="true"]')) return;
      if (!search.current || search.current.offsetParent === null) return;
      e.preventDefault();
      search.current.focus();
      search.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fixed]);

  const counts = useMemo(() => {
    const c: Record<LibraryView, number> = { alle: 0, offen: 0, gesehen: 0, aufgebraucht: 0, archiv: 0 };
    for (const x of coffees) for (const v of NAV) if (inView(x, v.view)) c[v.view] += 1;
    return c;
  }, [coffees]);

  const base = useMemo(() => coffees.filter((c) => inView(c, view)), [coffees, view]);
  const countBy = (list: CoffeeListItem[], key: (c: CoffeeListItem) => string[] | string | null) => {
    const m = new Map<string, number>();
    for (const c of list) {
      const k = key(c);
      for (const v of Array.isArray(k) ? k : k ? [k] : []) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  const roastCounts = useMemo(() => countBy(applyFilters(base, f, "roast"), (c) => c.roast_level), [base, f]);
  const countryCounts = useMemo(() => countBy(applyFilters(base, f, "countries"), (c) => c.country.trim() || null), [base, f]);
  const catCounts = useMemo(() => countBy(applyFilters(base, f, "cats"), (c) => c.categories), [base, f]);
  const countries = useMemo(() => {
    const names = new Set([...countryCounts.keys(), ...f.countries]);
    return [...names].sort((a, b) => (countryCounts.get(b) ?? 0) - (countryCounts.get(a) ?? 0) || a.localeCompare(b, "de"));
  }, [countryCounts, f.countries]);
  const shownCountries = allCountries ? countries : countries.slice(0, 6);
  const cats = FLAVOR_WHEEL.filter((c) => c.id !== "sonstiges" && ((catCounts.get(c.id) ?? 0) > 0 || f.cats.includes(c.id)));

  const goLibrary = () => {
    if (!onLibrary) navigate("/");
  };
  const recentCoffees = recent.map((id) => coffees.find((c) => c.id === id)).filter((c): c is CoffeeListItem => Boolean(c));
  const active = activeFilterCount(f);

  return (
    <nav
      aria-label="Seitenleiste"
      className="frost flex h-full flex-col gap-[18px] overflow-y-auto overscroll-contain border-r border-sep bg-[var(--c-sidebar)] px-3 pt-[max(18px,env(safe-area-inset-top))] pb-6"
    >
      <div className="flex items-center gap-2.5 px-2">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="shrink-0">
          <ellipse cx="12" cy="12" rx="6.5" ry="9.5" transform="rotate(35 12 12)" />
          <path d="M8.6 5.2c2.6 3.4 4.2 9.8 6.8 13.6" />
        </svg>
        <span className="flex-1 text-[16px] font-extrabold tracking-[-0.01em]">Kaffeebibliothek</span>
        {onNavigate && (
          <button
            type="button"
            aria-label="Seitenleiste schließen"
            onClick={onNavigate}
            className="flex size-8 items-center justify-center rounded-full text-ink2 hover:bg-hover"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <label className="mx-1 flex h-[38px] shrink-0 items-center gap-2 rounded-[11px] bg-bg px-2.5 shadow-[inset_0_0_0_1px_var(--c-sep)]">
        <Search size={14} strokeWidth={2.4} className="shrink-0 text-ink3" />
        <input
          ref={search}
          type="search"
          aria-label="Kaffees durchsuchen"
          aria-keyshortcuts={fixed ? "/" : undefined}
          placeholder="Suchen"
          value={f.q}
          onChange={(e) => {
            setFilters({ q: e.target.value });
            goLibrary();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onNavigate?.();
            // Escape leert erst, beim zweiten Mal gibt es den Fokus ab; im Drawer schließt Escape wie gewohnt die Leiste
            if (e.key === "Escape" && fixed) {
              if (f.q) setFilters({ q: "" });
              else e.currentTarget.blur();
            }
          }}
          className="field peer text-[14px] [&::-webkit-search-cancel-button]:hidden"
        />
        {fixed && !f.q && (
          <kbd aria-hidden="true" className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[6px] px-1 font-sans text-[11px] font-bold text-ink3 shadow-[inset_0_0_0_1px_var(--c-line)] peer-focus:hidden">
            /
          </kbd>
        )}
        {f.q && (
          <button type="button" aria-label="Suche leeren" onClick={() => setFilters({ q: "" })} className="flex size-4 items-center justify-center rounded-full bg-ink3 text-card">
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </label>

      <div className="flex flex-col gap-px">
        <SideHeading>Bibliothek</SideHeading>
        {/* Nach Priorität: jetzt (offen), Vorrat (Lager), Vergangenes (aufgebraucht), Gesehenes, selten (Archiv) */}
        {(["alle", "offen", "lager", "aufgebraucht", "gesehen", "archiv"] as const).map((v) => {
          if (v === "lager")
            return <SideLink key={v} to="/lager" icon={Package} label="Lager" count={stock.length} active={route.name === "stock"} onNavigate={onNavigate} />;
          const n = NAV.find((x) => x.view === v)!;
          if (v === "archiv" && counts.archiv === 0) return null;
          return (
            <SideLink
              key={v}
              to={viewPath(v)}
              icon={n.icon}
              label={n.label}
              count={counts[v]}
              active={onLibrary && view === v}
              onNavigate={onNavigate}
            />
          );
        })}
        <SideLink to="/bezuege" icon={History} label="Bezüge" active={route.name === "brews"} onNavigate={onNavigate} />
        <SideLink to="/statistik" icon={ChartColumn} label="Statistik" active={route.name === "stats"} onNavigate={onNavigate} />
        <SideLink to="/wissen" icon={GraduationCap} label="Kaffeewissen" active={route.name === "wiki"} onNavigate={onNavigate} />
      </div>

      {onLibrary ? (
        <>
          <div className="flex flex-col gap-px">
            {/* Zurücksetzen sitzt in der Kopfzeile, damit beim ersten Filter nichts nach unten springt */}
            <SideHeading
              action={
                active > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    title={active === 1 ? "1 Filter aktiv" : `${active} Filter aktiv`}
                    className="h-4 text-[11px] leading-4 font-semibold text-accent hover:underline"
                  >
                    Zurücksetzen
                  </button>
                )
              }
            >
              Röstgrad
            </SideHeading>
            {ROAST_LEVELS.map((r) => {
              const n = roastCounts.get(r.id) ?? 0;
              const on = f.roasts.includes(r.id);
              return (
                <ToggleRow
                  key={r.id}
                  checked={on}
                  onClick={() => {
                    setFilters({ roasts: toggle(f.roasts, r.id) });
                    goLibrary();
                  }}
                  lead={<span className="size-3 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.2)]" style={{ background: r.color }} />}
                  label={r.label}
                  count={n}
                  dim={(f.roasts.length > 0 && !on) || n === 0}
                />
              );
            })}
          </div>

          <div className="flex flex-col gap-2 px-1">
            <SideHeading>Röstung für</SideHeading>
            <Segmented
              label="Röstung für"
              size="sm"
              full
              value={f.roastFor}
              onChange={(v) => setFilters({ roastFor: v })}
              options={[{ id: "alle" as const, label: "Alle" }, ...ROAST_FOR.map((r) => ({ id: r.id, label: r.label }))]}
            />
          </div>

          {countries.length > 0 && (
            <div className="flex flex-col gap-px">
              <SideHeading>Herkunft</SideHeading>
              {shownCountries.map((c) => {
                const on = f.countries.includes(c);
                return (
                  <ToggleRow
                    key={c}
                    checked={on}
                    onClick={() => setFilters({ countries: toggle(f.countries, c) })}
                    lead={<span className="text-[14px] leading-none">{countryFlag(c)}</span>}
                    label={c}
                    count={countryCounts.get(c) ?? 0}
                    dim={f.countries.length > 0 && !on}
                  />
                );
              })}
              {countries.length > 6 && (
                <button
                  type="button"
                  onClick={() => setAllCountries((v) => !v)}
                  className="flex h-7 items-center gap-1 self-start px-2.5 text-[12px] font-medium text-accent"
                >
                  {allCountries ? "Weniger" : `Alle ${countries.length} Länder`}
                  <ChevronDown size={12} strokeWidth={2.6} className={cx("transition-transform", allCountries && "rotate-180")} />
                </button>
              )}
            </div>
          )}

          {cats.length > 0 && (
            <div className="flex flex-col gap-px">
              <SideHeading>Geschmack</SideHeading>
              {cats.map((c) => {
                const on = f.cats.includes(c.id);
                return (
                  <ToggleRow
                    key={c.id}
                    checked={on}
                    onClick={() => setFilters({ cats: toggle(f.cats, c.id) })}
                    lead={<span className="size-3 rounded-full" style={{ background: `light-dark(${c.color}, ${c.colorDark})` }} />}
                    label={c.label}
                    count={catCounts.get(c.id) ?? 0}
                    dim={f.cats.length > 0 && !on}
                  />
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-2 px-2.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="min-score" className="text-[11px] font-semibold text-ink3">
                Bester Score ab
              </label>
              <span className="tnum text-[12px] font-semibold">{f.minScore > 0 ? f.minScore.toFixed(1).replace(".", ",") : "Alle"}</span>
            </div>
            <input
              id="min-score"
              type="range"
              min={79.5}
              max={94}
              step={0.5}
              value={f.minScore > 0 ? f.minScore : 79.5}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFilters({ minScore: v < 80 ? 0 : v });
              }}
              className="range"
              style={{ ["--p" as string]: `${(((f.minScore > 0 ? f.minScore : 79.5) - 79.5) / 14.5) * 100}%` }}
            />
          </div>
        </>
      ) : (
        recentCoffees.length > 0 && (
          <div className="flex flex-col gap-px">
            <SideHeading>Zuletzt angesehen</SideHeading>
            {recentCoffees.map((c) => {
              const on = route.name === "coffee" && route.id === c.id;
              return (
                <CoffeeLink
                  key={c.id}
                  id={c.id}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "flex h-[34px] items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] text-ink no-underline",
                    on ? "bg-selected" : "hover:bg-hover",
                  )}
                >
                  <Artwork coffee={c} size="xs" rounded={6} className="size-6" />
                  <span className="flex-1 truncate">{c.name}</span>
                </CoffeeLink>
              );
            })}
          </div>
        )
      )}

      <div className="mt-auto flex flex-col gap-px pt-2">
        <SideLink to="/einstellungen" icon={Settings} label="Einstellungen" active={route.name === "settings" || route.name === "recipes" || route.name === "setup"} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
