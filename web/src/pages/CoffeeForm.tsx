import { useQuery } from "@tanstack/react-query";
import { Crop, ImageUp, Link2, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FLAVOR_NOTES } from "../../../shared/flavors.ts";
import { matchRoaster, PROCESS_TYPES, ROAST_FOR, ROAST_LEVELS, type CoffeeFields, type RoastFor, type RoastLevel } from "../../../shared/types.ts";
import { api, imageUrl } from "../api.ts";
import { dominantColor, fileToDataUrl } from "../lib/image.ts";
import { ArtImg, BagSvg, bagColors, tileStyle } from "../ui/Artwork.tsx";
import { Button, cx, Segmented } from "../ui/controls.tsx";
import { autoAlign, ImageEditor } from "../ui/ImageEditor.tsx";
import { Group, NumField, Row, TagInput, TextArea, TextField } from "../ui/form.tsx";
import { RoasterRecipesEditor } from "../ui/RoasterRecipes.tsx";
import { toast } from "../ui/overlay.tsx";

// ---------- Bildauswahl ----------

/** aligned: schon ausgerichtetes Quadrat; from: Schlüssel des Ausgangsbilds, damit dessen Vorschaubild markiert bleibt */
export type ImageChoice =
  | { kind: "file"; file: string }
  | { kind: "url"; url: string }
  | { kind: "data"; data: string; aligned?: boolean; from?: string }
  | null;

export function choiceSrc(c: ImageChoice): string | null {
  if (!c) return null;
  return c.kind === "file" ? imageUrl(c.file) : c.kind === "url" ? c.url : c.data;
}

const choiceKey = (c: ImageChoice) => (c ? `${c.kind}:${choiceSrc(c)}` : "none");

/** Gewähltes Bild auf den Server bringen; ein fremder Link, der nicht lädt, wird übersprungen */
export async function resolveImage(c: ImageChoice): Promise<string | null> {
  if (!c) return null;
  if (c.kind === "file") return c.file;
  if (c.kind === "data") return (await api.uploadImage(c.data)).file;
  try {
    return (await api.fetchImage(c.url)).file;
  } catch (e) {
    toast(`Bild nicht geladen (${e instanceof Error ? e.message : "Fehler"}). Gespeichert wird ohne Bild.`, "error");
    return null;
  }
}

export async function colorFor(file: string | null): Promise<string | null> {
  if (!file) return null;
  try {
    return await dominantColor(imageUrl(file));
  } catch {
    return null;
  }
}

function Thumb({ choice, selected, onClick }: { choice: ImageChoice; selected: boolean; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = choiceSrc(choice);
  if (!src || broken) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label="Dieses Bild verwenden"
      className={cx(
        "size-14 shrink-0 overflow-hidden rounded-[10px] bg-[var(--c-tile-a)] p-1 transition-shadow",
        selected ? "ring-2 ring-accent" : "ring-1 ring-sep hover:ring-ink4",
      )}
    >
      <ArtImg src={src} alt="" onError={() => setBroken(true)} className="h-full w-full object-contain" />
    </button>
  );
}

export function ImagePicker({
  value,
  onChange,
  candidates = [],
  color,
  roast,
  saved = null,
}: {
  value: ImageChoice;
  onChange: (c: ImageChoice) => void;
  candidates?: ImageChoice[];
  color: string | null;
  roast: RoastLevel | null;
  /** Bereits gespeichertes Bild: wird nicht automatisch neu ausgerichtet */
  saved?: string | null;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [broken, setBroken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const [prep, setPrep] = useState(false);
  const fetched = useRef(new Map<string, string>());
  const alignedCache = useRef(new Map<string, string>());
  const [aligning, setAligning] = useState(false);
  const change = useRef(onChange);
  change.current = onChange;
  const id = useId();
  const src = choiceSrc(value);
  const { bag, label } = bagColors(color, roast);
  const from = value?.kind === "data" ? value.from : undefined;
  const sources = from && candidates.some((c) => choiceKey(c) === from) ? candidates : [...candidates, value];
  const all = [...new Map(sources.filter(Boolean).map((c) => [choiceKey(c), c])).values()];
  const isSelected = (c: ImageChoice) => choiceKey(c) === choiceKey(value) || choiceKey(c) === from;

  // Neue Bilder gleich wie „Automatisch“ ausrichten; fremde Links laufen dafür über den Server-Proxy (gleiche Herkunft)
  useEffect(() => {
    if (!value || (value.kind === "data" && value.aligned) || (value.kind === "file" && value.file === saved)) return;
    const key = choiceKey(value);
    const done = (data: string) => change.current({ kind: "data", data, aligned: true, from: key });
    const hit = alignedCache.current.get(key);
    if (hit) return done(hit);
    const ac = new AbortController();
    let blobUrl: string | null = null;
    setAligning(true);
    (async () => {
      let s = choiceSrc(value)!;
      if (value.kind === "url") s = blobUrl = URL.createObjectURL(await api.proxyImage(value.url, ac.signal));
      const data = await autoAlign(s);
      alignedCache.current.set(key, data);
      if (!ac.signal.aborted) done(data);
    })()
      .catch(() => {}) // bleibt dann unausgerichtet, „Ausrichten“ geht weiterhin
      .finally(() => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        if (!ac.signal.aborted) setAligning(false);
      });
    return () => {
      ac.abort();
      setAligning(false);
    };
  }, [value, saved]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      onChange({ kind: "data", data: await fileToDataUrl(f) });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Foto nicht lesbar", "error");
    } finally {
      setBusy(false);
    }
  };

  const loadLink = () => {
    const u = link.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) return toast("Bitte einen Bild-Link mit https:// angeben", "error");
    onChange({ kind: "url", url: u });
    setLink("");
  };

  /** Fremde Bilder erst auf den Server holen: Der Zuschnitt im Canvas braucht dieselbe Herkunft */
  const openEditor = async () => {
    if (!value) return;
    if (value.kind !== "url") return setEditSrc(choiceSrc(value));
    const known = fetched.current.get(value.url);
    if (known) return setEditSrc(imageUrl(known));
    setPrep(true);
    try {
      const { file } = await api.fetchImage(value.url);
      fetched.current.set(value.url, file);
      setEditSrc(imageUrl(file));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Bild nicht ladbar", "error");
    } finally {
      setPrep(false);
    }
  };

  return (
    <Group
      title="Bild"
      footer="Neue Bilder werden automatisch ausgerichtet, damit alle Packungen im Regal gleich groß wirken. Mit „Ausrichten“ korrigierst du von Hand. Im hellen Modus verschwindet ein weißer Hintergrund von selbst."
    >
      {editSrc && (
        <ImageEditor
          src={editSrc}
          color={color ?? bag}
          onClose={() => setEditSrc(null)}
          onApply={(data) => onChange({ kind: "data", data, aligned: true, from: from ?? choiceKey(value) })}
        />
      )}
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div
            className="relative flex size-[132px] shrink-0 items-center justify-center overflow-hidden rounded-[14px]"
            style={tileStyle(color ?? bag)}
          >
            {aligning && (
              <span className="absolute inset-x-0 bottom-0 z-10 bg-[color-mix(in_srgb,var(--c-card)_85%,transparent)] py-1 text-center text-[11px] font-semibold text-ink2">
                Richte aus …
              </span>
            )}
            {src && broken !== src ? (
              <ArtImg src={src} alt="Gewähltes Bild" onError={() => setBroken(src)} className="h-full w-full object-contain p-[5%]" />
            ) : (
              <BagSvg bag={bag} label={label} className="w-[46%]" />
            )}
          </div>
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2.5">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={ImageUp} loading={busy} onClick={() => file.current?.click()}>
                Foto wählen
              </Button>
              {value && (value.kind === "url" || broken !== src) && (
                <Button size="sm" icon={Crop} loading={prep} onClick={() => void openEditor()}>
                  Ausrichten
                </Button>
              )}
              {value && (
                <Button size="sm" variant="plain" icon={Trash2} className="text-bad hover:bg-bad-soft" onClick={() => onChange(null)}>
                  Entfernen
                </Button>
              )}
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            {/* Kein <form>: Die Bildauswahl steckt im Formular der Seite, verschachtelte Formulare schicken das äußere ab */}
            <div className="flex gap-2">
              <label htmlFor={id} className="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-fill px-2.5">
                <Link2 size={13} strokeWidth={2.2} className="shrink-0 text-ink3" />
                <input
                  id={id}
                  type="url"
                  placeholder="Bild-Link einfügen"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    loadLink();
                  }}
                  className="field text-[13px]"
                />
              </label>
              <Button size="sm" disabled={!link.trim()} onClick={loadLink}>
                Laden
              </Button>
            </div>
            {src && broken === src && <p className="m-0 text-[12px] text-ink3">Vorschau nicht verfügbar. Beim Sichern wird das Bild trotzdem versucht.</p>}
          </div>
        </div>
        {all.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-ink3">Gefundene Bilder</span>
            <div className="no-scrollbar flex gap-2 overflow-x-auto p-0.5">
              {all.map((c) => (
                <Thumb key={choiceKey(c)} choice={c} selected={isSelected(c)} onClick={() => !isSelected(c) && onChange(c)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Group>
  );
}

// ---------- Felder ----------

const COUNTRIES = [
  "Äthiopien", "Kenia", "Kolumbien", "Brasilien", "Ruanda", "Burundi", "Guatemala", "Costa Rica", "Honduras",
  "El Salvador", "Nicaragua", "Panama", "Mexiko", "Peru", "Bolivien", "Ecuador", "Indonesien", "Jemen", "Indien",
  "Tansania", "Uganda", "Kongo", "Papua-Neuguinea", "Vietnam", "China", "Jamaika", "Malawi", "Sambia", "Kamerun",
  "Philippinen", "Taiwan", "Nepal", "Myanmar", "Laos", "Thailand", "Osttimor", "Dominikanische Republik", "Haiti",
  "Kuba", "Hawaii", "Venezuela",
];
const VARIETIES = [
  "Gesha", "Bourbon", "Red Bourbon", "Yellow Bourbon", "Pink Bourbon", "Typica", "Caturra", "Catuai", "Mundo Novo",
  "SL28", "SL34", "Ruiru 11", "Batian", "Pacamara", "Maragogype", "Heirloom", "74110", "74112", "Castillo", "Sidra",
  "Wush Wush", "Java", "Laurina", "Catimor", "Parainema", "Marsellesa", "Obata", "Villa Sarchi", "Eugenioides",
];
const FLAVOR_SUGGESTIONS = FLAVOR_NOTES.filter((n) => n.category !== "sonstiges").map((n) => n.label);

/** Röstereien aus der Bibliothek, häufigste zuerst; wie `knownRoasters` auf dem Server */
function useKnownRoasters(): string[] {
  const { data } = useQuery({ queryKey: ["coffees"], queryFn: api.coffees });
  const n = new Map<string, number>();
  for (const c of data ?? []) if (c.roaster.trim()) n.set(c.roaster, (n.get(c.roaster) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).map(([r]) => r);
}

function TagBlock({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col pt-3">
      <label htmlFor={htmlFor} className="px-4 text-[13px] text-ink2">
        {label}
      </label>
      {children}
    </div>
  );
}

export function CoffeeFieldsForm({ value, onChange }: { value: CoffeeFields; onChange: (v: CoffeeFields) => void }) {
  const id = useId();
  const set = (p: Partial<CoffeeFields>) => onChange({ ...value, ...p });
  const f = (name: string) => `${id}-${name}`;
  const roasters = useKnownRoasters();
  return (
    <>
      <datalist id={f("countries")}>
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id={f("roasters")}>
        {roasters.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <datalist id={f("processes")}>
        {PROCESS_TYPES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <Group title="Kaffee">
        <Row label="Name" htmlFor={f("name")}>
          <TextField id={f("name")} value={value.name} onChange={(v) => set({ name: v })} placeholder="Pflichtfeld" required />
        </Row>
        <Row label="Rösterei" htmlFor={f("roaster")}>
          <TextField
            id={f("roaster")}
            list={f("roasters")}
            value={value.roaster}
            onChange={(v) => set({ roaster: v })}
            onBlur={() => {
              const m = matchRoaster(value.roaster, roasters);
              if (m !== value.roaster) set({ roaster: m });
            }}
            placeholder="–"
          />
        </Row>
      </Group>

      <Group title="Herkunft">
        <Row label="Land" htmlFor={f("country")}>
          <TextField id={f("country")} list={f("countries")} value={value.country} onChange={(v) => set({ country: v })} placeholder="–" />
        </Row>
        <Row label="Region" htmlFor={f("region")}>
          <TextField id={f("region")} value={value.region} onChange={(v) => set({ region: v })} placeholder="–" />
        </Row>
        <Row label="Farm / Station" htmlFor={f("farm")}>
          <TextField id={f("farm")} value={value.farm} onChange={(v) => set({ farm: v })} placeholder="–" />
        </Row>
        <Row label="Produzent" htmlFor={f("producer")}>
          <TextField id={f("producer")} value={value.producer} onChange={(v) => set({ producer: v })} placeholder="–" />
        </Row>
        <Row label="Höhe" htmlFor={f("altitude")}>
          <TextField id={f("altitude")} value={value.altitude} onChange={(v) => set({ altitude: v })} placeholder="z. B. 1.900–2.100 m" />
        </Row>
        <Row label="Ernte" htmlFor={f("harvest")}>
          <TextField id={f("harvest")} value={value.harvest} onChange={(v) => set({ harvest: v })} placeholder="z. B. 2025/26" />
        </Row>
      </Group>

      <Group title="Bohne">
        <TagBlock label="Varietäten" htmlFor={f("varieties")}>
          <TagInput
            id={f("varieties")}
            label="Varietäten"
            values={value.varieties}
            onChange={(v) => set({ varieties: v })}
            suggestions={VARIETIES}
            placeholder="Varietät eingeben, Enter"
          />
        </TagBlock>
        <Row label="Aufbereitung" htmlFor={f("process")}>
          <TextField id={f("process")} list={f("processes")} value={value.process} onChange={(v) => set({ process: v })} placeholder="z. B. Gewaschen" />
        </Row>
        <Row label="Zusatz" htmlFor={f("process-detail")}>
          <TextField
            id={f("process-detail")}
            value={value.process_detail}
            onChange={(v) => set({ process_detail: v })}
            placeholder="z. B. 72 h anaerob, Hochbetten"
          />
        </Row>
      </Group>

      <Group title="Röstung">
        <Row label="Röstgrad" stacked>
          <Segmented<"none" | RoastLevel>
            label="Röstgrad"
            full
            value={value.roast_level ?? "none"}
            onChange={(v) => set({ roast_level: v === "none" ? null : v })}
            options={[{ id: "none", label: "–", title: "Unbekannt" }, ...ROAST_LEVELS.map((r) => ({ id: r.id, label: r.label }))]}
          />
        </Row>
        <Row label="Geröstet für" stacked>
          <Segmented<"none" | RoastFor>
            label="Geröstet für"
            full
            value={value.roast_for ?? "none"}
            onChange={(v) => set({ roast_for: v === "none" ? null : v })}
            options={[{ id: "none", label: "–", title: "Unbekannt" }, ...ROAST_FOR.map((r) => ({ id: r.id, label: r.label }))]}
          />
        </Row>
      </Group>

      <Group
        title="Geschmack laut Röster"
        footer="Freie Notizen sind erlaubt; bekannte Noten werden den Kategorien des Aromarads zugeordnet. Der Cup Score ist die SCA-Wertung, die der Röster angibt, nicht deine eigene."
      >
        <TagInput
          id={f("notes")}
          label="Geschmacksnoten"
          values={value.roaster_notes}
          onChange={(v) => set({ roaster_notes: v })}
          suggestions={FLAVOR_SUGGESTIONS}
          placeholder="z. B. Blaubeere, Jasmin, Bergamotte"
        />
        <Row label="Cup Score" htmlFor={f("cup")}>
          <NumField id={f("cup")} value={value.cup_score} onChange={(v) => set({ cup_score: v })} suffix="Punkte" placeholder="z. B. 85" />
        </Row>
      </Group>

      <RoasterRecipesEditor value={value} onChange={set} />

      <Group title="Packung">
        <Row label="Gewicht" htmlFor={f("weight")}>
          <NumField id={f("weight")} value={value.weight_g} onChange={(v) => set({ weight_g: v })} suffix="g" integer />
        </Row>
        <Row label="Preis" htmlFor={f("price")}>
          <NumField id={f("price")} value={value.price_eur} onChange={(v) => set({ price_eur: v })} suffix="€" />
        </Row>
        <Row label="Shop-Link" htmlFor={f("url")}>
          <TextField id={f("url")} type="url" value={value.url} onChange={(v) => set({ url: v })} placeholder="https://…" />
        </Row>
      </Group>

      <Group title="Beschreibung">
        <TextArea
          id={f("desc")}
          label="Beschreibung"
          value={value.description}
          onChange={(v) => set({ description: v })}
          placeholder="Was der Röster über den Kaffee schreibt"
          rows={4}
        />
      </Group>
    </>
  );
}

export function cleanFields(v: CoffeeFields): CoffeeFields {
  const t = (s: string) => s.trim();
  return {
    ...v,
    name: t(v.name),
    roaster: t(v.roaster),
    country: t(v.country),
    region: t(v.region),
    farm: t(v.farm),
    producer: t(v.producer),
    process: t(v.process),
    process_detail: t(v.process_detail),
    altitude: t(v.altitude),
    harvest: t(v.harvest),
    description: t(v.description),
    roaster_recipes: v.roaster_recipes.map((r) => ({ ...r, title: t(r.title) || r.method, grind: t(r.grind), notes: t(r.notes) })),
    url: t(v.url),
  };
}
