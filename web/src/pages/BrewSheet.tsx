import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Coffee as CupIcon, Info, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FLAVOR_BY_ID, FLAVOR_NOTES, FLAVOR_WHEEL } from "../../../shared/flavors.ts";
import {
  CUP_KEYS,
  defaultScores,
  GRADE_STEPS,
  QUALITY_LEVELS,
  qualityLevel,
  QUALITY_KEYS,
  QUALITY_MAX,
  QUALITY_MIN,
  QUALITY_STEP,
  SCORE_HINTS,
  SCORE_LABELS,
  scoreGrade,
  totalScore,
  formatScore,
  type Scores,
} from "../../../shared/sca.ts";
import { brewRatio, grindNumber, isGoodBrew, methodKey } from "../../../shared/grind.ts";
import {
  BREW_METHODS,
  bagAge,
  isSca,
  RATING_LABELS,
  TASTE_LABEL,
  type Brew,
  type BrewInput,
  type BrewKind,
  type CoffeeDetail,
  type GrinderEvent,
  type MachineShot,
  type TasteTag,
} from "../../../shared/types.ts";
import { api } from "../api.ts";
import { brewMethod, espressoHint, lastGoodGrind, learnedK, nextShot } from "../lib/dialin.ts";
import { fmtDateShort, fromLocalDateTime, localDateTime } from "../lib/format.ts";
import { fmtShotTime, mid, tenth, yieldOf } from "../../../shared/shot.ts";
import { ShotPanel } from "../ui/ShotPanel.tsx";
import { useShotTarget } from "../ui/ShotTarget.tsx";
import { Button, cx, Segmented, Stepper } from "../ui/controls.tsx";
import { compassLine, DialHintBox, fmtG, fmtU, PredictionDetails, predictionText, useGrinderProfile, useGrindPrediction } from "../ui/DialIn.tsx";
import { GrindDial, type DialMark } from "../ui/GrindDial.tsx";
import { eventGrind, GrinderCard, useGrinderEvents } from "../ui/GrinderSync.tsx";
import { MachineCard, useMachineShots } from "../ui/DecentShot.tsx";
import { pairGrinds } from "../../../shared/pairing.ts";
import { StarInput, TastePicker } from "../ui/Stars.tsx";
import { Radar } from "../ui/charts.tsx";
import { Group, NumField, Row, SelectField, TextArea, TextField, TimeField } from "../ui/form.tsx";
import { confirmDialog, Sheet, toast } from "../ui/overlay.tsx";
import { recipeMethod, roasterRecipeName } from "../ui/RoasterRecipes.tsx";

const fmtQ = (v: number) => v.toFixed(2).replace(".", ",");
const NOTE_ID = new Map(FLAVOR_NOTES.map((n) => [`${n.category}|${n.label}`, n.id]));

export function gradeClass(total: number) {
  const t = scoreGrade(total).tone;
  return t === "top" || t === "great" ? "text-good" : t === "low" ? "text-ink3" : "text-ink2";
}

/** Sinnvolle Vorbelegung für einen neuen Bezug */
function defaultBatchId(d: CoffeeDetail): number | null {
  const open = d.batches.find((b) => b.status === "offen");
  if (open) return open.id;
  const sorted = [...d.batches].sort((a, b) => (b.roast_date ?? b.created_at).localeCompare(a.roast_date ?? a.created_at));
  return sorted.find((b) => b.status !== "leer")?.id ?? sorted[0]?.id ?? null;
}

// Zuletzt gewählte Bewertungsart, für neue Bezüge eines Kaffees ohne eigene Bezüge
const KIND_KEY = "kb.brewKind";
function readKind(): BrewKind {
  try {
    return localStorage.getItem(KIND_KEY) === "quick" ? "quick" : "sca";
  } catch {
    return "sca";
  }
}
function writeKind(k: BrewKind) {
  try {
    localStorage.setItem(KIND_KEY, k);
  } catch {
    /* privates Fenster */
  }
}

/** `time_s` ist die Bezugszeit ohne Preinfusion, `preinfusion_s` getrennt (nur Espresso) */
type Params = { dose_g: number | null; water_g: number | null; temp_c: number | null; grind: string; time_s: number | null; preinfusion_s?: number | null };

/** Werte eines Mahlvorgangs über die Parameter legen; Ausbeute nur bei espressoartigem Verhältnis (sonst wäre sie das Brühwasser) */
function withEvent(p: Params, e: GrinderEvent | null): Params {
  if (!e) return p;
  const dose = e.dose_g ?? p.dose_g;
  return {
    ...p,
    dose_g: dose,
    grind: eventGrind(e) ?? p.grind,
    water_g: e.yield_g != null && dose && e.yield_g / dose <= 5 ? e.yield_g : p.water_g,
    time_s: e.shot_s != null ? tenth(e.shot_s) : p.time_s,
  };
}
/** Werte eines Decent-Shots darüber: Preinfusion und Bezugszeit getrennt, Temperatur, Ausbeute (nur espressoartig); Dosis nur, wenn sie fehlt (in der de1app oft veraltet) */
function withShot(p: Params, s: MachineShot | null): Params {
  if (!s) return p;
  const dose = p.dose_g ?? s.dose_g;
  return {
    ...p,
    dose_g: dose,
    water_g: s.yield_g != null && dose && s.yield_g / dose <= 5 ? s.yield_g : p.water_g,
    temp_c: s.temp_c ?? p.temp_c,
    time_s: s.time_s != null ? tenth(s.time_s - (s.preinfusion_s ?? 0)) : p.time_s,
    preinfusion_s: s.preinfusion_s != null ? tenth(s.preinfusion_s) : p.preinfusion_s,
  };
}
/** Mahlvorgang, der beim Öffnen eines neuen Bezugs noch als „gerade eben“ gilt */
const FRESH_MS = 90 * 60_000;

export function BrewSheet({
  open,
  onClose,
  detail,
  brew,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  detail: CoffeeDetail;
  brew: Brew | null;
  /** Index eines Röster-Rezepts, dessen Werte der neue Bezug übernimmt */
  preset?: number | null;
}) {
  if (!open) return null;
  // neuer Zustand, wenn aus dem Bearbeiten direkt ein neuer Bezug wird (oder umgekehrt)
  return <BrewSheetBody key={brew?.id ?? "neu"} onClose={onClose} detail={detail} brew={brew} preset={brew ? null : (preset ?? null)} />;
}

function BrewSheetBody({ onClose, detail, brew, preset }: { onClose: () => void; detail: CoffeeDetail; brew: Brew | null; preset: number | null }) {
  const qc = useQueryClient();
  const { data: allRecipes = [] } = useQuery({ queryKey: ["recipes"], queryFn: api.recipes });
  const coffee = detail.coffee;
  const lastBrew = useMemo(
    () => [...detail.brews].sort((a, b) => b.brewed_at.localeCompare(a.brewed_at))[0] ?? null,
    [detail.brews],
  );

  const recipes = useMemo(
    () => allRecipes.filter((r) => !r.archived || r.id === brew?.recipe_id),
    [allRecipes, brew?.recipe_id],
  );

  // Röster-Rezept: schon als eigenes Rezept gespeichert (gleicher Name) oder wird beim Sichern angelegt
  const roasterPick = (i: number) => {
    const r = coffee.roaster_recipes[i];
    const name = roasterRecipeName(coffee, r);
    const own = allRecipes.find((x) => x.name === name);
    return {
      recipeId: own ? own.id : ("new" as const),
      fromRoaster: own ? null : i,
      name,
      method: recipeMethod(r.method),
      p: { dose_g: r.dose_g, water_g: r.water_g, temp_c: r.temp_c, grind: r.grind, time_s: r.time_s },
    };
  };
  const pre = preset != null && coffee.roaster_recipes[preset] ? roasterPick(preset) : null;

  const initialRecipe: number | "none" | "new" = pre
    ? pre.recipeId
    : brew
      ? (brew.recipe_id ?? "none")
      : lastBrew?.recipe_id && !allRecipes.find((r) => r.id === lastBrew.recipe_id)?.archived
        ? lastBrew.recipe_id
        : "none";

  const [batchId, setBatchId] = useState<number | null>(brew ? brew.batch_id : defaultBatchId(detail));
  const [recipeId, setRecipeId] = useState<number | "none" | "new">(initialRecipe);
  const [fromRoaster, setFromRoaster] = useState<number | null>(pre?.fromRoaster ?? null);
  const [newName, setNewName] = useState(pre?.name ?? "");
  const [newMethod, setNewMethod] = useState<string>(pre?.method ?? (coffee.roast_for === "espresso" ? "Espresso" : "V60"));
  const [brewedAt, setBrewedAt] = useState(localDateTime(brew?.brewed_at));
  const src = brew ?? lastBrew;
  // Die Zeit ist ein Ergebnis, kein Parameter: neu nur die des Rezepts (wie bei der Rezeptwahl), nie die des letzten Bezugs.
  // Sonst landet sie ungeprüft im Bezug und das Mahlgrad-Modell lernt aus einer Zeit, die es nie gab
  const initialTime = brew ? brew.time_s : typeof initialRecipe === "number" ? (allRecipes.find((r) => r.id === initialRecipe)?.time_s ?? null) : null;
  const [p, setP] = useState<Params>(
    pre?.p ?? {
      dose_g: src?.dose_g ?? null,
      water_g: src?.water_g ?? null,
      temp_c: src?.temp_c ?? null,
      grind: src?.grind ?? "",
      time_s: initialTime,
      preinfusion_s: brew?.preinfusion_s ?? null,
    },
  );
  const [kind, setKind] = useState<BrewKind>(brew ? brew.kind : (lastBrew?.kind ?? readKind()));
  const [scores, setScores] = useState<Scores>(brew?.scores ?? defaultScores());
  // Sterne sind freiwillig: neu ohne, beim Wechsel vom Bogen grob aus dem Score
  const [rating, setRating] = useState<number | null>(brew?.rating ?? (brew?.total != null ? Math.max(1, Math.min(5, Math.round((brew.total - 72) / 4))) : null));
  const [taste, setTaste] = useState<TasteTag[]>(brew?.taste ?? []);
  // Mahlgrad nur vorschlagen, solange er nicht von Hand geändert wurde
  const grindTouched = useRef(Boolean(brew));
  const [flavors, setFlavors] = useState<string[]>(brew?.flavors ?? []);
  const [comment, setComment] = useState(brew?.comment ?? "");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [tabCat, setTabCat] = useState<string>(
    () => FLAVOR_BY_ID.get((brew?.flavors ?? [])[0] ?? "")?.category ?? FLAVOR_WHEEL[0].id,
  );
  const [saving, setSaving] = useState(false);

  // ---------- Mühle (Mahlkönig Sync) ----------
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const synced = settings?.mahlkoenig.set ?? false;
  const [eventId, setEventId] = useState<number | null>(brew?.grinder_event_id ?? null);
  // neu: die letzten 12 Stunden; bearbeiten: ±6 Stunden um den Bezug
  const [eventQuery] = useState(() =>
    brew ? { around: brew.brewed_at, hours: 6 } : { since: new Date(Date.now() - 12 * 3_600_000).toISOString() },
  );
  const grinderQ = useGrinderEvents(synced || brew?.grinder_event_id != null, eventQuery);
  const events = grinderQ.data?.events ?? [];
  const eventOf = (id: number | null) => (id == null ? null : (events.find((e) => e.id === id) ?? null));
  // Stand vor der Übernahme, für „Rückgängig“; nach einem Rückgängig nichts mehr selbst übernehmen
  const beforeEvent = useRef<{ p: Params; brewedAt: string; touched: boolean } | null>(null);
  const autoOff = useRef(Boolean(brew));
  // `shot`: der Shot, der danach gilt (beim Paaren der neue, nicht der bisher gewählte)
  const applyEvent = (e: GrinderEvent, shot: MachineShot | null = shotOf(shotId)) => {
    if (!beforeEvent.current) beforeEvent.current = { p, brewedAt, touched: grindTouched.current };
    setEventId(e.id);
    setP((cur) => withShot(withEvent(cur, e), shot));
    if (e.grind_um != null) grindTouched.current = true;
    setBrewedAt(localDateTime(shot?.shot_at ?? e.brewed_at ?? e.ground_at));
  };
  // Rückgängig nimmt nur die Werte der Mühle weg: ein weiter verknüpfter Shot gilt danach wieder (der Stand davor kann ohne ihn sein)
  const undoEvent = () => {
    const b = beforeEvent.current;
    if (b) {
      const s = shotOf(shotId);
      setP(withShot(b.p, s));
      setBrewedAt(s ? localDateTime(s.shot_at) : b.brewedAt);
      grindTouched.current = b.touched;
    }
    beforeEvent.current = null;
    autoOff.current = true;
    setEventId(null);
  };
  const releaseEvent = () => {
    autoOff.current = true;
    beforeEvent.current = null;
    setEventId(null);
  };
  // ---------- Maschine (Decent DE1) ----------
  const hasDecent = (settings?.decent.shots ?? 0) > 0;
  const [shotId, setShotId] = useState<number | null>(brew?.machine_shot_id ?? null);
  const shotsQ = useMachineShots(hasDecent || brew?.machine_shot_id != null, eventQuery);
  const shots = shotsQ.data?.shots ?? [];
  function shotOf(id: number | null) {
    return id == null ? null : (shots.find((s) => s.id === id) ?? null);
  }
  const beforeShot = useRef<{ p: Params; brewedAt: string } | null>(null);
  const shotAutoOff = useRef(Boolean(brew));
  const applyShot = (s: MachineShot) => {
    if (!beforeShot.current) beforeShot.current = { p, brewedAt };
    setShotId(s.id);
    setP((cur) => withShot(cur, s));
    setBrewedAt(localDateTime(s.shot_at));
  };
  // wie bei der Mühle: ein weiter verknüpfter Mahlvorgang bleibt
  const undoShot = () => {
    const b = beforeShot.current;
    if (b) {
      const e = eventOf(eventId);
      setP(withEvent(b.p, e));
      setBrewedAt(e ? localDateTime(e.brewed_at ?? e.ground_at) : b.brewedAt);
    }
    beforeShot.current = null;
    shotAutoOff.current = true;
    setShotId(null);
  };
  const releaseShot = () => {
    shotAutoOff.current = true;
    beforeShot.current = null;
    setShotId(null);
  };
  // Mühle und Maschine über die Zeit paaren (`shared/pairing.ts`): zum Shot gehört der Mahlvorgang direkt davor. Wer eins wählt, bekommt
  // das andere dazu, solange es frei ist und dort nicht „Rückgängig“ oder „Lösen“ gedrückt wurde
  const pairs = useMemo(() => pairGrinds(events, shots), [events, shots]);
  const free = (x: { brew_id: number | null }) => x.brew_id == null || x.brew_id === brew?.id;
  const fresh = (at: string) => Date.now() - Date.parse(at) < FRESH_MS;
  const pairedEvent = (shot: number) => events.find((e) => e.id === pairs.grindOfShot.get(shot) && free(e)) ?? null;
  const pairedShot = (event: number) => shots.find((s) => s.id === pairs.shotOfGrind.get(event) && free(s)) ?? null;
  function pickEvent(e: GrinderEvent) {
    applyEvent(e);
    const s = pairedShot(e.id);
    if (s && !shotAutoOff.current && s.id !== shotId) applyShot(s);
  }
  function pickShot(s: MachineShot) {
    applyShot(s);
    const e = pairedEvent(s.id);
    if (e && !autoOff.current && e.id !== eventId) applyEvent(e, s);
  }
  // Neuer Bezug: den jüngsten freien Shot der letzten 90 Minuten übernehmen, auch wenn er erst bei offenem Dialog ankommt
  const freshShot = shots.find((s) => s.brew_id == null && fresh(s.shot_at)) ?? null;
  // Mahlvorgang: der zum gewählten (oder gleich gewählten) Shot; ohne Shot der jüngste freie, der zu keinem Shot gehört (der kommt
  // vielleicht noch). Gehört er zu einem Shot ohne Partner, nie raten
  const anchor = shotId ?? freshShot?.id ?? null;
  const freshEvent =
    anchor != null
      ? (() => {
          const e = pairedEvent(anchor);
          return e && e.brew_id == null && fresh(e.ground_at) ? e : null;
        })()
      : (events.find((e) => e.brew_id == null && fresh(e.ground_at) && !pairs.shotOfGrind.has(e.id)) ?? null);
  // Neuer Bezug: Mahlvorgang übernehmen, auch wenn er erst kommt, während der Dialog offen ist (welcher: siehe freshEvent)
  useEffect(() => {
    if (!freshEvent || autoOff.current || eventId != null) return;
    pickEvent(freshEvent);
    toast(`Von der Mühle übernommen: ${[eventGrind(freshEvent) && `${eventGrind(freshEvent)} µm`, freshEvent.dose_g != null && `${String(freshEvent.dose_g).replace(".", ",")} g`].filter(Boolean).join(", ")}`);
  }, [freshEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!freshShot || shotAutoOff.current || shotId != null) return;
    pickShot(freshShot);
    toast(`Von der Maschine übernommen: ${[freshShot.time_s != null && fmtShotTime(freshShot.time_s - (freshShot.preinfusion_s ?? 0), freshShot.preinfusion_s), freshShot.yield_g != null && `${String(freshShot.yield_g).replace(".", ",")} g`].filter(Boolean).join(", ")}`);
  }, [freshShot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = totalScore(scores);
  const grade = scoreGrade(total);
  const recipe = typeof recipeId === "number" ? allRecipes.find((r) => r.id === recipeId) : undefined;

  // ---------- Einstellhilfe ----------
  // Zubereitung: Rezeptmethode, ohne Rezept nach Verhältnis (bis 1:5 Espresso), sonst nach „Geröstet für“
  const method = methodKey(recipeId === "new" ? newMethod : (recipe?.method ?? null), coffee.roast_for, brewRatio(p));
  const espresso = method === "Espresso";
  const profile = useGrinderProfile(recipeId === "new" ? "" : (recipe?.grinder ?? ""));
  const others = useMemo(() => detail.brews.filter((b) => b.id !== brew?.id), [detail.brews, brew?.id]);
  const good = lastGoodGrind(others, batchId, method, allRecipes, coffee);
  const bagBrews = others
    .filter((b) => b.batch_id === batchId && batchId != null && brewMethod(b, allRecipes, coffee) === method)
    .sort((a, b) => b.brewed_at.localeCompare(a.brewed_at));
  const lastBag = bagBrews[0] ?? null;
  const freshBag = batchId != null && bagBrews.length === 0;
  const target = useShotTarget(coffee);
  const grindQ = useGrindPrediction({ coffee_id: coffee.id, batch_id: batchId, method, grinder: recipe?.grinder ?? "" }, !brew || profile != null);
  const pred = grindQ.data?.prediction ?? null;
  const k = learnedK(pred);
  const hint = espresso && !brew ? espressoHint(lastBag, target, k, profile) : null;
  // Tipp wie „Nächster Shot“ am Kaffee: Zeit über k zur Fenstermitte, im Fenster zuerst der Geschmack (k erst abwarten)
  const kReady = grindQ.data !== undefined || grindQ.isError || grindQ.fetchStatus === "idle";
  const next = espresso && !brew && kReady ? nextShot(bagBrews, hint, target, k, profile) : null;
  // Shot-Analyse: derselbe „Nächste Shot“, mit eingetragener Zeit vom gerade bewerteten Shot aus (Geschmack, Ausbeute, Preinfusion zählen mit)
  const nowBrew: Brew | null =
    espresso && p.time_s != null
      ? ({
          ...(brew ?? lastBag ?? {}),
          id: -1,
          batch_id: batchId,
          brewed_at: brew?.brewed_at ?? new Date().toISOString(),
          dose_g: p.dose_g,
          water_g: p.water_g,
          temp_c: p.temp_c,
          grind: p.grind,
          time_s: p.time_s,
          preinfusion_s: p.preinfusion_s ?? null,
          kind,
          rating,
          total: kind === "sca" ? total : null,
          taste,
        } as Brew)
      : null;
  const shotNext = nowBrew && kReady ? nextShot([nowBrew, ...bagBrews], espressoHint(nowBrew, target, k, profile), target, k, profile) : next;
  // auch bei „Bleib dabei“ der Mahlgrad des letzten Shots, nicht ein älterer guter: sonst widerspricht der Dialog der Karte
  const tip = next?.value ?? null;
  const template = grindQ.data?.template ?? null;
  const unit = profile?.unit ?? "";
  // Vorschlag, in dieser Reihenfolge: Nächster Shot aus dem letzten Shot der Tüte (Espresso), letzter gelungener Mahlgrad der Tüte,
  // für eine frische Tüte der Startwert (Mahlkompass, mit Daten plus deine Abweichung)
  const suggestion: { grind: string; label: string } | null = brew
    ? null
    : tip != null
      ? {
          grind: fmtG(tip),
          label: next?.stay
            ? `Wie der letzte Shot (${hint?.title.toLowerCase() ?? "im Zeitfenster"})`
            : `Tipp aus dem letzten Shot (${next?.why === "zeit" ? "zur Fenstermitte" : hint?.title.toLowerCase()})`,
        }
      : good
        ? { grind: good.grind, label: `Letzter guter Mahlgrad dieser Tüte (${fmtDateShort(good.brewed_at)})` }
        : pred && (freshBag || batchId == null)
          ? { grind: fmtG(pred.value), label: pred.compass ? (pred.basis === "kompass" ? "Mahlkompass" : "Mahlkompass mit deiner Abweichung") : `Startwert für diese Tüte, ${predictionText(pred)}` }
          : null;
  useEffect(() => {
    if (!suggestion || grindTouched.current) return;
    setP((cur) => (cur.grind === suggestion.grind ? cur : { ...cur, grind: suggestion.grind }));
  }, [suggestion?.grind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Erster Bezug eines Kaffees: Dosis, Wasser, Temperatur vom letzten Bezug derselben Zubereitung (anderer Kaffee)
  const templated = useRef(Boolean(brew || pre || src));
  useEffect(() => {
    if (!template || templated.current) return;
    templated.current = true;
    setP((cur) => ({
      ...cur,
      dose_g: cur.dose_g ?? template.dose_g,
      water_g: cur.water_g ?? template.water_g,
      temp_c: cur.temp_c ?? template.temp_c,
    }));
  }, [template]);

  // Espresso ohne Werte (erster Bezug, kein Rezept): Dosis und Ausbeute aus dem Ziel des Kaffees
  const targeted = useRef(Boolean(brew || pre));
  useEffect(() => {
    if (!espresso || targeted.current || recipe) return;
    targeted.current = true;
    setP((cur) =>
      cur.dose_g != null || cur.water_g != null ? cur : { ...cur, dose_g: target.dose_g, water_g: yieldOf(target.dose_g, mid(target.ratio)) },
    );
  }, [espresso, target.dose_g, target.ratio[0], target.ratio[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Markierungen am Regler
  const marks: DialMark[] = [];
  if (profile) {
    if (pred) marks.push({ value: pred.value, kind: "kompass", label: pred.basis === "kompass" ? "Kompass" : "Kompass + du" });
    if (tip != null) marks.push({ value: tip, kind: "tip", label: "Tipp" });
    const g = good ? grindNumber(good.grind) : null;
    if (g != null) marks.push({ value: g, kind: "good", label: "Zuletzt gut" });
    const l = lastBag ? grindNumber(lastBag.grind) : null;
    if (l != null && lastBag !== good) marks.push({ value: l, kind: "last", label: "Letzter" });
  }
  const setGrind = (v: string) => {
    grindTouched.current = true;
    setP((cur) => ({ ...cur, grind: v }));
  };

  const pickRecipe = (v: number | "none" | "new" | `roaster:${number}`) => {
    if (typeof v === "string" && v.startsWith("roaster:")) {
      const r = roasterPick(Number(v.slice(8)));
      setRecipeId(r.recipeId);
      setFromRoaster(r.fromRoaster);
      setNewName(r.name);
      setNewMethod(r.method);
      // wie bei eigenen Rezepten: Preinfusion bleibt, der vorgeschlagene Mahlgrad gilt, solange keiner von Hand gesetzt ist
      const grind = suggestion && !grindTouched.current ? suggestion.grind : r.p.grind;
      setP(withShot(withEvent({ ...r.p, grind, preinfusion_s: p.preinfusion_s }, eventOf(eventId)), shotOf(shotId)));
      return;
    }
    if (v === "new" && fromRoaster != null) setNewName("");
    setFromRoaster(null);
    setRecipeId(v as number | "none" | "new");
    if (typeof v === "number") {
      const r = allRecipes.find((x) => x.id === v);
      if (r)
        setP(
          withShot(
            withEvent(
              { dose_g: r.dose_g, water_g: r.water_g, temp_c: r.temp_c, grind: suggestion && !grindTouched.current ? suggestion.grind : r.grind, time_s: r.time_s,
                preinfusion_s: p.preinfusion_s },
              eventOf(eventId),
            ),
            shotOf(shotId),
          ),
        );
    }
  };

  const batchOptions = [
    { value: 0, label: "Keine Charge" },
    ...[...detail.batches]
      .sort((a, b) => (b.roast_date ?? b.created_at).localeCompare(a.roast_date ?? a.created_at))
      .map((b) => {
        const day = bagAge(b, fromLocalDateTime(brewedAt));
        return {
          value: b.id,
          label: `${b.roast_date ? `Röstung ${fmtDateShort(b.roast_date)}` : b.status === "leer" ? "Ohne Röstdatum" : `Charge vom ${fmtDateShort(b.created_at)}`}${
            day != null && day >= 0 ? ` · Tag ${day}` : ""
          }`,
        };
      }),
  ];
  const recipeOptions: { value: string; label: string }[] = [
    { value: "none", label: "Ohne Rezept" },
    ...recipes.map((r) => ({ value: String(r.id), label: r.method && r.method !== r.name ? `${r.name} · ${r.method}` : r.name })),
    // Röster-Rezepte, die noch nicht als eigenes Rezept gespeichert sind
    ...coffee.roaster_recipes.flatMap((r, i) =>
      allRecipes.some((x) => x.name === roasterRecipeName(coffee, r)) ? [] : [{ value: `roaster:${i}`, label: `Vom Röster: ${r.title || r.method}` }],
    ),
    { value: "new", label: "Neues Rezept aus diesen Werten …" },
  ];

  const save = async () => {
    if (recipeId === "new" && !newName.trim()) return toast("Bitte dem neuen Rezept einen Namen geben", "error");
    if (kind === "quick" && !taste.length && rating == null) return toast("Wie war er? Kurzurteil wählen (oder Sterne)", "error");
    setSaving(true);
    try {
      let recipe_id: number | null = typeof recipeId === "number" ? recipeId : null;
      // Röster-Rezept, das inzwischen unter diesem Namen gespeichert ist, nicht doppelt anlegen
      const same = fromRoaster != null ? allRecipes.find((r) => r.name === newName.trim()) : undefined;
      if (same) recipe_id = same.id;
      else if (recipeId === "new") {
        const r = await api.createRecipe({
          name: newName.trim(),
          method: newMethod,
          dose_g: p.dose_g,
          water_g: p.water_g,
          temp_c: p.temp_c,
          grind: p.grind.trim(),
          grinder: "",
          time_s: p.time_s,
          notes: fromRoaster != null ? (coffee.roaster_recipes[fromRoaster]?.notes ?? "") : "",
          archived: false,
        });
        recipe_id = r.id;
      }
      const input: BrewInput = {
        coffee_id: coffee.id,
        batch_id: batchId,
        recipe_id,
        brewed_at: fromLocalDateTime(brewedAt),
        dose_g: p.dose_g,
        water_g: p.water_g,
        temp_c: p.temp_c,
        grind: p.grind.trim(),
        time_s: p.time_s,
        preinfusion_s: espresso ? (p.preinfusion_s ?? null) : null,
        grinder_event_id: eventId,
        machine_shot_id: shotId,
        kind,
        scores: kind === "sca" ? scores : null,
        rating: kind === "quick" ? rating : null,
        taste,
        flavors,
        comment: comment.trim(),
      };
      writeKind(kind);
      if (brew) await api.updateBrew(brew.id, input);
      else await api.createBrew(input);
      await Promise.all(
        [["coffee", coffee.id], ["coffees"], ["recipes"], ["stats"], ["grinder"]].map((k) => qc.invalidateQueries({ queryKey: k })),
      );
      toast(
        brew
          ? "Bezug gesichert"
          : kind === "sca"
            ? `Bezug bewertet: ${formatScore(total)}`
            : rating != null
              ? `Bezug bewertet: ${rating} ${rating === 1 ? "Stern" : "Sterne"}`
              : `Bezug gesichert: ${taste.map((t) => TASTE_LABEL.get(t) ?? t).join(", ")}`,
      );
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!brew) return;
    const ok = await confirmDialog({ title: "Bezug löschen?", message: "Die Bewertung wird endgültig entfernt.", confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    try {
      await api.deleteBrew(brew.id);
      await Promise.all([["coffee", coffee.id], ["coffees"], ["recipes"], ["stats"], ["grinder"]].map((k) => qc.invalidateQueries({ queryKey: k })));
      toast("Bezug gelöscht");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Löschen fehlgeschlagen", "error");
    }
  };

  const setScore = (k: keyof Scores, v: number) => setScores((s) => ({ ...s, [k]: v }));
  const toggleFlavor = (id: string) => setFlavors((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const prevBrew = useMemo(
    () =>
      [...detail.brews]
        .filter(isSca)
        .filter((b) => b.id !== brew?.id && (typeof recipeId === "number" ? b.recipe_id === recipeId : true))
        .sort((a, b) => b.brewed_at.localeCompare(a.brewed_at))[0] ?? null,
    [detail.brews, brew?.id, recipeId],
  );
  const qualitySum = QUALITY_KEYS.reduce((a, k) => a + scores[k], 0);
  const cupSum = CUP_KEYS.reduce((a, k) => a + scores[k], 0);

  return (
    <Sheet open onClose={onClose} title={brew ? "Bezug bearbeiten" : "Bezug bewerten"} onSave={() => void save()} saving={saving} width={1240}>
      <div className="@container flex flex-col gap-8">
        <div className="-mb-3 flex min-w-0 flex-col gap-0.5 px-1">
          {coffee.roaster && <span className="truncate text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">{coffee.roaster}</span>}
          <span className="truncate text-[20px] font-extrabold tracking-[-0.01em]">{coffee.name}</span>
        </div>

        {/* Schritt für Schritt: Rezept und Parameter, dann Mahlgrad, dann wie er lief und schmeckte */}
        <Step n={1} title="Rezept und Parameter">
          {(synced || eventId != null) && (
            <GrinderCard
              events={events}
              status={grinderQ.data?.status ?? null}
              loading={grinderQ.isFetching}
              selected={eventId}
              brewId={brew?.id ?? null}
              onPick={pickEvent}
              onUndo={undoEvent}
              onRelease={releaseEvent}
              canUndo={beforeEvent.current != null}
            />
          )}
          {(hasDecent || shotId != null) && (
            <MachineCard
              shots={shots}
              loading={shotsQ.isFetching}
              selected={shotId}
              brewId={brew?.id ?? null}
              onPick={pickShot}
              onUndo={undoShot}
              onRelease={releaseShot}
              canUndo={beforeShot.current != null}
            />
          )}
          <div className="grid items-start gap-6 @3xl:grid-cols-2 @3xl:gap-4">
            <Group title="Zubereitung">
              <Row label="Charge" htmlFor="bs-batch">
                <SelectField id="bs-batch" value={batchId ?? 0} onChange={(v) => setBatchId(v === 0 ? null : v)} options={batchOptions} />
              </Row>
              <Row label="Rezept" htmlFor="bs-recipe">
                <SelectField
                  id="bs-recipe"
                  value={fromRoaster != null && recipeId === "new" ? `roaster:${fromRoaster}` : String(recipeId)}
                  onChange={(v) => pickRecipe(v === "none" || v === "new" || v.startsWith("roaster:") ? (v as `roaster:${number}`) : Number(v))}
                  options={recipeOptions}
                />
              </Row>
              {recipeId === "new" && (
                <>
                  <Row label="Rezeptname" htmlFor="bs-rname">
                    <TextField id="bs-rname" value={newName} onChange={setNewName} placeholder="z. B. V60 hell 1:16" autoFocus />
                  </Row>
                  <Row label="Methode" htmlFor="bs-rmethod">
                    <SelectField id="bs-rmethod" value={newMethod} onChange={setNewMethod} options={BREW_METHODS.map((m) => ({ value: m, label: m }))} />
                  </Row>
                </>
              )}
              <Row label="Zeitpunkt" htmlFor="bs-at">
                <input
                  id="bs-at"
                  type="datetime-local"
                  value={brewedAt}
                  onChange={(e) => setBrewedAt(e.target.value)}
                  className="field h-9 w-auto text-right text-[15px]"
                />
              </Row>
            </Group>

            <Group
              title="Parameter"
              footer={
                recipe
                  ? "Vom Rezept übernommen; Abweichungen gelten nur für diesen Bezug."
                  : fromRoaster != null && recipeId === "new"
                    ? "Vom Röster übernommen. Beim Sichern entsteht daraus ein eigenes Rezept."
                    : undefined
              }
            >
              <Row label="Dosis" htmlFor="bs-dose">
                <NumField id="bs-dose" value={p.dose_g} onChange={(v) => setP({ ...p, dose_g: v })} suffix="g" />
              </Row>
              <Row label={espresso ? "Ausbeute" : "Wasser"} htmlFor="bs-water">
                <NumField
                  id="bs-water"
                  value={p.water_g}
                  onChange={(v) => setP({ ...p, water_g: v })}
                  suffix="g"
                  placeholder={espresso ? String(yieldOf(p.dose_g ?? target.dose_g, mid(target.ratio))) : undefined}
                />
              </Row>
              <Row label="Temperatur" htmlFor="bs-temp">
                <NumField id="bs-temp" value={p.temp_c} onChange={(v) => setP({ ...p, temp_c: v })} suffix="°C" />
              </Row>
            </Group>
          </div>
        </Step>

        <Step n={2} title="Mahlgrad">
          <div className="grid items-start gap-6 @3xl:grid-cols-2 @3xl:gap-4">
            {profile ? (
              <Group
                footer={
                  suggestion && !brew ? (
                    <span className="flex flex-col gap-0.5">
                      <span>
                        Vorgeschlagen: {suggestion.label}, <span className="tnum font-bold text-ink">{fmtU(grindNumber(suggestion.grind) ?? 0, unit)}</span>
                        {pred?.compass?.rough ? " (grobe Orientierung, Filterwerte sind geschätzt)" : ""}
                      </span>
                      {suggestion.label.startsWith("Mahlkompass") && pred && compassLine(pred) && <span className="text-ink3">{compassLine(pred)}</span>}
                    </span>
                  ) : undefined
                }
              >
                <GrindDial
                  id="bs-grind"
                  value={grindNumber(p.grind)}
                  onChange={(v) => setGrind(fmtG(v))}
                  profile={profile}
                  method={method}
                  marks={marks}
                  range={pred?.range ?? null}
                />
              </Group>
            ) : (
              <Group>
                <Row label="Mahlgrad" htmlFor="bs-grind">
                  <TextField id="bs-grind" value={p.grind} onChange={setGrind} placeholder="z. B. 22 Klicks" />
                </Row>
                {suggestion && (
                  <div className="flex flex-col gap-1.5 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink2">
                        {suggestion.label}: <span className="tnum font-bold text-ink">{suggestion.grind}</span>
                      </span>
                      {p.grind.trim() !== suggestion.grind && (
                        <Button size="sm" variant="plain" onClick={() => setGrind(suggestion.grind)}>
                          Übernehmen
                        </Button>
                      )}
                    </div>
                    {!good && pred && <PredictionDetails p={pred} />}
                  </div>
                )}
              </Group>
            )}
            {hint && (
              <section className="flex flex-col gap-1.5">
                <h3 className="m-0 px-1 pb-0.5 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Tipp aus dem letzten Shot dieser Tüte</h3>
                <DialHintBox hint={hint} compact next={tip != null ? fmtU(tip, unit) : null} />
              </section>
            )}
          </div>
        </Step>

        <Step
          n={3}
          title="Wie lief er?"
          aside={
            <Segmented
              label="Bewertungsart"
              value={kind}
              onChange={setKind}
              options={[
                { id: "quick", label: "Schnell" },
                { id: "sca", label: "SCA-Bogen" },
              ]}
            />
          }
        >
          <div className="grid items-start gap-6 @3xl:grid-cols-2 @3xl:gap-4">
            <Group title="Zeit" className="order-1">
              <Row label={espresso ? "Bezugszeit" : "Brühzeit"} htmlFor="bs-time">
                <TimeField id="bs-time" seconds={espresso} value={p.time_s} onChange={(v) => setP({ ...p, time_s: v })} />
              </Row>
              {espresso && (
                <Row label="Preinfusion" htmlFor="bs-pi">
                  <TimeField id="bs-pi" seconds value={p.preinfusion_s ?? null} onChange={(v) => setP({ ...p, preinfusion_s: v })} />
                </Row>
              )}
            </Group>
            <Group
              className="order-3 @3xl:order-2"
              title={kind === "quick" ? "Wie war er?" : "Kurzurteil"}
              footer={
                kind === "quick"
                  ? "Kurzurteil reicht, Sterne und Aromen nach Lust. Zählt getrennt: nicht im SCA-Score, in Bestenliste und Statistik-Schnitt."
                  : "Optional. Hilft beim Einstellen: zu sauer heißt meist feiner mahlen, zu bitter gröber."
              }
            >
              <div className="px-4 py-3">
                <TastePicker value={taste} onChange={setTaste} />
              </div>
              {kind === "quick" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="text-[12px] font-bold tracking-[0.06em] text-ink3 uppercase">Sterne</span>
                  <StarInput value={rating} onChange={setRating} size={22} />
                  <span className="text-[13px] font-semibold text-ink3" aria-live="polite">
                    {rating != null ? RATING_LABELS[rating] : "freiwillig"}
                  </span>
                </div>
              )}
            </Group>
            {espresso && (
              <div className="order-2 min-w-0 @3xl:order-3 @3xl:col-span-2">
                <ShotPanel target={target} p={p} bag={bagBrews} profile={profile} k={k} next={shotNext} />
              </div>
            )}
          </div>

          {kind === "sca" && (
            <section className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
              <div className="flex flex-col gap-5 rounded-[18px] bg-card p-5 shadow-card">
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">SCA-Score</span>
                    <div className="flex items-baseline gap-3">
                      <span className="tnum font-display text-[52px] leading-none font-extrabold tracking-[-0.035em]" aria-live="polite">
                        {formatScore(total)}
                      </span>
                      <span className={cx("text-[14px] font-bold", gradeClass(total))}>{grade.label}</span>
                    </div>
                  </div>
                  <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-[12px] bg-sep shadow-card">
                    {[
                      { k: "Qualität", v: fmtQ(qualitySum) },
                      { k: "Tassen", v: String(cupSum) },
                      { k: "Defekte", v: scores.defects ? `−${scores.defects}` : "0" },
                    ].map((x) => (
                      <div key={x.k} className="flex flex-col gap-0.5 bg-card px-3 py-2">
                        <dt className="text-[11px] font-bold tracking-[0.04em] text-ink2 uppercase">{x.k}</dt>
                        <dd className="tnum m-0 text-[15px] font-extrabold">{x.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <GradeBar total={total} />
              </div>
              <div className="hidden items-center justify-center rounded-[18px] bg-card px-3 py-4 shadow-card @3xl:flex">
                <Radar
                  axes={QUALITY_KEYS.map((k) => SCORE_LABELS[k])}
                  primary={QUALITY_KEYS.map((k) => scores[k])}
                  primaryLabel="Dieser Bezug"
                  compare={prevBrew ? QUALITY_KEYS.map((k) => prevBrew.scores[k]) : null}
                  compareLabel={prevBrew ? `Letzter Bezug (${formatScore(prevBrew.total)})` : undefined}
                />
              </div>
            </section>
          )}
        </Step>

        {/* SCA-Bogen */}
        {kind === "sca" && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 px-1 pb-0.5 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Bewertung nach SCA</h3>
          <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
            {QUALITY_KEYS.map((k) => (
              <QualityTile key={k} k={k} value={scores[k]} onChange={(v) => setScore(k, v)} />
            ))}
            <ScaleTile />
          </div>
          <div className="mt-1.5 grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
            {CUP_KEYS.map((k) => (
              <CupTile key={k} k={k} value={scores[k]} onChange={(v) => setScore(k, v)} />
            ))}
            <div className="flex flex-col gap-3 rounded-[16px] bg-card p-4 shadow-card">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-bold">Defekte</span>
                <span className="text-[12px] leading-snug text-ink2">Abzug für Fehlnoten, je Tasse 2 oder 4</span>
              </div>
              <div className="mt-auto">
                <Stepper
                  label="Defekte"
                  value={scores.defects}
                  onChange={(v) => setScore("defects", v)}
                  min={0}
                  max={40}
                  step={2}
                  format={(v) => (v === 0 ? "0" : `−${v}`)}
                />
              </div>
            </div>
          </div>
          <p className="m-0 px-1 pt-0.5 text-[12px] leading-snug text-ink2">
            Sieben Attribute je 6–10 in 0,25er-Schritten. Gleichmäßigkeit, Sauberkeit und Süße: jede Tasse zählt 2 Punkte. Defekte werden abgezogen.
          </p>
        </section>
        )}

        {/* Aromarad */}
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 px-1 pb-0.5 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Geschmacksnoten</h3>
          <div className="overflow-hidden rounded-[16px] bg-card shadow-card">
            {flavors.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-sep px-4 py-3">
                {flavors.map((id) => {
                  const n = FLAVOR_BY_ID.get(id);
                  const cat = FLAVOR_WHEEL.find((c) => c.id === n?.category);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleFlavor(id)}
                      aria-label={`${n?.label ?? id} entfernen`}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full pr-2 pl-2.5 text-[13px] font-semibold text-ink"
                      style={{ background: cat ? `color-mix(in srgb, ${cat.color} 14%, transparent)` : undefined }}
                    >
                      <span className="size-2 rounded-full" style={{ background: cat?.color }} />
                      {n?.label ?? id}
                      <span className="text-ink3">×</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Breit: Kategorien links, Noten rechts */}
            <div className="hidden @3xl:grid @3xl:grid-cols-[240px_minmax(0,1fr)]">
              <div role="tablist" aria-label="Kategorien" aria-orientation="vertical" className="flex flex-col gap-0.5 border-r border-sep p-2">
                {FLAVOR_WHEEL.map((c) => {
                  const count = flavors.filter((f) => FLAVOR_BY_ID.get(f)?.category === c.id).length;
                  const on = tabCat === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTabCat(c.id)}
                      className={cx(
                        "flex h-10 items-center gap-3 rounded-[10px] px-3 text-left text-[14px]",
                        on ? "bg-accent-soft font-bold text-ink" : "font-semibold text-ink2 hover:bg-hover hover:text-ink",
                      )}
                    >
                      <span className="size-3 shrink-0 rounded-full" style={{ background: `light-dark(${c.color}, ${c.colorDark})` }} />
                      <span className="flex-1 truncate">{c.label}</span>
                      {count > 0 && <span className="tnum rounded-full bg-card px-1.5 text-[12px] font-bold text-ink shadow-card">{count}</span>}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const c = FLAVOR_WHEEL.find((x) => x.id === tabCat) ?? FLAVOR_WHEEL[0];
                return (
                  <div role="tabpanel" aria-label={c.label} className="grid content-start gap-x-6 gap-y-5 p-5 @5xl:grid-cols-2">
                    {c.groups.map((g) => (
                      <NoteGroup key={g.label} cat={c} group={g} flavors={flavors} onToggle={toggleFlavor} />
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Schmal: Akkordeon */}
            <div className="@3xl:hidden [&>*+*]:border-t [&>*+*]:border-sep">
              {FLAVOR_WHEEL.map((c) => {
                const count = flavors.filter((f) => FLAVOR_BY_ID.get(f)?.category === c.id).length;
                const expanded = openCat === c.id;
                return (
                  <div key={c.id}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpenCat(expanded ? null : c.id)}
                      className="flex min-h-[44px] w-full items-center gap-3 px-4 text-left hover:bg-hover"
                    >
                      <span className="size-3 rounded-full" style={{ background: `light-dark(${c.color}, ${c.colorDark})` }} />
                      <span className="flex-1 text-[15px]">{c.label}</span>
                      {count > 0 && <span className="tnum text-[13px] text-ink2">{count}</span>}
                      <ChevronDown size={16} className={cx("text-ink3 transition-transform", expanded && "rotate-180")} />
                    </button>
                    {expanded && (
                      <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
                        {c.groups.map((g) => (
                          <NoteGroup key={g.label} cat={c} group={g} flavors={flavors} onToggle={toggleFlavor} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="m-0 px-1 text-[12px] leading-snug text-ink2">Aromarad nach SCA/WCR. Mehrere Noten möglich.</p>
        </section>

        <Group title="Notiz">
          <TextArea id="bs-comment" label="Notiz" value={comment} onChange={setComment} placeholder="Was ist dir aufgefallen?" rows={3} />
        </Group>

        {brew && (
          <div className="flex justify-center">
            <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
              Bezug löschen
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------- Bausteine ----------

/** Schritt im Dialog: Nummer, Titel, rechts optional ein Bedienelement */
function Step({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-extrabold text-on-accent" aria-hidden="true">
          {n}
        </span>
        <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.01em]">{title}</h2>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const clampQ = (v: number) => Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, Math.round(v / QUALITY_STEP) * QUALITY_STEP));

function QualityTile({ k, value, onChange }: { k: (typeof QUALITY_KEYS)[number]; value: number; onChange: (v: number) => void }) {
  const pct = ((value - QUALITY_MIN) / (QUALITY_MAX - QUALITY_MIN)) * 100;
  const id = `bs-${k}`;
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="text-[15px] font-bold">
            {SCORE_LABELS[k]}
          </label>
          <span className="text-[12px] leading-snug text-ink2">{SCORE_HINTS[k]}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="tnum text-[24px] leading-none font-extrabold tracking-[-0.02em]">{fmtQ(value)}</span>
          <span className="text-[11px] font-bold tracking-[0.04em] text-accent uppercase">{qualityLevel(value)}</span>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
        <TinyStep label={`${SCORE_LABELS[k]} verringern`} disabled={value <= QUALITY_MIN} onClick={() => onChange(clampQ(value - QUALITY_STEP))}>
          <Minus size={14} strokeWidth={2.6} />
        </TinyStep>
        <input
          id={id}
          type="range"
          min={QUALITY_MIN}
          max={QUALITY_MAX}
          step={QUALITY_STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`${fmtQ(value)}, ${qualityLevel(value)}`}
          className="range"
          style={{ ["--p" as string]: `${pct}%` }}
        />
        <TinyStep label={`${SCORE_LABELS[k]} erhöhen`} disabled={value >= QUALITY_MAX} onClick={() => onChange(clampQ(value + QUALITY_STEP))}>
          <Plus size={14} strokeWidth={2.6} />
        </TinyStep>
        <div className="tnum relative col-start-2 mx-[11px] h-4 text-[11px] text-ink3" aria-hidden="true">
          {[6, 7, 8, 9, 10].map((t) => (
            <span key={t} className="absolute top-0 -translate-x-1/2" style={{ left: `${((t - QUALITY_MIN) / (QUALITY_MAX - QUALITY_MIN)) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TinyStep({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full bg-fill text-ink2 hover:bg-fill2 hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** Erklärt die Stufen des Bogens; füllt das Raster der sieben Attribute auf acht Kacheln */
function ScaleTile() {
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-accent-soft p-4">
      <div className="flex items-center gap-2 text-accent">
        <Info size={16} strokeWidth={2.4} aria-hidden="true" />
        <span className="text-[15px] font-bold">Skala 6–10</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {QUALITY_LEVELS.map((l, i) => (
          <li key={l.label} className="flex items-center gap-2.5 text-[13px]">
            <span className="tnum w-[70px] shrink-0 font-bold text-ink">
              {l.min === 9 ? "9–10" : `${l.min}–${l.min},75`}
            </span>
            <span className="h-1.5 w-8 shrink-0 rounded-full bg-accent" style={{ opacity: 0.3 + i * 0.23 }} aria-hidden="true" />
            <span className="text-ink2">{l.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CupTile({ k, value, onChange }: { k: (typeof CUP_KEYS)[number]; value: number; onChange: (v: number) => void }) {
  const n = Math.round(value / 2);
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-bold">{SCORE_LABELS[k]}</span>
          <span className="text-[12px] leading-snug text-ink2">{SCORE_HINTS[k]}</span>
        </div>
        <span className="tnum shrink-0 text-[24px] leading-none font-extrabold tracking-[-0.02em]">{value}</span>
      </div>
      <div role="group" aria-label={`${SCORE_LABELS[k]}: Tassen`} className="mt-auto flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => {
          const on = i < n;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              aria-label={`Tasse ${i + 1}`}
              onClick={() => onChange((n === i + 1 ? i : i + 1) * 2)}
              className={cx(
                "flex h-9 flex-1 items-center justify-center rounded-[10px] transition-colors",
                on ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--c-accent)]" : "bg-fill text-ink4 hover:text-ink3",
              )}
            >
              <CupIcon size={16} strokeWidth={2.2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Stufenleiste 70–100 mit Marke beim aktuellen Score */
function GradeBar({ total }: { total: number }) {
  const lo = 70;
  const hi = 100;
  const pos = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100;
  const segs = [lo, ...GRADE_STEPS, hi];
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      <div className="relative h-2">
        <div className="absolute inset-0 flex gap-[2px] overflow-hidden rounded-full">
          {segs.slice(0, -1).map((a, i) => (
            <span
              key={a}
              className={cx("h-full", i === 0 ? "bg-fill2" : "bg-accent")}
              style={{ width: `${pos(segs[i + 1]) - pos(a)}%`, opacity: i === 0 ? 1 : 0.35 + i * 0.2 }}
            />
          ))}
        </div>
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card bg-ink shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] duration-200"
          style={{ left: `${pos(total)}%` }}
        />
      </div>
      <div className="tnum relative h-4 text-[11px] text-ink3">
        {GRADE_STEPS.map((s) => (
          <span key={s} className="absolute -translate-x-1/2" style={{ left: `${pos(s)}%` }}>
            {s}
          </span>
        ))}
        <span className="absolute right-0">Herausragend</span>
      </div>
    </div>
  );
}

function NoteGroup({
  cat,
  group,
  flavors,
  onToggle,
}: {
  cat: (typeof FLAVOR_WHEEL)[number];
  group: (typeof FLAVOR_WHEEL)[number]["groups"][number];
  flavors: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-bold tracking-[0.04em] text-ink2 uppercase">{group.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {group.notes.map((label) => {
          const noteId = NOTE_ID.get(`${cat.id}|${label}`);
          if (!noteId) return null;
          const on = flavors.includes(noteId);
          return (
            <button
              key={noteId}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(noteId)}
              className={cx(
                "h-[30px] rounded-full px-3 text-[13px] transition-colors",
                on ? "font-bold text-ink" : "bg-card text-ink shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2",
              )}
              style={on ? { background: `color-mix(in srgb, ${cat.color} 22%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${cat.color}` } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

