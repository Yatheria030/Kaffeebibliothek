// Mahlkönig E64 WS im Heimnetz: Die Mühle hat eine eigene Weboberfläche (lighttpd/PHP, selbstsigniertes Zertifikat). `login.php`
// meldet ohne Passwort als Owner an, `rest_api/download_database` liefert ihre SQLite-Datenbank mit jedem Mahlvorgang (`grind_log`).
// Die Cloud gibt einzelne Mahlvorgänge nur für Grind-by-Sync heraus, deshalb holen wir sie hier direkt. Nur lesend, nichts an der Mühle ändern.
import { request } from "node:https";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { cfg } from "./config.ts";
import type { EventRow } from "./mahlkoenig.ts";

export class GrinderLocalError extends Error {}

const TIMEOUT = 8_000;
/** Auslassen und Vormahlen startet man am Knopf, ein Bezug startet über die Siebträger-Erkennung (`PortafilterDetection`) */
const MANUAL_TRIGGER = "StartButton";
/** Spülen, Leerlauf und Fehlmessungen ohne Siebträger: unter 3 g oder schneller als 4 g/s (die E64 schafft gut 2 g/s) */
const MIN_DOSE_G = 3;
const MAX_G_PER_S = 4;

/** Adresse vereinheitlichen: „192.168.1.50“ oder „https://mühle/“ → „https://192.168.1.50“ */
export function grinderHost(input: string): string | null {
  const s = input.trim().replace(/\/+$/, "");
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return `https://${u.host}`;
  } catch {
    return null;
  }
}

function get(url: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    // Die Mühle hat nur ein selbstsigniertes Zertifikat
    const req = request(url, { method: "GET", headers, rejectUnauthorized: false, timeout: TIMEOUT }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (d: Buffer) => parts.push(d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    req.on("error", reject);
    req.end();
  });
}

async function download(host: string): Promise<Buffer> {
  try {
    const login = await get(`${host}/login.php`, {});
    const cookie = ([] as string[])
      .concat((login.headers["set-cookie"] as string[] | undefined) ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!cookie) throw new GrinderLocalError("Mühle hat keine Sitzung vergeben (ist das die Adresse der E64 WS?)");
    const res = await get(`${host}/rest_api/download_database`, { cookie, "content-type": "application/json" });
    if (res.status !== 200) throw new GrinderLocalError(`Mühle antwortet mit ${res.status}`);
    if (res.body.subarray(0, 15).toString("latin1") !== "SQLite format 3") throw new GrinderLocalError("Mühle liefert keine Datenbank");
    return res.body;
  } catch (e) {
    if (e instanceof GrinderLocalError) throw e;
    const code = (e as { code?: string }).code;
    const why =
      code === "TIMEOUT"
        ? `keine Antwort in ${TIMEOUT / 1000} s`
        : code === "EHOSTUNREACH" || code === "ENETUNREACH"
          ? "kein Weg ins Netz der Mühle"
          : (code ?? (e instanceof Error ? e.message : String(e)));
    throw new GrinderLocalError(`Mühle im Heimnetz nicht erreichbar (${why})`);
  }
}

type Row = {
  uuid: string;
  at: string;
  ddd: number;
  duration: number;
  weight: number;
  trigger: string | null;
  recipe_index: number | null;
  mode: string | null;
  coarseness: number | null;
  amount: number | null;
  brew_time: number | null;
  brew_duration: number | null;
  brew_mass: number | null;
};

const ms = (v: number | null) => (v == null ? null : Math.round(v / 100) / 10);

/** Mahlvorgänge der letzten 90 Tage von der Mühle, in der Form der Cloud-Ereignisse */
export async function localEvents(host: string, device = "E64WS"): Promise<EventRow[]> {
  const file = path.join(tmpdir(), `mahlkoenig-${randomUUID()}.db`);
  writeFileSync(file, await download(host));
  try {
    const g = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = g
        .prepare(
          `SELECT CAST(l.grind_uuid AS TEXT) AS uuid, l.grind_date_time AS at, l.grind_ddd AS ddd, l.grind_duration AS duration,
             l.grind_weight AS weight, t.grind_trigger_name AS trigger, l.recipe_index, m.recipe_mode_name AS mode,
             d.recipe_coarseness AS coarseness, d.recipe_amount AS amount, d.recipe_brew_time AS brew_time,
             b.brew_duration, b.brew_mass
           FROM grind_log l
           LEFT JOIN grind_trigger_modes t ON t.grind_trigger_id = l.grind_trigger_id
           LEFT JOIN recipe_data d ON d.recipe_data_id = l.recipe_data_id
           LEFT JOIN recipe_modes m ON m.recipe_mode_id = d.recipe_mode_id
           LEFT JOIN brew_events b ON b.grind_id = l.grind_id
           WHERE l.grind_successfull = 1 AND l.grind_date_time >= ?
           ORDER BY l.grind_id`,
        )
        .all(new Date(Date.now() - cfg().sync_days * 86_400_000).toISOString().slice(0, 19)) as Row[];
      const out: EventRow[] = [];
      for (const r of rows) {
        const t = Date.parse(r.at);
        const dose = r.weight / 1000;
        const secs = r.duration / 1000;
        if (!r.uuid || !Number.isFinite(t) || r.trigger === MANUAL_TRIGGER || dose < MIN_DOSE_G || secs <= 0 || dose / secs > MAX_G_PER_S) continue;
        const brewed = r.brew_duration != null || r.brew_mass != null;
        out.push({
          uuid: r.uuid,
          ground_at: new Date(t).toISOString(),
          device,
          // grind_ddd in 0,1 µm (1354 bei Rezept 135 µm)
          grind_um: Math.round(r.ddd) / 10,
          grind_target_um: r.coarseness,
          dose_g: Math.round(dose * 10) / 10,
          dose_target_g: r.mode === "ByWeight" ? ms(r.amount) : null,
          grind_s: Math.round(secs * 10) / 10,
          recipe_index: r.recipe_index,
          recipe_mode: r.mode ?? "",
          brew_time_target_s: ms(r.brew_time),
          brewed_at: brewed ? new Date(t).toISOString() : null,
          yield_g: ms(r.brew_mass),
          shot_s: ms(r.brew_duration),
          quality: "",
          raw: JSON.stringify({ source: "local", ...r }),
        });
      }
      return out;
    } finally {
      g.close();
    }
  } finally {
    rmSync(file, { force: true });
  }
}
