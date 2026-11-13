import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BarChart3, ChevronRight } from "lucide-react";
import { formatScore } from "../../../shared/sca.ts";
import { countryFlag, type CoffeeListItem, type Stats } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { fmtEuro, fmtMonth, fmtMonthLong, fmtNum, plural } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { resetFilters, setFilters } from "../lib/store.ts";
import { Artwork } from "../ui/Artwork.tsx";
import { CoffeeLink } from "../ui/CoffeeLink.tsx";
import { BarList, Columns, ScoreChart } from "../ui/charts.tsx";
import { Card, cx, EmptyState, LoadError, SectionTitle, Segmented, Spinner } from "../ui/controls.tsx";
import { LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { fmtStars } from "../ui/Stars.tsx";
import { TasteProfileSection } from "../ui/TasteProfile.tsx";
import { WorldMap, type MapMode } from "../ui/WorldMap.tsx";
import { gradeClass } from "./BrewSheet.tsx";

/** Letzte 12 Monate inkl. Monaten ohne Bezug */
function monthSeries(byMonth: Stats["by_month"]) {
  const map = new Map(byMonth.map((m) => [m.month, m]));
  const now = new Date();
  const out: { key: string; label: string; value: number; tip: React.ReactNode }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = map.get(key);
    out.push({
      key,
      label: fmtMonth(key),
      value: m?.brews ?? 0,
      tip: (
        <>
          <span className="font-semibold">{fmtMonthLong(key)}</span>
          <br />
          {m ? `${plural(m.brews, "Bezug", "Bezüge")} · Ø ${formatScore(m.avg)}` : "Kein Bezug"}
        </>
      ),
    });
  }
  return out;
}

function kg(g: number): { v: string; unit: string } {
  return g >= 1000 ? { v: fmtNum(g / 1000, 1), unit: "kg" } : { v: fmtNum(g, 0), unit: "g" };
}

const avgSub = (avg: number | null) => (avg != null ? `Ø ${formatScore(avg)}` : undefined);

/** Ausgaben je Monat, letzte 12 Monate inkl. Monaten ohne Kauf */
function spendSeries(byMonth: Stats["costs"]["by_month"]) {
  const map = new Map(byMonth.map((m) => [m.month, m]));
  const now = new Date();
  const out: { key: string; label: string; value: number; tip: React.ReactNode }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = map.get(key);
    out.push({
      key,
      label: fmtMonth(key),
      value: m?.spent ?? 0,
      tip: (
        <>
          <span className="font-semibold">{fmtMonthLong(key)}</span>
          <br />
          {m ? `${fmtEuro(m.spent)} · ${plural(m.batches, "Charge", "Chargen")}` : "Nichts gekauft"}
        </>
      ),
    });
  }
  return out;
}

/** Pearson-Korrelation, ab drei Punkten */
function correlation(pts: { x: number; y: number }[]): number | null {
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function valueVerdict(r: number | null, n: number): string {
  if (r == null) return n < 3 ? "Ab drei Kaffees mit Preis und SCA-Bogen gibt es hier eine Aussage." : "Alle gleich teuer oder gleich bewertet.";
  if (r >= 0.5) return "Ja, recht deutlich: Teurere Kaffees schneiden bei dir besser ab.";
  if (r >= 0.2) return "Ein wenig: Teurere Kaffees schneiden bei dir tendenziell etwas besser ab.";
  if (r > -0.2) return "Nein: Preis und Bewertung hängen bei dir kaum zusammen.";
  return "Eher im Gegenteil: Die günstigeren Kaffees schneiden bei dir besser ab.";
}

export function StatsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const { data: coffees } = useQuery({ queryKey: ["coffees"], queryFn: api.coffees });
  const [mapMode, setMapMode] = useState<MapMode>("count");
  const byId = new Map<number, CoffeeListItem>((coffees ?? []).map((c) => [c.id, c]));

  if (error && !data)
    return (
      <>
        <Toolbar title="Statistik" />
        <Page wide>
          <LargeTitle lift>Statistik</LargeTitle>
          <LoadError what="Die Statistik wurde" error={error} retry={() => void refetch()} />
        </Page>
      </>
    );
  if (isLoading || !data)
    return (
      <>
        <Toolbar title="Statistik" />
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      </>
    );

  const used = kg(data.grams_used);
  const tiles = [
    { k: "Kaffees", v: String(data.coffees), sub: "in der Bibliothek" },
    { k: "Bezüge", v: String(data.brews), sub: "bewertet" },
    // Nur die gute Note färbt: grau gedämpft sähe die Kennzahl neben den anderen wie abgeschaltet aus
    {
      k: "Ø Score",
      v: formatScore(data.avg_score),
      sub: "über alle SCA-Bögen",
      tone: data.avg_score != null && gradeClass(data.avg_score) === "text-good" ? "text-good" : undefined,
    },
    // Schnellbewertungen zählen getrennt: eigene Kennzahl, nicht im Score-Schnitt
    ...(data.quick.count > 0
      ? [{ k: "Ø Sterne", v: `★ ${fmtStars(data.quick.avg)}`, sub: `aus ${plural(data.quick.count, "Schnellbewertung", "Schnellbewertungen")}` }]
      : []),
    { k: "Verbraucht", v: used.v, unit: used.unit, sub: "Kaffee laut Dosis" },
  ];
  const costs = data.costs;
  const spend = spendSeries(costs.by_month);
  const hasSpend = spend.some((m) => m.value > 0);
  const valuePts = costs.value.map((v) => ({ x: v.per_kg, y: v.avg }));
  const r = correlation(valuePts);
  const pickCountry = (label: string) => {
    // nur dieses Land zeigen: andere Filter würden Treffer verstecken
    resetFilters();
    setFilters({ countries: [label] });
    navigate("/");
  };
  const months = monthSeries(data.by_month);
  const hasMonths = months.some((m) => m.value > 0);

  return (
    <>
      <Toolbar title="Statistik" />
      <Page wide>
        <LargeTitle lift sub="Was du trinkst, wie es dir schmeckt.">Statistik</LargeTitle>

        <div className="@container">
          <div className={cx("grid grid-cols-2 gap-3 sm:gap-4", tiles.length === 5 ? "@4xl:grid-cols-5" : "@2xl:grid-cols-4")}>
            {tiles.map((t, i) => (
              <div
                key={t.k}
                className={cx(
                  "flex min-w-0 flex-col gap-1 rounded-[18px] bg-card px-5 py-4 shadow-card",
                  tiles.length === 5 && i === 4 && "@max-4xl:col-span-2",
                )}
              >
                <span className="text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">{t.k}</span>
                <span className={cx("tnum font-display text-[30px] leading-none font-extrabold tracking-[-0.02em]", t.tone)}>
                  {t.v}
                  {t.unit && <span className="ml-1 text-[17px] font-semibold text-ink3">{t.unit}</span>}
                </span>
                <span className="text-[12px] text-ink3">{t.sub}</span>
              </div>
            ))}
          </div>
        </div>

        {data.brews === 0 && (
          <Card>
            <EmptyState
              icon={BarChart3}
              title="Noch keine Bezüge"
              text="Sobald du Bezüge bewertest, siehst du hier deine Bestenliste, Vorlieben nach Herkunft und Methode und den Verlauf über die Monate."
            />
          </Card>
        )}

        {data.top.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <SectionTitle sub="Bester einzelner Bezug je Kaffee">Bestenliste</SectionTitle>
            {/* Breit ab 4 Einträgen zwei Spalten (erste Hälfte links), statt einzelner Zeilen über die ganze Seite */}
            <div className="@container overflow-hidden rounded-[18px] bg-card shadow-card">
              <div
                className={cx("-mt-px grid", data.top.length >= 4 && "@4xl:grid-flow-col @4xl:grid-cols-2 @4xl:grid-rows-[repeat(var(--rows),auto)]")}
                style={{ "--rows": Math.ceil(data.top.length / 2) } as React.CSSProperties}
              >
                {data.top.map((t, i) => {
                  const c = byId.get(t.id);
                  return (
                    <CoffeeLink
                      key={t.id}
                      id={t.id}
                      className={cx(
                        "flex min-w-0 items-center gap-3.5 border-t border-sep px-4 py-2.5 text-ink no-underline hover:bg-hover",
                        data.top.length >= 4 && i >= Math.ceil(data.top.length / 2) && "@4xl:border-l",
                      )}
                    >
                      <span className="tnum w-5 shrink-0 text-center text-[15px] font-semibold text-ink3">{i + 1}</span>
                      {c ? (
                        <Artwork coffee={c} size="xs" rounded={10} className="size-11" />
                      ) : (
                        <span className="size-11 shrink-0 rounded-[10px] bg-fill" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] font-medium">{t.name}</span>
                        <span className="truncate text-[13px] text-ink2">
                          {[t.roaster, plural(t.brews, "Bezug", "Bezüge")].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className={cx("tnum shrink-0 text-[17px] font-bold", gradeClass(t.score))}>{formatScore(t.score)}</span>
                      <ChevronRight size={16} className="shrink-0 text-ink4" aria-hidden="true" />
                    </CoffeeLink>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {hasMonths && (
          <Card className="flex flex-col gap-3">
            <SectionTitle sub="Bezüge je Monat, letzte 12 Monate">Verlauf</SectionTitle>
            <Columns data={months} />
          </Card>
        )}

        {coffees && <TasteProfileSection coffees={coffees} />}

        {costs.batches_priced > 0 && (
          <section className="flex flex-col gap-2.5">
            <SectionTitle sub="Aus Preis und Gewicht der Chargen, pro Tasse über die Dosis der Bezüge">Kosten</SectionTitle>
            <div className="@container">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 @2xl:grid-cols-3">
                {[
                  { k: "Ausgegeben", v: fmtEuro(costs.spent), sub: plural(costs.batches_priced, "Charge mit Preis", "Chargen mit Preis") },
                  { k: "Ø pro kg", v: fmtEuro(costs.per_kg), sub: "gewichtet nach Menge" },
                  { k: "Ø pro Tasse", v: fmtEuro(costs.per_cup), sub: costs.cups_priced ? `aus ${plural(costs.cups_priced, "Bezug", "Bezügen")} mit Dosis` : "Dosis fehlt in den Bezügen" },
                ].map((t, i) => (
                  <div key={t.k} className={cx("flex min-w-0 flex-col gap-1 rounded-[18px] bg-card px-5 py-4 shadow-card", i === 2 && "@max-2xl:col-span-2")}>
                    <span className="text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">{t.k}</span>
                    <span className="tnum font-display truncate text-[26px] leading-none font-extrabold tracking-[-0.02em]">{t.v}</span>
                    <span className="text-[12px] text-ink3">{t.sub}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
              {hasSpend && (
                <Card className="flex flex-col gap-3">
                  <SectionTitle sub="Euro je Monat nach Röstdatum, letzte 12 Monate">Ausgaben</SectionTitle>
                  <Columns data={spend} label="Ausgaben je Monat in Euro" />
                </Card>
              )}
              {costs.by_roaster.length > 0 && (
                <Card className="flex flex-col gap-4">
                  <SectionTitle sub="Ø Preis pro kg je Rösterei">Preis pro Rösterei</SectionTitle>
                  <BarList
                    unit={["/kg", "/kg"]}
                    fmt={fmtEuro}
                    rows={costs.by_roaster.slice(0, 10).map((x) => ({
                      label: x.label,
                      value: x.per_kg,
                      sub: [plural(x.batches, "Charge", "Chargen"), avgSub(x.avg)].filter(Boolean).join(" · "),
                    }))}
                  />
                </Card>
              )}
            </div>
            {costs.value.length > 0 && (
              <Card className="flex flex-col gap-3">
                <SectionTitle sub={valueVerdict(r, costs.value.length)}>Teuer gleich besser?</SectionTitle>
                <ScoreChart
                  points={costs.value.map((v) => ({
                    id: v.id,
                    x: v.per_kg,
                    y: v.avg,
                    selected: true,
                    title: v.name,
                    sub: [v.roaster, `${fmtEuro(v.per_kg)}/kg`].filter(Boolean).join(" · "),
                  }))}
                  xFmt={(x) => `${fmtNum(x, 0)} €`}
                  line={false}
                  selectedLabel="Kaffee: € pro kg gegen Ø SCA-Score"
                  label="Preis pro kg gegen Ø SCA-Score je Kaffee"
                  onPick={(id) => navigate(`/kaffee/${id}`)}
                />
              </Card>
            )}
          </section>
        )}

        {data.by_country.some((x) => x.label && x.label !== "Unbekannt") && (
          <Card className="flex flex-col gap-3">
            <SectionTitle
              sub={mapMode === "count" ? "Kaffees je Herkunftsland" : "Ø SCA-Score je Herkunftsland"}
              action={
                <Segmented
                  label="Einfärben nach"
                  size="sm"
                  value={mapMode}
                  onChange={setMapMode}
                  options={[
                    { id: "count", label: "Anzahl" },
                    { id: "avg", label: "Ø Score" },
                  ]}
                />
              }
            >
              Weltkarte
            </SectionTitle>
            <WorldMap rows={data.by_country} mode={mapMode} onPick={pickCountry} />
          </Card>
        )}

        {data.coffees > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
            <Card className="flex flex-col gap-4">
              <SectionTitle sub="Kaffees je Land, mit Ø Score">Herkunft</SectionTitle>
              <BarList
                unit={["Kaffee", "Kaffees"]}
                rows={data.by_country.slice(0, 10).map((r) => ({
                  label: r.label,
                  value: r.count,
                  sub: avgSub(r.avg),
                  lead: r.label !== "Unbekannt" ? <span aria-hidden="true">{countryFlag(r.label)}</span> : undefined,
                }))}
              />
            </Card>
            <Card className="flex flex-col gap-4">
              <SectionTitle sub="Kaffees je Aufbereitung">Aufbereitung</SectionTitle>
              <BarList unit={["Kaffee", "Kaffees"]} rows={data.by_process.slice(0, 10).map((r) => ({ label: r.label, value: r.count, sub: avgSub(r.avg) }))} />
            </Card>
            <Card className="flex flex-col gap-4">
              <SectionTitle sub="Kaffees je Röstgrad">Röstgrad</SectionTitle>
              <BarList unit={["Kaffee", "Kaffees"]} rows={data.by_roast.map((r) => ({ label: r.label, value: r.count, sub: avgSub(r.avg) }))} />
            </Card>
            {data.by_method.length > 0 && (
              <Card className="flex flex-col gap-4">
                <SectionTitle sub="Bezüge je Methode">Methode</SectionTitle>
                <BarList unit={["Bezug", "Bezüge"]} rows={data.by_method.slice(0, 10).map((r) => ({ label: r.label, value: r.count, sub: avgSub(r.avg) }))} />
              </Card>
            )}
          </div>
        )}
      </Page>
    </>
  );
}
