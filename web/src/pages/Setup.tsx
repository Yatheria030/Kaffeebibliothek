import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { useState } from "react";
import { api } from "../api.ts";
import { navigate } from "../lib/router.ts";
import { Button, cx, LoadError, Spinner } from "../ui/controls.tsx";
import { NeedTag } from "../ui/ConfigForm.tsx";
import { toast } from "../ui/overlay.tsx";
import { LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { SECTIONS, SectionBody } from "./Settings.tsx";

type Need = "Pflicht" | "Optional" | "Empfohlen";
type Value = { name: string; need: Need; what: string; where?: string };
type Step = { slug: string; title: string; lead: string; values: Value[] };

/**
 * Erste Schritte: dieselben Bereiche wie die Einstellungen, in sinnvoller Reihenfolge, je Schritt eine Liste der Werte mit
 * Pflicht/Optional, wofür sie da sind und wo man sie findet. Pflicht ist nichts: Ohne jede Angabe läuft die App, nur von Hand.
 */
const STEPS: Step[] = [
  {
    slug: "allgemein",
    title: "Zeitzone",
    lead: "Damit die nächtliche Sicherung zur richtigen Uhrzeit läuft und „heute“ auf dem Server stimmt.",
    values: [{ name: "Zeitzone", need: "Empfohlen", what: "IANA-Name wie Europe/Berlin. Leer: die des Servers bzw. TZ aus der Umgebung." }],
  },
  {
    slug: "anthropic",
    title: "Anthropic-API",
    lead: "Liest neue Kaffees aus Shop-Link, Name oder Packungsfoto aus und sucht unter „Was passt zu mir?“ nach Kaffees. Ohne Key erfasst du alles von Hand.",
    values: [
      { name: "API-Key", need: "Optional", what: "Schlüssel für die Anthropic-API, kostet Nutzung je Auslesen.", where: "console.anthropic.com → API Keys" },
      { name: "Modell", need: "Optional", what: "Leer: Standard-Modell. Kleinere Modelle sind günstiger, lesen aber weniger gründlich." },
    ],
  },
  {
    slug: "muehle",
    title: "Mühle",
    lead: "Für den Mahlkompass (Startwert je neuer Tüte) und um Mahlvorgänge automatisch in Bezüge zu übernehmen.",
    values: [
      { name: "Deine Mühle", need: "Empfohlen", what: "Profil für den Mahlkompass. „Andere Mühle“ schaltet ihn ab, Startwerte kommen dann nur aus deinen Bezügen." },
      { name: "Mühle im Heimnetz", need: "Optional", what: "Adresse der Mahlkönig E64 WS (Weboberfläche), z. B. 192.168.1.50.", where: "Display der Mühle → Netzwerk" },
      { name: "Mahlkönig Sync", need: "Optional", what: "E-Mail und Passwort des Cloud-Kontos, Store-ID findet die App selbst.", where: "sync.mahlkoenig.com" },
      { name: "Abgleich", need: "Optional", what: "Wie oft (Standard alle 10 min) und wie weit zurück (Standard 90 Tage)." },
    ],
  },
  {
    slug: "maschine",
    title: "Maschine",
    lead: "Decent DE1: Shots per Plugin der de1app übernehmen, Livewerte und Schalter über Home Assistant.",
    values: [
      { name: "Home Assistant", need: "Optional", what: "Adresse und Long-Lived Access Token.", where: "Home Assistant → Profil → Sicherheit" },
      { name: "Erkennung", need: "Optional", what: "Teile der Entitäts-IDs der Maschine, Standard „decent, de1“ (de1app-MQTT-Plugin)." },
      { name: "Decent-Plugin", need: "Optional", what: "ZIP laden und in der de1app unter plugins/ entpacken, die Adresse dieser App steht schon drin." },
    ],
  },
  {
    slug: "espresso",
    title: "Espresso-Ziel",
    lead: "Dosis, Verhältnis, Zeit, Preinfusion und Temperatur je Röstgrad. Gegen dieses Ziel lernt der Mahlkompass.",
    values: [
      { name: "Ziel je Röstgrad", need: "Optional", what: "Leer: eingebaute Werte (z. B. mittel 18 g, 1:2–2,2, 25–30 s). Am Kaffee einzeln überschreibbar." },
      { name: "Rezepte", need: "Optional", what: "Vorlagen für Bezüge, entstehen auch direkt beim Bewerten." },
    ],
  },
  {
    slug: "lager",
    title: "Trinkfenster",
    lead: "Wann ein Kaffee nach der Röstung trinkbereit ist, wann er am besten ist und wie lange er gut bleibt.",
    values: [{ name: "Trinkfenster", need: "Optional", what: "Tage je „Geröstet für“ und Röstgrad. Leer: recherchierte Röster-Werte." }],
  },
  {
    slug: "daten",
    title: "Sicherung",
    lead: "Jede Nacht ein ZIP mit Datenbank und Bildern. Ohne Ordner gibt es nur die Sicherung von Hand.",
    values: [
      { name: "Ordner", need: "Empfohlen", what: "Absoluter Pfad auf dem Server, im Container ein eingehängter Ordner wie /backups." },
      { name: "Uhrzeit", need: "Optional", what: "Standard 02:30, in der Zeitzone von oben." },
      { name: "Behalten", need: "Optional", what: "So viele Sicherungen bleiben liegen, Standard 14." },
    ],
  },
];

export function SetupPage() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backups });
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = i === STEPS.length;

  const finish = async () => {
    setBusy(true);
    try {
      qc.setQueryData(["settings"], await api.saveSettings({ onboarded: true }));
      toast("Eingerichtet. Viel Spaß mit deiner Bibliothek");
      navigate("/");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setBusy(false);
    }
  };
  const go = (n: number) => {
    setI(n);
    window.scrollTo({ top: 0 });
  };

  if (error && !data)
    return (
      <>
        <Toolbar title="Erste Schritte" />
        <Page narrow>
          <LargeTitle lift>Erste Schritte</LargeTitle>
          <LoadError what="Die Einstellungen wurden" error={error} retry={() => void refetch()} />
        </Page>
      </>
    );
  if (!data)
    return (
      <>
        <Toolbar title="Erste Schritte" />
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      </>
    );

  const step = STEPS[i];
  const nav = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="plain" icon={ArrowLeft} disabled={i === 0} onClick={() => go(i - 1)}>
        Zurück
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        {!last && (
          <Button variant="plain" onClick={() => void finish()} disabled={busy}>
            Später einrichten
          </Button>
        )}
        {last ? (
          <Button variant="primary" icon={Check} loading={busy} onClick={() => void finish()}>
            Fertig
          </Button>
        ) : (
          <Button variant="primary" icon={ArrowRight} onClick={() => go(i + 1)}>
            {i === STEPS.length - 1 ? "Übersicht" : "Weiter"}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Toolbar title="Erste Schritte" tab={`${last ? "Übersicht" : step.title} · Erste Schritte`} />
      <Page>
        <LargeTitle lift sub="Nichts davon ist Pflicht: Ohne jede Angabe läuft die App, du erfasst dann alles von Hand. Alles lässt sich später unter Einstellungen ändern.">
          Erste Schritte
        </LargeTitle>

        {/* Fortschritt: Punkte zum Springen */}
        <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Schritte">
          {[...STEPS.map((s) => s.title), "Übersicht"].map((t, n) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => go(n)}
                aria-current={n === i ? "step" : undefined}
                className={cx(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold",
                  n === i ? "bg-accent text-white" : n < i ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2",
                )}
              >
                <span className="tnum">{n + 1}</span>
                <span className={cx(n !== i && "max-sm:hidden")}>{t}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="flex w-full max-w-[820px] min-w-0 flex-col gap-6">
        {last ? (
          <Summary data={data} backupsEnabled={backups.data?.enabled ?? false} jump={go} />
        ) : (
          <div key={step.slug} className="flex flex-col gap-6">
            <header className="flex flex-col gap-1 px-1">
              <h2 className="m-0 text-[22px] font-extrabold tracking-[-0.015em]">
                {i + 1}. {step.title}
              </h2>
              <p className="m-0 text-[14px] leading-snug text-ink2">{step.lead}</p>
            </header>
            <ValueList values={step.values} />
            <SectionBody slug={step.slug} data={data} backups={backups.data} backupsLoading={backups.isLoading} setup />
          </div>
        )}
        {nav}
        </div>
      </Page>
    </>
  );
}

/** Was in diesem Schritt einzutragen ist, mit Pflicht/Optional und Fundort */
function ValueList({ values }: { values: Value[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 px-1 pb-0.5 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">Werte in diesem Schritt</h3>
      <ul className="m-0 flex list-none flex-col gap-0 overflow-hidden rounded-[16px] bg-card p-0 shadow-card [&>*+*]:border-t [&>*+*]:border-sep">
        {values.map((v) => (
          <li key={v.name} className="flex flex-col gap-0.5 px-4 py-2.5">
            <span className="text-[15px] font-semibold">
              {v.name}
              <NeedTag need={v.need} />
            </span>
            <span className="text-[13px] leading-snug text-ink2">{v.what}</span>
            {v.where && <span className="text-[12px] text-ink3">Zu finden: {v.where}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Übersicht: Stand je Bereich wie im Untermenü der Einstellungen, offene Punkte springen zum Schritt */
function Summary({ data, backupsEnabled, jump }: { data: import("../../../shared/types.ts").Settings; backupsEnabled: boolean; jump: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 px-1">
        <h2 className="m-0 flex items-center gap-2 text-[22px] font-extrabold tracking-[-0.015em]">
          <Rocket size={20} className="text-accent" aria-hidden="true" />
          Übersicht
        </h2>
        <p className="m-0 text-[14px] leading-snug text-ink2">Was eingerichtet ist und was offen bleibt. Antippen springt zum Schritt.</p>
      </header>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[16px] bg-card p-0 shadow-card [&>*+*]:border-t [&>*+*]:border-sep">
        {STEPS.map((s, n) => {
          const sec = SECTIONS.find((x) => x.slug === s.slug)!;
          const st = sec.status(data, { enabled: backupsEnabled, list: [] });
          const text = s.slug === "daten" ? (backupsEnabled ? `Nachts um ${data.config.effective.backup_time}` : "Nachts aus") : st.text;
          const tone = s.slug === "daten" ? (backupsEnabled ? "ok" : "warn") : st.tone;
          return (
            <li key={s.slug}>
              <button type="button" onClick={() => jump(n)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                <span
                  aria-hidden="true"
                  className={cx("size-2 shrink-0 rounded-full", tone === "ok" ? "bg-good" : tone === "warn" ? "bg-[var(--c-orange)]" : "bg-ink3/50")}
                />
                <span className="flex-1 text-[15px] font-semibold">{s.title}</span>
                <span className="truncate text-[14px] text-ink2">{text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
