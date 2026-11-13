import { Camera, Check, FileText, Filter, Globe, PenLine, Search, Sparkles, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { countryFlag, ROAST_FOR, ROAST_LEVELS, type ScrapePartial, type ScrapeStep } from "../../../shared/types.ts";
import { fmtCupScore, fmtEuro, hostOf } from "../lib/format.ts";
import { ArtImg, BagSvg, bagColors, tileStyle } from "./Artwork.tsx";
import { Button, cx } from "./controls.tsx";
import { NoteChip } from "./NoteChip.tsx";

const KIND_ICON: Record<ScrapeStep["kind"], LucideIcon> = {
  page: FileText,
  photo: Camera,
  search: Search,
  fetch: Globe,
  filter: Filter,
  write: PenLine,
};

/** Felder der Vorschau in der Reihenfolge, in der save_coffee sie schreibt */
const ROWS: { k: keyof ScrapePartial; label: string; show: (f: ScrapePartial) => ReactNode }[] = [
  { k: "country", label: "Land", show: (f) => f.country && `${countryFlag(f.country)} ${f.country}`.trim() },
  { k: "region", label: "Region", show: (f) => f.region },
  { k: "farm", label: "Farm / Station", show: (f) => f.farm },
  { k: "producer", label: "Produzent", show: (f) => f.producer },
  { k: "varieties", label: "Varietäten", show: (f) => f.varieties?.join(", ") },
  { k: "process", label: "Aufbereitung", show: (f) => f.process },
  { k: "process_detail", label: "Zusatz", show: (f) => f.process_detail },
  { k: "altitude", label: "Höhe", show: (f) => f.altitude },
  { k: "harvest", label: "Ernte", show: (f) => f.harvest },
  { k: "roast_level", label: "Röstgrad", show: (f) => ROAST_LEVELS.find((r) => r.id === f.roast_level)?.label },
  { k: "roast_for", label: "Geröstet für", show: (f) => ROAST_FOR.find((r) => r.id === f.roast_for)?.label },
  { k: "cup_score", label: "Cup Score", show: (f) => (f.cup_score != null ? fmtCupScore(f.cup_score) : null) },
  { k: "roaster_recipes", label: "Rezepte vom Röster", show: (f) => f.roaster_recipes?.map((r) => r.title || r.method).join(", ") },
  { k: "weight_g", label: "Packung", show: (f) => (f.weight_g ? `${f.weight_g} g` : null) },
  { k: "price_eur", label: "Preis", show: (f) => (f.price_eur != null ? fmtEuro(f.price_eur) : null) },
];
const TRACKED: (keyof ScrapePartial)[] = ["name", "roaster", ...ROWS.map((r) => r.k), "roaster_notes", "description"];

function filled(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tnum">{Math.max(0, Math.round((now - since) / 1000))} s</span>;
}

function Skel({ className }: { className?: string }) {
  return <span className={cx("skeleton block rounded-[6px]", className)} aria-hidden="true" />;
}

// ---------- Schritte ----------

function StepIcon({ st }: { st: ScrapeStep }) {
  const Icon = KIND_ICON[st.kind];
  return (
    <span
      className={cx(
        "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full",
        st.state === "fail" ? "bg-fill text-ink3" : "bg-accent-soft text-accent",
      )}
    >
      <Icon size={15} strokeWidth={2.3} />
      {st.state === "run" && (
        <span className="absolute -inset-[3px] animate-spin rounded-full border-2 border-accent border-t-transparent border-l-transparent" />
      )}
      {st.state === "ok" && (
        <span className="anim-pop absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_0_0_2px_var(--c-card)]">
          <Check size={10} strokeWidth={3.5} />
        </span>
      )}
      {st.state === "fail" && (
        <span className="anim-pop absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-ink3 text-card shadow-[0_0_0_2px_var(--c-card)]">
          <X size={10} strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}

/** Mehrere Auswertungen der Suchtreffer direkt hintereinander als eine Zeile */
function collapse(steps: ScrapeStep[]): ScrapeStep[] {
  const rows: (ScrapeStep & { n: number })[] = [];
  for (const st of steps) {
    const prev = rows.at(-1);
    if (st.kind === "filter" && prev?.kind === "filter") {
      const n = prev.n + 1;
      const state = st.state === "run" || prev.state === "run" ? "run" : st.state === "ok" || prev.state === "ok" ? "ok" : "fail";
      rows[rows.length - 1] = { ...prev, state, n, detail: `${n}× ausgewertet` };
    } else rows.push({ ...st, n: 1 });
  }
  return rows;
}

function Timeline({ steps: raw, thinking, className }: { steps: ScrapeStep[]; thinking: boolean; className?: string }) {
  const steps = collapse(raw);
  return (
    <ol className={cx("m-0 flex list-none flex-col p-5", className)} aria-live="polite">
      {steps.map((st, i) => {
        const hosts = [...new Set((st.hits ?? []).map((h) => hostOf(h.url)))].slice(0, 5);
        const last = i === steps.length - 1 && !thinking;
        return (
          <li key={st.id} className="anim-rise relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className="absolute top-9 bottom-1 left-[15.5px] w-px bg-sep" aria-hidden="true" />}
            <StepIcon st={st} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-[5px]">
              <span className={cx("text-[14px] leading-tight font-bold", st.state === "fail" && "text-ink2")}>{st.label}</span>
              {st.detail && <span className="line-clamp-2 text-[13px] leading-snug break-words text-ink2">{st.detail}</span>}
              {hosts.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {hosts.map((h, j) => (
                    <span
                      key={h}
                      className="anim-pop rounded-full bg-fill px-2 py-[3px] text-[11px] font-semibold text-ink2"
                      style={{ animationDelay: `${j * 70}ms` }}
                    >
                      {h}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </li>
        );
      })}
      {thinking && (
        <li className="anim-rise flex items-center gap-3">
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Sparkles size={15} strokeWidth={2.3} className="animate-pulse" />
          </span>
          <span className="flex items-center gap-1 text-[14px] font-bold text-ink2">
            Denkt nach
            <span className="flex gap-[3px] pt-1" aria-hidden="true">
              {[0, 1, 2].map((d) => (
                <span key={d} className="size-[4px] animate-bounce rounded-full bg-ink3" style={{ animationDelay: `${d * 150}ms` }} />
              ))}
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}

// ---------- Vorschau ----------

function Tile({ src, roast }: { src: string | null; roast: ScrapePartial["roast_level"] }) {
  const [broken, setBroken] = useState<string | null>(null);
  const { bag, label } = bagColors(null, roast ?? null);
  const ok = src && broken !== src;
  return (
    <div className="relative flex size-[92px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] @lg:size-[112px]" style={tileStyle(bag)}>
      {ok ? (
        <ArtImg key={src} src={src} alt="" onError={() => setBroken(src)} className="anim-fade h-full w-full object-contain p-[5%]" />
      ) : (
        <BagSvg bag={bag} label={label} className="w-[46%] opacity-80" />
      )}
    </div>
  );
}

function Preview({ fields, image, writing, className }: { fields: ScrapePartial; image: string | null; writing: boolean; className?: string }) {
  // Das zuletzt geschriebene Feld bekommt den Cursor, solange save_coffee läuft
  const keys = Object.keys(fields) as (keyof ScrapePartial)[];
  const active = writing ? keys.filter((k) => k !== "image_urls" && filled(fields[k])).at(-1) : undefined;
  const caret = (k: keyof ScrapePartial) => (active === k ? "caret" : undefined);
  const count = TRACKED.filter((k) => filled(fields[k])).length;
  const origin = [fields.country, fields.region, fields.process].filter(Boolean).join(" · ");

  return (
    <div className={cx("@container flex min-w-0 flex-col gap-4 p-5", className)}>
      <div className="flex items-start gap-4">
        <Tile src={image} roast={fields.roast_level} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
          {fields.roaster ? (
            <span key="r" className={cx("anim-fade truncate text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase", caret("roaster"))}>
              {fields.roaster}
            </span>
          ) : (
            <Skel className="h-3 w-24" />
          )}
          {fields.name ? (
            <span key="n" className={cx("anim-fade text-[21px] leading-tight font-extrabold tracking-[-0.02em] break-words @lg:text-[24px]", caret("name"))}>
              {fields.name}
            </span>
          ) : (
            <Skel className="h-6 w-44 max-w-full" />
          )}
          {origin ? <span className="truncate text-[13px] text-ink2">{origin}</span> : <Skel className="mt-0.5 h-3 w-32" />}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${(count / TRACKED.length) * 100}%` }}
          />
        </span>
        <span className="tnum shrink-0 text-[12px] font-semibold text-ink2">
          {count} von {TRACKED.length} Feldern
        </span>
      </div>

      <dl className="m-0 grid grid-cols-1 overflow-hidden rounded-[14px] bg-sep shadow-card [gap:1px] @lg:grid-cols-2">
        {ROWS.map((r) => {
          const v = r.show(fields);
          const on = filled(fields[r.k]) && v != null && v !== "";
          return (
            <div key={on ? `${r.k}-on` : r.k} className={cx("flex min-w-0 items-baseline justify-between gap-3 bg-card px-3.5 py-2.5", on && "anim-flash")}>
              <dt className="shrink-0 text-[12px] font-bold tracking-[0.04em] text-ink3 uppercase">{r.label}</dt>
              <dd className={cx("m-0 min-w-0 truncate text-right text-[14px] font-semibold", caret(r.k))}>
                {on ? v : <Skel className="ml-auto inline-block h-3 w-14 align-middle" />}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="flex min-h-[30px] flex-wrap gap-1.5">
        {fields.roaster_notes?.length ? (
          fields.roaster_notes.map((n, i) => (
            <NoteChip key={i} note={n} className={cx("anim-pop", active === "roaster_notes" && i === fields.roaster_notes!.length - 1 && "caret")} />
          ))
        ) : (
          <>
            <Skel className="h-[28px] w-20 rounded-full" />
            <Skel className="h-[28px] w-24 rounded-full" />
            <Skel className="h-[28px] w-16 rounded-full" />
          </>
        )}
      </div>

      {fields.description ? (
        <p className={cx("anim-fade m-0 line-clamp-4 text-[14px] leading-relaxed text-ink2", caret("description"))}>{fields.description}</p>
      ) : (
        <div className="flex flex-col gap-1.5" aria-hidden="true">
          <Skel className="h-3 w-full" />
          <Skel className="h-3 w-[85%]" />
        </div>
      )}
    </div>
  );
}

// ---------- Ganze Karte ----------

export function ScrapeLive({
  what,
  started,
  steps,
  fields,
  images,
  photo,
  finished,
  onCancel,
}: {
  what: string;
  started: number;
  steps: ScrapeStep[];
  fields: ScrapePartial;
  images: string[];
  photo: string | null;
  finished: boolean;
  onCancel: () => void;
}) {
  const running = steps.filter((s) => s.state === "run").at(-1);
  const writing = steps.some((s) => s.id === "write" && s.state === "run");
  const thinking = !finished && !running;
  const activity = finished
    ? "Alles da, gleich geht es weiter"
    : running
      ? [running.label, running.detail].filter(Boolean).join(" · ")
      : steps.length
        ? "Denkt nach"
        : "Startet";
  const image = fields.image_urls?.find((u) => /^https?:\/\//.test(u)) ?? photo ?? images[0] ?? null;

  return (
    <section className="@container max-w-[1080px] overflow-hidden rounded-[22px] bg-card shadow-card">
      <header className="flex items-center gap-3.5 border-b border-sep px-5 py-4">
        <span className="relative flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-accent-soft text-accent">
          {!finished && <span className="anim-ring absolute inset-0 rounded-[14px] border-2 border-accent" aria-hidden="true" />}
          {finished ? <Check key="ok" size={22} strokeWidth={2.6} className="anim-pop" /> : <Sparkles size={22} className="animate-pulse" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[16px] leading-tight font-extrabold break-words">{finished ? "Fertig ausgelesen" : `Lese ${what} aus`}</span>
          <span key={activity} className="anim-rise truncate text-[13px] text-ink2">
            {activity} · <Elapsed since={started} />
          </span>
        </div>
        {!finished && (
          <Button size="sm" onClick={onCancel}>
            Abbrechen
          </Button>
        )}
      </header>
      <div className="grid @2xl:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]">
        <Timeline steps={steps} thinking={thinking} className="order-2 border-t border-sep @2xl:order-1 @2xl:border-t-0 @2xl:border-r" />
        <Preview fields={fields} image={image} writing={writing} className="order-1 @2xl:order-2" />
      </div>
    </section>
  );
}
