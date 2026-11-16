import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScrapeJob } from "../../../shared/types.ts";
import { api, imageUrl } from "../api.ts";
import { navigate, useRoute } from "../lib/router.ts";
import { cx } from "./controls.tsx";
import { confirmDialog, toast } from "./overlay.tsx";

export const JOBS_KEY = ["scrape-jobs"];

/** Laufende und fertige Auslesungen im Server; solange eine läuft, oft nachfragen */
export function useScrapeJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: api.scrapeJobs,
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === "run") ? 2000 : 30_000),
    refetchIntervalInBackground: true,
  });
}

export const jobPath = (id: string) => `/neu?job=${encodeURIComponent(id)}`;

const jobTitle = (j: ScrapeJob) => (j.name ? [j.name, j.roaster].filter(Boolean).join(" · ") : `Kaffee aus ${j.what}`);

/** Systemmeldung erlauben lassen; nur aus einem Klick heraus aufrufen */
export function askNotify() {
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    /* ohne Meldungen geht es auch */
  }
}

function notify(title: string, body: string, id: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag: `scrape-${id}`, icon: "/icon-192.png" });
    n.onclick = () => {
      window.focus();
      navigate(jobPath(id));
      n.close();
    };
  } catch {
    /* iOS kennt new Notification nicht, dort bleibt der Hinweis in der App */
  }
}

/** Ab in den Hintergrund: Meldung erbitten, zurück zur Bibliothek, kurzer Hinweis */
export function toBackground(back: string) {
  askNotify();
  navigate(back);
  toast("Liest im Hintergrund weiter. Unten rechts siehst du, wann er fertig ist.");
}

/** Hinweis, sobald eine Auslesung fertig ist, die man gerade nicht anschaut */
function useFinishNotice(jobs: ScrapeJob[] | undefined, viewing: string | null) {
  const known = useRef<Map<string, ScrapeJob["state"]> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const prev = known.current;
    known.current = new Map(jobs.map((j) => [j.id, j.state]));
    if (!prev) return; // erster Stand: nichts melden, was schon vorher fertig war
    for (const j of jobs) {
      if (prev.get(j.id) !== "run" || j.state === "run" || j.id === viewing) continue;
      const open = () => navigate(jobPath(j.id));
      if (j.state === "done") {
        toast(`${jobTitle(j)} ist ausgelesen`, "ok", { label: "Prüfen", onClick: open });
        if (document.hidden) notify("Kaffee ausgelesen", `${jobTitle(j)}: bitte kurz prüfen und sichern.`, j.id);
      } else {
        toast(`Auslesen fehlgeschlagen: ${j.error ?? j.what}`, "error", { label: "Ansehen", onClick: open });
        if (document.hidden) notify("Auslesen fehlgeschlagen", j.error ?? j.what, j.id);
      }
    }
  }, [jobs, viewing]);
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tnum">{Math.max(0, Math.round((now - since) / 1000))} s</span>;
}

function JobRow({ j }: { j: ScrapeJob }) {
  const qc = useQueryClient();
  const thumb = j.image ?? (j.photo ? imageUrl(j.photo) : null);
  const remove = async () => {
    const ok = await confirmDialog(
      j.state === "run"
        ? { title: "Auslesen abbrechen?", message: `${jobTitle(j)} wird nicht weiter ausgelesen.`, confirmLabel: "Abbrechen", danger: true }
        : j.state === "done"
          ? { title: "Ergebnis verwerfen?", message: `${jobTitle(j)} wurde noch nicht gesichert.`, confirmLabel: "Verwerfen", danger: true }
          : { title: "Hinweis entfernen?", message: "Das fehlgeschlagene Auslesen verschwindet aus der Liste.", confirmLabel: "Entfernen" },
    );
    if (!ok) return;
    await api.removeScrapeJob(j.id).catch(() => {});
    qc.setQueryData<ScrapeJob[]>(JOBS_KEY, (l) => l?.filter((x) => x.id !== j.id));
  };
  return (
    <li className="anim-sheet flex items-center gap-1 rounded-[16px] bg-card shadow-pop">
      <button
        type="button"
        onClick={() => navigate(jobPath(j.id))}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-l-[16px] py-2.5 pr-1 pl-2.5 text-left hover:bg-hover"
      >
        <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-accent-soft text-accent">
          {thumb ? (
            <img src={thumb} alt="" className="size-full object-contain" />
          ) : j.state === "error" ? (
            <CircleAlert size={18} className="text-bad" />
          ) : (
            <Sparkles size={18} className={j.state === "run" ? "animate-pulse" : undefined} />
          )}
          {j.state === "run" && <span className="anim-ring absolute inset-0 rounded-[10px] border-2 border-accent" aria-hidden="true" />}
          {j.state === "done" && (
            <span className="anim-pop absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent">
              <Check size={10} strokeWidth={3.5} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] leading-tight font-bold">{j.state === "run" && !j.name ? `Lese ${j.what} aus` : jobTitle(j)}</span>
          <span className={cx("truncate text-[12.5px]", j.state === "error" ? "text-bad" : j.state === "done" ? "font-semibold text-accent" : "text-ink2")}>
            {j.state === "run" ? (
              <>
                {j.activity ?? "Denkt nach"} · <Elapsed since={j.started} />
              </>
            ) : j.state === "done" ? (
              "Fertig · prüfen und sichern"
            ) : (
              (j.error ?? "Fehlgeschlagen")
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={j.state === "run" ? "Auslesen abbrechen" : "Verwerfen"}
        onClick={() => void remove()}
        className="mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-ink3 hover:bg-hover hover:text-ink"
      >
        <X size={16} />
      </button>
    </li>
  );
}

/**
 * Auslesungen im Hintergrund unten rechts (auf dem Handy unten über die ganze Breite), auf jeder Seite außer der, die den
 * Auftrag gerade zeigt. Meldet sich, wenn einer fertig wird. Schiebt die Toasts per `--dock-h` darüber.
 */
export function ScrapeJobsDock() {
  const route = useRoute();
  const { data } = useScrapeJobs();
  const viewing = route.name === "new" ? route.job : null;
  useFinishNotice(data, viewing);
  const list = (data ?? []).filter((j) => j.id !== viewing);
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 3);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--dock-h");
      return;
    }
    const measure = () => root.style.setProperty("--dock-h", `${el.offsetHeight + 8}px`);
    measure(); // sofort, ResizeObserver meldet sich erst mit dem nächsten Frame (im Hintergrund-Tab gar nicht)
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--dock-h");
    };
  }, [shown.length > 0]);
  useEffect(() => {
    if (list.length <= 3) setAll(false);
  }, [list.length]);

  if (!shown.length) return null;
  return (
    <div
      ref={ref}
      aria-label="Auslesen im Hintergrund"
      className="pointer-events-none fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-[80] flex justify-center px-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:px-0"
    >
      <ul className="pointer-events-auto m-0 flex w-full max-w-[420px] list-none flex-col gap-2 p-0 sm:w-[360px]">
        {shown.map((j) => (
          <JobRow key={j.id} j={j} />
        ))}
        {list.length > shown.length && (
          <li className="self-end">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="rounded-full bg-card px-3 py-1 text-[12px] font-semibold text-ink2 shadow-card hover:text-ink"
            >
              +{list.length - shown.length} weitere
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
