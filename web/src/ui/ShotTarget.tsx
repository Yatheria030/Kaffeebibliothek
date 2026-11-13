import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_SHOT_TARGETS,
  fmtRatio,
  fmtWindow,
  mid,
  parseShotTargets,
  shotTargetOf,
  targetLine,
  type ResolvedTarget,
  type ShotOverride,
  type ShotTarget,
  type ShotTargets,
} from "../../../shared/shot.ts";
import { ROAST_LEVELS, type Coffee } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { fmtNum } from "../lib/format.ts";
import { Button, cx } from "./controls.tsx";
import { Group, NumField, Row } from "./form.tsx";
import { Sheet, toast } from "./overlay.tsx";

/** Standards je Röstgrad aus den Einstellungen (bis sie geladen sind, die eingebauten) */
export function useShotTargets(): ShotTargets {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 5 * 60_000 });
  return data?.shot_targets ?? DEFAULT_SHOT_TARGETS;
}

export function useShotTarget(c: Pick<Coffee, "roast_level" | "shot_target">): ResolvedTarget {
  return shotTargetOf(c, useShotTargets());
}

const levelLabel = (t: ResolvedTarget) => (t.fallback ? "Standard (ohne Röstgrad wie mittel)" : `Standard ${ROAST_LEVELS.find((l) => l.id === t.level)?.label.toLowerCase()}`);

/** Woher das Ziel kommt: „eigenes“, „Standard hell“ oder gemischt */
export function targetSource(t: ResolvedTarget): string {
  if (t.own.length === 7) return "eigenes Ziel";
  if (!t.own.length) return levelLabel(t);
  const names = { dose_g: "Dosis", ratio: "Verhältnis", time: "Zeit", pi: "Preinfusion", pi_flow: "Fluss", pi_bar: "Abbruchdruck", temp: "Temperatur" } as const;
  return `${t.own.map((k) => names[k]).join(", ")} eigen, sonst ${levelLabel(t)}`;
}

/** Entwurf mit leeren Feldern (null = Standard) */
type Draft = {
  dose: number | null;
  r0: number | null;
  r1: number | null;
  t0: number | null;
  t1: number | null;
  p0: number | null;
  p1: number | null;
  fl: number | null;
  br: number | null;
  c0: number | null;
  c1: number | null;
};
const draftOf = (t: Partial<ShotOverride> | ShotTarget | null): Draft => ({
  dose: t?.dose_g ?? null,
  r0: t?.ratio?.[0] ?? null,
  r1: t?.ratio?.[1] ?? null,
  t0: t?.time?.[0] ?? null,
  t1: t?.time?.[1] ?? null,
  p0: t?.pi?.[0] ?? null,
  p1: t?.pi?.[1] ?? null,
  fl: t?.pi_flow ?? null,
  br: t?.pi_bar ?? null,
  c0: t?.temp?.[0] ?? null,
  c1: t?.temp?.[1] ?? null,
});
const pairOf = (a: number | null, b: number | null, fb: [number, number]): [number, number] | null => {
  if (a == null && b == null) return null;
  const x = a ?? fb[0];
  const y = b ?? fb[1];
  return x <= y ? [x, y] : [y, x];
};

function Range({
  id,
  label,
  a,
  b,
  onA,
  onB,
  ph,
  prefix,
  suffix,
  integer,
}: {
  id: string;
  label: string;
  a: number | null;
  b: number | null;
  onA: (v: number | null) => void;
  onB: (v: number | null) => void;
  ph: [number, number];
  prefix?: string;
  suffix: string;
  integer?: boolean;
}) {
  return (
    <span className="flex items-center justify-end gap-1.5 text-[15px]">
      {prefix && <span className="text-ink3">{prefix}</span>}
      <span className="w-[68px]">
        <NumField id={id} label={`${label} von`} value={a} onChange={onA} placeholder={fmtNum(ph[0])} integer={integer} />
      </span>
      <span className="text-ink3">–</span>
      <span className="w-[68px]">
        <NumField label={`${label} bis`} value={b} onChange={onB} placeholder={fmtNum(ph[1])} integer={integer} />
      </span>
      <span className="w-4 shrink-0 text-ink3">{suffix}</span>
    </span>
  );
}

/** Zeilen Dosis, Verhältnis, Zeit, Preinfusion (Dauer, Fluss, Abbruchdruck), Temperatur; leere Felder zeigen den Standard als Platzhalter */
function TargetRows({ id, d, set, ph }: { id: string; d: Draft; set: (d: Draft) => void; ph: ShotTarget }) {
  return (
    <>
      <Row label="Dosis" htmlFor={`${id}-dose`}>
        <span className="flex items-center justify-end gap-1.5 text-[15px]">
          <span className="w-[68px]">
            <NumField id={`${id}-dose`} value={d.dose} onChange={(v) => set({ ...d, dose: v })} placeholder={fmtNum(ph.dose_g)} />
          </span>
          <span className="w-4 shrink-0 text-ink3">g</span>
        </span>
      </Row>
      <Row label="Verhältnis" htmlFor={`${id}-r0`}>
        <Range id={`${id}-r0`} label="Verhältnis" prefix="1:" a={d.r0} b={d.r1} onA={(v) => set({ ...d, r0: v })} onB={(v) => set({ ...d, r1: v })} ph={ph.ratio} suffix="" />
      </Row>
      <Row label="Zeit" htmlFor={`${id}-t0`}>
        <Range id={`${id}-t0`} label="Zeit" a={d.t0} b={d.t1} onA={(v) => set({ ...d, t0: v })} onB={(v) => set({ ...d, t1: v })} ph={ph.time} suffix="s" integer />
      </Row>
      <Row label="Preinfusion" htmlFor={`${id}-p0`}>
        <Range id={`${id}-p0`} label="Preinfusion" a={d.p0} b={d.p1} onA={(v) => set({ ...d, p0: v })} onB={(v) => set({ ...d, p1: v })} ph={ph.pi} suffix="s" integer />
      </Row>
      <Row label="Preinfusion Fluss" htmlFor={`${id}-fl`}>
        <span className="flex items-center justify-end gap-1.5 text-[15px]">
          <span className="w-[68px]">
            <NumField id={`${id}-fl`} value={d.fl} onChange={(v) => set({ ...d, fl: v })} placeholder={fmtNum(ph.pi_flow)} />
          </span>
          <span className="text-ink3">ml/s bis</span>
          <span className="w-[68px]">
            <NumField label="Abbruchdruck" value={d.br} onChange={(v) => set({ ...d, br: v })} placeholder={fmtNum(ph.pi_bar)} />
          </span>
          <span className="w-4 shrink-0 text-ink3">bar</span>
        </span>
      </Row>
      <Row label="Temperatur" htmlFor={`${id}-c0`}>
        <Range id={`${id}-c0`} label="Temperatur" a={d.c0} b={d.c1} onA={(v) => set({ ...d, c0: v })} onB={(v) => set({ ...d, c1: v })} ph={ph.temp} suffix="°C" />
      </Row>
    </>
  );
}

/** Ziel am Kaffee bearbeiten: leere Felder folgen dem Standard des Röstgrads */
export function ShotTargetSheet({ coffee, open, onClose }: { coffee: Coffee; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const targets = useShotTargets();
  const base = shotTargetOf({ roast_level: coffee.roast_level, shot_target: null }, targets);
  const [d, setD] = useState<Draft>(draftOf(coffee.shot_target));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setD(draftOf(coffee.shot_target));
  }, [open, coffee.shot_target]);

  const next: ShotOverride = {
    dose_g: d.dose,
    ratio: pairOf(d.r0, d.r1, base.ratio),
    time: pairOf(d.t0, d.t1, base.time),
    pi: pairOf(d.p0, d.p1, base.pi),
    pi_flow: d.fl,
    pi_bar: d.br,
    temp: pairOf(d.c0, d.c1, base.temp),
  };
  const preview = shotTargetOf({ roast_level: coffee.roast_level, shot_target: next }, targets);
  const save = async (o: ShotOverride | null) => {
    setSaving(true);
    try {
      await api.patchCoffee(coffee.id, { shot_target: o && (o.dose_g != null || o.ratio || o.time || o.pi || o.pi_flow != null || o.pi_bar != null || o.temp) ? o : null });
      await Promise.all([qc.invalidateQueries({ queryKey: ["coffee", coffee.id] }), qc.invalidateQueries({ queryKey: ["grind"] })]);
      toast(o ? "Ziel gesichert" : "Ziel folgt wieder dem Standard");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Espresso-Ziel" onSave={() => void save(next)} saving={saving} width={520}>
      <div className="flex flex-col gap-5">
        <Group
          title={coffee.name}
          footer={`Leere Felder folgen dem ${levelLabel(base)} (${targetLine(base)}, änderbar in den Einstellungen). Tipp und Startwert messen jeden Shot an diesem Ziel.`}
        >
          <TargetRows id="st" d={d} set={setD} ph={base} />
        </Group>
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="tnum text-[13px] font-semibold text-ink2">{targetLine(preview)}</span>
          {coffee.shot_target && (
            <Button variant="plain" size="sm" onClick={() => void save(null)}>
              Standard nutzen
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** Zeile „Ziel 18 g → 36–40 g in 25–30 s“ mit Herkunft und Knopf zum Anpassen */
export function ShotTargetLine({ target, onEdit, className }: { target: ResolvedTarget; onEdit?: () => void; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.04em] text-ink2 uppercase">
        <Target size={14} strokeWidth={2.3} className="text-accent" aria-hidden="true" />
        Ziel
      </span>
      <span className="tnum text-[15px] font-bold">{targetLine(target)}</span>
      <span className="text-[12px] text-ink3">{targetSource(target)}</span>
      {onEdit && (
        <button type="button" onClick={onEdit} className="ml-auto h-7 rounded-full px-2.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
          Anpassen
        </button>
      )}
    </div>
  );
}

/** Einstellungen: Standard je Röstgrad, mit Vorschau und Zurücksetzen */
export function ShotTargetSettings({ value }: { value: ShotTargets }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState(() => Object.fromEntries(ROAST_LEVELS.map((l) => [l.id, draftOf(value[l.id])])) as Record<keyof ShotTargets, Draft>);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(ROAST_LEVELS.map((l) => [l.id, draftOf(value[l.id])])) as Record<keyof ShotTargets, Draft>), [value]);

  const built = Object.fromEntries(
    ROAST_LEVELS.map((l) => {
      const d = drafts[l.id];
      const def = DEFAULT_SHOT_TARGETS[l.id];
      return [
        l.id,
        {
          dose_g: d.dose ?? def.dose_g,
          ratio: pairOf(d.r0, d.r1, def.ratio) ?? def.ratio,
          time: pairOf(d.t0, d.t1, def.time) ?? def.time,
          pi: pairOf(d.p0, d.p1, def.pi) ?? def.pi,
          pi_flow: d.fl ?? def.pi_flow,
          pi_bar: d.br ?? def.pi_bar,
          temp: pairOf(d.c0, d.c1, def.temp) ?? def.temp,
        },
      ];
    }),
  ) as ShotTargets;
  const dirty = JSON.stringify(built) !== JSON.stringify(value);
  const isDefault = JSON.stringify(value) === JSON.stringify(parseShotTargets(null));

  const save = async (t: ShotTargets | null) => {
    setSaving(true);
    try {
      const s = await api.saveSettings({ shot_targets: t });
      qc.setQueryData(["settings"], s);
      await qc.invalidateQueries({ queryKey: ["grind"] });
      toast(t ? "Espresso-Ziele gesichert" : "Espresso-Ziele zurückgesetzt");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group
      title="Espresso-Ziel je Röstgrad"
      footer="Standard für jeden Kaffee ohne eigenes Ziel (am Kaffee unter Einstellen → Anpassen). Ohne Röstgrad gilt mittel. Helle Röstungen lösen schwerer und laufen länger, dunkle kürzer. Zeit ohne Preinfusion; die Preinfusion hat ein eigenes Fenster (hell länger, damit der dichte Puck satt wird, dunkel kurz), dazu Fluss und Abbruchdruck wie in der Decent. Temperatur und Preinfusion gehen in die Decent-Profile der Kaffees. Gelernt wird gegen dieses Ziel: Die Zeit zählt über alle Kaffees, der Geschmack nur je Kaffee."
    >
      {ROAST_LEVELS.map((l) => (
        <div key={l.id} className="flex flex-col">
          <div className="flex items-center gap-2 px-4 pt-3">
            <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden="true" />
            <span className="text-[13px] font-bold tracking-[0.04em] text-ink2 uppercase">{l.label}</span>
            <span className="tnum ml-auto text-[12px] text-ink3">
              {fmtRatio(built[l.id].ratio)} · {built[l.id].pi.join("–")} + {fmtWindow(built[l.id].time)} · {fmtNum(mid(built[l.id].temp))} °C
            </span>
          </div>
          <div className="[&>*+*]:border-t [&>*+*]:border-sep">
            <TargetRows id={`set-${l.id}`} d={drafts[l.id]} set={(d) => setDrafts({ ...drafts, [l.id]: d })} ph={DEFAULT_SHOT_TARGETS[l.id]} />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        {!isDefault && (
          <Button variant="plain" size="sm" onClick={() => void save(null)} disabled={saving}>
            Auf Startwerte
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={() => void save(built)} loading={saving} disabled={!dirty}>
          Sichern
        </Button>
      </div>
    </Group>
  );
}
