import { useMemo, useSyncExternalStore } from "react";

export type LibraryView = "alle" | "offen" | "gesehen" | "aufgebraucht" | "archiv";

export type Route =
  | { name: "library"; view: LibraryView }
  | { name: "coffee"; id: number; brew: boolean }
  | { name: "edit"; id: number }
  | { name: "new"; job: string | null }
  | { name: "recipes" }
  | { name: "stats" }
  | { name: "stock" }
  | { name: "brews" }
  | { name: "wiki"; slug: string | null }
  | { name: "settings"; section: string | null }
  | { name: "setup" }
  | { name: "notfound" };

const VIEWS: Record<string, LibraryView> = {
  "": "alle",
  offen: "offen",
  gesehen: "gesehen",
  merkliste: "gesehen",
  aufgebraucht: "aufgebraucht",
  archiv: "archiv",
};

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1 && (parts[0] ?? "") in VIEWS) return { name: "library", view: VIEWS[parts[0] ?? ""] };
  if (parts[0] === "kaffee" && parts[1]) {
    const id = Number(parts[1]);
    if (!Number.isInteger(id) || id <= 0) return { name: "notfound" };
    if (parts[2] === "bearbeiten") return { name: "edit", id };
    return { name: "coffee", id, brew: new URLSearchParams(query).has("bezug") };
  }
  if (parts[0] === "neu") return { name: "new", job: new URLSearchParams(query).get("job") };
  if (parts[0] === "rezepte") return { name: "recipes" };
  if (parts[0] === "statistik") return { name: "stats" };
  if (parts[0] === "lager") return { name: "stock" };
  if (parts[0] === "bezuege") return { name: "brews" };
  if (parts[0] === "wissen") return parts[1] ? { name: "wiki", slug: decodeURIComponent(parts[1]) } : { name: "wiki", slug: null };
  if (parts[0] === "erste-schritte") return { name: "setup" };
  if (parts[0] === "einstellungen") return { name: "settings", section: parts[1] ? decodeURIComponent(parts[1]) : null };
  return { name: "notfound" };
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export function useRoute(): Route {
  const hash = useHash();
  return useMemo(() => parseRoute(hash), [hash]);
}

export function href(path: string): string {
  return "#" + path;
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const target = "#" + path;
  if (opts.replace) {
    history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
}

export function viewPath(view: LibraryView): string {
  return view === "alle" ? "/" : `/${view}`;
}

// Zuletzt besuchte Bibliotheksansicht, für "‹ Bibliothek"-Links
let lastLibrary = "/";
export const rememberLibrary = (path: string) => {
  lastLibrary = path;
};
export const lastLibraryPath = () => lastLibrary;

/** Seite, von der aus zuletzt ein Kaffee geöffnet wurde: Ziel und Beschriftung des Zurück-Links am Kaffee */
export type Origin = { path: string; label: string };
let origin: Origin = { path: "/", label: "Bibliothek" };
export const lastOrigin = () => origin;

/**
 * Beim Öffnen eines Kaffees merken, woher man kam. Nur Übersichten mit Kaffee-Links zählen (Bibliothek, Lager, Bezüge, Statistik,
 * Wiki-Artikel), von überall sonst (Einstellungen, direkter Aufruf, nach dem Hinzufügen) geht es zurück in die Bibliothek.
 */
export function rememberOrigin(from: Route | null) {
  if (from?.name === "library") origin = { path: viewPath(from.view), label: "Bibliothek" };
  else if (from?.name === "stock") origin = { path: "/lager", label: "Lager" };
  else if (from?.name === "brews") origin = { path: "/bezuege", label: "Bezüge" };
  else if (from?.name === "stats") origin = { path: "/statistik", label: "Statistik" };
  else if (from?.name === "wiki" && from.slug) origin = { path: `/wissen/${encodeURIComponent(from.slug)}`, label: "Kaffeewissen" };
  else origin = { path: lastLibrary, label: "Bibliothek" };
}
