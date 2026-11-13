import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { windowsOf, type AppConfig, type ConfigKey, type ConfigView, type DrinkWindows } from "../../../shared/config.ts";
import { DRINK_WINDOWS } from "../../../shared/freshness.ts";
import { ROAST_FOR, ROAST_LEVELS } from "../../../shared/types.ts";
import { Button, Switch } from "./controls.tsx";
import { Group, Row } from "./form.tsx";
import { toast } from "./overlay.tsx";

/** Trinkfenster wie eingestellt; bis die Einstellungen da sind, die recherchierten */
export function useDrinkWindows(): DrinkWindows {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });
  return windowsOf(data?.config.effective);
}

export async function saveConfig(qc: ReturnType<typeof useQueryClient>, patch: Partial<AppConfig>, done: string) {
  try {
    qc.setQueryData(["settings"], await api.saveSettings({ config: patch }));
    toast(done);
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    return false;
  }
}

export type Field = {
  key: Exclude<ConfigKey, "drink_windows" | "backup_off">;
  label: string;
  kind: "text" | "int" | "time";
  suffix?: string;
  hint?: ReactNode;
  /** Vorschläge im Feld */
  list?: string[];
  /** Pflicht/Optional als Marke, für die Ersten Schritte */
  need?: "Pflicht" | "Optional" | "Empfohlen";
};

const str = (v: unknown) => (v == null ? "" : String(v));

export function NeedTag({ need }: { need: NonNullable<Field["need"]> }) {
  return (
    <span
      className={
        "ml-1.5 inline-block rounded-full px-1.5 py-px align-[1px] text-[10.5px] font-bold tracking-[0.04em] uppercase " +
        (need === "Pflicht" ? "bg-bad-soft text-bad" : need === "Empfohlen" ? "bg-accent-soft text-accent" : "bg-fill text-ink3")
      }
    >
      {need}
    </span>
  );
}

/**
 * Felder aus `config`: leer = Standard (steht als Platzhalter im Feld, mit Herkunft darunter). „Sichern“ schickt nur diese Gruppe,
 * „Auf Standard“ leert sie. `toggle` schaltet die nächtliche Sicherung (gespeichert als backup_off).
 */
export function ConfigGroup({
  config,
  title,
  footer,
  fields,
  toggle,
  children,
}: {
  config: ConfigView;
  title: string;
  footer?: ReactNode;
  fields: Field[];
  toggle?: { key: "backup_off"; label: string };
  children?: ReactNode;
}) {
  const qc = useQueryClient();
  const init = () => Object.fromEntries(fields.map((f) => [f.key, str(config.saved[f.key])])) as Record<string, string>;
  const [draft, setDraft] = useState(init);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(init()), [JSON.stringify(config.saved)]);

  const patch: Partial<AppConfig> = {};
  for (const f of fields) {
    const t = draft[f.key].trim();
    (patch as Record<string, unknown>)[f.key] = t === "" ? null : f.kind === "int" ? Number(t.replace(/\D/g, "")) || null : t;
  }
  const dirty = fields.some((f) => draft[f.key].trim() !== str(config.saved[f.key]));
  const custom = fields.some((f) => config.saved[f.key] != null);

  const save = async (p: Partial<AppConfig>, msg: string) => {
    setSaving(true);
    await saveConfig(qc, p, msg);
    setSaving(false);
  };

  return (
    <Group title={title} footer={footer}>
      {toggle && (
        <Row label={toggle.label}>
          <Switch
            label={toggle.label}
            checked={!config.effective.backup_off && config.effective.backup_dir != null}
            disabled={config.effective.backup_dir == null}
            onChange={(on) => void save({ backup_off: on ? null : true }, on ? `${toggle.label}: an` : `${toggle.label}: aus`)}
          />
        </Row>
      )}
      {fields.map((f) => {
        const id = `cfg-${f.key}`;
        const def = str(config.defaults[f.key]);
        const src = config.sources[f.key];
        const note = config.saved[f.key] == null && def && src === "env" ? 1 : !def && !draft[f.key].trim() ? 1 : 0;
        const hint = !f.hint && !note ? undefined : (
          <>
            {f.hint}
            {f.hint && " "}
            {config.saved[f.key] == null && def && src === "env" ? "Wert aus der Umgebung." : !def && !draft[f.key].trim() ? "Ohne Wert aus." : null}
          </>
        );
        return (
          <Row
            key={f.key}
            htmlFor={id}
            label={
              <>
                {f.label}
                {f.need && <NeedTag need={f.need} />}
              </>
            }
            hint={hint}
          >
            <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
              <input
                id={id}
                list={f.list ? `${id}-list` : undefined}
                inputMode={f.kind === "int" ? "numeric" : undefined}
                spellCheck={false}
                value={draft[f.key]}
                placeholder={def || "–"}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dirty) void save(patch, `${title} gesichert`);
                }}
                className={"field tnum h-9 min-w-0 text-right text-[15px] " + (f.kind === "text" ? "w-full max-w-[320px]" : "w-full max-w-[110px]")}
              />
              {f.list && (
                <datalist id={`${id}-list`}>
                  {f.list.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              )}
              {f.suffix && <span className="shrink-0 text-[15px] text-ink3">{f.suffix}</span>}
            </span>
          </Row>
        );
      })}
      {children}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        {custom && (
          <Button
            variant="plain"
            size="sm"
            disabled={saving}
            onClick={() => void save(Object.fromEntries(fields.map((f) => [f.key, null])), `${title}: Standard`)}
          >
            Auf Standard
          </Button>
        )}
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={() => void save(patch, `${title} gesichert`)}>
          Sichern
        </Button>
      </div>
    </Group>
  );
}

type WDraft = Record<string, string>;
const COLS = [
  { k: "ready", l: "Trinkbereit ab" },
  { k: "peak", l: "Am besten bis" },
  { k: "end", l: "Noch gut bis" },
] as const;

/** Trinkfenster je „Geröstet für“ und Röstgrad in Tagen ab Röstung; leer = recherchierter Wert */
export function DrinkWindowSettings({ config }: { config: ConfigView }) {
  const qc = useQueryClient();
  const cur = windowsOf(config.effective);
  const keyOf = (f: string, l: string, k: string) => `${f}.${l}.${k}`;
  const init = (): WDraft => {
    const d: WDraft = {};
    for (const f of ROAST_FOR) for (const l of ROAST_LEVELS) for (const c of COLS) d[keyOf(f.id, l.id, c.k)] = String(cur[f.id][l.id][c.k]);
    return d;
  };
  const [draft, setDraft] = useState(init);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(init()), [JSON.stringify(config.saved.drink_windows)]);

  const built = Object.fromEntries(
    ROAST_FOR.map((f) => [
      f.id,
      Object.fromEntries(
        ROAST_LEVELS.map((l) => [
          l.id,
          Object.fromEntries(COLS.map((c) => [c.k, Number(draft[keyOf(f.id, l.id, c.k)]) || (draft[keyOf(f.id, l.id, c.k)].trim() === "0" ? 0 : DRINK_WINDOWS[f.id][l.id][c.k])])),
        ]),
      ),
    ]),
  ) as DrinkWindows;
  const dirty = JSON.stringify(built) !== JSON.stringify(cur);

  const save = async (w: DrinkWindows | null) => {
    setSaving(true);
    await saveConfig(qc, { drink_windows: w }, w ? "Trinkfenster gesichert" : "Trinkfenster auf Röster-Werte");
    setSaving(false);
  };

  return (
    <Group
      title="Trinkfenster"
      footer="Tage ab Röstdatum, für Lager, „Seit Röstung“ am Kaffee und „Als Nächstes öffnen“. Standard sind recherchierte Röster-Werte (Wiki „Ruhezeit“). Ohne Röstdatum, „Geröstet für“ oder Röstgrad gibt es keine Bewertung."
    >
      {ROAST_FOR.map((f) => (
        <div key={f.id} className="flex flex-col px-4 py-3">
          <span className="pb-2 text-[13px] font-bold tracking-[0.04em] text-ink2 uppercase">{f.label}</span>
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,4.5rem))] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_repeat(3,6.5rem)]">
            <span />
            {COLS.map((c) => (
              <span key={c.k} className="text-right text-[11px] leading-tight font-semibold text-ink3">
                {c.l}
              </span>
            ))}
            {ROAST_LEVELS.map((l) => (
              <div key={l.id} className="contents">
                <span className="flex items-center gap-2 text-[15px]">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden="true" />
                  {l.label}
                </span>
                {COLS.map((c) => {
                  const k = keyOf(f.id, l.id, c.k);
                  return (
                    <input
                      key={k}
                      aria-label={`${f.label}, ${l.label}: ${c.l} (Tage)`}
                      inputMode="numeric"
                      value={draft[k]}
                      placeholder={String(DRINK_WINDOWS[f.id][l.id][c.k])}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/\D/g, "") })}
                      className="field tnum h-9 w-full min-w-0 rounded-[9px] bg-fill px-2 text-right text-[15px]"
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        {config.saved.drink_windows && (
          <Button variant="plain" size="sm" disabled={saving} onClick={() => void save(null)}>
            Auf Röster-Werte
          </Button>
        )}
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={() => void save(built)}>
          Sichern
        </Button>
      </div>
    </Group>
  );
}

/** Häufige Zeitzonen als Vorschlag, eintippen geht jede IANA-Zone */
export const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Europe/Berlin", "UTC"];
  } catch {
    return ["Europe/Berlin", "UTC"];
  }
})();

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"];
