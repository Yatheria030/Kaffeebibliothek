// Mahlgrad-Modell im eigenen Thread: Kreuzvalidierung über viele Tüten dauert Sekunden und darf den Server nicht anhalten.
// Eigene Verbindung zur Datenbank (WAL, nur lesen); `data_version` meldet Änderungen des Hauptthreads, dann rechnet learnFrom neu.
import { parentPort } from "node:worker_threads";
import { predictGrind } from "./grind.ts";

type Opts = Parameters<typeof predictGrind>[0];
type Msg = { t: "predict"; id: number; opts: Opts; tz: string | undefined } | { t: "warm"; tz: string | undefined };

/** Zuletzt gefragte Zubereitungen; nach einer Änderung im Voraus neu rechnen, damit der nächste Dialog nicht wartet */
const recent = new Map<string, Opts>();
const keyOf = (o: Opts) => [o.coffee_id, o.batch_id, o.method, o.grinder].join("|");

// Zeitzone folgt der Einstellung des Hauptthreads; das Setzen hier stellt auch die Uhr dieses Threads um
const useTz = (tz: string | undefined) => {
  if (tz && process.env.TZ !== tz) process.env.TZ = tz;
};

parentPort!.on("message", (m: Msg) => {
  useTz(m.tz);
  if (m.t === "warm") {
    for (const o of recent.values()) {
      try {
        predictGrind(o);
      } catch {
        // beim Vorrechnen still, die echte Anfrage meldet den Fehler
      }
    }
    return;
  }
  try {
    const result = predictGrind(m.opts);
    const k = keyOf(m.opts);
    recent.delete(k);
    recent.set(k, m.opts);
    if (recent.size > 12) recent.delete(recent.keys().next().value!);
    parentPort!.postMessage({ id: m.id, result });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) });
  }
});
