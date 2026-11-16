import { useSyncExternalStore } from "react";
import type { CoffeeListItem, RoastFor, RoastLevel } from "../../../shared/types.ts";
import type { LibraryView } from "./router.ts";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privates Fenster: dann eben nur für diese Sitzung */
  }
}

/** Kleiner Store mit localStorage, ohne Context-Ballast */
function createStore<T extends object>(key: string, initial: T) {
  let state = read(key, initial);
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      write(key, state);
      for (const l of listeners) l();
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

// ---------- Filter der Bibliothek ----------

export type SortKey = "zuletzt" | "score" | "name" | "roast" | "added";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "zuletzt", label: "Zuletzt getrunken" },
  { id: "score", label: "Bester Score" },
  { id: "name", label: "Name" },
  { id: "roast", label: "Röstdatum" },
  { id: "added", label: "Zuletzt hinzugefügt" },
];

export type Filters = {
  q: string;
  /** gewählte Röstgrade, leer = alle */
  roasts: RoastLevel[];
  roastFor: RoastFor | "alle";
  countries: string[];
  cats: string[];
  minScore: number;
  layout: "grid" | "list";
  sort: SortKey;
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  roasts: [],
  roastFor: "alle",
  countries: [],
  cats: [],
  minScore: 0,
  layout: "grid",
  sort: "zuletzt",
};

export const filterStore = createStore<Filters>("kb.filters.v2", DEFAULT_FILTERS);

export function useFilters(): Filters {
  return useSyncExternalStore(filterStore.subscribe, filterStore.get);
}

export const setFilters = filterStore.set;

export function resetFilters() {
  filterStore.set({ q: "", roasts: [], roastFor: "alle", countries: [], cats: [], minScore: 0 });
}

export function activeFilterCount(f: Filters): number {
  return (
    (f.q.trim() ? 1 : 0) +
    (f.roasts.length ? 1 : 0) +
    (f.roastFor !== "alle" ? 1 : 0) +
    (f.countries.length ? 1 : 0) +
    (f.cats.length ? 1 : 0) +
    (f.minScore > 0 ? 1 : 0)
  );
}

export function inView(c: CoffeeListItem, view: LibraryView): boolean {
  switch (view) {
    case "alle":
      return !c.archived && !c.wishlist;
    case "offen":
      return !c.archived && c.status === "offen";
    case "gesehen":
      return !c.archived && c.wishlist;
    case "aufgebraucht":
      return !c.archived && c.status === "leer";
    case "archiv":
      return c.archived;
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function matchesSearch(c: CoffeeListItem, q: string): boolean {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(
    [c.name, c.roaster, c.country, c.region, c.farm, c.producer, c.process, c.process_detail, ...c.varieties, ...c.roaster_notes].join(" "),
  );
  return terms.every((t) => hay.includes(t));
}

/** Alle Filter außer dem genannten anwenden (für die Zähler in der Seitenleiste) */
export function applyFilters(
  list: CoffeeListItem[],
  f: Filters,
  skip?: "roast" | "roastFor" | "countries" | "cats",
): CoffeeListItem[] {
  return list.filter((c) => {
    if (!matchesSearch(c, f.q)) return false;
    if (skip !== "roast" && f.roasts.length && (!c.roast_level || !f.roasts.includes(c.roast_level))) return false;
    if (skip !== "roastFor" && f.roastFor !== "alle" && c.roast_for !== f.roastFor && c.roast_for !== "omni") return false;
    if (skip !== "countries" && f.countries.length && !f.countries.includes(c.country.trim())) return false;
    if (skip !== "cats" && f.cats.length && !f.cats.some((x) => c.categories.includes(x))) return false;
    if (f.minScore > 0 && (c.best_score ?? 0) < f.minScore) return false;
    return true;
  });
}

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

export function sortCoffees(list: CoffeeListItem[], sort: SortKey): CoffeeListItem[] {
  const out = [...list];
  const by = (a: string | null | undefined, b: string | null | undefined) => (b ?? "").localeCompare(a ?? "");
  switch (sort) {
    case "zuletzt":
      return out.sort((a, b) => by(a.last_brewed_at ?? a.created_at, b.last_brewed_at ?? b.created_at));
    case "score":
      return out.sort((a, b) => (b.best_score ?? -1) - (a.best_score ?? -1) || collator.compare(a.name, b.name));
    case "name":
      return out.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.roaster, b.roaster));
    case "roast":
      return out.sort((a, b) => by(a.open_batch?.roast_date, b.open_batch?.roast_date) || collator.compare(a.name, b.name));
    case "added":
      return out.sort((a, b) => by(a.created_at, b.created_at));
  }
}

// ---------- Zuletzt angesehen ----------

const recentStore = createStore<{ ids: number[] }>("kb.recent.v1", { ids: [] });

export function useRecent(): number[] {
  return useSyncExternalStore(recentStore.subscribe, () => recentStore.get().ids);
}

export function pushRecent(id: number) {
  recentStore.set((s) => (s.ids[0] === id ? {} : { ids: [id, ...s.ids.filter((x) => x !== id)].slice(0, 4) }));
}

// ---------- Übergabe aus der Bibliothek an "Hinzufügen" ----------

export type PendingAdd = { url?: string; name?: string; image?: string; wishlist?: boolean } | null;
let pending: PendingAdd = null;
export const setPendingAdd = (p: PendingAdd) => {
  pending = p;
};
/** Nur lesen; geleert wird per clearPendingAdd im Effekt (StrictMode rendert doppelt) */
export const peekPendingAdd = (): PendingAdd => pending;
export const clearPendingAdd = () => {
  pending = null;
};
