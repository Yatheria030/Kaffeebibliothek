import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ImageUp, KeyRound, Link2, PenLine, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { BATCH_CHOICES, emptyCoffeeFields, fromChoice, type BatchChoice, type CoffeeFields, type CoffeeSource, type ScrapeDraft, type ScrapeEvent, type ScrapePartial, type ScrapeStep } from "../../../shared/types.ts";
import { api, ApiError, scrapeLive } from "../api.ts";
import { hostOf, todayIso } from "../lib/format.ts";
import { fileToDataUrl } from "../lib/image.ts";
import { lastLibraryPath, navigate } from "../lib/router.ts";
import { clearPendingAdd, peekPendingAdd } from "../lib/store.ts";
import { Banner, Button, Card, cx, Segmented } from "../ui/controls.tsx";
import { Group, Row } from "../ui/form.tsx";
import { toast } from "../ui/overlay.tsx";
import { ScrapeLive } from "../ui/ScrapeLive.tsx";
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

export function AddCoffee() {
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

  // Formularzustand
  const [fields, setFields] = useState<CoffeeFields>(emptyCoffeeFields);
  const [image, setImage] = useState<ImageChoice>(null);
  const [candidates, setCandidates] = useState<ImageChoice[]>([]);
  const [draft, setDraft] = useState<ScrapeDraft | null>(null);
  const [source, setSource] = useState<CoffeeSource | null>(null);
  const [buy, setBuy] = useState<"gekauft" | "merkliste">(pending?.wishlist ? "merkliste" : "gekauft");
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

  const run = async (input: ScrapeInput) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const what = input.url ? hostOf(input.url) : input.name ? `„${input.name}“` : "das Foto";
    setLive(NO_LIVE);
    setStep({ s: "loading", started: Date.now(), what, photo: input.image ?? null });
    try {
      const d = await scrapeLive(input, (e) => !ac.signal.aborted && setLive((l) => reduceLive(l, e)), ac.signal);
      if (ac.signal.aborted) return;
      // Kurz das fertige Ergebnis zeigen, dann ins Formular
      await new Promise((r) => setTimeout(r, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900));
      if (ac.signal.aborted) return;
      applyDraft(d);
      setStep({ s: "form" });
      window.scrollTo(0, 0);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      const uploaded = e instanceof ApiError && typeof e.data.uploaded_image === "string" ? e.data.uploaded_image : null;
      setStep({ s: "error", message: e instanceof Error ? e.message : String(e), uploaded });
    }
  };

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
    const f = emptyCoffeeFields();
    const u = asUrl(url);
    if (mode === "name" && name.trim()) f.name = name.trim();
    if (mode === "link" && u) f.url = u;
    setFields(f);
    setDraft(null);
    setSource({ kind: "manual", input: mode === "link" ? (u ?? "") : mode === "name" ? name.trim() : "", at: new Date().toISOString() });
    const img: ImageChoice = uploaded ? { kind: "file", file: uploaded } : mode === "foto" && photo ? { kind: "data", data: photo } : null;
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
        wishlist: buy === "merkliste",
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
      toast(buy === "merkliste" ? "Auf die Merkliste gesetzt" : "Kaffee hinzugefügt");
      navigate(`/kaffee/${id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const input = currentInput();

  // ---------- Formular ----------
  if (step.s === "form") {
    return (
      <>
        <Toolbar tab="Kaffee hinzufügen">
          <BackLink to={lastLibraryPath()}>Bibliothek</BackLink>
          <div className="flex-1" />
          <Button variant="plain" size="sm" icon={RotateCcw} onClick={() => setStep({ s: "input" })} className="max-sm:hidden">
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
                  label="Gekauft oder Merkliste"
                  full
                  value={buy}
                  onChange={setBuy}
                  options={[
                    { id: "gekauft", label: "Gekauft" },
                    { id: "merkliste", label: "Merkliste" },
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
                  Landet auf der Merkliste. Sobald du eine Charge einträgst, zieht er in die Bibliothek um.
                </p>
              )}
            </Group>

            <CoffeeFieldsForm value={fields} onChange={setFields} />
            <ImagePicker value={image} onChange={setImage} candidates={candidates} color={null} roast={fields.roast_level} />

            <div className="flex justify-end gap-2">
              <Button onClick={() => setStep({ s: "input" })}>Neu beginnen</Button>
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
              setStep({ s: "input" });
            }}
          />
        ) : (
          <Card>
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (input && hasKey) void run(input);
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
                <Button type="submit" variant="primary" size="lg" icon={Sparkles} disabled={!input || !hasKey}>
                  {step.s === "error" ? "Erneut auslesen" : "Auslesen"}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </Page>
    </>
  );
}
