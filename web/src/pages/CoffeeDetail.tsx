import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDrinkWindows } from "../ui/ConfigForm.tsx";
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  ChevronRight,
  Coffee as CoffeeIcon,
  Ellipsis,
  ExternalLink,
  Flame,
  MapPin,
  Mountain,
  Pencil,
  Plus,
  ShoppingBag,
  Sprout,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_ID, FLAVOR_BY_ID } from "../../../shared/flavors.ts";
import { byUrgency, freshness, freshnessLabel } from "../../../shared/freshness.ts";
import { CUP_KEYS, formatScore, QUALITY_KEYS, SCORE_LABELS, scoreGrade } from "../../../shared/sca.ts";
import { countryFlag, daysBetween, isSca, pricePerKg, ROAST_FOR, ROAST_LEVELS, TASTE_LABEL, TASTE_TAGS, type Batch, type Brew, type Coffee, type ScaBrew, type TasteTag } from "../../../shared/types.ts";
import { api } from "../api.ts";
import {
  averageScores,
  averageTotal,
  brewParamsLine,
  groupByRecipe,
  groupParams,
  topFlavors,
  X_AXES,
  xValue,
  type XAxis,
} from "../lib/analysis.ts";
import { fmtCupScore, fmtDate, fmtDateShort, fmtDateTime, fmtEuro, fmtGrams, fmtNum, hostOf, plural, todayIso } from "../lib/format.ts";
import { lastOrigin, navigate } from "../lib/router.ts";
import { pushRecent } from "../lib/store.ts";
import { NoteChip } from "../ui/NoteChip.tsx";
import { RoasterRecipesButton, RoasterRecipesSheet } from "../ui/RoasterRecipes.tsx";
import { Artwork, RoastDot } from "../ui/Artwork.tsx";
import { Radar, ScoreChart, type ScorePoint } from "../ui/charts.tsx";
import { Banner, Button, Card, cx, EmptyState, IconButton, Menu, SectionTitle, Segmented, Spinner } from "../ui/controls.tsx";
import { confirmDialog, toast } from "../ui/overlay.tsx";
import { BackLink, Page, Toolbar } from "../ui/Shell.tsx";
import { WikiTerm } from "./Wiki.tsx";
import { DecentProfileCard } from "../ui/DecentProfile.tsx";
import { DialInCard } from "../ui/DialIn.tsx";
import { isGoodBrew } from "../../../shared/grind.ts";
import { fmtStars, StarsValue } from "../ui/Stars.tsx";
import { BatchSheet } from "./BatchSheet.tsx";
import { BrewSheet, gradeClass } from "./BrewSheet.tsx";

const CUP_COLOR = "light-dark(#5B7FA6, #8FB2D6)";

function batchLabel(b: Batch): string {
  const base = b.roast_date ? `Röstung ${fmtDateShort(b.roast_date)}` : b.status === "leer" ? "Ohne Röstdatum" : `Charge vom ${fmtDateShort(b.created_at)}`;
  if (b.status === "leer") return `${base} · ${b.backfilled ? "nachgetragen" : "aufgebraucht"}`;
  if (b.status === "ungeoeffnet") return `${base} · ungeöffnet`;
  const day = daysBetween(b.roast_date, todayIso());
  return day != null ? `${base} · Tag ${day}` : base;
}

/** Preis, mit €/kg, wenn das Gewicht bekannt ist */
function priceLine(price: number, weight: number | null): string {
  const kg = pricePerKg(price, weight);
  return kg != null ? `${fmtEuro(price)} (${fmtEuro(kg)}/kg)` : fmtEuro(price);
}

const avgStars = (list: Brew[]) => {
  const r = list.flatMap((b) => (b.rating != null ? [b.rating] : []));
  return r.length ? r.reduce((a, x) => a + x, 0) / r.length : null;
};

/** Farbe als leichter Hintergrund, hell und dunkel passend */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

type DetailGroup = { key: string; label: string; icon: LucideIcon; tone: string; lead?: React.ReactNode; rows: { k: string; v: React.ReactNode }[] };

/** Farbe je Kurzurteil, gleiche Reihenfolge wie TASTE_TAGS */
const TASTE_TONE: Record<TasteTag, string> = {
  ausgewogen: "var(--c-green)",
  sauer: "var(--c-star)",
  bitter: "var(--c-orange)",
  duenn: CUP_COLOR,
  kraeftig: "var(--c-red)",
};

/**
 * Geschmack ohne SCA-Bogen: was die Schnellbewertungen sagen (Kurzurteile als Leiste, Sterne, Aromen, letzte Notiz).
 * Radar und Rezeptvergleich bleiben dem SCA-Bogen vorbehalten.
 */
function QuickTaste({ brews, recipeName, className }: { brews: Brew[]; recipeName: (id: number | null) => string; className?: string }) {
  const counts = TASTE_TAGS.map((t) => ({ ...t, n: brews.filter((b) => b.taste.includes(t.id)).length })).filter((t) => t.n > 0);
  const none = brews.filter((b) => !b.taste.length).length;
  const total = counts.reduce((a, t) => a + t.n, 0) + none;
  const rated = brews.filter((b) => b.rating != null);
  const stars = avgStars(brews);
  const good = brews.filter(isGoodBrew).length;
  const flavors = topFlavors(brews, 8);
  const noted = [...brews].sort((a, b) => b.brewed_at.localeCompare(a.brewed_at)).find((b) => b.comment.trim());
  const tile = "flex min-w-0 flex-col gap-0.5 rounded-[14px] px-3.5 py-3";
  return (
    <Card className={cx("flex flex-col gap-5", className)}>
      <SectionTitle sub={`Aus ${plural(brews.length, "Schnellbewertung", "Schnellbewertungen")}. Radar und Rezeptvergleich kommen mit dem ersten SCA-Bogen.`}>
        Geschmack
      </SectionTitle>

      <div className="grid grid-cols-2 gap-2.5">
        <div className={tile} style={{ background: tint("var(--c-star)", 12) }}>
          <span className="text-[11.5px] font-bold tracking-[0.06em] text-ink2 uppercase">Ø Sterne</span>
          <span className="flex items-center gap-1.5">
            <Star size={22} strokeWidth={0} className="fill-[var(--c-star)]" aria-hidden="true" />
            <span className="tnum font-display text-[30px] leading-none font-extrabold tracking-[-0.02em]">{stars != null ? fmtStars(stars) : "–"}</span>
          </span>
          <span className="text-[12px] text-ink2">{rated.length ? `aus ${plural(rated.length, "Bewertung", "Bewertungen")} mit Sternen` : "noch ohne Sterne"}</span>
        </div>
        <div className={tile} style={{ background: tint("var(--c-green)", 12) }}>
          <span className="text-[11.5px] font-bold tracking-[0.06em] text-ink2 uppercase">Gelungen</span>
          <span className="tnum font-display text-[30px] leading-none font-extrabold tracking-[-0.02em]">
            {good}
            <span className="text-[18px] font-bold text-ink2"> von {brews.length}</span>
          </span>
          <span className="text-[12px] text-ink2">ausgewogen, ab 4 Sternen</span>
        </div>
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[11.5px] font-bold tracking-[0.06em] text-ink3 uppercase">Kurzurteil</span>
          <div className="flex h-3 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
            {counts.map((t) => (
              <span key={t.id} className="h-full" style={{ flex: t.n, background: TASTE_TONE[t.id] }} />
            ))}
            {none > 0 && <span className="h-full bg-fill2" style={{ flex: none }} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {counts.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 text-[13px]">
                <span className="size-2.5 rounded-full" style={{ background: TASTE_TONE[t.id] }} />
                {t.label}
                <span className="tnum font-bold">{t.n}</span>
              </span>
            ))}
            {none > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-ink2">
                <span className="size-2.5 rounded-full bg-fill2" />
                Ohne Urteil
                <span className="tnum font-bold">{none}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {flavors.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-bold tracking-[0.06em] text-ink3 uppercase">Aromen</span>
          <div className="flex flex-wrap gap-1.5">
            {flavors.map((f) => {
              const cat = CATEGORY_BY_ID.get(f.category);
              return (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-ink"
                  style={{ background: cat ? tint(cat.color, 13) : "var(--c-fill)" }}
                >
                  <span className="size-[7px] rounded-full" style={{ background: cat?.color }} />
                  {f.label}
                  {f.count > 1 && <span className="tnum text-ink3">{f.count}×</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {noted && (
        <figure className="m-0 flex flex-col gap-1 border-l-[3px] border-accent/50 pl-3.5">
          <blockquote className="m-0 line-clamp-3 text-[14px] leading-snug text-ink">{noted.comment}</blockquote>
          <figcaption className="text-[12px] text-ink3">
            {fmtDateShort(noted.brewed_at)} · {recipeName(noted.recipe_id)}
          </figcaption>
        </figure>
      )}
    </Card>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-fill px-[11px] py-[5px] text-[13px]">{children}</span>;
}

const STATUS_DOT: Record<Batch["status"], string> = {
  offen: "bg-accent",
  ungeoeffnet: "bg-card shadow-[inset_0_0_0_1.5px_var(--c-ink3)]",
  leer: "bg-ink4",
};

/** Zeile der Chargen-Liste in der rechten Spalte; ohne batch die Zeile „Alle Chargen“ */
function BatchRow({
  batch: b,
  title,
  sub,
  on,
  onPick,
  onEdit,
}: {
  batch?: Batch;
  title?: string;
  sub?: string;
  on: boolean;
  onPick: () => void;
  onEdit?: () => void;
}) {
  const day = b?.status === "offen" ? daysBetween(b.roast_date, todayIso()) : null;
  const badge = !b ? null : b.status === "leer" ? (b.backfilled ? "Nachgetragen" : "Aufgebraucht") : b.status === "ungeoeffnet" ? "Ungeöffnet" : day != null ? `Tag ${day}` : "Offen";
  // Aufgebrauchte ohne Röstdatum sind nachgetragen: Anlegedatum wäre irreführend, fehlendes Datum kein Mangel
  const head =
    title ??
    (b?.roast_date ? `Röstung ${fmtDate(b.roast_date)}` : b?.status === "leer" ? "Ohne Röstdatum" : `Charge vom ${fmtDateShort(b?.created_at ?? "")}`);
  const info =
    sub ??
    [
      b?.opened_at ? `geöffnet ${fmtDateShort(b.opened_at)}` : b?.roast_date || b?.status === "leer" ? null : "Röstdatum fehlt",
      b?.weight_g != null ? fmtGrams(b.weight_g) : null,
      b?.price_eur != null ? priceLine(b.price_eur, b.weight_g) : null,
      b ? plural(b.brew_count, "Bezug", "Bezüge") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <div className={cx("flex items-center rounded-[14px]", on ? "bg-accent-soft shadow-[inset_0_0_0_1px_var(--c-accent)]" : "hover:bg-hover")}>
      <button type="button" aria-pressed={on} onClick={onPick} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3 text-left">
        <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-full", b && STATUS_DOT[b.status])} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx("truncate text-[14px]", on ? "font-bold" : "font-semibold")}>{head}</span>
          <span className="line-clamp-2 text-[12px] text-ink2">{info}</span>
          {b?.note && <span className="truncate text-[12px] text-ink3">{b.note}</span>}
        </span>
        {badge && <span className="tnum shrink-0 rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold text-ink2">{badge}</span>}
      </button>
      {onEdit && (
        <button
          type="button"
          aria-label="Charge bearbeiten"
          title="Charge bearbeiten"
          onClick={onEdit}
          className="mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] text-ink2 hover:bg-fill hover:text-ink"
        >
          <Pencil size={14} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

function sourceLine(c: Coffee): string | null {
  const s = c.source;
  if (!s) return null;
  const d = fmtDate(s.at);
  switch (s.kind) {
    case "url":
      return `Per Anthropic-API aus dem Shop-Link übernommen am ${d} (${hostOf(s.input)})`;
    case "name":
      return `Per Anthropic-API anhand des Namens recherchiert am ${d}`;
    case "photo":
      return `Per Anthropic-API aus dem Packungsfoto gelesen am ${d}`;
    default:
      return `Manuell erfasst am ${d}`;
  }
}

// ---------- Seite ----------

export function CoffeeDetail({ id, brewOpen }: { id: number; brewOpen: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["coffee", id], queryFn: () => api.coffee(id) });
  const windows = useDrinkWindows();

  const [batchFilter, setBatchFilter] = useState<number | "all">("all");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [axis, setAxis] = useState<XAxis>("days");
  const [onlyGroup, setOnlyGroup] = useState(true);
  const [editBrew, setEditBrew] = useState<Brew | null>(null);
  const [roasterOpen, setRoasterOpen] = useState(false);
  const [brewPreset, setBrewPreset] = useState<number | null>(null);
  const [batchSheet, setBatchSheet] = useState<{ batch: Batch | null } | null>(null);

  // Geschmack (links) und Einstellen (rechts) stehen breit nebeneinander; das Decent-Profil kommt unter die kürzere Spalte
  const leftCol = useRef<HTMLDivElement>(null);
  const rightCol = useRef<HTMLDivElement>(null);
  const [decentLeft, setDecentLeft] = useState(true);
  useEffect(() => {
    const l = leftCol.current;
    const r = rightCol.current;
    if (!l || !r) return;
    const own = (col: HTMLElement) => [...col.children].filter((e) => !e.hasAttribute("data-decent")) as HTMLElement[];
    const height = (col: HTMLElement) => own(col).reduce((a, e) => a + e.offsetHeight, 0);
    const ro = new ResizeObserver(() => setDecentLeft(height(l) <= height(r)));
    for (const e of [...own(l), ...own(r)]) ro.observe(e);
    return () => ro.disconnect();
  });

  useEffect(() => {
    if (data) pushRecent(id);
  }, [data, id]);

  const brews = useMemo(() => {
    const list = data?.brews ?? [];
    return batchFilter === "all" ? list : list.filter((b) => b.batch_id === batchFilter);
  }, [data, batchFilter]);
  // Rezeptvergleich, Radar und Score-Verlauf nur aus SCA-Bögen; schnelle Bewertungen zählen getrennt (Sterne)
  const scaBrews = useMemo(() => brews.filter(isSca), [brews]);
  const groups = useMemo(() => groupByRecipe(scaBrews, data?.recipes ?? []), [scaBrews, data]);
  const group = groups.find((g) => g.key === groupKey) ?? groups[0] ?? null;
  const batchMap = useMemo(() => new Map((data?.batches ?? []).map((b) => [b.id, b])), [data]);

  if (error)
    return (
      <>
        <Toolbar>
          <BackLink to={lastOrigin().path}>{lastOrigin().label}</BackLink>
        </Toolbar>
        <Page>
          <EmptyState icon={CoffeeIcon} title="Kaffee nicht gefunden" text={error.message} />
        </Page>
      </>
    );
  if (isLoading || !data)
    return (
      <>
        <Toolbar>
          <BackLink to={lastOrigin().path}>{lastOrigin().label}</BackLink>
        </Toolbar>
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      </>
    );

  const c = data.coffee;
  const refresh = () => Promise.all([["coffee", id], ["coffees"], ["stats"]].map((k) => qc.invalidateQueries({ queryKey: k })));

  const patch = async (p: { wishlist?: boolean; archived?: boolean }, msg: string) => {
    try {
      await api.patchCoffee(id, p);
      await refresh();
      toast(msg);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Fehler", "error");
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${c.name}“ löschen?`,
      message: `Mit ${plural(data.batches.length, "Charge", "Chargen")} und ${plural(data.brews.length, "Bezug", "Bezügen")}. Das lässt sich nicht rückgängig machen. Archivieren behält alles.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCoffee(id);
      await Promise.all([qc.invalidateQueries({ queryKey: ["coffees"] }), qc.invalidateQueries({ queryKey: ["stats"] })]);
      qc.removeQueries({ queryKey: ["coffee", id] });
      toast("Kaffee gelöscht");
      navigate(lastOrigin().path, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Löschen fehlgeschlagen", "error");
    }
  };

  // ---------- Kennzahlen ----------
  const sortedBatches = [...data.batches].sort((a, b) => (b.roast_date ?? b.created_at).localeCompare(a.roast_date ?? a.created_at));
  const openBatch = data.batches.find((b) => b.status === "offen") ?? null;
  const scaAll = data.brews.filter(isSca);
  const quickAll = data.brews.filter((b) => !isSca(b));
  const starsAll = avgStars(quickAll);
  const best = scaAll.reduce<ScaBrew | null>((m, b) => (!m || b.total > m.total ? b : m), null);
  const recipeName = (rid: number | null) => data.recipes.find((r) => r.id === rid)?.name ?? "Ohne Rezept";
  const bestDay = best?.batch_id ? daysBetween(batchMap.get(best.batch_id)?.roast_date ?? null, best.brewed_at) : null;
  const usedRecipes = new Set(data.brews.map((b) => b.recipe_id ?? 0)).size;

  // Höhepunkt: Tag mit dem besten Schnitt über alle Bezüge mit Röstdatum
  const byDay = new Map<number, number[]>();
  for (const b of scaAll) {
    const d = xValue(b, "days", batchMap);
    if (d != null) byDay.set(d, [...(byDay.get(d) ?? []), b.total]);
  }
  const peak = [...byDay.entries()]
    .map(([d, v]) => ({ d, avg: v.reduce((a, x) => a + x, 0) / v.length }))
    .sort((a, b) => b.avg - a.avg)[0];
  // „Seit Röstung“ gilt der offenen Packung, sonst der ungeöffneten, die als Erste dran ist
  const today = todayIso();
  const nextSealed =
    data.batches
      .filter((b) => b.status === "ungeoeffnet")
      .map((b) => ({ b, f: freshness(b, c, today, windows) }))
      .sort((x, y) => byUrgency(x.f, y.f))[0]?.b ?? null;
  const refBatch = openBatch ?? nextSealed;
  const refDay = refBatch ? daysBetween(refBatch.roast_date, today) : null;
  const refFresh = refBatch ? freshness(refBatch, c, today, windows) : null;
  const refSub = !refBatch
    ? "keine offene Charge"
    : refDay == null
      ? "Röstdatum fehlt"
      : [refBatch === openBatch ? null : "ungeöffnet", refFresh && refFresh.state !== "unbekannt" ? freshnessLabel(refFresh) : refBatch === openBatch ? "offene Charge" : null]
          .filter(Boolean)
          .join(" · ");
  const lastBrew = data.brews.length ? data.brews.reduce((a, b) => (b.brewed_at > a.brewed_at ? b : a)) : null;

  const stats = [
    {
      k: "Bester Score",
      v: formatScore(best?.total),
      accent: true,
      sub: best
        ? [recipeName(best.recipe_id), bestDay != null ? `Tag ${bestDay}` : null].filter(Boolean).join(" · ")
        : quickAll.length
          ? "noch kein SCA-Bogen"
          : "noch kein Bezug",
    },
    { k: "Bezüge", v: String(data.brews.length), sub: data.brews.length ? plural(usedRecipes, "Rezept", "Rezepte") : "–" },
    {
      k: "Seit Röstung",
      v: refDay != null ? `Tag ${refDay}` : "–",
      sub: peak && byDay.size > 1 ? `Höhepunkt um Tag ${peak.d}` : refSub,
    },
    scaAll.length || !quickAll.length
      ? {
          k: "Ø Score",
          v: scaAll.length ? formatScore(averageTotal(scaAll)) : "–",
          sub:
            starsAll != null
              ? `★ ${fmtStars(starsAll)} aus ${quickAll.filter((b) => b.rating != null).length} schnellen`
              : lastBrew
                ? `zuletzt ${fmtDateShort(lastBrew.brewed_at)}`
                : "–",
        }
      : starsAll != null
        ? { k: "Ø Sterne", v: `★ ${fmtStars(starsAll)}`, sub: lastBrew ? `zuletzt ${fmtDateShort(lastBrew.brewed_at)}` : "–" }
        : // Nur Kurzurteile ohne Sterne: wie oft es gepasst hat
          {
            k: "Gelungen",
            v: `${quickAll.filter(isGoodBrew).length} von ${quickAll.length}`,
            sub: lastBrew ? `zuletzt ${fmtDateShort(lastBrew.brewed_at)}` : "–",
          },
  ];

  // Kosten pro Tasse: Dosis je Bezug mal €/kg seiner Charge (sonst des Kaffees)
  const perKg = pricePerKg(c.price_eur, c.weight_g);
  const cupCosts = data.brews.flatMap((b) => {
    const batch = b.batch_id != null ? batchMap.get(b.batch_id) : undefined;
    const kg = (batch && pricePerKg(batch.price_eur, batch.weight_g ?? c.weight_g)) ?? perKg;
    return b.dose_g && kg != null ? [{ eur: (b.dose_g / 1000) * kg, dose: b.dose_g }] : [];
  });
  const perCup = cupCosts.length
    ? { eur: cupCosts.reduce((a, x) => a + x.eur, 0) / cupCosts.length, dose: cupCosts.reduce((a, x) => a + x.dose, 0) / cupCosts.length }
    : null;

  const roast = ROAST_LEVELS.find((r) => r.id === c.roast_level);
  const roastFor = ROAST_FOR.find((r) => r.id === c.roast_for);
  const originParts = [c.country.trim(), c.region.trim(), c.process.trim(), c.varieties.join(", ")].filter(Boolean);

  // Details in Gruppen; Land und Region stehen groß im Kopf der Herkunft, ohne Land rutscht die Region in die Zeilen
  const country = c.country.trim();
  const detailGroups: DetailGroup[] = [
    {
      key: "origin",
      label: "Herkunft",
      icon: MapPin,
      tone: "var(--c-accent)",
      lead: country ? (
        <div className="flex items-center gap-3 rounded-[14px] px-3 py-2.5" style={{ background: tint("var(--c-accent)", 8) }}>
          <span className="text-[30px] leading-none" aria-hidden="true">
            {countryFlag(c.country)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[16px] font-extrabold">
              <WikiTerm field="country" value={c.country} />
            </span>
            {c.region.trim() && <span className="truncate text-[13px] text-ink2">{c.region}</span>}
          </span>
          {c.altitude.trim() && (
            <span className="tnum inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[12.5px] font-semibold shadow-card">
              <Mountain size={13} strokeWidth={2.3} className="text-accent" aria-hidden="true" />
              {c.altitude}
            </span>
          )}
        </div>
      ) : null,
      rows: [
        { k: "Region", v: !country && c.region },
        { k: "Höhe", v: !country && c.altitude },
        { k: "Farm / Station", v: c.farm },
        { k: "Produzent", v: c.producer },
      ],
    },
    {
      key: "bean",
      label: "Bohne",
      icon: Sprout,
      tone: "var(--c-star)",
      rows: [
        {
          k: c.varieties.length > 1 ? "Varietäten" : "Varietät",
          v:
            c.varieties.length > 0 &&
            c.varieties.map((v, i) => (
              <span key={v}>
                {i > 0 && ", "}
                <WikiTerm field="varieties" value={v} />
              </span>
            )),
        },
        { k: "Aufbereitung", v: c.process && <WikiTerm field="process" value={c.process} /> },
        { k: "Im Detail", v: c.process_detail },
        { k: "Ernte", v: c.harvest },
      ],
    },
    {
      key: "roast",
      label: "Röstung",
      icon: Flame,
      tone: "var(--c-orange)",
      rows: [
        {
          k: "Röstgrad",
          v: roast && (
            <span className="inline-flex items-center gap-1.5">
              <RoastDot level={c.roast_level} size={9} />
              <WikiTerm field="roast_level" value={roast.id}>
                {roast.label}
              </WikiTerm>
            </span>
          ),
        },
        { k: "Geröstet für", v: roastFor && <WikiTerm field="roast_for" value={roastFor.id}>{roastFor.label}</WikiTerm> },
        {
          k: "Cup Score",
          v: c.cup_score != null && (
            <span className="tnum rounded-full px-2 py-0.5 text-[12.5px] font-bold" style={{ background: tint("var(--c-orange)", 14), color: "var(--c-orange)" }}>
              {fmtCupScore(c.cup_score)} <span className="font-semibold opacity-75">laut Röster</span>
            </span>
          ),
        },
        { k: "Rezepte vom Röster", v: c.roaster_recipes.length > 0 && <RoasterRecipesButton count={c.roaster_recipes.length} onClick={() => setRoasterOpen(true)} /> },
      ],
    },
    {
      key: "buy",
      label: "Kauf",
      icon: ShoppingBag,
      tone: CUP_COLOR,
      rows: [
        { k: "Packung", v: c.weight_g != null ? fmtGrams(c.weight_g) : "" },
        { k: "Preis", v: c.price_eur != null ? fmtEuro(c.price_eur) + (perKg != null ? ` · ${fmtEuro(perKg)}/kg` : "") : "" },
        {
          k: "Pro Tasse",
          v: perCup && (
            <span>
              <span className="font-bold">≈ {fmtEuro(perCup.eur)}</span>
              <span className="text-ink2"> bei Ø {fmtNum(Math.round(perCup.dose * 10) / 10)} g</span>
            </span>
          ),
        },
        {
          k: "Shop",
          v: c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent no-underline hover:underline">
              {hostOf(c.url)}
              <ExternalLink size={12} strokeWidth={2.3} aria-hidden="true" />
            </a>
          ),
        },
      ],
    },
  ]
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.v) }))
    .filter((g) => g.lead || g.rows.length);

  // ---------- Geschmack nach Rezept ----------
  const overall = scaBrews.length ? averageScores(scaBrews) : null;
  const bestGroupTotal = Math.max(...groups.map((g) => g.total));
  const delta = group ? group.total - bestGroupTotal : 0;
  const flavorsTop = group ? topFlavors(group.brews, 8) : [];

  const points: ScorePoint[] = scaBrews
    .map((b) => {
      const x = xValue(b, axis, batchMap);
      if (x == null) return null;
      const g = groups.find((gr) => gr.brews.includes(b));
      return {
        id: b.id,
        x,
        y: b.total,
        selected: g?.key === group?.key,
        title: fmtDateTime(b.brewed_at),
        sub: [g?.label, brewParamsLine(b)].filter(Boolean).join(" · "),
      };
    })
    .filter((p): p is ScorePoint => p != null);
  const axisDef = X_AXES.find((a) => a.id === axis)!;

  const listBrews = [...(onlyGroup && group && groups.length > 1 ? group.brews : brews)].sort((a, b) => b.brewed_at.localeCompare(a.brewed_at));
  const selBatch = batchFilter === "all" ? null : (batchMap.get(batchFilter) ?? null);

  const closeBrew = () => {
    setEditBrew(null);
    setBrewPreset(null);
    if (brewOpen) navigate(`/kaffee/${id}`, { replace: true });
  };

  const decentCard = data.decent_profile && (
    // Decent-Profil des Kaffees, in der App und am Tablet änderbar
    <div data-decent="" className="order-4 min-w-0">
      <DecentProfileCard coffee={c} profile={data.decent_profile} className="@container" />
    </div>
  );

  const menu = [
    { label: "Bearbeiten", icon: Pencil, onSelect: () => navigate(`/kaffee/${id}/bearbeiten`) },
    {
      label: c.wishlist ? "Von der Merkliste nehmen" : "Auf die Merkliste",
      icon: Bookmark,
      onSelect: () => void patch({ wishlist: !c.wishlist }, c.wishlist ? "Von der Merkliste genommen" : "Auf die Merkliste gesetzt"),
    },
    { label: "Shop öffnen", icon: ExternalLink, disabled: !c.url, onSelect: () => window.open(c.url, "_blank", "noopener") },
    {
      label: c.archived ? "Wiederherstellen" : "Archivieren",
      icon: c.archived ? ArchiveRestore : Archive,
      onSelect: () => void patch({ archived: !c.archived }, c.archived ? "Wiederhergestellt" : "Archiviert"),
    },
    "sep" as const,
    { label: "Löschen …", icon: Trash2, danger: true, onSelect: () => void remove() },
  ];

  return (
    <>
      <Toolbar tab={c.name}>
        <BackLink to={lastOrigin().path}>{lastOrigin().label}</BackLink>
        <div className="flex-1" />
        <IconButton
          label={c.wishlist ? "Von der Merkliste nehmen" : "Auf die Merkliste"}
          icon={Bookmark}
          active={c.wishlist}
          onClick={() => void patch({ wishlist: !c.wishlist }, c.wishlist ? "Von der Merkliste genommen" : "Auf die Merkliste gesetzt")}
        />
        <Button size="sm" className="max-sm:hidden" onClick={() => navigate(`/kaffee/${id}/bearbeiten`)}>
          Bearbeiten
        </Button>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => navigate(`/kaffee/${id}?bezug`)}>
          <span className="sm:hidden">Bewerten</span>
          <span className="hidden sm:inline">Bezug bewerten</span>
        </Button>
        <Menu label="Weitere Aktionen" items={menu} trigger={(p) => <IconButton {...p} label="Weitere Aktionen" icon={Ellipsis} />} />
      </Toolbar>

      <Page wide>
        {c.archived && (
          <Banner tone="info" icon={Archive} action={<Button size="sm" onClick={() => void patch({ archived: false }, "Wiederhergestellt")}>Wiederherstellen</Button>}>
            Archiviert. Taucht nur noch im Archiv auf, alle Daten bleiben erhalten.
          </Banner>
        )}
        {c.wishlist && !c.archived && (
          <Banner tone="info" icon={Bookmark} action={<Button size="sm" onClick={() => setBatchSheet({ batch: null })}>Gekauft</Button>}>
            Auf der Merkliste. Mit der ersten Charge zieht er in die Bibliothek um.
          </Banner>
        )}

        {/*
          Breit (Container ab 72rem): links Kopf, Geschmack, Verlauf, Bezüge; rechts Chargen-Liste und Details.
          Schmal: eine Spalte, beide Spalten-Hüllen sind display:contents und order legt die Reihenfolge fest.
        */}
        <div className="@container/detail">
          <div className="flex flex-col gap-6 @6xl:grid @6xl:grid-cols-[minmax(0,1fr)_320px] @6xl:items-start @6xl:gap-7 @7xl:grid-cols-[minmax(0,1fr)_352px]">
            <div className="contents @6xl:flex @6xl:min-w-0 @6xl:flex-col @6xl:gap-6">
        {/* Hero */}
        <section className="order-1 flex flex-wrap items-end gap-7">
          <Artwork coffee={c} size="lg" rounded={18} className="aspect-square w-[min(216px,100%)] shadow-art" />
          <div className="@container flex min-w-0 flex-[1_1_380px] flex-col gap-2.5">
            {c.roaster && <span className="text-[13px] font-bold tracking-[0.06em] text-ink2 uppercase">{c.roaster}</span>}
            <h1 className="m-0 font-display text-[30px] leading-[1.05] font-extrabold tracking-[-0.025em] break-words sm:text-[40px]">{c.name}</h1>
            {/* Mit rechter Spalte stehen Land, Region und Co. in den Details, hier nur einspaltig */}
            {originParts.length > 0 && (
              <span className="text-[15px] text-ink2 @6xl/detail:hidden">
                {c.country.trim() && <span className="mr-1.5">{countryFlag(c.country)}</span>}
                {originParts.join(" · ")}
              </span>
            )}
            {(roast || roastFor || c.roaster_notes.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {roast && (
                  <Pill>
                    <RoastDot level={c.roast_level} />
                    {roast.label}
                  </Pill>
                )}
                {roastFor && <Pill>{roastFor.label}</Pill>}
                {c.roaster_notes.map((n) => (
                  <NoteChip key={n} note={n} />
                ))}
              </div>
            )}
            <div className="mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-sep shadow-card @lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.k} className="flex min-w-0 flex-col gap-0.5 bg-card px-3.5 py-3">
                  <span className="text-[12px] font-bold tracking-[0.04em] text-ink2 uppercase">{s.k}</span>
                  <span className={cx("tnum text-[22px] font-extrabold tracking-[-0.01em]", s.accent && best && "text-accent")}>{s.v}</span>
                  <span className="max-w-full truncate text-[12px] text-ink2">{s.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Chargen */}
        <section aria-label="Chargen" className="order-2 flex flex-col gap-2.5 @6xl:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1.5 text-[15px] font-extrabold">Charge</span>
            {data.batches.length > 1 && (
              <button
                type="button"
                aria-pressed={batchFilter === "all"}
                onClick={() => setBatchFilter("all")}
                className={cx(
                  "h-9 rounded-[11px] px-3.5 text-[13px]",
                  batchFilter === "all" ? "bg-accent-soft font-bold text-ink shadow-[inset_0_0_0_1px_var(--c-accent)]" : "bg-card text-ink2 shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2 hover:text-ink",
                )}
              >
                Alle
              </button>
            )}
            {sortedBatches.map((b) => {
              const on = batchFilter === b.id || (data.batches.length === 1 && batchFilter === "all");
              return (
                <span key={b.id} className="inline-flex items-center">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setBatchFilter(data.batches.length === 1 ? "all" : on ? "all" : b.id)}
                    className={cx("h-9 rounded-[11px] px-3.5 text-[13px]", on ? "bg-accent-soft font-bold text-ink shadow-[inset_0_0_0_1px_var(--c-accent)]" : "bg-card text-ink2 shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2 hover:text-ink")}
                  >
                    {batchLabel(b)}
                  </button>
                  {on && (
                    <button
                      type="button"
                      aria-label="Charge bearbeiten"
                      title="Charge bearbeiten"
                      onClick={() => setBatchSheet({ batch: b })}
                      className="ml-1 flex size-9 items-center justify-center rounded-[11px] text-ink2 hover:bg-fill"
                    >
                      <Pencil size={14} strokeWidth={2.2} />
                    </button>
                  )}
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setBatchSheet({ batch: null })}
              className="h-9 rounded-[11px] border border-dashed border-ink4 px-3.5 text-[13px] font-bold text-accent hover:bg-accent-soft"
            >
              + Neue Charge
            </button>
          </div>
          {(() => {
            const b = selBatch ?? (data.batches.length === 1 ? data.batches[0] : null);
            if (!b) return null;
            const info = [
              b.roast_date ? `Geröstet ${fmtDate(b.roast_date)}` : b.status === "leer" ? null : "Röstdatum fehlt",
              b.opened_at ? `geöffnet ${fmtDateShort(b.opened_at)}` : null,
              b.weight_g != null ? fmtGrams(b.weight_g) : null,
              b.price_eur != null ? priceLine(b.price_eur, b.weight_g) : null,
              plural(b.brew_count, "Bezug", "Bezüge"),
            ].filter(Boolean);
            return (
              <p className="m-0 text-[13px] text-ink2">
                {info.join(" · ")}
                {b.note && <span className="text-ink3"> · {b.note}</span>}
              </p>
            );
          })()}
        </section>

        {/* Geschmack und Einstellen nebeneinander, sobald die Spalte breit genug ist (sonst untereinander) */}
        <div className="@container/pair order-3">
          <div className="grid grid-cols-1 gap-6 @[60rem]/pair:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @[60rem]/pair:items-start @[60rem]/pair:[&:has(>:empty)]:grid-cols-1 [&>:empty]:hidden">
            {/* Breit zwei Spalten (links Geschmack, rechts Einstellen und Verlauf), schmal display:contents mit order: Geschmack, Einstellen, Verlauf, Decent */}
            <div ref={leftCol} className="contents @[60rem]/pair:flex @[60rem]/pair:min-w-0 @[60rem]/pair:flex-col @[60rem]/pair:gap-6">
        {group && overall ? (
          <Card className="order-1 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="m-0 text-[22px] font-extrabold tracking-[-0.02em]">Geschmack nach Rezept</h2>
                <span className="text-[13px] text-ink2">
                  {groups.length > 1 ? "Rezept wählen, Profil und Score wechseln mit. Gestrichelt: Schnitt aller Rezepte." : `${plural(group.brews.length, "Bezug", "Bezüge")} mit ${group.label}`}
                </span>
              </div>
              {groups.length > 1 && (
                <div className="no-scrollbar max-w-full overflow-x-auto">
                  <Segmented label="Rezept" value={group.key} onChange={setGroupKey} options={groups.map((g) => ({ id: g.key, label: g.label }))} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
              {groupParams(group).map((p) => (
                <div key={p.k} className="flex min-w-0 flex-col gap-0.5 rounded-[12px] bg-card2 px-3 py-2.5">
                  <span className="text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">{p.k}</span>
                  <span className="tnum truncate text-[17px] font-semibold">{p.v}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="flex min-w-0 flex-[1_1_380px] justify-center">
                <div className="w-full max-w-[460px]">
                  <Radar
                    axes={QUALITY_KEYS.map((k) => SCORE_LABELS[k])}
                    primary={QUALITY_KEYS.map((k) => group.scores[k])}
                    compare={groups.length > 1 ? QUALITY_KEYS.map((k) => overall[k]) : null}
                    primaryLabel={group.label}
                    compareLabel="Schnitt aller Rezepte"
                  />
                </div>
              </div>
              <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-[9px]">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2.5">
                  <span className="tnum font-display text-[48px] leading-none font-extrabold tracking-[-0.03em]">{formatScore(group.total)}</span>
                  {groups.length > 1 &&
                    (delta >= -0.005 ? (
                      <span className="rounded-full bg-good-soft px-[9px] py-[3px] text-[12px] font-semibold text-good">bestes Rezept</span>
                    ) : (
                      <span className="rounded-full bg-bad-soft px-[9px] py-[3px] text-[12px] font-semibold text-bad">
                        −{formatScore(-delta)} zum besten
                      </span>
                    ))}
                  <span className={cx("text-[13px] font-medium", gradeClass(group.total))}>{scoreGrade(group.total).label}</span>
                </div>
                <span className="-mt-2 mb-1 text-[12px] text-ink3">
                  Schnitt aus {plural(group.brews.length, "Bezug", "Bezügen")}
                  {group.best && group.brews.length > 1 ? ` · bester ${formatScore(group.best.total)}` : ""}
                </span>
                {[...QUALITY_KEYS, ...CUP_KEYS].map((k) => {
                  const v = group.scores[k];
                  const quality = (QUALITY_KEYS as readonly string[]).includes(k);
                  const w = quality ? (v - 6) / 4 : v / 10;
                  return (
                    <div key={k} className="grid grid-cols-[112px_minmax(0,1fr)_44px] items-center gap-3 sm:grid-cols-[124px_minmax(0,1fr)_44px]">
                      <span className="truncate text-[13px] text-ink2">{SCORE_LABELS[k]}</span>
                      <div className="h-1.5 overflow-hidden rounded-[3px] bg-fill">
                        <div
                          className="h-1.5 rounded-[3px]"
                          style={{ width: `${Math.max(0, Math.min(1, w)) * 100}%`, background: quality ? "var(--c-accent)" : CUP_COLOR }}
                        />
                      </div>
                      <span className="tnum text-right text-[13px] font-semibold">{v.toFixed(2).replace(".", ",")}</span>
                    </div>
                  );
                })}
                {group.scores.defects > 0 && (
                  <div className="grid grid-cols-[112px_minmax(0,1fr)_44px] items-center gap-3 sm:grid-cols-[124px_minmax(0,1fr)_44px]">
                    <span className="text-[13px] text-ink2">Defekte</span>
                    <span />
                    <span className="tnum text-right text-[13px] font-semibold text-bad">−{fmtNum(group.scores.defects)}</span>
                  </div>
                )}
                {flavorsTop.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {flavorsTop.map((f) => {
                      const cat = CATEGORY_BY_ID.get(f.category);
                      return (
                        <span
                          key={f.id}
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink"
                          style={{ background: cat ? `color-mix(in srgb, ${cat.color} 13%, transparent)` : "var(--c-fill)" }}
                        >
                          <span className="size-[7px] rounded-full" style={{ background: cat?.color }} />
                          {f.label}
                          {f.count > 1 && <span className="tnum text-ink3">{f.count}×</span>}
                        </span>
                      );
                    })}
                  </div>
                )}
                <span className="mt-1 text-[12px] text-ink3">
                  SCA-Cupping-Bogen: 7 Attribute je 6–10 in 0,25er-Schritten, dazu Gleichmäßigkeit, Sauberkeit und Süße, minus Defekte.
                </span>
              </div>
            </div>
          </Card>
        ) : brews.length ? (
          <QuickTaste brews={brews} recipeName={recipeName} className="order-1" />
        ) : (
          <Card className="order-1">
            <EmptyState
              icon={CoffeeIcon}
              title={data.brews.length ? "Kein Bezug in dieser Charge" : "Noch kein Bezug bewertet"}
              text="Schnell mit einem Kurzurteil oder ausführlich nach dem SCA-Bogen. Mit mehreren Rezepten siehst du hier, welches am besten schmeckt und wie sich der Kaffee über die Tage entwickelt."
              action={
                <Button variant="primary" icon={Plus} onClick={() => navigate(`/kaffee/${id}?bezug`)}>
                  {data.brews.length ? "Bezug bewerten" : "Ersten Bezug bewerten"}
                </Button>
              }
            />
          </Card>
        )}
        {decentLeft && decentCard}
            </div>
            <div ref={rightCol} className="contents @[60rem]/pair:flex @[60rem]/pair:min-w-0 @[60rem]/pair:flex-col @[60rem]/pair:gap-6">
        {/* Einstellen: Mahlgrad je Tüte, Hinweis, Startwert für neue Tüten */}
        <DialInCard data={data} batchFilter={batchFilter} className="order-2" onPick={setEditBrew} />

        {/* Verlauf */}
        {scaBrews.length > 0 && group && (
          <Card className="order-3 flex flex-col gap-3">
            <SectionTitle
              sub={groups.length > 1 ? `${group.label} in Blau, andere Rezepte grau. Punkt antippen öffnet den Bezug.` : "Punkt antippen öffnet den Bezug."}
              action={
                <div className="no-scrollbar max-w-full overflow-x-auto">
                  <Segmented label="Achse" size="sm" value={axis} onChange={setAxis} options={X_AXES.map((a) => ({ id: a.id, label: a.label }))} />
                </div>
              }
            >
              {axisDef.title}
            </SectionTitle>
            {points.length > 0 ? (
              <ScoreChart
                points={points}
                xFmt={axisDef.fmt}
                selectedLabel={group.label}
                onPick={(bid) => setEditBrew(data.brews.find((b) => b.id === bid) ?? null)}
              />
            ) : (
              <p className="m-0 rounded-[12px] bg-card2 px-4 py-6 text-center text-[14px] text-ink2">
                {axis === "days"
                  ? "Für diese Achse fehlt das Röstdatum der Charge."
                  : axis === "ratio"
                    ? "Für diese Achse fehlen Dosis und Wasser in den Bezügen."
                    : `Für diese Achse fehlen ${axis === "time" ? "Zeiten" : "Temperaturen"} in den Bezügen.`}
              </p>
            )}
          </Card>
        )}
        {!decentLeft && decentCard}
            </div>
          </div>
        </div>

        {/* Bezüge */}
        {brews.length > 0 && (
          <section className="order-5 flex flex-col gap-2.5">
            <SectionTitle
              action={
                groups.length > 1 && group ? (
                  <Button variant="plain" size="sm" onClick={() => setOnlyGroup((v) => !v)}>
                    {onlyGroup ? "Alle Bezüge" : `Nur ${group.label}`}
                  </Button>
                ) : undefined
              }
            >
              {onlyGroup && groups.length > 1 && group ? `Bezüge mit ${group.label}` : "Bezüge"}
            </SectionTitle>
            <div className="overflow-hidden rounded-[16px] bg-card shadow-card [&>*+*]:border-t [&>*+*]:border-sep">
              {listBrews.map((b) => {
                const day = xValue(b, "days", batchMap);
                const text =
                  b.comment || [...b.taste.map((t) => TASTE_LABEL.get(t) ?? t), ...b.flavors.map((f) => FLAVOR_BY_ID.get(f)?.label ?? f)].join(", ");
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setEditBrew(b)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-hover"
                  >
                    <span className="flex w-[74px] shrink-0 flex-col">
                      <span className="tnum text-[14px] font-semibold">{fmtDateShort(b.brewed_at)}</span>
                      <span className="text-[12px] text-ink3">{day != null ? `Tag ${day}` : fmtDateTime(b.brewed_at).split(" · ")[1]}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px]">{text || <span className="text-ink3">Ohne Notiz</span>}</span>
                      <span className="truncate text-[12px] text-ink2">{[recipeName(b.recipe_id), brewParamsLine(b)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {isSca(b) ? (
                      <span className="tnum shrink-0 text-[15px] font-semibold">{formatScore(b.total)}</span>
                    ) : b.rating != null ? (
                      <StarsValue value={b.rating} className="shrink-0 text-[15px] font-semibold" />
                    ) : isGoodBrew(b) ? (
                      <span className="shrink-0 text-[13px] font-bold text-good">Passt</span>
                    ) : null}
                    <ChevronRight size={16} className="shrink-0 text-ink4" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <span className="px-1 text-[12px] text-ink3">
              {[
                scaBrews.length ? `Ø ${formatScore(averageTotal(scaBrews))} über ${plural(scaBrews.length, "SCA-Bogen", "SCA-Bögen")}` : null,
                brews.length > scaBrews.length
                  ? `★ ${fmtStars(avgStars(brews.filter((b) => !isSca(b))))} über ${plural(brews.length - scaBrews.length, "Schnellbewertung", "Schnellbewertungen")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </section>
        )}

            </div>

            <div className="contents @6xl:flex @6xl:min-w-0 @6xl:flex-col @6xl:gap-6">
        {/* Chargen als Liste, nur breit */}
        <Card padded={false} className="hidden flex-col pb-2 @6xl:flex">
          <div className="flex items-center justify-between gap-2 pt-3.5 pr-3 pb-1.5 pl-5">
            <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.01em]">Chargen</h2>
            <Button variant="plain" size="sm" icon={Plus} onClick={() => setBatchSheet({ batch: null })}>
              Neue Charge
            </Button>
          </div>
          <div className="flex flex-col gap-1 px-2">
            {data.batches.length > 1 && (
              <BatchRow on={batchFilter === "all"} title="Alle Chargen" sub={plural(data.brews.length, "Bezug", "Bezüge")} onPick={() => setBatchFilter("all")} />
            )}
            {sortedBatches.map((b) => {
              const on = batchFilter === b.id || (data.batches.length === 1 && batchFilter === "all");
              return (
                <BatchRow
                  key={b.id}
                  batch={b}
                  on={on}
                  onPick={() => setBatchFilter(data.batches.length === 1 ? "all" : on ? "all" : b.id)}
                  onEdit={() => setBatchSheet({ batch: b })}
                />
              );
            })}
          </div>
        </Card>

        {/* Details */}
        {(detailGroups.length > 0 || c.description) && (
          <section className="order-6 flex flex-col gap-2.5">
            <SectionTitle>Details</SectionTitle>
            {detailGroups.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-7 gap-y-5 rounded-[18px] bg-card px-4 pt-4 pb-2 shadow-card">
                {detailGroups.map((g) => (
                  <div key={g.key} className="flex min-w-0 flex-col gap-2">
                    <span className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-[8px]" style={{ background: tint(g.tone, 15), color: g.tone }}>
                        <g.icon size={14} strokeWidth={2.3} aria-hidden="true" />
                      </span>
                      <span className="text-[11.5px] font-bold tracking-[0.07em] uppercase" style={{ color: g.tone }}>
                        {g.label}
                      </span>
                    </span>
                    {g.lead}
                    {g.rows.length > 0 && (
                      <dl className="m-0 flex flex-col">
                        {g.rows.map((d) => (
                          <div key={d.k} className="flex items-baseline justify-between gap-4 border-b border-sep py-2.5 last:border-b-0">
                            <dt className="shrink-0 text-[13.5px] text-ink2">{d.k}</dt>
                            <dd className="m-0 min-w-0 text-right text-[13.5px] break-words">{d.v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                ))}
              </div>
            )}
            {c.description && (
              <Card>
                <p className="m-0 text-[15px] leading-relaxed whitespace-pre-line text-ink2">{c.description}</p>
              </Card>
            )}
            {sourceLine(c) && <span className="px-1 text-[12px] text-ink3">{sourceLine(c)} · jedes Feld lässt sich bearbeiten</span>}
          </section>
        )}
            </div>
          </div>
        </div>
      </Page>

      <BrewSheet
        open={brewOpen || editBrew != null || brewPreset != null}
        onClose={closeBrew}
        detail={data}
        brew={brewOpen || brewPreset != null ? null : editBrew}
        preset={brewPreset}
      />
      <RoasterRecipesSheet
        coffee={c}
        open={roasterOpen}
        onClose={() => setRoasterOpen(false)}
        onBrew={(i) => {
          setRoasterOpen(false);
          setBrewPreset(i);
        }}
      />
      <BatchSheet
        open={batchSheet != null}
        onClose={() => setBatchSheet(null)}
        detail={data}
        batch={batchSheet?.batch ?? null}
        onSaved={(bid) => {
          if (bid == null) setBatchFilter("all");
        }}
      />
    </>
  );
}
