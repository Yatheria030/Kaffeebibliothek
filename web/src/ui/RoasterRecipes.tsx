import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, Coffee as CoffeeIcon, Plus, Sparkles, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { BREW_METHODS, type Coffee, type CoffeeFields, type RoasterRecipe } from "../../../shared/types.ts";
import { api, type RecipeInput } from "../api.ts";
import { isEspresso } from "../lib/analysis.ts";
import { fmtGrams, fmtRatio, fmtTemp, fmtTime, hostOf, plural } from "../lib/format.ts";
import { Button, cx } from "./controls.tsx";
import { Group, NumField, Row, SelectField, TextArea, TextField, TimeField } from "./form.tsx";
import { confirmDialog, Sheet, toast } from "./overlay.tsx";

type Params = Pick<RecipeInput, "method" | "dose_g" | "water_g" | "temp_c" | "grind" | "time_s">;

/** Kenngrößen eines Rezepts für die Kacheln (eigene Rezepte und Röster-Rezepte) */
export function recipeParams(r: Params): { k: string; v: string }[] {
  const esp = isEspresso(r.method);
  return [
    { k: "Dosis", v: r.dose_g != null ? fmtGrams(r.dose_g) : "" },
    { k: esp ? "Ausbeute" : "Wasser", v: r.water_g != null ? fmtGrams(r.water_g) : "" },
    { k: "Verhältnis", v: r.dose_g && r.water_g ? fmtRatio(r.dose_g, r.water_g) : "" },
    { k: "Temperatur", v: r.temp_c != null ? fmtTemp(r.temp_c) : "" },
    { k: "Mahlgrad", v: r.grind },
    { k: esp ? "Bezugszeit" : "Brühzeit", v: r.time_s != null ? fmtTime(r.time_s) : "" },
  ].filter((p) => p.v);
}

export function ParamTiles({ r, className }: { r: Params; className?: string }) {
  const params = recipeParams(r);
  if (!params.length) return null;
  return (
    <div className={cx("grid grid-cols-3 gap-2", className)}>
      {params.map((p) => (
        <div key={p.k} className="flex min-w-0 flex-col rounded-[10px] bg-card2 px-2.5 py-2">
          <span className="truncate text-[10px] font-semibold tracking-[0.04em] text-ink3 uppercase">{p.k}</span>
          <span className="tnum truncate text-[14px] font-semibold" title={p.v}>
            {p.v}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Name, unter dem ein Röster-Rezept als eigenes Rezept gespeichert wird; daran wird es auch wiedererkannt */
export function roasterRecipeName(coffee: Pick<Coffee, "name">, r: RoasterRecipe): string {
  return `${r.title || r.method} · ${coffee.name}`.slice(0, 120);
}

export const recipeMethod = (m: string) => ((BREW_METHODS as readonly string[]).includes(m) ? m : "Sonstiges");

export function roasterRecipeInput(coffee: Pick<Coffee, "name">, r: RoasterRecipe): RecipeInput {
  return {
    name: roasterRecipeName(coffee, r),
    method: recipeMethod(r.method),
    dose_g: r.dose_g,
    water_g: r.water_g,
    temp_c: r.temp_c,
    grind: r.grind,
    grinder: "",
    time_s: r.time_s,
    notes: r.notes,
    archived: false,
  };
}

/** Knopf in den Details: öffnet die Rezepte, die der Röster vorschlägt */
export function RoasterRecipesButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[13.5px] font-bold text-accent hover:brightness-95">
      {count === 1 ? "1 Rezept ansehen" : `${count} Rezepte ansehen`}
    </button>
  );
}

export function RoasterRecipesSheet({
  coffee,
  open,
  onClose,
  onBrew,
}: {
  coffee: Coffee;
  open: boolean;
  onClose: () => void;
  onBrew: (index: number) => void;
}) {
  const qc = useQueryClient();
  const { data: recipes = [] } = useQuery({ queryKey: ["recipes"], queryFn: api.recipes, enabled: open });
  const [saving, setSaving] = useState<number | null>(null);

  const save = async (i: number) => {
    setSaving(i);
    try {
      await api.createRecipe(roasterRecipeInput(coffee, coffee.roaster_recipes[i]));
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      toast("Als Rezept gespeichert");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Rezepte vom Röster" closeLabel="Fertig" width={640}>
      <div className="flex flex-col gap-5">
        <p className="m-0 text-[14px] leading-snug text-ink2">
          So bereitet {coffee.roaster || "der Röster"} diesen Kaffee zu
          {coffee.url && (
            <>
              {" "}
              laut{" "}
              <a href={coffee.url} target="_blank" rel="noreferrer" className="text-accent no-underline hover:underline">
                {hostOf(coffee.url)}
              </a>
            </>
          )}
          . „Bezug damit“ übernimmt die Werte in den Bewertungsbogen.
        </p>
        {coffee.roaster_recipes.map((r, i) => {
          const saved = recipes.some((x) => x.name === roasterRecipeName(coffee, r));
          return (
            <section key={i} className="flex flex-col gap-3.5 rounded-[18px] bg-card p-5 shadow-card">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 className="m-0 truncate text-[17px] font-semibold">{r.title || r.method}</h3>
                {r.method && r.method !== r.title && <span className="text-[13px] text-ink2">{r.method}</span>}
              </div>
              <ParamTiles r={r} />
              {r.notes && <p className="m-0 text-[14px] leading-relaxed whitespace-pre-line text-ink2">{r.notes}</p>}
              <div className="flex flex-wrap gap-2 pt-0.5">
                <Button variant="primary" size="sm" icon={CoffeeIcon} onClick={() => onBrew(i)}>
                  Bezug damit
                </Button>
                <Button size="sm" icon={saved ? Check : BookmarkPlus} disabled={saved} loading={saving === i} onClick={() => void save(i)}>
                  {saved ? "In deinen Rezepten" : "Als Rezept speichern"}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}

function emptyRoasterRecipe(): RoasterRecipe {
  return { title: "", method: "V60", dose_g: null, water_g: null, temp_c: null, grind: "", time_s: null, notes: "" };
}

/** Bearbeiten im Kaffee-Formular, mit Nachladen von der Shopseite */
export function RoasterRecipesEditor({ value, onChange }: { value: CoffeeFields; onChange: (p: Partial<CoffeeFields>) => void }) {
  const id = useId();
  const [loading, setLoading] = useState(false);
  const list = value.roaster_recipes;
  const setAt = (i: number, p: Partial<RoasterRecipe>) => onChange({ roaster_recipes: list.map((r, j) => (j === i ? { ...r, ...p } : r)) });

  const fetchFromShop = async () => {
    if (list.length && !(await confirmDialog({ title: "Rezepte ersetzen?", message: "Die Rezepte von der Shopseite ersetzen die bisherigen.", confirmLabel: "Ersetzen" })))
      return;
    setLoading(true);
    try {
      const { recipes } = await api.scrapeRecipes({ url: value.url, name: value.name, roaster: value.roaster });
      if (!recipes.length) return toast("Auf der Shopseite steht keine Zubereitung", "error");
      onChange({ roaster_recipes: recipes });
      toast(`${plural(recipes.length, "Rezept", "Rezepte")} übernommen. Mit Sichern speichern`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Auslesen fehlgeschlagen", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Rezepte vom Röster</h3>
          <p className="m-0 text-[12px] leading-snug text-ink2">Zubereitungen, die der Röster vorschlägt. Im Kaffee unter Details.</p>
        </div>
        <div className="flex gap-2">
          {/^https?:\/\//.test(value.url.trim()) && (
            <Button size="sm" icon={Sparkles} loading={loading} onClick={() => void fetchFromShop()}>
              Von der Shopseite
            </Button>
          )}
          <Button size="sm" icon={Plus} onClick={() => onChange({ roaster_recipes: [...list, emptyRoasterRecipe()] })} disabled={list.length >= 8}>
            Rezept
          </Button>
        </div>
      </div>
      {list.map((r, i) => {
        const esp = isEspresso(r.method);
        const f = (k: string) => `${id}-${i}-${k}`;
        return (
          <Group key={i}>
            <div className="flex items-center gap-2 py-1.5 pr-2 pl-4">
              <TextField
                id={f("title")}
                aria-label="Name des Rezepts"
                align="left"
                value={r.title}
                onChange={(v) => setAt(i, { title: v })}
                placeholder={`Rezept ${i + 1}, z. B. V60`}
                className="min-w-0 flex-1 font-semibold"
              />
              <button
                type="button"
                aria-label="Rezept entfernen"
                title="Rezept entfernen"
                onClick={() => onChange({ roaster_recipes: list.filter((_, j) => j !== i) })}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink3 hover:bg-bad-soft hover:text-bad"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <Row label="Methode" htmlFor={f("method")}>
              <SelectField id={f("method")} value={recipeMethod(r.method)} onChange={(v) => setAt(i, { method: v })} options={BREW_METHODS.map((m) => ({ value: m, label: m }))} />
            </Row>
            <Row label="Dosis" htmlFor={f("dose")}>
              <NumField id={f("dose")} value={r.dose_g} onChange={(v) => setAt(i, { dose_g: v })} suffix="g" />
            </Row>
            <Row label={esp ? "Ausbeute" : "Wasser"} htmlFor={f("water")}>
              <NumField id={f("water")} value={r.water_g} onChange={(v) => setAt(i, { water_g: v })} suffix="g" />
            </Row>
            <Row label="Temperatur" htmlFor={f("temp")}>
              <NumField id={f("temp")} value={r.temp_c} onChange={(v) => setAt(i, { temp_c: v })} suffix="°C" />
            </Row>
            <Row label="Mahlgrad" htmlFor={f("grind")}>
              <TextField id={f("grind")} value={r.grind} onChange={(v) => setAt(i, { grind: v })} placeholder="z. B. mittelfein" />
            </Row>
            <Row label={esp ? "Bezugszeit" : "Brühzeit"} htmlFor={f("time")}>
              <TimeField id={f("time")} value={r.time_s} onChange={(v) => setAt(i, { time_s: v })} />
            </Row>
            <TextArea id={f("notes")} label="Ablauf" value={r.notes} onChange={(v) => setAt(i, { notes: v })} placeholder="Ablauf, z. B. 50 g Bloom 30 s, dann in zwei Güssen" rows={3} />
          </Group>
        );
      })}
    </section>
  );
}
