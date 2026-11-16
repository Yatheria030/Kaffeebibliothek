import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, ExternalLink, KeyRound, Search, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProfile, type ProfileDim, type ProfileValue, type TasteProfile } from "../../../shared/profile.ts";
import { formatScore } from "../../../shared/sca.ts";
import { countryFlag, type CoffeeListItem, type Recommendations, type Suggestion } from "../../../shared/types.ts";
import { api, recommendLive } from "../api.ts";
import { fmtDateTime, fmtEuro, fmtGrams, hostOf, plural } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { setPendingAdd } from "../lib/store.ts";
import { Banner, Button, Card, cx, SectionTitle, Spinner } from "./controls.tsx";
import { TextField } from "./form.tsx";
import { fmtStars } from "./Stars.tsx";

/**
 * „Was passt zu mir?“: Profil aus den eigenen Bewertungen (rechnet der Browser, kostenlos) und auf Knopfdruck eine Suche
 * per Claude bei den eigenen Röstereien (kostet API-Nutzung). Das letzte Ergebnis liefert GET /api/recommend.
 */
export function TasteProfileSection({ coffees }: { coffees: CoffeeListItem[] }) {
  const profile = useMemo(() => buildProfile(coffees.filter((c) => !c.wishlist)), [coffees]);
  if (!profile.basis) return null;
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle sub={profileSub(profile)}>Was passt zu mir?</SectionTitle>
      <Card className="@container flex flex-col gap-5">
        <Headline p={profile} />
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {profile.dims
            .filter((d) => d.values.length > 0)
            .map((d) => (
              <div key={d.id} className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[11px] font-semibold tracking-[0.04em] text-ink3 uppercase">{d.label}</span>
                {shownValues(d, profile).map((v) => (
                  <ValueRow key={v.label} v={v} p={profile} top={isHeadline(d, v, profile)} flag={d.id === "country"} />
                ))}
              </div>
            ))}
        </div>
      </Card>
      <Finder profile={profile} />
    </section>
  );
}

const isHeadline = (d: ProfileDim, v: ProfileValue, p: TasteProfile) => ["country", "process", "variety"].includes(d.id) && p.headline.includes(v.label);

/** Die besten vier; der Favorit aus dem Satz oben bleibt sichtbar, auch wenn Einzelkaffees vor ihm liegen */
function shownValues(d: ProfileDim, p: TasteProfile): ProfileValue[] {
  const top = d.values.slice(0, 4);
  const fav = d.values.find((v) => isHeadline(d, v, p));
  return fav && !top.includes(fav) ? [...top.slice(0, 3), fav] : top;
}

function profileSub(p: TasteProfile) {
  const scale = p.basis === "sca" ? "Ø SCA-Score" : "Ø Sterne";
  return `Aus ${plural(p.rated, "bewertetem Kaffee", "bewerteten Kaffees")}, sortiert nach ${scale}${p.basis === "sca" && p.avg_stars != null ? ", Sterne getrennt daneben" : ""}.`;
}

function Headline({ p }: { p: TasteProfile }) {
  if (!p.headline.length)
    return (
      <p className="m-0 text-[15px] leading-relaxed text-ink2">
        Noch kein klarer Favorit: Nichts liegt deutlich über deinem Schnitt. Mit mehr bewerteten Kaffees wird das Profil schärfer.
      </p>
    );
  return (
    <p className="m-0 text-[17px] leading-snug">
      <span className="text-ink2">Bei dir schneidet am besten ab: </span>
      <span className="font-extrabold">{p.headline.join(", ")}</span>
      <span className="text-ink2">
        {" "}
        (dein Schnitt {p.basis === "sca" ? formatScore(p.avg_sca) : `★ ${fmtStars(p.avg_stars)}`})
      </span>
    </p>
  );
}

function ValueRow({ v, p, top, flag }: { v: ProfileValue; p: TasteProfile; top: boolean; flag: boolean }) {
  const main = p.basis === "sca" ? v.sca : v.stars;
  const avg = p.basis === "sca" ? p.avg_sca : p.avg_stars;
  const diff = main != null && avg != null ? main - avg : null;
  return (
    <div className="flex min-w-0 items-center gap-2 text-[14px]">
      <span className={cx("min-w-0 flex-1 truncate", top && "font-bold")}>
        {flag && <span aria-hidden="true">{countryFlag(v.label)} </span>}
        {v.label}
        <span className="text-ink3"> · {v.coffees.length}</span>
      </span>
      {p.basis === "sca" && v.stars != null && <span className="tnum shrink-0 text-[12px] text-ink3">★ {fmtStars(v.stars)}</span>}
      <span className="tnum w-[52px] shrink-0 text-right font-semibold">{main == null ? "–" : p.basis === "sca" ? formatScore(main) : `★ ${fmtStars(main)}`}</span>
      <span
        className={cx(
          "tnum w-[44px] shrink-0 text-right text-[12px]",
          diff == null ? "text-ink4" : diff > 0.05 ? "text-good" : diff < -0.05 ? "text-bad" : "text-ink3",
        )}
      >
        {diff == null ? "" : `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${p.basis === "sca" ? formatScore(Math.abs(diff)) : fmtStars(Math.round(Math.abs(diff) * 10) / 10)}`}
      </span>
    </div>
  );
}

// ---------- Suche per Claude ----------

type Step = { label: string; detail: string };

function Finder({ profile }: { profile: TasteProfile }) {
  const qc = useQueryClient();
  const last = useQuery({ queryKey: ["recommend"], queryFn: api.recommendations, select: (d) => d.result });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [hint, setHint] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setRunning(true);
    setSteps([]);
    setError(null);
    try {
      const result = await recommendLive(
        hint.trim(),
        (e) => {
          if (e.t === "step") setSteps((s) => [...s, { label: e.label, detail: e.detail }]);
        },
        ctl.signal,
      );
      qc.setQueryData(["recommend"], { result });
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "Suche fehlgeschlagen");
    } finally {
      if (abort.current === ctl) {
        abort.current = null;
        setRunning(false);
      }
    }
  };
  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
  };

  const noKey = settings.data && !settings.data.api_key.set;
  const result: Recommendations | null | undefined = last.data;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="m-0 flex items-center gap-2 text-[17px] font-extrabold tracking-[-0.01em]">
          <Sparkles size={17} className="text-accent" aria-hidden="true" />
          Passende Kaffees finden
        </h3>
        <p className="m-0 text-[13px] leading-snug text-ink2">
          Die Anthropic-API sucht mit deinem Profil{profile.headline.length ? ` (${profile.headline.join(", ")})` : ""} in den Shops deiner Röstereien nach
          Kaffees, die es gerade gibt. Kostet API-Nutzung (Websuche und Seitenabrufe) und dauert ein bis drei Minuten.
        </p>
      </div>
      {noKey ? (
        <Banner tone="warn" icon={KeyRound} action={<Button size="sm" onClick={() => navigate("/einstellungen")}>Einstellungen</Button>}>
          Für die Suche braucht es einen API-Key.
        </Banner>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <TextField
            value={hint}
            onChange={setHint}
            align="left"
            maxLength={300}
            disabled={running}
            placeholder="Wunsch (optional), z. B. eher fruchtig, für Filter"
            aria-label="Wunsch für die Suche"
            className="min-w-0 flex-[1_1_260px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !running) void run();
            }}
          />
          {running ? (
            <Button icon={X} onClick={cancel}>
              Abbrechen
            </Button>
          ) : (
            <Button variant="primary" icon={Search} onClick={() => void run()}>
              {result ? "Neu suchen" : "Suchen"}
            </Button>
          )}
        </div>
      )}

      {running && (
        <div className="flex flex-col gap-1.5 rounded-[12px] bg-card2 px-4 py-3" aria-live="polite">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Spinner size={14} /> {steps.length ? "Sucht …" : "Startet …"}
          </span>
          {steps.slice(-6).map((s, i) => (
            <span key={i} className="truncate text-[12px] text-ink2">
              {s.label}: <span className="text-ink">{s.detail}</span>
            </span>
          ))}
        </div>
      )}
      {error && (
        <Banner tone="error" icon={TriangleAlert}>
          {error}
        </Banner>
      )}

      {result && !running && (
        <div className="flex flex-col gap-3">
          <span className="text-[12px] text-ink3">
            {result.items.length ? plural(result.items.length, "Vorschlag", "Vorschläge") : "Keine Vorschläge"} vom {fmtDateTime(result.at)}
            {result.hint ? ` · Wunsch: ${result.hint}` : ""}
          </span>
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
              {result.items.map((s) => (
                <SuggestionCard key={s.url} s={s} />
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const facts = [s.country && `${countryFlag(s.country)} ${s.country}`, s.process, s.varieties.join(", ")].filter(Boolean);
  const price = [s.price_eur != null ? fmtEuro(s.price_eur) : null, s.weight_g != null ? fmtGrams(s.weight_g) : null].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[14px] bg-card2 p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">{s.roaster}</span>
        <span className="text-[16px] leading-snug font-extrabold">{s.name}</span>
        {(facts.length > 0 || price) && <span className="text-[13px] text-ink2">{[...facts, price].filter(Boolean).join(" · ")}</span>}
      </div>
      {s.notes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.notes.map((n) => (
            <span key={n} className="rounded-full bg-fill px-2.5 py-0.5 text-[12px]">
              {n}
            </span>
          ))}
        </div>
      )}
      <p className="m-0 text-[14px] leading-relaxed">{s.reason}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          icon={BookmarkPlus}
          onClick={() => {
            setPendingAdd({ url: s.url, wishlist: true });
            navigate("/neu");
          }}
        >
          Unter Gesehen ablegen
        </Button>
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-[32px] min-w-0 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-bold text-accent no-underline hover:bg-accent-soft"
        >
          <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{hostOf(s.url)}</span>
        </a>
      </div>
    </div>
  );
}
