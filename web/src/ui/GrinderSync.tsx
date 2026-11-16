// Mahlkönig: Mühle im Heimnetz und Cloud-Konto in den Einstellungen, Mahlvorgänge im Bewertungsdialog übernehmen
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudOff, Link2, Plug, RefreshCw, Undo2, Unlink } from "lucide-react";
import { useState } from "react";
import type { GrinderEvent, GrinderSyncStatus } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDateShort, fmtDateTime, fmtRelative } from "../lib/format.ts";
import { Button, cx, Spinner } from "./controls.tsx";
import { CoffeeLink } from "./CoffeeLink.tsx";
import { fmtG } from "./DialIn.tsx";
import { fmtSec, tenth } from "../../../shared/shot.ts";
import { Group, Row } from "./form.tsx";
import { confirmDialog, toast } from "./overlay.tsx";

const n1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const hm = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const at = (iso: string) => hm.format(new Date(iso));
/** Uhrzeit, an anderen Tagen mit Datum */
export const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? `${at(iso)} Uhr` : fmtDateTime(iso));

/** Mahlgrad wie im Bezug (µm auf Zehntel wie gemessen, ohne Tausenderpunkt; das Display der Mühle schneidet ab) */
export const eventGrind = (e: GrinderEvent) => (e.grind_um == null ? null : fmtG(tenth(e.grind_um)));

export function useGrinderEvents(enabled: boolean, q: { since?: string; around?: string; hours?: number }) {
  return useQuery({
    queryKey: ["grinder", "events", q],
    queryFn: () => api.grinderEvents({ ...q, limit: 40 }),
    enabled,
    // solange der Dialog offen ist, kommen neue Mahlvorgänge von selbst
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

// ---------- Einstellungen ----------

export function GrinderSyncSettings({ status }: { status: GrinderSyncStatus }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [store, setStore] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<"connect" | "sync" | "local" | null>(null);
  const recent = useQuery({ queryKey: ["grinder", "events", { recent: true }], queryFn: () => api.grinderEvents({ limit: 5 }), enabled: status.set });
  const s = recent.data?.status ?? status;

  const connect = async () => {
    const sid = store.trim() ? Number(store.trim()) : null;
    if (sid != null && !(Number.isInteger(sid) && sid > 0)) return toast("Store-ID ist eine Zahl, z. B. 3868", "error");
    setBusy("connect");
    try {
      const st = await api.grinderConnect({ email: email.trim(), password, store_id: sid });
      qc.setQueryData(["settings"], st);
      setPassword("");
      toast("Mühle verbunden, Mahlvorgänge werden geholt");
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["grinder"] }), 1500);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verbinden fehlgeschlagen", "error");
    } finally {
      setBusy(null);
    }
  };
  const sync = async () => {
    setBusy("sync");
    try {
      const st = await api.grinderSync();
      await qc.invalidateQueries({ queryKey: ["grinder"] });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      const err = st.local_error ?? st.last_error;
      if (err) toast(err, "error");
      else toast(`Abgeglichen, ${st.events} Mahlvorgänge`);
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Mühle trennen?",
      message: "Zugangsdaten werden gelöscht. Schon geholte Mahlvorgänge und ihre Verknüpfung mit Bezügen bleiben.",
      confirmLabel: "Trennen",
      danger: true,
    });
    if (!ok) return;
    try {
      qc.setQueryData(["settings"], await api.grinderDisconnect());
      await qc.invalidateQueries({ queryKey: ["grinder"] });
      toast("Mühle getrennt");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Trennen fehlgeschlagen", "error");
    }
  };

  const connectLocal = async () => {
    setBusy("local");
    try {
      qc.setQueryData(["settings"], await api.grinderLocal(host.trim()));
      setHost("");
      await qc.invalidateQueries({ queryKey: ["grinder"] });
      toast("Mühle im Heimnetz verbunden, Mahlvorgänge übernommen");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verbinden fehlgeschlagen", "error");
    } finally {
      setBusy(null);
    }
  };
  const disconnectLocal = async () => {
    const ok = await confirmDialog({
      title: "Mühle im Heimnetz trennen?",
      message: "Die App holt dann keine Mahlvorgänge mehr direkt von der Mühle. Schon geholte und ihre Verknüpfung mit Bezügen bleiben.",
      confirmLabel: "Trennen",
      danger: true,
    });
    if (!ok) return;
    try {
      qc.setQueryData(["settings"], await api.grinderLocalDisconnect());
      await qc.invalidateQueries({ queryKey: ["grinder"] });
      toast("Mühle im Heimnetz getrennt");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Trennen fehlgeschlagen", "error");
    }
  };
  const syncLine = (when: string | null, error: string | null) => (
    <span className={cx("min-w-0 truncate text-[15px]", error ? "text-bad" : "text-ink2")} title={error ?? undefined}>
      {error ? error : when ? `${fmtRelative(when)}, ${at(when)} Uhr` : "noch nicht"}
    </span>
  );
  const syncButton = (
    <Button size="sm" variant="plain" icon={RefreshCw} loading={busy === "sync"} onClick={() => void sync()}>
      <span className="max-sm:hidden">Jetzt</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <Group
        title="Mahlkönig im Heimnetz"
        footer={
          s.local_host
            ? "Holt jeden Mahlvorgang (Mahlgrad, Dosis, Mahlzeit) direkt von der Mühle, alle 10 Minuten und während du bewertest alle 30 Sekunden. Spülen und Leerlauf ohne Siebträger fallen weg."
            : "Für die E64 WS im WLAN: Die App liest die Mahlvorgänge direkt aus der Mühle, ohne Cloud und ohne Passwort. Adresse: die IP der Mühle in deinem WLAN."
        }
      >
        {s.local_host ? (
          <>
            <Row label="Mühle">
              <span className="flex min-w-0 items-center gap-1.5 text-[15px] text-ink2">
                {s.local_error ? (
                  <CloudOff size={16} className="shrink-0 text-bad" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden="true" />
                )}
                <span className="truncate">{s.local_host.replace(/^https:\/\//, "")}</span>
                <span className="shrink-0 text-ink3 max-sm:hidden">· {s.local_source === "env" ? "aus der Umgebung" : "hier hinterlegt"}</span>
              </span>
            </Row>
            <Row label="Abgleich">
              {syncLine(s.local_sync, s.local_error)}
              {syncButton}
            </Row>
            {s.local_source === "db" && (
              <div className="flex justify-end px-2 py-1.5">
                <Button size="sm" variant="plain" icon={Unlink} onClick={() => void disconnectLocal()}>
                  Trennen
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <label htmlFor="mk-host" className="sr-only">
              Adresse der Mühle
            </label>
            <input
              id="mk-host"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (host.trim()) void connectLocal();
              }}
              placeholder="Adresse der Mühle, z. B. 192.168.1.50"
              className="field h-9 min-w-0 flex-[1_1_220px] rounded-[9px] bg-fill px-3 text-[15px]"
            />
            <Button variant="primary" size="sm" icon={Plug} loading={busy === "local"} disabled={!host.trim()} className="h-9" onClick={() => void connectLocal()}>
              Verbinden
            </Button>
          </div>
        )}
      </Group>

      {s.set && (
        <Group title="Mahlvorgänge">
          <Row label="Gesamt">
            <span className="tnum text-[15px] text-ink2">
              {s.events}
              {s.last_event ? ` · zuletzt ${fmtRelative(s.last_event)}, ${at(s.last_event)}` : ""}
            </span>
          </Row>
          {(recent.data?.events.length ?? 0) > 0 && (
            <ul className="m-0 flex list-none flex-col p-0">
              {recent.data!.events.map((e) => (
                <li key={e.id} className="grid grid-cols-1 gap-0.5 border-t border-sep px-4 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                  <span className="tnum min-w-0 text-[14px] font-semibold">
                    {when(e.ground_at)}
                    <span className="font-normal text-ink2"> · {eventLine(e)}</span>
                  </span>
                  <span className="min-w-0 truncate text-[13px] text-ink3 sm:text-right">
                    {e.brew_coffee_id != null ? (
                      <CoffeeLink id={e.brew_coffee_id} className="text-accent no-underline">
                        {e.brew_coffee}
                      </CoffeeLink>
                    ) : (
                      "kein Bezug"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Group>
      )}

      <Group
        title="Mahlkönig Sync"
        footer={
          s.cloud
            ? "Holt zusätzlich aus der Mahlkönig-Cloud. Einzelne Mahlvorgänge gibt die Cloud nur mit Grind-by-Sync (gekoppelte Maschine oder Waage) heraus, sonst bleibt sie leer."
            : "Optional, für Grind-by-Sync mit gekoppelter Maschine oder Waage: Zeit und Ausbeute aus der Mahlkönig-Cloud. Zugang wie in der Mahlkönig-App, das Passwort bleibt auf dem Server. Die Store-ID findet die App meist selbst."
        }
      >
        {s.cloud ? (
          <>
            <Row label="Konto">
              <span className="flex min-w-0 items-center gap-1.5 text-[15px] text-ink2">
                <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden="true" />
                <span className="truncate">{s.email}</span>
                <span className="shrink-0 text-ink3 max-sm:hidden">· {s.source === "env" ? "aus der Umgebung" : "hier hinterlegt"}</span>
              </span>
            </Row>
            {s.store_id != null && (
              <Row label="Store-ID">
                <span className="tnum text-[15px] text-ink2">{s.store_id}</span>
              </Row>
            )}
            <Row label="Abgleich">
              {syncLine(s.last_sync, s.last_error)}
              {syncButton}
            </Row>
            {s.source === "db" && (
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
            if (email.trim() && password) void connect();
          }}
        >
          <label htmlFor="mk-email" className="sr-only">
            E-Mail
          </label>
          <input
            id="mk-email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-Mail des Mahlkönig-Kontos"
            className="field h-9 rounded-[9px] bg-fill px-3 text-[15px]"
          />
          <div className="flex flex-wrap gap-2">
            <label htmlFor="mk-pw" className="sr-only">
              Passwort
            </label>
            <input
              id="mk-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort"
              className="field h-9 min-w-0 flex-[1_1_200px] rounded-[9px] bg-fill px-3 text-[15px]"
            />
            <label htmlFor="mk-store" className="sr-only">
              Store-ID (optional)
            </label>
            <input
              id="mk-store"
              inputMode="numeric"
              autoComplete="off"
              value={store}
              onChange={(e) => setStore(e.target.value.replace(/\D/g, ""))}
              placeholder="Store-ID (optional)"
              className="field tnum h-9 min-w-0 flex-[1_1_140px] rounded-[9px] bg-fill px-3 text-[15px]"
            />
            <Button type="submit" variant="primary" size="sm" icon={Plug} loading={busy === "connect"} disabled={!email.trim() || !password} className="h-9">
              Verbinden
            </Button>
          </div>
        </form>
        )}
      </Group>
    </div>
  );
}

function eventLine(e: GrinderEvent): string {
  return [
    e.grind_um != null ? `${eventGrind(e)} µm` : null,
    e.dose_g != null ? `${n1.format(e.dose_g)} g` : null,
    e.yield_g != null ? `→ ${n1.format(e.yield_g)} g` : null,
    e.shot_s != null ? `${fmtSec(e.shot_s)} s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------- Bewertungsdialog ----------

export function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-card px-3.5 py-2.5">
      <span className="text-[11px] font-bold tracking-[0.06em] text-ink2 uppercase">{label}</span>
      <span className="tnum truncate text-[26px] leading-tight font-extrabold tracking-[-0.02em]">
        {value}
        {unit && <span className="ml-0.5 text-[15px] font-bold text-ink2">{unit}</span>}
      </span>
      {sub && <span className="tnum truncate text-[12px] text-ink3">{sub}</span>}
    </div>
  );
}

/**
 * Karte „Von der Mühle“: der übernommene Mahlvorgang groß, darunter andere zur Auswahl.
 * `selected` ist die Verknüpfung des Bezugs, `brewId` der Bezug selbst (seine eigene Verknüpfung gilt nicht als belegt).
 */
export function GrinderCard({
  events,
  status,
  loading,
  selected,
  brewId,
  onPick,
  onUndo,
  onRelease,
  canUndo,
}: {
  events: GrinderEvent[];
  status: GrinderSyncStatus | null;
  loading: boolean;
  selected: number | null;
  brewId: number | null;
  onPick: (e: GrinderEvent) => void;
  onUndo: () => void;
  onRelease: () => void;
  canUndo: boolean;
}) {
  const [more, setMore] = useState(false);
  const sel = events.find((e) => e.id === selected) ?? null;
  const others = events.filter((e) => e.id !== selected);
  const listed = sel && !more ? [] : others.slice(0, more ? 12 : 4);

  return (
    <section className="flex flex-col gap-1.5" aria-label="Von der Mühle">
      <div className="flex items-center gap-2 px-1 pb-0.5">
        <h3 className="m-0 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Von der Mühle</h3>
        {loading && <Spinner size={13} />}
        {(status?.local_error ?? status?.last_error) && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-bad">
            <CloudOff size={13} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{status!.local_error ?? status!.last_error}</span>
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-[16px] bg-card shadow-card">
        {sel ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
              <Link2 size={15} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[14px] font-semibold">
                Gemahlen {when(sel.ground_at)}
                {sel.device && <span className="font-normal text-ink3"> · {sel.device}</span>}
              </span>
              <span className="flex gap-1">
                {canUndo && (
                  <Button size="sm" variant="plain" icon={Undo2} onClick={onUndo}>
                    Rückgängig
                  </Button>
                )}
                {!canUndo && (
                  <Button size="sm" variant="plain" icon={Unlink} onClick={onRelease}>
                    Lösen
                  </Button>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-sep bg-sep @lg:grid-cols-4">
              <Stat label="Mahlgrad" value={sel.grind_um != null ? eventGrind(sel)! : "–"} unit={sel.grind_um != null ? "µm" : undefined}
                sub={sel.grind_target_um != null && tenth(sel.grind_target_um) !== tenth(sel.grind_um ?? -1) ? `Rezept ${fmtG(tenth(sel.grind_target_um))} µm` : null} />
              <Stat label="Dosis" value={sel.dose_g != null ? n1.format(sel.dose_g) : "–"} unit={sel.dose_g != null ? "g" : undefined}
                sub={sel.dose_target_g != null ? `Ziel ${n1.format(sel.dose_target_g)} g${sel.grind_s != null ? ` · ${n1.format(sel.grind_s)} s gemahlen` : ""}` : null} />
              <Stat label="Zeit" value={sel.shot_s != null ? fmtSec(sel.shot_s) : "–"} unit={sel.shot_s != null ? "s" : undefined}
                sub={sel.brew_time_target_s != null ? `Ziel ${fmtSec(sel.brew_time_target_s)} s` : sel.shot_s == null ? "ohne Waage/Zeiteingabe" : null} />
              <Stat label="Ausbeute" value={sel.yield_g != null ? n1.format(sel.yield_g) : "–"} unit={sel.yield_g != null ? "g" : undefined}
                sub={sel.yield_g != null && sel.dose_g ? `1:${n1.format(sel.yield_g / sel.dose_g)}` : null} />
            </div>
            {sel.brew_id != null && sel.brew_id !== brewId && (
              <p className="m-0 border-t border-sep px-4 py-2 text-[12px] text-ink2">
                Hing bisher an einem Bezug von {sel.brew_coffee ?? "einem anderen Kaffee"}; beim Sichern wechselt er hierher.
              </p>
            )}
          </>
        ) : (
          <p className="m-0 px-4 py-3 text-[14px] text-ink2">
            {loading && !events.length
              ? "Mahlvorgänge werden geholt …"
              : events.length
                ? "Keiner übernommen. Wähle den Mahlvorgang zu diesem Bezug:"
                : "Kein Mahlvorgang in diesem Zeitraum. Neue erscheinen hier von selbst."}
          </p>
        )}
        {listed.length > 0 && (
          <ul className="m-0 flex list-none flex-col border-t border-sep p-0">
            {listed.map((e) => {
              const taken = e.brew_id != null && e.brew_id !== brewId;
              return (
                <li key={e.id} className="flex items-center gap-3 border-t border-sep px-4 py-2 first:border-t-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="tnum truncate text-[14px] font-semibold">
                      {when(e.ground_at)}
                      <span className="font-normal text-ink2"> · {eventLine(e) || "ohne Werte"}</span>
                    </span>
                    {taken && <span className="truncate text-[12px] text-ink3">schon bei {e.brew_coffee ?? "einem Bezug"}</span>}
                  </span>
                  <Button size="sm" variant={taken ? "plain" : "secondary"} onClick={() => onPick(e)}>
                    Übernehmen
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {others.length > (sel ? 0 : 4) && (
          <div className="flex justify-center border-t border-sep px-2 py-1">
            <Button size="sm" variant="plain" onClick={() => setMore((m) => !m)}>
              {more ? "Weniger" : sel ? "Anderen Mahlvorgang wählen" : `Ältere (${fmtDateShort(others[others.length - 1].ground_at)} …)`}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
