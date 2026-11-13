// Livewerte der Decent DE1 aus Home Assistant: Knopf in der Leiste mit Temperatur, aufgeklappt alle Werte und Schalter
// für Maschine (wecken/schlafen) und Dampf. Einstellungsgruppe „Home Assistant“ mit Adresse und Token.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cloud, Droplet, Link2, Power, Thermometer, Unlink } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { api } from "../api.ts";
import type { HaStatus, MachineLive } from "../../../shared/types.ts";
import { Button, cx, Spinner, Switch } from "./controls.tsx";
import { Group, Row } from "./form.tsx";
import { confirmDialog, toast } from "./overlay.tsx";

const KEY = ["ha", "machine"];
const fmt = (n: number | null, d = 0) => (n == null ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));

/** Zustand der de1app auf Deutsch; Unterzustand „heating“ usw. heißt „Heizt auf“ */
export function stateLabel(m: MachineLive): string {
  if (!m.online) return "Offline";
  const s = m.state ?? "";
  if (/heat|stabil/i.test(m.substate ?? "") && s !== "Sleep") return "Heizt auf";
  const map: Record<string, string> = {
    Sleep: "Schläft",
    GoingToSleep: "Schläft ein",
    Idle: "Bereit",
    SchedIdle: "Bereit",
    Espresso: "Espresso läuft",
    Steam: "Dampf läuft",
    HotWater: "Heißwasser",
    HotWaterRinse: "Spült",
    SteamRinse: "Spült",
    AirPurge: "Entlüftet",
    Refill: "Wasser nachfüllen",
    Clean: "Reinigung",
    Descale: "Entkalkt",
    Busy: "Beschäftigt",
    FatalError: "Fehler",
  };
  return map[s] ?? s;
}

/** Dauer seit einem Zeitpunkt, grob: „2 min“, „3 h“, „4 Tagen“ */
function since(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? "einem Tag" : `${d} Tagen`;
}

type Tone = "on" | "heat" | "off";
const toneOf = (m: MachineLive): Tone => (!m.online || !m.awake ? "off" : stateLabel(m) === "Heizt auf" ? "heat" : "on");

export function useMachineLive() {
  const [fast, setFast] = useState(0);
  const q = useQuery({
    queryKey: KEY,
    queryFn: api.machineLive,
    // wach alle 5 s, schlafend alle 30 s, kurz nach dem Schalten alle 2 s
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d?.configured) return false;
      if (Date.now() < fast) return 2_000;
      return d.awake ? 5_000 : 30_000;
    },
  });
  return { ...q, burst: () => setFast(Date.now() + 30_000) };
}

const CONFIRM_MS = 20_000;
type Pending = { what: "power" | "steam"; on: boolean; until: number };
const doneText = (p: Pending) => (p.what === "power" ? (p.on ? "Maschine ist wach" : "Maschine schläft") : p.on ? "Dampf an" : "Dampf aus");

/** Schalten über HA: Der Schalter zeigt den Wunsch, bis die Maschine ihn meldet. Kommt in 20 s nichts, Meldung statt still zurückspringen */
function useSwitch(m: MachineLive | undefined, burst: () => void) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const flip = async (what: "power" | "steam", on: boolean) => {
    setPending({ what, on, until: Date.now() + CONFIRM_MS });
    try {
      await api.machineSwitch(what, on);
      burst();
    } catch (e) {
      setPending(null);
      toast(e instanceof Error ? e.message : "Schalten fehlgeschlagen", "error");
    }
  };
  useEffect(() => {
    if (!pending || !m) return;
    if ((pending.what === "power" ? m.awake : m.steam) === pending.on) {
      setPending(null);
      toast(doneText(pending));
    }
  }, [m, pending]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setPending(null);
      const live = qc.getQueryData<MachineLive>(KEY);
      toast(
        live?.stale ? "Keine Rückmeldung: Die de1app sendet nicht an MQTT" : "Keine Rückmeldung der Maschine, der Befehl kam wohl nicht an",
        "error",
      );
      void qc.invalidateQueries({ queryKey: KEY });
    }, Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(t);
  }, [pending, qc]);
  return { pending, flip };
}

/**
 * Decent in der Leiste. Die Hülle ist ein Container: Mit Platz stehen Schalter (Maschine mit Zustand, Dampf) und die Werte
 * dauerhaft da, ohne Knopf. Schmal ein Knopf mit Ein-Symbol in der Zustandsfarbe und Kopftemperatur bzw. „Aus“, dazu so viele
 * Werte, wie passen. Werte und Knopf klappen das Fenster mit allen Werten und den Schaltern auf.
 */
export function MachinePill() {
  const { data: m, burst } = useMachineLive();
  const { pending, flip } = useSwitch(m, burst);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!m?.configured) return null;
  const tone = m.ok && !m.stale ? toneOf(m) : "off";
  const label = !m.ok ? "Nicht erreichbar" : m.stale ? "Kein Signal" : stateLabel(m);
  const short = !m.ok || !m.online || m.stale ? "–" : m.awake ? `${fmt(m.head_c)}°` : "Aus";
  // Schalter und Werte nur, wenn die Maschine sich meldet; sonst bleibt der Knopf mit der Meldung
  const live = m.ok && m.online;
  const powerOn = pending?.what === "power" ? pending.on : Boolean(m.awake);
  const steamOn = pending?.what === "steam" ? pending.on : Boolean(m.steam);

  return (
    // Der kleine Titel der Toolbar behält seine Breite, ab lg rückt alles vom großen Titel weg, der dort in derselben Zeile steht
    <div ref={ref} className="@container relative flex min-w-0 flex-[100_1_0%] items-center justify-end gap-2 lg:ml-24">
      {live && (
        <div className="hidden shrink-0 items-center gap-1.5 @[420px]:flex">
          {m.can_power && (
            <Toggle
              on={powerOn}
              busy={pending?.what === "power"}
              disabled={pending != null}
              onClick={() => void flip("power", !powerOn)}
              label={powerOn ? "Maschine schlafen legen" : "Maschine wecken"}
              icon={<Power size={14} strokeWidth={2.6} className={cx(tone === "on" ? "text-good" : tone === "heat" ? "animate-pulse text-warn" : "text-ink3")} />}
            >
              {label}
            </Toggle>
          )}
          {m.can_steam && (
            <Toggle
              on={steamOn}
              busy={pending?.what === "steam"}
              disabled={pending != null}
              onClick={() => void flip("steam", !steamOn)}
              label={steamOn ? "Dampf ausschalten" : "Dampf einschalten"}
              icon={<Cloud size={14} strokeWidth={2.4} className={steamOn ? "text-accent" : "text-ink3"} />}
            >
              Dampf
            </Toggle>
          )}
        </div>
      )}
      {live && (
        <button
          type="button"
          aria-controls={id}
          aria-expanded={open}
          aria-label="Livewerte der Decent, Details anzeigen"
          onClick={() => setOpen((o) => !o)}
          className={cx("hidden h-[30px] min-w-0 items-center gap-3.5 rounded-full px-2.5 hover:bg-fill @[280px]:flex", m.stale && "opacity-50")}
        >
          <Reading label="Kopf" value={fmt(m.head_c, 1)} unit="°C" />
          <Reading label="Dampf" value={fmt(m.steam_c)} unit="°C" className="@[390px]:flex" />
          <Reading label="Wasser" value={fmt(m.water_ml)} unit="ml" className="@[535px]:flex" />
          <Reading label="Mischung" value={fmt(m.mix_c, 1)} unit="°C" className="@[675px]:flex" />
        </button>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Decent: ${label}${m.awake && !m.stale ? `, Kopf ${fmt(m.head_c, 1)} °C` : ""}`}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex h-[30px] shrink-0 items-center gap-1.5 rounded-full bg-fill pr-2.5 pl-2 text-[13px] text-ink hover:bg-fill2",
          live && "@[420px]:hidden",
        )}
      >
        <Power
          size={14}
          strokeWidth={2.6}
          aria-hidden="true"
          className={cx(tone === "on" ? "text-good" : tone === "heat" ? "animate-pulse text-warn" : "text-ink3")}
        />
        <span className="tnum font-semibold">{short}</span>
        {/* ab lg steht der große Titel in derselben Zeile, der Text erst wieder ab xl */}
        <span className="text-ink2 max-md:hidden lg:max-xl:hidden">{m.ok && (m.awake || m.stale) ? label : "Decent"}</span>
        {m.ok && m.steam && !m.stale && (
          <span className="tnum flex items-center gap-0.5 text-ink2 max-sm:hidden lg:max-xl:hidden">
            <Cloud size={13} strokeWidth={2.2} aria-hidden="true" />
            {fmt(m.steam_c)}°
          </span>
        )}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Decent DE1"
          className="anim-fade frost fixed inset-x-3 top-[calc(env(safe-area-inset-top)+56px)] z-50 rounded-[14px] bg-[color-mix(in_srgb,var(--c-card)_92%,transparent)] p-1.5 shadow-pop sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-1.5 sm:w-[320px]"
        >
          <MachinePanel m={m} pending={pending} flip={flip} />
        </div>
      )}
    </div>
  );
}

/** Schalter in der Leiste: an = getönt, wartet mit Kreisel auf die Rückmeldung der Maschine */
function Toggle({
  on,
  busy,
  disabled,
  onClick,
  label,
  icon,
  children,
}: {
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-[30px] items-center gap-1.5 rounded-full pr-2.5 pl-2 text-[13px] font-semibold whitespace-nowrap disabled:opacity-70",
        on ? "bg-accent-soft text-accent" : "bg-fill text-ink hover:bg-fill2",
      )}
    >
      {busy ? <Spinner size={14} /> : <span aria-hidden="true" className="flex">{icon}</span>}
      {children}
    </button>
  );
}

function Reading({ label, value, unit, className }: { label: string; value: string; unit: string; className?: string }) {
  return (
    <span className={cx("items-baseline gap-1 whitespace-nowrap", className ? `hidden ${className}` : "flex")}>
      <span className="text-[11px] font-semibold tracking-[0.06em] text-ink3 uppercase">{label}</span>
      <span className="tnum text-[14px] font-bold text-ink">
        {value}
        <span className="ml-0.5 text-[12px] font-semibold text-ink2">{unit}</span>
      </span>
    </span>
  );
}

function MachinePanel({ m, pending, flip }: { m: MachineLive; pending: Pending | null; flip: (w: "power" | "steam", on: boolean) => void }) {
  if (!m.ok)
    return (
      <div className="px-3 py-3 text-[14px]">
        <div className="font-semibold">Decent DE1</div>
        <div className="mt-1 text-bad">{m.error ?? "Nicht erreichbar"}</div>
      </div>
    );
  const tone = m.stale ? "off" : toneOf(m);
  const tiles: { label: string; value: string; unit: string; icon: typeof Thermometer }[] = [
    { label: "Kopf", value: fmt(m.head_c, 1), unit: "°C", icon: Thermometer },
    { label: "Mischung", value: fmt(m.mix_c, 1), unit: "°C", icon: Thermometer },
    { label: "Dampf", value: fmt(m.steam_c), unit: "°C", icon: Cloud },
    { label: "Wasser", value: fmt(m.water_ml), unit: "ml", icon: Droplet },
  ];
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span
          aria-hidden="true"
          className={cx("size-2.5 shrink-0 rounded-full", tone === "on" ? "bg-good" : tone === "heat" ? "animate-pulse bg-warn" : "bg-ink3")}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">{m.stale ? "Kein Signal" : stateLabel(m)}</span>
          {m.profile && <span className="block truncate text-[12px] text-ink3">{m.profile}</span>}
        </span>
      </div>
      {m.stale && m.updated && (
        <div className="mx-1.5 mb-1.5 flex gap-2 rounded-[10px] bg-[color-mix(in_srgb,var(--c-orange)_14%,transparent)] px-3 py-2 text-[13px] leading-snug">
          <AlertTriangle size={16} strokeWidth={2.2} className="mt-px shrink-0 text-warn" aria-hidden="true" />
          <span>
            Keine neuen Werte seit {since(m.updated)}. Die de1app sendet gerade nicht an MQTT, Schalten kommt nicht an. Am Tablet das
            MQTT-Plugin und das WLAN prüfen.
          </span>
        </div>
      )}
      <div className={cx("grid grid-cols-2 gap-1.5 px-1.5 pb-1.5", m.stale && "opacity-50")}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[10px] bg-fill px-3 py-2">
            <div className="text-[11px] font-semibold tracking-[0.06em] text-ink3 uppercase">{t.label}</div>
            <div className="tnum text-[22px] leading-tight font-bold">
              {t.value}
              <span className="ml-0.5 text-[13px] font-semibold text-ink2">{t.unit}</span>
            </div>
          </div>
        ))}
      </div>
      {m.can_power && (
        <div className="flex items-center gap-3 border-t border-sep px-3 py-2">
          <Power size={16} strokeWidth={2.2} className="text-ink2" aria-hidden="true" />
          <span className="flex-1 text-[15px]">Maschine</span>
          {pending?.what === "power" && <Spinner size={16} />}
          <Switch
            checked={pending?.what === "power" ? pending.on : Boolean(m.awake)}
            disabled={pending != null}
            onChange={(v) => void flip("power", v)}
            label="Maschine wecken oder schlafen legen"
          />
        </div>
      )}
      {m.can_steam && (
        <div className="flex items-center gap-3 border-t border-sep px-3 py-2">
          <Cloud size={16} strokeWidth={2.2} className="text-ink2" aria-hidden="true" />
          <span className="flex-1 text-[15px]">Dampf</span>
          {pending?.what === "steam" && <Spinner size={16} />}
          <Switch
            checked={pending?.what === "steam" ? pending.on : Boolean(m.steam)}
            disabled={pending != null}
            onChange={(v) => void flip("steam", v)}
            label="Dampf ein oder aus"
          />
        </div>
      )}
      <div className="border-t border-sep px-3 pt-2 pb-1.5 text-[12px] text-ink3">
        {pending
          ? "Wartet auf Rückmeldung der Maschine …"
          : `Über Home Assistant${m.changed && !m.stale ? ` · ${stateLabel(m)} seit ${since(m.changed)}` : ""}`}
      </div>
    </div>
  );
}

/** Einstellungsgruppe: Adresse und Long-Lived-Token, der Token bleibt auf dem Server */
export function HaSettings({ status }: { status: HaStatus }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useMachineLive();

  const connect = async () => {
    setBusy(true);
    try {
      qc.setQueryData(["settings"], await api.haConnect({ url: url.trim(), token: token.trim() }));
      setToken("");
      await qc.invalidateQueries({ queryKey: KEY });
      toast("Home Assistant verbunden");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verbinden fehlgeschlagen", "error");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    const ok = await confirmDialog({ title: "Home Assistant trennen?", message: "Adresse und Token werden gelöscht.", confirmLabel: "Trennen", danger: true });
    if (!ok) return;
    try {
      qc.setQueryData(["settings"], await api.haDisconnect());
      await qc.invalidateQueries({ queryKey: KEY });
      toast("Home Assistant getrennt");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Trennen fehlgeschlagen", "error");
    }
  };
  const m = live.data;

  return (
    <Group
      title="Home Assistant"
      footer={
        status.set
          ? "Zeigt Zustand und Temperaturen der Decent oben in der Bibliothek, dort lässt sie sich wecken und der Dampf schalten. Die Entitäten des de1app-MQTT-Plugins (decent, de1) findet die App selbst."
          : "Für Livewerte der Decent in der Leiste: Adresse von Home Assistant und ein Long-Lived Access Token (Profil → Sicherheit). Der Token bleibt auf dem Server und wird nie angezeigt."
      }
    >
      {status.set ? (
        <>
          <Row label="Verbunden">
            <span className="flex min-w-0 items-center gap-1.5 text-[15px] text-ink2">
              <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden="true" />
              <span className="truncate">{status.url}</span>
              <span className="shrink-0 text-ink3 max-sm:hidden">· {status.source === "env" ? "aus der Umgebung" : "hier hinterlegt"}</span>
            </span>
          </Row>
          <Row label="Maschine">
            {!m ? (
              <Spinner size={16} />
            ) : (
              <span className={cx("min-w-0 truncate text-[15px]", !m.ok ? "text-bad" : m.stale ? "text-warn" : "text-ink2")}>
                {!m.ok
                  ? m.error
                  : m.stale && m.updated
                    ? `Kein Signal seit ${since(m.updated)}, die de1app sendet nicht an MQTT`
                    : `${stateLabel(m)}${m.head_c != null ? ` · Kopf ${fmt(m.head_c, 1)} °C` : ""}`}
              </span>
            )}
          </Row>
          {status.source === "db" && (
            <div className="flex justify-end px-2 py-1.5">
              <Button size="sm" variant="plain" icon={Unlink} onClick={() => void disconnect()}>
                Trennen
              </Button>
            </div>
          )}
        </>
      ) : (
        <form
          className="flex flex-col gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && token.trim()) void connect();
          }}
        >
          <label htmlFor="ha-url" className="sr-only">
            Adresse
          </label>
          <input
            id="ha-url"
            type="url"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://homeassistant.local:8123"
            className="field h-9 rounded-[9px] bg-fill px-3 text-[15px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ha-token" className="sr-only">
              Token
            </label>
            <input
              id="ha-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Long-Lived Access Token"
              className="field h-9 min-w-0 flex-[1_1_220px] rounded-[9px] bg-fill px-3 text-[15px]"
            />
            <Button type="submit" variant="primary" size="sm" icon={Link2} loading={busy} disabled={!url.trim() || !token.trim()}>
              Verbinden
            </Button>
          </div>
        </form>
      )}
    </Group>
  );
}
