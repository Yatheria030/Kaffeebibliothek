import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { paramWindow, recommendedParams, type CoffeeProfile, type ParamKey, type ProfileParams } from "../../../shared/decent-profile.ts";
import type { ResolvedTarget } from "../../../shared/shot.ts";
import type { Coffee } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDateTime, fmtNum } from "../lib/format.ts";
import { Button, Card, cx } from "./controls.tsx";
import { Group, NumField, Row } from "./form.tsx";
import { Sheet, toast } from "./overlay.tsx";
import { useShotTarget } from "./ShotTarget.tsx";

type Field = { k: ParamKey; label: string; unit: string; digits: 0 | 1; integer?: boolean };

/** Reihenfolge wie im Profil-Editor der de1app: Preinfusion, dann Bezug */
const FIELDS: Field[] = [
  { k: "pi_flow", label: "Preinfusion Fluss", unit: "ml/s", digits: 1 },
  { k: "pi_bar", label: "Preinfusion bis", unit: "bar", digits: 1 },
  { k: "pi_s", label: "Preinfusion höchstens", unit: "s", digits: 0, integer: true },
  { k: "temp", label: "Temperatur", unit: "°C", digits: 1 },
  { k: "pressure", label: "Druck", unit: "bar", digits: 1 },
  { k: "weight", label: "Stopp bei", unit: "g", digits: 0 },
  { k: "dose", label: "Dosis", unit: "g", digits: 1 },
];

const signed = (v: number, digits: 0 | 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmtNum(Math.abs(v), digits)}`;

/** Abstand zur Empfehlung: mit Fenster 0 im Fenster, sonst zum nächsten Rand; ohne Fenster zum Punkt */
function deviation(k: ParamKey, v: number | null, rec: ProfileParams, t: ResolvedTarget): { diff: number; ref: string } | null {
  const r = rec[k];
  if (v == null || r == null) return null;
  const w = paramWindow(k, t);
  if (w) return { diff: v < w[0] ? v - w[0] : v > w[1] ? v - w[1] : 0, ref: `${fmtNum(w[0], 1)}–${fmtNum(w[1], 1)}` };
  return { diff: Math.round((v - r) * 10) / 10, ref: fmtNum(r, 1) };
}

/** Karte am Kaffee: das Decent-Profil „# Rösterei - Kaffee“ mit Abweichung von der Empfehlung, in der App oder am Tablet änderbar */
export function DecentProfileCard({ coffee, profile: initial, className }: { coffee: Coffee; profile: CoffeeProfile; className?: string }) {
  // Änderungen am Tablet kommen alle paar Sekunden an; nur das Profil abfragen, nicht den ganzen Kaffee
  const { data: profile = initial } = useQuery({
    queryKey: ["coffee", coffee.id, "decent-profile"],
    queryFn: () => api.decentProfile(coffee.id),
    initialData: initial,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const target = useShotTarget(coffee);
  const rec = recommendedParams(target);
  const [edit, setEdit] = useState(false);
  const p = profile.params;
  const off = FIELDS.filter((f) => (deviation(f.k, p[f.k], rec, target)?.diff ?? 0) !== 0);
  const simple = profile.type === "settings_2a" || profile.type === "settings_2b";

  return (
    <Card className={cx("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.04em] text-ink2 uppercase">
            <SlidersHorizontal size={14} strokeWidth={2.3} className="text-accent" aria-hidden="true" />
            Decent-Profil
          </span>
          <span className="truncate text-[17px] font-bold">{profile.title}</span>
        </div>
        <Button variant="plain" size="sm" className="ml-auto" onClick={() => setEdit(true)}>
          Bearbeiten
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4">
        {FIELDS.map((f) => {
          const v = p[f.k];
          const d = deviation(f.k, v, rec, target);
          return (
            <div key={f.k} className="flex min-w-0 flex-col gap-0.5 rounded-[12px] bg-card2 px-3 py-2.5">
              <span className="truncate text-[12px] text-ink2">{f.label}</span>
              <span className="tnum text-[22px] leading-tight font-bold">
                {v == null ? "–" : fmtNum(v, f.digits)}
                <span className="ml-1 text-[13px] font-semibold text-ink3">{f.unit}</span>
              </span>
              {d ? (
                <span className={cx("tnum truncate text-[12px] font-semibold", d.diff === 0 ? "text-good" : "text-warn")}>
                  {d.diff === 0 ? `passt (${d.ref})` : `${signed(d.diff, f.digits)} ${f.unit} zu ${d.ref}`}
                </span>
              ) : (
                <span className="truncate text-[12px] text-ink3">keine Empfehlung</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="m-0 text-[12px] leading-snug text-ink2">
        {simple
          ? "Preinfusion läuft mit diesem Fluss, bis der Druck erreicht ist, höchstens so lange; danach der Druck bis zum Stopp-Gewicht. "
          : "Erweitertes Profil: Die Werte hier ändern nur die einfachen Felder, die Schritte am Tablet bleiben. "}
        Empfehlung aus dem Espresso-Ziel. Zuletzt geändert {profile.source === "app" ? "in der App" : "an der Decent"} am {fmtDateTime(profile.updated_at)}. Tablet
        und App gleichen Änderungen alle 10 s ab (Plugin ab 1.6), nicht während eines Bezugs.
      </p>

      <DecentProfileSheet coffee={coffee} profile={profile} target={target} open={edit} onClose={() => setEdit(false)} offCount={off.length} />
    </Card>
  );
}

type Draft = Record<ParamKey, number | null>;

function DecentProfileSheet({
  coffee,
  profile,
  target,
  open,
  onClose,
  offCount,
}: {
  coffee: Coffee;
  profile: CoffeeProfile;
  target: ResolvedTarget;
  open: boolean;
  onClose: () => void;
  offCount: number;
}) {
  const qc = useQueryClient();
  const rec = recommendedParams(target);
  const [d, setD] = useState<Draft>(profile.params);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setD(profile.params);
  }, [open, profile.params]);

  const save = async () => {
    const body: Partial<ProfileParams> = {};
    for (const f of FIELDS) if (d[f.k] != null && d[f.k] !== profile.params[f.k]) body[f.k] = d[f.k];
    setSaving(true);
    try {
      await api.saveDecentProfile(coffee.id, body);
      await qc.invalidateQueries({ queryKey: ["coffee", coffee.id] });
      toast(Object.keys(body).length ? "Profil gesichert, das Tablet holt es in ein paar Sekunden" : "Nichts geändert");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const useRec = () => setD({ ...d, ...Object.fromEntries(FIELDS.filter((f) => rec[f.k] != null).map((f) => [f.k, rec[f.k]])) });

  return (
    <Sheet open={open} onClose={onClose} title="Decent-Profil" onSave={() => void save()} saving={saving} width={520}>
      <div className="flex flex-col gap-5">
        <Group title={profile.title} footer="Leer gelassene Felder bleiben, wie sie sind. Das Tablet überschreibt nur Profile der App (Datei beginnt mit _), nie eigene.">
          {FIELDS.map((f) => {
            const w = paramWindow(f.k, target);
            const r = rec[f.k];
            return (
              <Row
                key={f.k}
                label={f.label}
                htmlFor={`dp-${f.k}`}
                hint={r == null ? undefined : `Empfehlung ${w ? `${fmtNum(w[0], 1)}–${fmtNum(w[1], 1)}` : fmtNum(r, 1)} ${f.unit}`}
              >
                <span className="flex items-center justify-end gap-1.5 text-[15px]">
                  <span className="w-[84px]">
                    <NumField id={`dp-${f.k}`} value={d[f.k]} onChange={(v) => setD({ ...d, [f.k]: v })} placeholder={r == null ? "" : fmtNum(r, 1)} integer={f.integer} />
                  </span>
                  <span className="w-9 shrink-0 text-ink3">{f.unit}</span>
                </span>
              </Row>
            );
          })}
        </Group>
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-[13px] text-ink2">{offCount ? `${offCount} Werte außerhalb der Empfehlung` : "Alle Werte passen zur Empfehlung"}</span>
          <Button variant="plain" size="sm" onClick={useRec}>
            Empfehlung übernehmen
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
