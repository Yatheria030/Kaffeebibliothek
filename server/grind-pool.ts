// Hauptthread-Seite des Mahlgrad-Workers: Anfragen weiterreichen, nach Änderungen vorrechnen lassen. Startet der Worker nicht,
// rechnet der Hauptthread wie früher selbst (langsam, aber richtig).
import { Worker } from "node:worker_threads";
import type { GrindPrediction } from "../shared/grind.ts";
import { predictGrind } from "./grind.ts";

type Opts = Parameters<typeof predictGrind>[0];
type Reply = { id: number; result?: GrindPrediction | null; error?: string };

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, { resolve: (v: GrindPrediction | null) => void; reject: (e: Error) => void; opts: Opts }>();

function start(): Worker | null {
  if (worker || broken) return worker;
  try {
    // execArgv erbt den tsx-Loader, der Worker läuft also auch direkt aus TS
    const w = new Worker(new URL("./grind-worker.ts", import.meta.url));
    w.unref();
    w.on("message", (r: Reply) => {
      const p = waiting.get(r.id);
      if (!p) return;
      waiting.delete(r.id);
      if (r.error != null) p.reject(new Error(r.error));
      else p.resolve(r.result ?? null);
    });
    const fail = (e: unknown) => {
      console.error("Mahlgrad-Worker beendet, rechne im Hauptthread:", e);
      worker = null;
      // Offene Anfragen nicht hängen lassen
      for (const [id, p] of waiting) {
        waiting.delete(id);
        try {
          p.resolve(predictGrind(p.opts));
        } catch (err) {
          p.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };
    w.on("error", (e) => {
      broken = true;
      fail(e);
    });
    w.on("exit", (code) => {
      if (code !== 0 && !broken) fail(`Exit ${code}`);
      worker = null;
    });
    worker = w;
  } catch (e) {
    broken = true;
    console.error("Mahlgrad-Worker startet nicht, rechne im Hauptthread:", e);
  }
  return worker;
}

export function predictGrindAsync(opts: Opts): Promise<GrindPrediction | null> {
  const w = start();
  if (!w) return Promise.resolve(predictGrind(opts));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, opts });
    w.postMessage({ t: "predict", id, opts, tz: process.env.TZ });
  });
}

let warmTimer: NodeJS.Timeout | null = null;
/** Nach einer Änderung (kurz entprellt) die zuletzt gefragten Startwerte im Worker neu rechnen lassen */
export function warmGrind() {
  if (!worker) return;
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => worker?.postMessage({ t: "warm", tz: process.env.TZ }), 1500);
  warmTimer.unref();
}
