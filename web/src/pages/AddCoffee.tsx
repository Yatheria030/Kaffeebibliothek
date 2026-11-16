import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ImageUp, KeyRound, Link2, Minimize2, PenLine, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  BATCH_CHOICES,
  emptyCoffeeFields,
  fromChoice,
  type BatchChoice,
  type CoffeeFields,
  type CoffeeSource,
  type ScrapeDraft,
  type ScrapeEvent,
  type ScrapeJob,
  type ScrapePartial,
  type ScrapeStep,
} from "../../../shared/types.ts";
import { api, ApiError, followScrapeJob, imageUrl } from "../api.ts";
import { hostOf, todayIso } from "../lib/format.ts";
import { fileToDataUrl } from "../lib/image.ts";
import { lastLibraryPath, navigate } from "../lib/router.ts";
import { clearPendingAdd, peekPendingAdd } from "../lib/store.ts";
import { Banner, Button, Card, cx, Segmented } from "../ui/controls.tsx";
import { Group, Row } from "../ui/form.tsx";
import { toast } from "../ui/overlay.tsx";
import { ScrapeLive } from "../ui/ScrapeLive.tsx";
import { askNotify, jobPath, JOBS_KEY, toBackground } from "../ui/ScrapeJobs.tsx";
import { BackLink, LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { asUrl } from "./Library.tsx";
import { CoffeeFieldsForm, cleanFields, colorFor, ImagePicker, resolveImage, type ImageChoice } from "./CoffeeForm.tsx";

type Mode = "link" | "name" | "foto";
type Step =
  | { s: "input" }
  | { s: "loading"; started: number; what: string; photo: string | null }
  | { s: "error"; message: string; uploaded: string | null }
  | { s: "form" };
type ScrapeInput = { url?: string; name?: string; image?: string };
/** Was der Stream bisher geliefert hat */
type Live = { steps: ScrapeStep[]; fields: ScrapePartial; images: string[]; finished: boolean };
const NO_LIVE: Live = { steps: [], fields: {}, images: [], finished: false };

function reduceLive(l: Live, e: ScrapeEvent): Live {
  switch (e.t) {
    case "step": {
      const { t: _t, ...st } = e;
      const i = l.steps.findIndex((x) => x.id === st.id);
      return { ...l, steps: i < 0 ? [...l.steps, st] : l.steps.map((x, j) => (j === i ? st : x)) };
    }
    case "fields":
      return { ...l, fields: e.fields };
    case "images":
      return { ...l, images: e.urls };
    case "done":
      return {
        ...l,
        finished: true,
        fields: { ...e.draft.fields, image_urls: e.draft.image_urls },
        steps: l.steps.map((x) => (x.state === "run" ? { ...x, state: "ok" } : x)),
      };
    default:
      return l;
  }
}

/** Foto für ein erneutes Auslesen: data-URL bleibt, eine Datei unter /images wird wieder zur data-URL */
async function photoData(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error("Foto nicht mehr da, bitte neu wählen");
  return fileToDataUrl(await res.blob());
}

/**
 * Kaffee hinzufügen. Auslesen läuft als Auftrag im Server (`server/scrape-jobs.ts`): `job` in der Adresse (`#/neu?job=…`) zeigt
 * dessen Verlauf, wer die Seite verlässt, lässt ihn im Hintergrund weiterlaufen (Dock unten rechts, `ui/ScrapeJobs.tsx`).
 */
export function AddCoffee({ job }: { job: string | null }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const hasKey = settings.data?.api_key.set ?? false;

  const [pending] = useState(peekPendingAdd);
  useEffect(() => clearPendingAdd(), []);

  const [mode, setMode] = useState<Mode>(pending?.image ? "foto" : pending?.name ? "name" : "link");
  const [url, setUrl] = useState(pending?.url ?? "");
  const [name, setName] = useState(pending?.name ?? "");
  const [photo, setPhoto] = useState<string | null>(pending?.image ?? null);
  const [step, setStep] = useState<Step>({ s: "input" });
  const [live, setLive] = useState<Live>(NO_LIVE);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Auftrag, den diese Seite gerade zeigt */
  const jobRef = useRef<string | null>(null);
  const [starting, setStarting] = useState<"live" | "background" | null>(null);

  // Formularzustand
  const [fields, setFields] = useState<CoffeeFields>(emptyCoffeeFields);
  const [image, setImage] = useState<ImageChoice>(null);
  const [candidates, setCandidates] = useState<ImageChoice[]>([]);
  const [draft, setDraft] = useState<ScrapeDraft | null>(null);
  const [source, setSource] = useState<CoffeeSource | null>(null);
  const [buy, setBuy] = useState<"gekauft" | "gesehen">(pending?.wishlist ? "gesehen" : "gekauft");
  const [roastDate, setRoastDate] = useState("");
  // Röstdatum bleibt leer, bis man es einträgt; „Nachgetragen“ = alte, aufgebrauchte Packung mit unbekannten Daten
  const [batchChoice, setBatchChoice] = useState<BatchChoice>("offen");
  const [saving, setSaving] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const currentInput = (): ScrapeInput | null => {
    if (mode === "link") {
      const u = asUrl(url);
      return u ? { url: u } : null;
    }
    if (mode === "name") return name.trim().length >= 3 ? { name: name.trim() } : null;
    return photo ? { image: photo } : null;
  };

  const applyDraft = (d: ScrapeDraft) => {
    setDraft(d);
    setFields(d.fields);
    setSource(d.source);
    const cands: ImageChoice[] = [
      ...(d.uploaded_image ? [{ kind: "file" as const, file: d.uploaded_image }] : []),
      ...d.image_urls.map((u) => ({ kind: "url" as const, url: u })),
    ];
    setCandidates(cands);
    setImage(cands[0] ?? null);
  };

  /** Einem Auftrag folgen: bisheriger Stand kommt sofort, danach live; fertig geht es ins Formular */
  const follow = async (j: Pick<ScrapeJob, "id" | "what" | "started" | "photo" | "state">) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    jobRef.current = j.id;
    setLive(NO_LIVE);
    setStep({ s: "loading", started: j.started, what: j.what, photo: j.photo ? imageUrl(j.photo) : null });
    try {
      const d = await followScrapeJob(j.id, (e) => !ac.signal.aborted && setLive((l) => reduceLive(l, e)), ac.signal);
      if (ac.signal.aborted) return;
      // Kurz das fertige Ergebnis zeigen, dann ins Formular (nicht, wenn er schon fertig war)
      const pause = j.state !== "run" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
      await new Promise((r) => setTimeout(r, pause));
      if (ac.signal.aborted) return;
      applyDraft(d);
      setStep({ s: "form" });
      window.scrollTo(0, 0);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      const uploaded = e instanceof ApiError && typeof e.data.uploaded_image === "string" ? e.data.uploaded_image : null;
      if (uploaded && !photo) setPhoto(imageUrl(uploaded));
      setStep({ s: "error", message: e instanceof Error ? e.message : String(e), uploaded });
    }
  };

  /** Auftrag weg (gesichert, verworfen, abgebrochen) */
  const dropJob = (id = jobRef.current) => {
    if (!id) return;
    if (jobRef.current === id) jobRef.current = null;
    qc.setQueryData<ScrapeJob[]>(JOBS_KEY, (l) => l?.filter((x) => x.id !== id));
    void api.removeScrapeJob(id).catch(() => {});
  };

  /** Neuen Auftrag starten; live folgt ihm hier, im Hintergrund geht es zurück zur Bibliothek */
  const run = async (input: ScrapeInput, background = false) => {
    if (background) askNotify();
    setStarting(background ? "background" : "live");
    try {
      const body = input.image ? { image: await photoData(input.image) } : input;
      const j = await api.startScrapeJob(body);
      dropJob(); // ein fehlgeschlagener Vorgänger hat sich damit erledigt
      qc.setQueryData<ScrapeJob[]>(JOBS_KEY, (l) => [j, ...(l ?? [])]);
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
      if (background) {
        toBackground(lastLibraryPath());
        return;
      }
      jobRef.current = j.id;
      navigate(jobPath(j.id), { replace: true });
      void follow(j);
    } catch (e) {
      const uploaded = e instanceof ApiError && typeof e.data.uploaded_image === "string" ? e.data.uploaded_image : null;
      setStep({ s: "error", message: e instanceof Error ? e.message : String(e), uploaded });
    } finally {
      setStarting(null);
    }
  };

  // Auftrag aus der Adresse (Dock, Meldung, neu geladen): Eingaben von dort übernehmen und folgen
  useEffect(() => {
    if (job === jobRef.current) return;
    if (!job) {
      // Ohne Auftrag in der Adresse (z. B. erneut „Hinzufügen“): frisch beginnen
      abortRef.current?.abort();
      jobRef.current = null;
      setStep({ s: "input" });
      return;
    }
    jobRef.current = job;
    let gone = false;
    void qc.fetchQuery({ queryKey: JOBS_KEY, queryFn: api.scrapeJobs, staleTime: 0 }).then(
      (list) => {
        if (gone || jobRef.current !== job) return;
        const j = list.find((x) => x.id === job);
        if (!j) {
          jobRef.current = null;
          navigate("/neu", { replace: true });
          setStep({ s: "error", message: "Dieses Auslesen gibt es nicht mehr (abgelaufen oder der Server wurde neu gestartet).", uploaded: null });
          return;
        }
        if ("url" in j.input) {
          setMode("link");
          setUrl(j.input.url);
        } else if ("name" in j.input) {
          setMode("name");
          setName(j.input.name);
        } else if (j.photo) {
          setMode("foto");
          setPhoto(imageUrl(j.photo));
        }
        void follow(j);
      },
      (e: unknown) => !gone && setStep({ s: "error", message: e instanceof Error ? e.message : String(e), uploaded: null }),
    );
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  // Aus der Bibliothek übergeben: direkt auslesen, sobald klar ist, dass ein Key da ist
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !settings.data || !pending) return;
    if (!pending.url && !pending.name && !pending.image) return;
    autoStarted.current = true;
    if (!settings.data.api_key.set) return;
    void run(pending.url ? { url: pending.url } : pending.name ? { name: pending.name } : { image: pending.image! });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const manual = (uploaded: string | null = null) => {
    abortRef.current?.abort();
    if (jobRef.current) {
      dropJob();
      navigate("/neu", { replace: true });
    }
    const f = emptyCoffeeFields();
    const u = asUrl(url);
    if (mode === "name" && name.trim()) f.name = name.trim();
    if (mode === "link" && u) f.url = u;
    setFields(f);
    setDraft(null);
    setSource({ kind: "manual", input: mode === "link" ? (u ?? "") : mode === "name" ? name.trim() : "", at: new Date().toISOString() });
    const img: ImageChoice = uploaded
      ? { kind: "file", file: uploaded }
      : mode === "foto" && photo
        ? photo.startsWith("/images/")
          ? { kind: "file", file: photo.slice("/images/".length) }
          : { kind: "data", data: photo }
        : null;
    setCandidates(img ? [img] : []);
    setImage(img);
    setStep({ s: "form" });
    window.scrollTo(0, 0);
  };

  const takePhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPhoto(await fileToDataUrl(f));
      setMode("foto");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Foto nicht lesbar", "error");
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (f) void takePhoto(f);
  };

  const save = async () => {
    const clean = cleanFields(fields);
    if (!clean.name) {
      toast("Bitte einen Namen eingeben", "error");
      document.getElementById("add-form")?.querySelector<HTMLInputElement>("input[required]")?.focus();
      return;
    }
    setSaving(true);
    try {
      const file = await resolveImage(image);
      const color = await colorFor(file);
      const { id } = await api.createCoffee({
        ...clean,
        image: file,
        color,
        wishlist: buy === "gesehen",
        archived: false,
        source,
        first_batch:
          buy === "gekauft"
            ? {
                roast_date: roastDate || null,
                weight_g: clean.weight_g,
                price_eur: clean.price_eur,
                ...fromChoice(batchChoice),
              }
            : null,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["coffees"] }),
        qc.invalidateQueries({ queryKey: ["stats"] }),
      ]);
      dropJob();
      toast(buy === "gesehen" ? "Unter Gesehen abgelegt" : "Kaffee hinzugefügt");
      navigate(`/kaffee/${id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const input = currentInput();

  /** Formular verwerfen: der Auftrag dahinter ist damit erledigt */
  const restart = () => {
    if (jobRef.current) {
      dropJob();
      navigate("/neu", { replace: true });
    }
    setStep({ s: "input" });
  };

  // ---------- Formular ----------
  if (step.s === "form") {
    return (
      <>
        <Toolbar tab="Kaffee hinzufügen">
          <BackLink to={lastLibraryPath()}>Bibliothek</BackLink>
          <div className="flex-1" />
          <Button variant="plain" size="sm" icon={RotateCcw} onClick={restart} className="max-sm:hidden">
            Neu beginnen
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            Sichern
          </Button>
        </Toolbar>
        <Page narrow>
          <LargeTitle sub={draft ? "Per Anthropic-API ausgelesen. Bitte kurz prüfen und ergänzen." : "Alle Felder sind optional außer dem Namen."}>
            Neuer Kaffee
          </LargeTitle>

          {draft && (draft.notes || draft.sources_used.length > 0) && (
            <Banner tone="info" icon={Sparkles}>
              {draft.notes && <p className="m-0">{draft.notes}</p>}
              {draft.sources_used.length > 0 && (
                <p className={cx("m-0 text-[13px] text-ink2", draft.notes && "mt-1.5")}>
                  Quellen:{" "}
                  {[...new Map(draft.sources_used.map((s) => [hostOf(s), s])).values()].slice(0, 6).map((s, i) => (
                    <span key={s}>
                      {i > 0 && ", "}
                      <a href={s} target="_blank" rel="noreferrer" className="text-accent no-underline hover:underline">
                        {hostOf(s)}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </Banner>
          )}

          <form
            id="add-form"
            className="flex flex-col gap-7"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Group title="Status" footer={buy === "gekauft" ? "Die erste Charge übernimmt Gewicht und Preis aus „Packung“." : undefined}>
              <div className="p-3">
                <Segmented
                  label="Gekauft oder nur gesehen"
                  full
                  value={buy}
                  onChange={setBuy}
                  options={[
                    { id: "gekauft", label: "Gekauft" },
                    { id: "gesehen", label: "Gesehen" },
                  ]}
                />
              </div>
              {buy === "gekauft" ? (
                <>
                  <Row label="Röstdatum" htmlFor="add-roast">
                    <input
                      id="add-roast"
                      type="date"
                      max={todayIso()}
                      value={roastDate}
                      onChange={(e) => setRoastDate(e.target.value)}
                      className="field h-9 w-auto text-right text-[15px]"
                    />
                  </Row>
                  <Row label="Packung" stacked>
                    <Segmented label="Packung" full wrap value={batchChoice} onChange={setBatchChoice} options={BATCH_CHOICES} />
                  </Row>
                </>
              ) : (
                <p className="m-0 px-4 py-3 text-[13px] text-ink2">
                  Landet unter Gesehen. Sobald du eine Charge einträgst, zieht er in die Bibliothek um.
                </p>
              )}
            </Group>

            <CoffeeFieldsForm value={fields} onChange={setFields} />
            <ImagePicker value={image} onChange={setImage} candidates={candidates} color={null} roast={fields.roast_level} />

            <div className="flex justify-end gap-2">
              <Button onClick={restart}>Neu beginnen</Button>
              <Button type="submit" variant="primary" loading={saving}>
                Sichern
              </Button>
            </div>
          </form>
        </Page>
      </>
    );
  }

  // ---------- Eingabe, Laden, Fehler ----------
  return (
    <>
      <Toolbar tab="Kaffee hinzufügen">
        <BackLink to={lastLibraryPath()}>Bibliothek</BackLink>
      </Toolbar>
      {/* Beim Auslesen breiter, damit Ablauf und Vorschau nebeneinander Platz haben */}
      <Page narrow={step.s !== "loading"}>
        <LargeTitle sub="Link zum Shop, Name oder Foto der Packung. Die Anthropic-API sucht die Infos zusammen und füllt die Felder vor.">
          Kaffee hinzufügen
        </LargeTitle>

        {settings.data && !hasKey && (
          <Banner
            tone="warn"
            icon={KeyRound}
            action={
              <Button size="sm" onClick={() => navigate("/einstellungen")}>
                Einstellungen
              </Button>
            }
          >
            Kein API-Key hinterlegt. Auslesen klappt erst mit Key; manuell erfassen geht immer.
          </Banner>
        )}

        {step.s === "loading" ? (
          <ScrapeLive
            what={step.what}
            started={step.started}
            photo={step.photo}
            {...live}
            onCancel={() => {
              abortRef.current?.abort();
              restart();
            }}
            onBackground={() => toBackground(lastLibraryPath())}
          />
        ) : (
          <Card>
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (input && hasKey && !starting) void run(input);
              }}
            >
              <Segmented
                label="Quelle"
                full
                value={mode}
                onChange={setMode}
                options={[
                  { id: "link", label: "Link" },
                  { id: "name", label: "Name" },
                  { id: "foto", label: "Foto" },
                ]}
              />

              {mode === "link" && (
                <label className="flex h-11 items-center gap-2 rounded-[10px] bg-fill px-3">
                  <Link2 size={16} strokeWidth={2.2} className="shrink-0 text-ink3" />
                  <input
                    autoFocus
                    type="url"
                    inputMode="url"
                    aria-label="Link zum Kaffee"
                    placeholder="https://shop.example/kaffee/guji"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="field text-[15px]"
                  />
                </label>
              )}
              {mode === "name" && (
                <label className="flex h-11 items-center gap-2 rounded-[10px] bg-fill px-3">
                  <PenLine size={16} strokeWidth={2.2} className="shrink-0 text-ink3" />
                  <input
                    autoFocus
                    type="text"
                    aria-label="Name und Rösterei"
                    placeholder="z. B. Guji Hambela Hafenrösterei"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field text-[15px]"
                  />
                </label>
              )}
              {mode === "foto" && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}
                  className={cx(
                    "flex flex-wrap items-center gap-4 rounded-[14px] border-2 border-dashed p-4 transition-colors",
                    drag ? "border-accent bg-accent-soft" : "border-sep",
                  )}
                >
                  {photo ? (
                    <img src={photo} alt="Foto der Packung" className="h-28 w-28 rounded-[10px] bg-fill object-contain" />
                  ) : (
                    <span className="flex size-28 items-center justify-center rounded-[10px] bg-fill text-ink3">
                      <ImageUp size={30} strokeWidth={1.7} />
                    </span>
                  )}
                  <div className="flex min-w-0 flex-[1_1_200px] flex-col items-start gap-2">
                    <p className="m-0 text-[14px] text-ink2">Vorderseite der Packung, gern auch die Rückseite mit Herkunft und Röstdatum.</p>
                    <Button size="sm" icon={ImageUp} onClick={() => fileRef.current?.click()}>
                      {photo ? "Anderes Foto" : "Foto wählen"}
                    </Button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      void takePhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}

              {step.s === "error" && (
                <Banner tone="error" icon={CircleAlert}>
                  {step.message}
                </Banner>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="plain" icon={PenLine} onClick={() => manual(step.s === "error" ? step.uploaded : null)}>
                  Manuell erfassen
                </Button>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    size="lg"
                    icon={Minimize2}
                    disabled={!input || !hasKey || starting != null}
                    loading={starting === "background"}
                    onClick={() => input && void run(input, true)}
                    title="Liest im Hintergrund, du kannst weiter in der App stöbern und wirst gemeldet, wenn er fertig ist"
                  >
                    Im Hintergrund
                  </Button>
                  <Button type="submit" variant="primary" size="lg" icon={Sparkles} disabled={!input || !hasKey || starting != null} loading={starting === "live"}>
                    {step.s === "error" ? "Erneut auslesen" : "Auslesen"}
                  </Button>
                </span>
              </div>
            </form>
          </Card>
        )}
      </Page>
    </>
  );
}
