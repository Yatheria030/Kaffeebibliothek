import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GraduationCap, Lightbulb, Search, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { type CoffeeListItem } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { href } from "../lib/router.ts";
import {
  ARTICLE_BY_SLUG,
  articleFor,
  articleMatches,
  searchArticles,
  TOPIC_BY_ID,
  WIKI_ARTICLES,
  WIKI_TOPICS,
  type WikiArticle,
  type WikiBlock,
  type WikiField,
  type WikiTopic,
} from "../lib/wiki.ts";
import { Artwork } from "../ui/Artwork.tsx";
import { CoffeeLink } from "../ui/CoffeeLink.tsx";
import { Card, cx, EmptyState } from "../ui/controls.tsx";
import { BackLink, LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";

// ---------- Farben je Thema ----------

const tint = (t: WikiTopic, pct = 14): CSSProperties => ({ background: `color-mix(in srgb, ${t.color} ${pct}%, var(--c-card))` });
const ink = (t: WikiTopic): CSSProperties => ({ color: `color-mix(in srgb, ${t.color} 78%, var(--c-ink))` });

function TopicIcon({ topic, size = 40 }: { topic: WikiTopic; size?: number }) {
  const Icon = topic.icon;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[12px]" style={{ ...tint(topic), ...ink(topic), width: size, height: size }}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

/** Tendenz 1–5 als fünf Striche */
function Meter({ value, topic }: { value: number; topic: WikiTopic }) {
  return (
    <span className="flex gap-[3px]" role="img" aria-label={`${value} von 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="h-[7px] w-[14px] rounded-full"
          style={i <= value ? { background: `color-mix(in srgb, ${topic.color} 85%, var(--c-ink))` } : { background: "var(--c-fill)" }}
        />
      ))}
    </span>
  );
}

// ---------- Bibliothek ↔ Wiki ----------

function coffeeValues(c: CoffeeListItem, field: WikiField): string[] {
  switch (field) {
    case "process":
      return [c.process];
    case "varieties":
      return c.varieties;
    case "country":
      return [c.country];
    case "roast_level":
      return c.roast_level ? [c.roast_level] : [];
    case "roast_for":
      return c.roast_for ? [c.roast_for] : [];
  }
}

function coffeesFor(a: WikiArticle, coffees: CoffeeListItem[]): CoffeeListItem[] {
  if (!a.match) return [];
  const field = a.match.field;
  return coffees.filter((c) => !c.archived && coffeeValues(c, field).some((v) => articleMatches(a, field, v)));
}

function useCoffees() {
  return useQuery({ queryKey: ["coffees"], queryFn: api.coffees }).data ?? [];
}

/** Feldwert im Kaffee-Detail, verlinkt auf den passenden Artikel, falls es einen gibt */
export function WikiTerm({ field, value, children }: { field: WikiField; value: string | null | undefined; children?: ReactNode }) {
  const a = articleFor(field, value);
  const label = children ?? value;
  if (!a) return <>{label}</>;
  return (
    <a
      href={href(`/wissen/${a.slug}`)}
      title={`Im Kaffeewissen: ${a.title}`}
      className="text-ink underline decoration-ink3/60 decoration-dotted underline-offset-[3px] hover:text-accent hover:decoration-accent"
    >
      {label}
    </a>
  );
}

// ---------- Suche ----------

function SearchField({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  return (
    <label className="flex h-[44px] w-full max-w-[560px] items-center gap-2.5 rounded-[13px] bg-card px-3.5 shadow-card">
      <Search size={17} className="shrink-0 text-ink3" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQ("");
        }}
        placeholder="Suchen, z. B. Honey, Gesha, Ruhezeit"
        aria-label="Kaffeewissen durchsuchen"
        className="field text-[15px] [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" aria-label="Suche leeren" onClick={() => setQ("")} className="flex size-[18px] items-center justify-center rounded-full bg-ink3 text-card">
          <X size={11} strokeWidth={3} />
        </button>
      )}
    </label>
  );
}

function ResultRow({ a }: { a: WikiArticle }) {
  const t = TOPIC_BY_ID.get(a.topic)!;
  return (
    <a href={href(`/wissen/${a.slug}`)} className="flex items-center gap-3.5 border-b border-sep px-5 py-3.5 text-ink no-underline last:border-b-0 hover:bg-fill/60">
      <TopicIcon topic={t} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold">{a.title}</span>
        <span className="line-clamp-2 text-[13px] text-ink2">{a.lead}</span>
      </span>
      <span className="text-[11px] font-semibold tracking-[0.04em] uppercase max-sm:hidden" style={ink(t)}>
        {t.title}
      </span>
      <ChevronRight size={16} className="shrink-0 text-ink3" />
    </a>
  );
}

// ---------- Startseite ----------

function TopicCard({ topic, coffees, className }: { topic: WikiTopic; coffees: CoffeeListItem[]; className?: string }) {
  const articles = WIKI_ARTICLES.filter((a) => a.topic === topic.id);
  return (
    <Card padded={false} className={cx("flex flex-col overflow-hidden", className)}>
      <div className="flex items-start gap-3.5 px-5 pt-5 pb-4">
        <TopicIcon topic={topic} size={44} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-[19px] leading-tight font-extrabold tracking-[-0.015em]">{topic.title}</h2>
          <p className="m-0 text-[13.5px] leading-snug text-ink2">{topic.blurb}</p>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col p-0 pb-2">
        {articles.map((a) => {
          const n = coffeesFor(a, coffees).length;
          return (
            <li key={a.slug}>
              <a href={href(`/wissen/${a.slug}`)} className="group flex h-10 items-center gap-2 px-5 text-[14.5px] text-ink no-underline hover:bg-fill/60">
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                {n > 0 && (
                  <span title={`${n} in deiner Bibliothek`} className="tnum rounded-full px-1.5 text-[11.5px] leading-[18px] font-bold" style={{ ...tint(topic, 16), ...ink(topic) }}>
                    {n}
                  </span>
                )}
                <ChevronRight size={15} className="shrink-0 text-ink3 transition-transform group-hover:translate-x-0.5" />
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Alle Aufbereitungen mit Profil nebeneinander */
function ProcessCompare({ className }: { className?: string }) {
  const topic = TOPIC_BY_ID.get("aufbereitung")!;
  const rows = WIKI_ARTICLES.filter((a) => a.topic === "aufbereitung" && a.profile);
  const labels = rows[0]?.profile?.map((p) => p.label) ?? [];
  return (
    <Card padded={false} className={cx("overflow-hidden", className)}>
      <div className="flex flex-col gap-0.5 px-5 pt-5 pb-3 sm:px-6">
        <h2 className="m-0 text-[19px] font-extrabold tracking-[-0.015em]">Aufbereitungen im Vergleich</h2>
        <p className="m-0 text-[13.5px] text-ink2">Grobe Tendenz in der Tasse. Varietät, Röstung und Zubereitung verschieben viel.</p>
      </div>
      {/* Breit eine Tabelle, schmal je Verfahren ein Block mit 2×2 Werten */}
      <div className="@container pb-2">
        <div className="hidden grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] gap-3 px-5 py-2 text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase @xl:grid sm:px-6">
          <span>Verfahren</span>
          {labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        {rows.map((a) => (
          <div key={a.slug} className="grid gap-2 border-t border-sep px-5 py-3 @xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] @xl:items-center @xl:gap-3 sm:px-6">
            <a href={href(`/wissen/${a.slug}`)} className="text-[14.5px] font-semibold text-ink no-underline hover:text-accent">
              {a.title}
            </a>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 @xl:contents">
              {a.profile!.map((p) => (
                <div key={p.label} className="flex items-center justify-between gap-2 @xl:block">
                  <span className="text-[12.5px] text-ink2 @xl:hidden">{p.label}</span>
                  <Meter value={p.value} topic={topic} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function WikiHome() {
  const [q, setQ] = useState("");
  const coffees = useCoffees();
  const results = q.trim() ? searchArticles(q) : null;

  return (
    <>
      <Toolbar title="Kaffeewissen" />
      <Page wide>
        <LargeTitle lift sub="Röstung, Aufbereitung, Herkunft und Verkostung, kurz und verständlich erklärt.">
          Kaffeewissen
        </LargeTitle>
        <SearchField q={q} setQ={setQ} />

        {results ? (
          results.length ? (
            <Card padded={false} className="overflow-hidden">
              <div className="px-5 pt-4 pb-2 text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">
                {results.length === 1 ? "1 Artikel" : `${results.length} Artikel`}
              </div>
              {results.map((a) => (
                <ResultRow key={a.slug} a={a} />
              ))}
            </Card>
          ) : (
            <EmptyState icon={GraduationCap} title="Nichts gefunden" text={`Kein Artikel erwähnt „${q.trim()}“.`} />
          )
        ) : (
          // Sieben Themen plus Vergleich (zwei Spalten breit) füllen drei Spalten; bei zwei Spalten wird das erste Thema breit
          <div className="@container">
            <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
              {WIKI_TOPICS.map((t, i) => (
                <TopicCard key={t.id} topic={t} coffees={coffees} className={cx(i === 0 && "@2xl:col-span-2 @5xl:col-span-1")} />
              ))}
              <ProcessCompare className="@2xl:col-span-2" />
            </div>
          </div>
        )}
      </Page>
    </>
  );
}

// ---------- Artikel ----------

function Block({ b, topic }: { b: WikiBlock; topic: WikiTopic }) {
  if (typeof b === "string") return <p className="m-0 text-[15.5px] leading-[1.65] text-ink">{b}</p>;
  if ("tip" in b)
    return (
      <div className="flex gap-3 rounded-[14px] px-4 py-3" style={tint(topic, 10)}>
        <Lightbulb size={18} className="mt-[3px] shrink-0" style={ink(topic)} />
        <p className="m-0 text-[14.5px] leading-[1.6] text-ink">{b.tip}</p>
      </div>
    );
  return (
    <dl className="m-0 flex flex-col overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1px_var(--c-sep)]">
      {b.list.map(([k, v]) => (
        <div key={k} className="@container border-b border-sep last:border-b-0">
          <div className="flex flex-col gap-0.5 px-4 py-3 @lg:grid @lg:grid-cols-[160px_minmax(0,1fr)] @lg:gap-4">
            <dt className="text-[14px] font-bold" style={ink(topic)}>
              {k}
            </dt>
            <dd className="m-0 text-[14.5px] leading-[1.55] text-ink">{v}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padded={false} className="flex flex-col">
      <div className="px-5 pt-4 pb-1 text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">{title}</div>
      {children}
    </Card>
  );
}

function ArticleLink({ a, dir }: { a: WikiArticle; dir: "prev" | "next" }) {
  return (
    <a
      href={href(`/wissen/${a.slug}`)}
      className={cx(
        "flex min-w-0 flex-1 items-center gap-2 rounded-[18px] bg-card px-4 py-3.5 text-ink no-underline shadow-card hover:bg-fill/40",
        dir === "next" && "flex-row-reverse text-right",
      )}
    >
      {dir === "prev" ? <ChevronLeft size={18} className="shrink-0 text-ink3" /> : <ChevronRight size={18} className="shrink-0 text-ink3" />}
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">{dir === "prev" ? "Zurück" : "Weiter"}</span>
        <span className="truncate text-[15px] font-bold">{a.title}</span>
      </span>
    </a>
  );
}

export function WikiArticlePage({ slug }: { slug: string }) {
  const coffees = useCoffees();
  const a = ARTICLE_BY_SLUG.get(slug);
  if (!a)
    return (
      <>
        <Toolbar>
          <BackLink to="/wissen">Kaffeewissen</BackLink>
        </Toolbar>
        <Page>
          <EmptyState icon={GraduationCap} title="Artikel nicht gefunden" text="Diesen Eintrag gibt es im Kaffeewissen nicht." />
        </Page>
      </>
    );

  const topic = TOPIC_BY_ID.get(a.topic)!;
  const siblings = WIKI_ARTICLES.filter((x) => x.topic === a.topic);
  const i = siblings.indexOf(a);
  const prev = siblings[i - 1];
  const next = siblings[i + 1];
  const mine = coffeesFor(a, coffees);
  const related = (a.related ?? []).map((s) => ARTICLE_BY_SLUG.get(s)).filter((x): x is WikiArticle => !!x);
  const hasSide = !!(a.facts?.length || a.profile?.length || mine.length || related.length);

  return (
    <>
      <Toolbar tab={a.title}>
        <BackLink to="/wissen">Kaffeewissen</BackLink>
      </Toolbar>
      <Page>
        <header className="flex max-w-[760px] flex-col gap-2.5">
          <span className="flex items-center gap-2 text-[12px] font-bold tracking-[0.05em] uppercase" style={ink(topic)}>
            <TopicIcon topic={topic} size={26} />
            {topic.title}
          </span>
          <h1 className="m-0 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.025em] sm:text-[38px]">{a.title}</h1>
          <p className="m-0 text-[17px] leading-[1.55] text-ink2 sm:text-[18px]">{a.lead}</p>
        </header>

        <div className="@container">
          <div className={cx("grid items-start gap-4", hasSide && "@4xl:grid-cols-[minmax(0,1fr)_320px]")}>
            <Card className="flex flex-col gap-7">
              {a.sections.map((s) => (
                <section key={s.h} className="flex flex-col gap-3">
                  <h2 className="m-0 text-[19px] leading-tight font-extrabold tracking-[-0.015em]">{s.h}</h2>
                  {s.body.map((b, j) => (
                    <Block key={j} b={b} topic={topic} />
                  ))}
                </section>
              ))}
            </Card>

            {hasSide && (
              <aside className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-1">
                {!!a.facts?.length && (
                  <SideCard title="Steckbrief">
                    <dl className="m-0 flex flex-col px-5 pb-2">
                      {a.facts.map(([k, v]) => (
                        <div key={k} className="flex flex-col gap-0.5 border-b border-sep py-2.5 last:border-b-0">
                          <dt className="text-[12.5px] text-ink3">{k}</dt>
                          <dd className="m-0 text-[14.5px] leading-snug font-semibold">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </SideCard>
                )}
                {!!a.profile?.length && (
                  <SideCard title="In der Tasse">
                    <div className="flex flex-col gap-2.5 px-5 pt-2 pb-5">
                      {a.profile.map((p) => (
                        <div key={p.label} className="flex items-center justify-between gap-3">
                          <span className="text-[14px] text-ink2">{p.label}</span>
                          <Meter value={p.value} topic={topic} />
                        </div>
                      ))}
                    </div>
                  </SideCard>
                )}
                {mine.length > 0 && (
                  <SideCard title={`In deiner Bibliothek · ${mine.length}`}>
                    <div className="flex flex-col pb-2">
                      {mine.slice(0, 8).map((c) => (
                        <CoffeeLink key={c.id} id={c.id} className="flex items-center gap-3 px-5 py-2 text-ink no-underline hover:bg-fill/60">
                          <Artwork coffee={c} size="xs" rounded={9} className="size-10" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[14px] font-semibold">{c.name}</span>
                            <span className="truncate text-[12.5px] text-ink2">{c.roaster || c.country}</span>
                          </span>
                        </CoffeeLink>
                      ))}
                      {mine.length > 8 && <span className="px-5 py-1.5 text-[12.5px] text-ink3">und {mine.length - 8} weitere</span>}
                    </div>
                  </SideCard>
                )}
                {related.length > 0 && (
                  <SideCard title="Weiterlesen">
                    <div className="flex flex-col pb-2">
                      {related.map((r) => {
                        const rt = TOPIC_BY_ID.get(r.topic)!;
                        return (
                          <a key={r.slug} href={href(`/wissen/${r.slug}`)} className="flex items-center gap-3 px-5 py-2 text-ink no-underline hover:bg-fill/60">
                            <TopicIcon topic={rt} size={30} />
                            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{r.title}</span>
                            <ChevronRight size={15} className="shrink-0 text-ink3" />
                          </a>
                        );
                      })}
                    </div>
                  </SideCard>
                )}
              </aside>
            )}
          </div>
        </div>

        {(prev || next) && (
          <nav className="flex gap-3 max-sm:flex-col">
            {prev ? <ArticleLink a={prev} dir="prev" /> : <span className="flex-1 max-sm:hidden" />}
            {next ? <ArticleLink a={next} dir="next" /> : <span className="flex-1 max-sm:hidden" />}
          </nav>
        )}
      </Page>
    </>
  );
}
