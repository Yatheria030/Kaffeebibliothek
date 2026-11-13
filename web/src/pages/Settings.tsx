import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, CheckCircle2, ChevronRight, Coffee, Disc3, Download, KeyRound, Package, Rocket, Settings2, Sparkles, Target, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { api, type BackupList } from "../api.ts";
import { fmtDateTime } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { Banner, Button, cx, LoadError, Spinner } from "../ui/controls.tsx";
import { Group, Row, SelectField } from "../ui/form.tsx";
import { GRINDERS, NO_GRINDER } from "../../../shared/compass.ts";
import type { Settings } from "../../../shared/types.ts";
import { parseShotTargets } from "../../../shared/shot.ts";
import { confirmDialog, toast } from "../ui/overlay.tsx";
import { LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { GrinderSyncSettings } from "../ui/GrinderSync.tsx";
import { DecentSettings } from "../ui/DecentShot.tsx";
import { HaSettings } from "../ui/MachineLive.tsx";
import { ShotTargetSettings } from "../ui/ShotTarget.tsx";
import { ConfigGroup, DrinkWindowSettings, MODELS, TIMEZONES } from "../ui/ConfigForm.tsx";

const fmtSize = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);

function DownloadLink({ href, icon: Icon = Download, children }: { href: string; icon?: typeof Download; children: React.ReactNode }) {
  return (
    <a href={href} download className="no-underline">
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[14px] font-medium text-accent hover:bg-fill2">
        <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
        {children}
      </span>
    </a>
  );
}

type Tone = "ok" | "warn" | "off";
type Section = {
  slug: string;
  label: string;
  icon: LucideIcon;
  intro: string;
  /** Kurzstand für das Untermenü */
  status: (d: Settings, b: BackupList | undefined) => { text: string; tone: Tone };
};

export const SECTIONS: Section[] = [
  {
    slug: "muehle",
    label: "Mühle",
    icon: Disc3,
    intro: "Deine Mühle für den Mahlkompass und woher die App die Mahlvorgänge holt.",
    status: (d) => {
      const m = d.mahlkoenig;
      if (m.local_error ?? m.last_error) return { text: "Abgleich gestört", tone: "warn" };
      if (m.local_host) return { text: "Im Heimnetz verbunden", tone: "ok" };
      if (m.cloud) return { text: "Über die Cloud", tone: "ok" };
      return { text: GRINDERS.find((g) => g.id === d.grinder)?.name ?? "Andere Mühle", tone: "off" };
    },
  },
  {
    slug: "maschine",
    label: "Maschine",
    icon: Coffee,
    intro: "Decent DE1: Shots per Plugin der de1app, Livewerte und Schalter über Home Assistant.",
    status: (d) =>
      d.homeassistant.set || d.decent.shots > 0
        ? { text: [d.homeassistant.set && "Home Assistant", d.decent.shots > 0 && `${d.decent.shots} Shots`].filter(Boolean).join(" · "), tone: "ok" }
        : { text: "Nicht eingerichtet", tone: "off" },
  },
  {
    slug: "espresso",
    label: "Espresso & Rezepte",
    icon: Target,
    intro: "Ziel für Dosis, Verhältnis und Zeit je Röstgrad und deine Vorlagen für Bezüge.",
    status: (d) => ({ text: JSON.stringify(d.shot_targets) !== JSON.stringify(parseShotTargets(null)) ? "Ziel angepasst" : "Standard-Ziel", tone: "off" }),
  },
  {
    slug: "lager",
    label: "Lager & Frische",
    icon: Package,
    intro: "Trinkfenster je „Geröstet für“ und Röstgrad: wann ein Kaffee trinkbereit ist und wie lange er am besten schmeckt.",
    status: (d) => ({ text: d.config.saved.drink_windows ? "Eigene Fenster" : "Röster-Werte", tone: "off" }),
  },
  {
    slug: "anthropic",
    label: "Anthropic-API",
    icon: Sparkles,
    intro: "Liest beim Hinzufügen Shop-Seiten, sucht nach Namen und erkennt Packungsfotos. Ohne Key geht alles von Hand.",
    status: (d) => (d.api_key.set ? { text: "Key hinterlegt", tone: "ok" } : { text: "Kein Key", tone: "warn" }),
  },
  {
    slug: "daten",
    label: "Daten & Sicherung",
    icon: Archive,
    intro: "Sicherung und Export laden, nächtliche Sicherungen auf dem Server.",
    status: (_d, b) =>
      !b ? { text: "…", tone: "off" } : !b.enabled ? { text: "Nachts aus", tone: "warn" } : b.list[0] ? { text: `Zuletzt ${fmtDateTime(b.list[0].at)}`, tone: "ok" } : { text: "Noch keine", tone: "off" },
  },
  {
    slug: "allgemein",
    label: "Allgemein",
    icon: Settings2,
    intro: "Zeitzone des Servers, Darstellung und die Ersten Schritte.",
    status: (d) => ({ text: d.config.effective.timezone, tone: "off" }),
  },
];

const TONE: Record<Tone, string> = { ok: "bg-good", warn: "bg-[var(--c-orange)]", off: "bg-ink3/50" };

/** Untermenü: breit als Liste links mit Kurzstand, schmal als waagerecht scrollende Leiste */
function SectionNav({ active, data, backups }: { active: Section; data: Settings; backups: BackupList | undefined }) {
  const go = (e: React.MouseEvent, slug: string) => {
    e.preventDefault();
    navigate(`/einstellungen/${slug}`, { replace: true });
  };
  return (
    <nav aria-label="Bereiche der Einstellungen" className="min-w-0 @3xl:sticky @3xl:top-[68px]">
      <ul className="-mx-4 m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 @3xl:mx-0 @3xl:flex-col @3xl:gap-0.5 @3xl:overflow-visible @3xl:px-0 @3xl:pb-0">
        {SECTIONS.map((sec) => {
          const on = sec === active;
          const st = sec.status(data, backups);
          const Icon = sec.icon;
          return (
            <li key={sec.slug} className="shrink-0">
              <a
                href={`#/einstellungen/${sec.slug}`}
                onClick={(e) => go(e, sec.slug)}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2 no-underline",
                  // schmal: Pillen
                  "h-9 rounded-full px-3.5 text-[14px] @3xl:h-auto @3xl:gap-2.5 @3xl:rounded-[10px] @3xl:px-2.5 @3xl:py-2",
                  on ? "bg-selected font-bold text-accent" : "bg-fill font-semibold text-ink hover:bg-hover @3xl:bg-transparent",
                )}
              >
                <Icon size={16} strokeWidth={2.2} className={cx("shrink-0", on ? "text-accent" : "text-ink2")} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate whitespace-nowrap">{sec.label}</span>
                  <span className="hidden items-center gap-1.5 text-[12px] font-normal text-ink3 @3xl:flex">
                    <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-full", TONE[st.tone])} />
                    <span className="truncate">{st.text}</span>
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SettingsPage({ section }: { section: string | null }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backups });

  if (error && !data)
    return (
      <>
        <Toolbar title="Einstellungen" />
        <Page narrow>
          <LargeTitle lift>Einstellungen</LargeTitle>
          <LoadError what="Die Einstellungen wurden" error={error} retry={() => void refetch()} />
        </Page>
      </>
    );
  if (isLoading || !data)
    return (
      <>
        <Toolbar title="Einstellungen" />
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      </>
    );

  // alte Adressen: #/einstellungen/claude und /darstellung
  const slug = section === "claude" ? "anthropic" : section === "darstellung" ? "allgemein" : section;
  const active = SECTIONS.find((x) => x.slug === slug) ?? SECTIONS[0];

  return (
    <>
      <Toolbar title="Einstellungen" tab={`${active.label} · Einstellungen`} />
      <Page wide>
        <LargeTitle lift>Einstellungen</LargeTitle>

        {/* Breit: Untermenü links mit Kurzstand je Bereich, rechts der gewählte Bereich. Schmal: Leiste über dem Inhalt */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-[240px_minmax(0,1fr)] @3xl:items-start @3xl:gap-8">
            <SectionNav active={active} data={data} backups={backups.data} />
            <div key={active.slug} className="flex w-full max-w-[820px] min-w-0 flex-col gap-6">
              <header className="flex flex-col gap-1 px-1">
                <h2 className="m-0 text-[22px] font-extrabold tracking-[-0.015em]">{active.label}</h2>
                <p className="m-0 text-[14px] leading-snug text-ink2">{active.intro}</p>
              </header>
              <SectionBody slug={active.slug} data={data} backups={backups.data} backupsLoading={backups.isLoading} />
            </div>
          </div>
        </div>
      </Page>
    </>
  );
}

/** Inhalt eines Bereichs, auch für die Ersten Schritte (`setup` blendet den Verweis auf sie aus) */
export function SectionBody({
  slug,
  data,
  backups,
  backupsLoading,
  setup,
}: {
  slug: string;
  data: Settings;
  backups: BackupList | undefined;
  backupsLoading: boolean;
  setup?: boolean;
}) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (value: string | null) => {
    setSaving(true);
    try {
      const s = await api.saveSettings({ api_key: value });
      qc.setQueryData(["settings"], s);
      setKey("");
      toast(value ? "API-Key gesichert" : "API-Key entfernt");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveGrinder = async (grinder: string) => {
    try {
      const s = await api.saveSettings({ grinder });
      qc.setQueryData(["settings"], s);
      await qc.invalidateQueries({ queryKey: ["grind"] });
      toast(grinder === NO_GRINDER ? "Mahlkompass aus, Startwerte nur aus deinen Bezügen" : `Mühle: ${GRINDERS.find((g) => g.id === grinder)?.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: "API-Key entfernen?",
      message:
        data?.api_key.source === "db"
          ? "Der hier hinterlegte Key wird gelöscht. Ist auf dem Server ein Key in der Umgebung gesetzt, gilt danach dieser."
          : "Der Key wird gelöscht.",
      confirmLabel: "Entfernen",
      danger: true,
    });
    if (ok) await save(null);
  };

  const k = data.api_key;
  const trimmed = key.trim();

  const cfg = data.config;

  const claude = (
    <>
      <Group
        title="API-Key"
        footer={
          <>
            Den Key legst du unter{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-accent">
              console.anthropic.com
            </a>{" "}
            an. Er wird nur auf dem Server gespeichert und nie wieder angezeigt.
          </>
        }
      >
        <Row label="Status">
          {k.set ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[15px] text-ink2">
              <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden="true" />
              <span className="tnum">{k.hint}</span>
              <span className="truncate text-ink3">· {k.source === "env" ? "aus der Umgebung" : "hier hinterlegt"}</span>
            </span>
          ) : (
            <span className="text-[15px] text-ink3">Kein Key</span>
          )}
        </Row>
        <form
          className="flex flex-wrap items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) void save(trimmed);
          }}
        >
          <label htmlFor="st-key" className="sr-only">
            API-Key
          </label>
          <input
            id="st-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={k.set ? "Neuen Key einsetzen" : "sk-ant-…"}
            className="field h-9 min-w-0 flex-[1_1_220px] rounded-[9px] bg-fill px-3 text-[15px]"
          />
          <Button type="submit" variant="primary" size="sm" icon={KeyRound} loading={saving} disabled={!trimmed}>
            Sichern
          </Button>
          {k.source === "db" && (
            <Button type="button" variant="plain" size="sm" onClick={() => void remove()}>
              Entfernen
            </Button>
          )}
        </form>
      </Group>
      {!k.set && (
        <Banner tone="info" icon={Sparkles}>
          Ohne Key funktioniert alles außer dem automatischen Auslesen. Neue Kaffees erfasst du dann von Hand.
        </Banner>
      )}
      <ConfigGroup
        config={cfg}
        title="Modell"
        footer="Für Auslesen und „Was passt zu mir?“. Größere Modelle lesen gründlicher, kleinere sind günstiger."
        fields={[{ key: "model", label: "Modell", kind: "text", list: MODELS }]}
      />
    </>
  );

  const grinder = (
    <>
      <Group
        title="Mahlkompass"
        footer={
          data.grinder !== NO_GRINDER
            ? `Startwert für neue Kaffees aus Röstgrad, Aufbereitung, Höhe, Robusta-Anteil und Röstalter, gelernt wird nur deine Abweichung. ${GRINDERS.find((g) => g.id === data.grinder)?.note ?? ""} Rezepte, die im Feld „Mühle“ eine andere nennen, nutzen ihn nicht.`
            : "Ohne bekannte Mühle gibt es keinen Mahlkompass und keinen Regler, Startwerte kommen nur aus deinen gelungenen Bezügen."
        }
      >
        <Row label="Deine Mühle" htmlFor="set-grinder">
          <SelectField
            id="set-grinder"
            value={data.grinder}
            onChange={(v) => void saveGrinder(v)}
            options={[...GRINDERS.map((g) => ({ value: g.id, label: g.name })), { value: NO_GRINDER, label: "Andere Mühle" }]}
          />
        </Row>
        <Row label="Mahlkompass">
          <PillLink href="#/wissen/mahlkompass">Wie er rechnet</PillLink>
        </Row>
      </Group>
      <GrinderSyncSettings status={data.mahlkoenig} />
      <ConfigGroup
        config={cfg}
        title="Abgleich"
        footer="Wie oft die App Mahlvorgänge holt (Heimnetz und Cloud) und wie weit der erste Abgleich zurückreicht. Danach holt sie ab dem letzten Mahlvorgang."
        fields={[
          { key: "sync_min", label: "Alle", kind: "int", suffix: "min" },
          { key: "sync_days", label: "Zeitraum", kind: "int", suffix: "Tage" },
        ]}
      />
    </>
  );

  const content: Record<string, React.ReactNode> = {
    muehle: grinder,
    maschine: (
      <>
        <HaSettings status={data.homeassistant} />
        <ConfigGroup
          config={cfg}
          title="Erkennung in Home Assistant"
          footer="Teile der Entitäts-IDs, an denen die App die Maschine erkennt, mit Komma getrennt. Kurze Teile (bis 3 Zeichen) zählen nur zwischen Punkt oder Unterstrich."
          fields={[{ key: "ha_match", label: "IDs enthalten", kind: "text" }]}
        />
        <DecentSettings status={data.decent} />
      </>
    ),
    espresso: (
      <>
        <ShotTargetSettings value={data.shot_targets} />
        <Group title="Rezepte" footer="Vorlagen für Bezüge: Beim Bewerten wählst du eins aus, die Werte kommen vorbelegt. Neue entstehen auch direkt beim Bewerten.">
          <Row label="Rezepte">
            <PillLink href="#/rezepte">Verwalten</PillLink>
          </Row>
        </Group>
      </>
    ),
    lager: <DrinkWindowSettings config={cfg} />,
    anthropic: claude,
    daten: <DataGroups backups={backups} loading={backupsLoading} config={cfg} />,
    allgemein: (
      <>
        <ConfigGroup
          config={cfg}
          title="Zeitzone"
          footer="Bestimmt die Uhrzeit der nächtlichen Sicherung und das Datum auf dem Server. Jede IANA-Zone, z. B. Europe/Berlin."
          fields={[{ key: "timezone", label: "Zeitzone", kind: "text", list: TIMEZONES }]}
        />
        <Group title="Darstellung">
          <Row label="Erscheinungsbild">
            <span className="text-[15px] text-ink2">folgt dem System</span>
          </Row>
        </Group>
        {!setup && (
          <Group title="Erste Schritte" footer="Führt Schritt für Schritt durch alle Werte, die du einstellen kannst, und zeigt, was noch offen ist.">
            <Row label="Einrichtung">
              <PillLink href="#/erste-schritte" icon={Rocket}>
                Öffnen
              </PillLink>
            </Row>
          </Group>
        )}
      </>
    ),
  };

  return <>{content[slug]}</>;
}

function PillLink({ href, children, icon: Icon = BookOpen }: { href: string; children: React.ReactNode; icon?: LucideIcon }) {
  return (
    <a href={href} className="no-underline">
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[14px] font-medium text-accent hover:bg-fill2">
        <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
        {children}
        <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </a>
  );
}

/** Daten und Sicherungen */
function DataGroups({ backups, loading, config }: { backups: BackupList | undefined; loading: boolean; config: Settings["config"] }) {
  const e = config.effective;
  return (
    <>
    <Group
      title="Daten"
      footer="Die Sicherung ist ein ZIP mit Datenbank (kaffee.db), allen Bildern (images/) und einer JSON-Kopie. Zurückspielen: bei gestopptem Container in den Datenordner entpacken. Der JSON-Export enthält nur die Daten, keine Bilder."
    >
      <Row label="Sicherung">
        <DownloadLink href="/api/backup" icon={Archive}>
          ZIP laden
        </DownloadLink>
      </Row>
      <Row label="Export">
        <DownloadLink href="/api/export">JSON laden</DownloadLink>
      </Row>
    </Group>

    <ConfigGroup
      config={config}
      title="Nächtliche Sicherung"
      toggle={{ key: "backup_off", label: "Nächtliche Sicherung" }}
      footer={
        e.backup_off
          ? "Ausgeschaltet. Die ZIP-Sicherung oben geht trotzdem."
          : e.backup_dir
            ? `Jede Nacht um ${e.backup_time} (${e.timezone}) nach ${e.backup_dir}, die letzten ${e.backup_keep} bleiben liegen. Startet der Server und ist die letzte älter als einen Tag, kommt gleich eine. Im Container einen eingehängten Ordner wählen, sonst ist die Sicherung mit dem Container weg.`
            : "Ohne Ordner keine nächtliche Sicherung. Die ZIP-Sicherung oben geht trotzdem."
      }
      fields={[
        { key: "backup_dir", label: "Ordner", kind: "text" },
        { key: "backup_time", label: "Uhrzeit", kind: "time" },
        { key: "backup_keep", label: "Behalten", kind: "int", suffix: "Stück" },
      ]}
    />
    <Group title="Vorhandene Sicherungen">
      {loading ? (
        <Row label="Sicherungen">
          <Spinner size={16} />
        </Row>
      ) : !backups?.enabled ? (
        <Row label="Status">
          <span className="text-[15px] text-ink2">Aus</span>
        </Row>
      ) : backups.list.length === 0 ? (
        <Row label="Status">
          <span className="text-[15px] text-ink2">Noch keine</span>
        </Row>
      ) : (
        backups.list.slice(0, 7).map((b) => (
          <Row key={b.name} label={fmtDateTime(b.at)}>
            <span className="tnum text-[13px] text-ink3">{fmtSize(b.size)}</span>
            <DownloadLink href={`/api/backups/${encodeURIComponent(b.name)}`}>Laden</DownloadLink>
          </Row>
        ))
      )}
    </Group>

    </>
  );
}
