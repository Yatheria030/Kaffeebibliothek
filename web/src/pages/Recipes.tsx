import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatScore } from "../../../shared/sca.ts";
import { BREW_METHODS, type RecipeListItem } from "../../../shared/types.ts";
import { api, type RecipeInput } from "../api.ts";
import { isEspresso } from "../lib/analysis.ts";
import { fmtRatio, plural } from "../lib/format.ts";
import { Button, cx, EmptyState, LoadError, Spinner, Switch } from "../ui/controls.tsx";
import { Group, NumField, Row, TextArea, TextField, TimeField } from "../ui/form.tsx";
import { confirmDialog, Sheet, toast } from "../ui/overlay.tsx";
import { ParamTiles } from "../ui/RoasterRecipes.tsx";
import { LargeTitle, LIFT, Page, Toolbar } from "../ui/Shell.tsx";
import { gradeClass } from "./BrewSheet.tsx";
import { fmtStars, StarsValue } from "../ui/Stars.tsx";

function emptyRecipe(): RecipeInput {
  return { name: "", method: "V60", dose_g: 15, water_g: 250, temp_c: 94, grind: "", grinder: "", time_s: null, notes: "", archived: false };
}

// ---------- Seite ----------

export function Recipes() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["recipes"], queryFn: api.recipes });
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState<{ recipe: RecipeListItem | null } | null>(null);

  const all = data ?? [];
  const archivedCount = all.filter((r) => r.archived).length;
  const list = all
    .filter((r) => showArchived || !r.archived)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || b.brew_count - a.brew_count || a.name.localeCompare(b.name, "de"));

  return (
    <>
      <Toolbar title="Rezepte">
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setSheet({ recipe: null })}>
          Neues Rezept
        </Button>
      </Toolbar>
      <Page wide>
        <div className={`flex flex-wrap items-end justify-between gap-4 ${LIFT}`}>
          <LargeTitle sub="Vorlagen für deine Bezüge. Beim Bewerten wählst du eins aus, die Werte kommen vorbelegt.">Rezepte</LargeTitle>
          {archivedCount > 0 && (
            <label className="flex items-center gap-2.5 text-[14px] text-ink2">
              Archivierte zeigen
              <Switch checked={showArchived} onChange={setShowArchived} label="Archivierte Rezepte zeigen" />
            </label>
          )}
        </div>

        {error && !data ? (
          <LoadError what="Die Rezepte wurden" error={error} retry={() => void refetch()} />
        ) : isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Noch keine Rezepte"
            text="Lege ein Rezept an, z. B. „V60 hell“ mit 15 g auf 250 g bei 94 °C. Du kannst auch beim Bewerten direkt eins aus den Werten speichern."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setSheet({ recipe: null })}>
                Rezept anlegen
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4">
            {list.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSheet({ recipe: r })}
                className={cx(
                  "flex flex-col gap-3.5 rounded-[18px] bg-card p-5 text-left shadow-card transition-shadow hover:shadow-pop",
                  r.archived && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[17px] font-semibold">{r.name}</span>
                    <span className="text-[13px] text-ink2">
                      {[r.method, r.grinder, r.archived && "archiviert"].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {r.avg_score != null ? (
                    <span className={cx("tnum shrink-0 text-[20px] font-extrabold tracking-[-0.01em]", gradeClass(r.avg_score))}>{formatScore(r.avg_score)}</span>
                  ) : (
                    r.avg_rating != null && <StarsValue value={r.avg_rating} className="shrink-0 text-[20px] font-extrabold tracking-[-0.01em]" />
                  )}
                </div>
                <ParamTiles r={r} />
                <span className="text-[12px] text-ink3">
                  {r.brew_count
                    ? `${plural(r.brew_count, "Bezug", "Bezüge")} · ${plural(r.coffee_count, "Kaffee", "Kaffees")}${r.avg_score != null ? ` · Ø ${formatScore(r.avg_score)}` : ""}${r.avg_rating != null ? ` · ★ ${fmtStars(r.avg_rating)}` : ""}`
                    : "Noch nicht benutzt"}
                </span>
              </button>
            ))}
          </div>
        )}
      </Page>
      {sheet && <RecipeSheet recipe={sheet.recipe} onClose={() => setSheet(null)} />}
    </>
  );
}

// ---------- Sheet ----------

function RecipeSheet({ recipe, onClose }: { recipe: RecipeListItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [r, setR] = useState<RecipeInput>(() =>
    recipe
      ? {
          name: recipe.name,
          method: recipe.method,
          dose_g: recipe.dose_g,
          water_g: recipe.water_g,
          temp_c: recipe.temp_c,
          grind: recipe.grind,
          grinder: recipe.grinder,
          time_s: recipe.time_s,
          notes: recipe.notes,
          archived: recipe.archived,
        }
      : emptyRecipe(),
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RecipeInput>(k: K, v: RecipeInput[K]) => setR((p) => ({ ...p, [k]: v }));
  const esp = isEspresso(r.method);

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["recipes"] }), qc.invalidateQueries({ queryKey: ["coffee"] }), qc.invalidateQueries({ queryKey: ["stats"] })]);

  const save = async () => {
    if (!r.name.trim()) return toast("Bitte einen Namen eingeben", "error");
    setSaving(true);
    try {
      const input = { ...r, name: r.name.trim(), method: r.method.trim(), grind: r.grind.trim(), grinder: r.grinder.trim(), notes: r.notes.trim() };
      if (recipe) await api.updateRecipe(recipe.id, input);
      else await api.createRecipe(input);
      await refresh();
      toast(recipe ? "Rezept gesichert" : "Rezept angelegt");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!recipe) return;
    const ok = await confirmDialog({
      title: `„${recipe.name}“ löschen?`,
      message: recipe.brew_count
        ? `${plural(recipe.brew_count, "Bezug behält", "Bezüge behalten")} ihre Werte, laufen danach aber unter „Ohne Rezept“. Archivieren blendet es nur aus.`
        : "Das Rezept wird endgültig entfernt.",
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRecipe(recipe.id);
      await refresh();
      toast("Rezept gelöscht");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Löschen fehlgeschlagen", "error");
    }
  };

  return (
    <Sheet open onClose={onClose} title={recipe ? "Rezept bearbeiten" : "Neues Rezept"} onSave={() => void save()} saving={saving} canSave={!!r.name.trim()} width={560}>
      <div className="flex flex-col gap-7">
        <Group>
          <Row label="Name" htmlFor="rc-name">
            <TextField id="rc-name" value={r.name} onChange={(v) => set("name", v)} placeholder="z. B. V60 hell" autoFocus={!recipe} />
          </Row>
          <Row label="Methode" htmlFor="rc-method">
            <TextField id="rc-method" value={r.method} onChange={(v) => set("method", v)} list="rc-methods" placeholder="V60" />
            <datalist id="rc-methods">
              {BREW_METHODS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Row>
        </Group>

        <Group title="Parameter" footer={r.dose_g && r.water_g ? `Verhältnis ${fmtRatio(r.dose_g, r.water_g)}` : undefined}>
          <Row label="Dosis" htmlFor="rc-dose">
            <NumField id="rc-dose" value={r.dose_g} onChange={(v) => set("dose_g", v)} suffix="g" />
          </Row>
          <Row label={esp ? "Ausbeute" : "Wasser"} htmlFor="rc-water">
            <NumField id="rc-water" value={r.water_g} onChange={(v) => set("water_g", v)} suffix="g" />
          </Row>
          <Row label="Temperatur" htmlFor="rc-temp">
            <NumField id="rc-temp" value={r.temp_c} onChange={(v) => set("temp_c", v)} suffix="°C" />
          </Row>
          <Row label="Mahlgrad" htmlFor="rc-grind">
            <TextField id="rc-grind" value={r.grind} onChange={(v) => set("grind", v)} placeholder="z. B. 22 Klicks" />
          </Row>
          <Row label="Mühle" htmlFor="rc-grinder">
            <TextField id="rc-grinder" value={r.grinder} onChange={(v) => set("grinder", v)} placeholder="z. B. Comandante" />
          </Row>
          <Row label={esp ? "Bezugszeit" : "Brühzeit"} htmlFor="rc-time">
            <TimeField id="rc-time" value={r.time_s} onChange={(v) => set("time_s", v)} />
          </Row>
        </Group>

        <Group title="Ablauf und Notizen">
          <TextArea id="rc-notes" label="Notizen" value={r.notes} onChange={(v) => set("notes", v)} placeholder="z. B. 50 g Bloom 30 s, dann in zwei Güssen" rows={4} />
        </Group>

        {recipe && (
          <Group footer="Archivierte Rezepte tauchen beim Bewerten nicht mehr auf, alte Bezüge behalten sie.">
            <Row label="Archiviert">
              <Switch checked={r.archived} onChange={(v) => set("archived", v)} label="Archiviert" />
            </Row>
          </Group>
        )}

        {recipe && (
          <div className="flex justify-center">
            <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
              Rezept löschen
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
