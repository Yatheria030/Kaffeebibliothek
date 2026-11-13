import { useQuery } from "@tanstack/react-query";
import { Coffee, TriangleAlert } from "lucide-react";
import { api } from "./api.ts";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { navigate, rememberLibrary, rememberOrigin, useHash, useRoute, viewPath, type Route } from "./lib/router.ts";
import { AddCoffee } from "./pages/AddCoffee.tsx";
import { BrewsPage } from "./pages/Brews.tsx";
import { CoffeeDetail } from "./pages/CoffeeDetail.tsx";
import { EditCoffee } from "./pages/EditCoffee.tsx";
import { Library } from "./pages/Library.tsx";
import { Recipes } from "./pages/Recipes.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { SetupPage } from "./pages/Setup.tsx";
import { StatsPage } from "./pages/Stats.tsx";
import { StockPage } from "./pages/Stock.tsx";
import { WikiArticlePage, WikiHome } from "./pages/Wiki.tsx";
import { Button, EmptyState } from "./ui/controls.tsx";
import { ConfirmHost, Drawer, ToastHost } from "./ui/overlay.tsx";
import { Page, ShellProvider, Sidebar, Toolbar } from "./ui/Shell.tsx";

/** Scrollposition je Seite merken; ein ?bezug-Sheet zählt nicht als neue Seite */
function useScrollRestore(pathKey: string) {
  const saved = useRef(new Map<string, number>());
  const current = useRef(pathKey);
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const onScroll = () => saved.current.set(current.current, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    current.current = pathKey;
    window.scrollTo(0, saved.current.get(pathKey) ?? 0);
  }, [pathKey]);
}

function NotFound() {
  return (
    <>
      <Toolbar />
      <Page>
        <EmptyState
          icon={Coffee}
          title="Seite nicht gefunden"
          text="Diese Adresse gibt es in der Kaffeebibliothek nicht."
          action={
            <Button variant="primary" onClick={() => navigate("/")}>
              Zur Bibliothek
            </Button>
          }
        />
      </Page>
    </>
  );
}

/** Fängt Fehler beim Zeichnen einer Seite ab: Seitenleiste und Navigation bleiben benutzbar, statt dass alles weiß wird */
class PageBoundary extends Component<{ children: ReactNode; path: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { path: string }) {
    // Ein Seitenwechsel gibt der nächsten Seite eine neue Chance
    if (prev.path !== this.props.path && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <Toolbar />
        <Page>
          <EmptyState
            icon={TriangleAlert}
            title="Diese Seite ist abgestürzt"
            text={`Deine Daten sind davon nicht betroffen. Neu laden hilft meistens. (${this.state.error.message})`}
            action={
              <span className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Neu laden
                </Button>
                <Button onClick={() => navigate("/")}>Zur Bibliothek</Button>
              </span>
            }
          />
        </Page>
      </>
    );
  }
}

export function App() {
  const route = useRoute();
  const hash = useHash();
  const pathKey = (hash.replace(/^#/, "") || "/").split("?")[0];
  const [drawer, setDrawer] = useState(false);
  const prevRoute = useRef<Route | null>(null);
  useScrollRestore(pathKey);
  useEffect(() => setDrawer(false), [pathKey]);
  // Beim Seitenwechsel schon im Rendern, damit der Zurück-Link am Kaffee beim ersten Zeichnen stimmt (kein Effekt: der käme zu spät)
  if (prevRoute.current !== route) {
    const from = prevRoute.current;
    prevRoute.current = route;
    if (route.name === "library") rememberLibrary(viewPath(route.view));
    // Herkunft für den Zurück-Link; zwischen Kaffee, Bezug und Bearbeiten bleibt sie stehen
    if (route.name === "coffee" && from?.name !== "coffee" && from?.name !== "edit") rememberOrigin(from);
  }

  const shell = useMemo(() => ({ openSidebar: () => setDrawer(true) }), []);

  // Erste Schritte beim ersten Start einmal je Sitzung von der Bibliothek aus öffnen, solange sie nicht erledigt sind
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });
  useEffect(() => {
    if (settings.data && !settings.data.onboarded && route.name === "library") {
      let shown = false;
      try {
        shown = sessionStorage.getItem("setup-shown") != null;
        sessionStorage.setItem("setup-shown", "1");
      } catch {
        /* ohne Speicher: trotzdem einmal zeigen */
      }
      if (!shown) navigate("/erste-schritte", { replace: true });
    }
  }, [settings.data, route.name]);

  let page;
  switch (route.name) {
    case "library":
      page = <Library view={route.view} />;
      break;
    case "coffee":
      page = <CoffeeDetail key={route.id} id={route.id} brewOpen={route.brew} />;
      break;
    case "edit":
      page = <EditCoffee key={route.id} id={route.id} />;
      break;
    case "new":
      page = <AddCoffee />;
      break;
    case "recipes":
      page = <Recipes />;
      break;
    case "stats":
      page = <StatsPage />;
      break;
    case "stock":
      page = <StockPage />;
      break;
    case "brews":
      page = <BrewsPage />;
      break;
    case "wiki":
      page = route.slug ? <WikiArticlePage key={route.slug} slug={route.slug} /> : <WikiHome />;
      break;
    case "setup":
      page = <SetupPage />;
      break;
    case "settings":
      page = <SettingsPage section={route.section} />;
      break;
    default:
      page = <NotFound />;
  }

  return (
    <ShellProvider value={shell}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[228px] shrink-0 lg:block">
          <Sidebar route={route} />
        </aside>
        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          <Sidebar route={route} onNavigate={() => setDrawer(false)} />
        </Drawer>
        <main className="flex min-w-0 flex-1 flex-col">
          <PageBoundary path={pathKey}>{page}</PageBoundary>
        </main>
      </div>
      <ConfirmHost />
      <ToastHost />
    </ShellProvider>
  );
}
