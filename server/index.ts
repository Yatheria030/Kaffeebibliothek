import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { stream } from "hono/streaming";
import { createReadStream, existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { z } from "zod";
import { backupDir, backupPath, listBackups, scheduleBackups, writeBackup, writeZip } from "./backup.ts";
import { connectHa, disconnectHa, HaError, haStatus, machineLive, switchMachine } from "./homeassistant.ts";
import { ArchiveError, saveArchiveFile, SHOT_FILTER } from "./decent-archive.ts";
import { coffeeProfile, profilesForTablet, updateProfile } from "./decent-profile.ts";
import { decentStatus, getShot, listShots, pluginFiles, PLUGIN_NAME, saveShot, ShotError } from "./decent.ts";
import { DATA_DIR, IMAGE_DIR } from "./db.ts";
import { brewTemplate } from "./grind.ts";
import { predictGrindAsync, warmGrind } from "./grind-pool.ts";
import {
  connectGrinder, connectLocal, disconnectGrinder, disconnectLocal, GrinderSyncError, grinderStatus, listGrinderEvents, scheduleGrinderSync, syncGrinder,
} from "./mahlkoenig.ts";
import { GrinderLocalError } from "./grinder-local.ts";
import { DEFAULT_GRINDER } from "../shared/compass.ts";
import { parseShotTargets } from "../shared/shot.ts";
import { lastRecommendations, recommend } from "./recommend.ts";
import { downloadImage, fetchRemoteImage, removeImage, saveDataUrl, scheduleImagePrune } from "./images.ts";
import { applyTimezone, ConfigError, configView, saveConfig } from "./config.ts";
import { apiKey, model, scrape, ScrapeError, scrapeRecipes } from "./scrape.ts";
import { followJob, getJob, listJobs, removeJob, startJob } from "./scrape-jobs.ts";
import {
  batchInputSchema,
  freezeSchema,
  brewInputSchema,
  coffeeInputSchema,
  coffeePatchSchema,
  decentProfileSchema,
  grinderAccountSchema,
  grinderLocalSchema,
  haAccountSchema,
  haSwitchSchema,
  recipeInputSchema,
  recipesScrapeSchema,
  recommendInputSchema,
  scrapeInputSchema,
  settingsInputSchema,
} from "./schemas.ts";
import * as store from "./store.ts";
import type { RecommendEvent, ScrapeEvent, Settings } from "../shared/types.ts";

const app = new Hono();
const api = new Hono();

// JSON-Routen höchstens 1 MB; Routen mit großen Körpern (Bilder, Decent, Auslesen) setzen ihr eigenes Limit
const BIG_BODY = /^\/api\/(images$|decent\/(shots|files)$|scrape(\/jobs)?$)/;
const smallBody = bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Anfrage zu groß" }, 413) });
api.use("*", (c, next) => (BIG_BODY.test(c.req.path) ? next() : smallBody(c, next)));
// Nach jeder Änderung die Startwerte im Hintergrund neu rechnen (der Worker merkt die Änderung über data_version)
api.use("*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.status < 400) warmGrind();
});

/** Zeitpunkt aus der Abfrage nur, wenn er lesbar und plausibel ist (sonst wirft toISOString später) */
const queryTime = (c: Context, name: string) => {
  const v = c.req.query(name);
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.UTC(2200, 0, 1) ? v : undefined;
};
const queryLimit = (c: Context) => {
  const n = Math.trunc(Number(c.req.query("limit")));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : undefined;
};

const idParam = (c: Context) => {
  const n = Number(c.req.param("id"));
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Ungültiges JSON" }, 400);
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 4)
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return c.json({ error: msg }, 400);
  }
  return r.data;
}

api.get("/health", (c) => c.json({ ok: true }));

// Kaffees
api.get("/coffees", (c) => c.json(store.listCoffees()));
api.get("/coffees/:id", (c) => {
  const id = idParam(c);
  const d = id ? store.getCoffee(id) : null;
  return d ? c.json({ ...d, decent_profile: coffeeProfile(d.coffee.id) }) : c.json({ error: "Kaffee nicht gefunden" }, 404);
});
// Decent-Profil des Kaffees: einzeln (die Karte fragt es oft ab, Änderungen am Tablet), Werte in der App ändern, das Plugin holt sie aufs Tablet
api.get("/coffees/:id/decent-profile", (c) => {
  const id = idParam(c);
  const p = id ? coffeeProfile(id) : null;
  return p ? c.json(p) : c.json({ error: "Kein Profil" }, 404);
});
api.put("/coffees/:id/decent-profile", async (c) => {
  const id = idParam(c);
  const b = await body(c, decentProfileSchema);
  if (b instanceof Response) return b;
  const p = id ? updateProfile(id, b) : null;
  return p ? c.json(p) : c.json({ error: "Kaffee nicht gefunden" }, 404);
});
api.post("/coffees", async (c) => {
  const b = await body(c, coffeeInputSchema);
  if (b instanceof Response) return b;
  return c.json({ id: store.createCoffee(b) }, 201);
});
api.put("/coffees/:id", async (c) => {
  const id = idParam(c);
  const b = await body(c, coffeeInputSchema);
  if (b instanceof Response) return b;
  if (!id) return c.json({ error: "Kaffee nicht gefunden" }, 404);
  const before = store.getCoffee(id);
  if (!before) return c.json({ error: "Kaffee nicht gefunden" }, 404);
  store.updateCoffee(id, b);
  const old = before.coffee.image;
  if (old && old !== b.image && !store.imageInUse(old)) await removeImage(old);
  return c.json({ id });
});
api.patch("/coffees/:id", async (c) => {
  const id = idParam(c);
  const b = await body(c, coffeePatchSchema);
  if (b instanceof Response) return b;
  return id && store.patchCoffee(id, b) ? c.json({ id }) : c.json({ error: "Kaffee nicht gefunden" }, 404);
});
api.delete("/coffees/:id", async (c) => {
  const id = idParam(c);
  const r = id ? store.deleteCoffee(id) : false;
  if (r === false) return c.json({ error: "Kaffee nicht gefunden" }, 404);
  if (r && !store.imageInUse(r)) await removeImage(r);
  return c.json({ ok: true });
});

// Chargen
api.post("/coffees/:id/batches", async (c) => {
  const id = idParam(c);
  const b = await body(c, batchInputSchema);
  if (b instanceof Response) return b;
  const bid = id ? store.createBatch(id, b) : null;
  return bid ? c.json({ id: bid }, 201) : c.json({ error: "Kaffee nicht gefunden" }, 404);
});
api.put("/batches/:id", async (c) => {
  const id = idParam(c);
  const b = await body(c, batchInputSchema);
  if (b instanceof Response) return b;
  return id && store.updateBatch(id, b) ? c.json({ id }) : c.json({ error: "Charge nicht gefunden" }, 404);
});
api.post("/batches/:id/freeze", async (c) => {
  const id = idParam(c);
  const b = await body(c, freezeSchema);
  if (b instanceof Response) return b;
  if (!id) return c.json({ error: "Charge nicht gefunden" }, 404);
  const err = store.freezeBatch(id, b.on, b.date);
  return err ? c.json({ error: err }, err.includes("nicht gefunden") ? 404 : 400) : c.json({ id });
});
api.delete("/batches/:id", (c) => {
  const id = idParam(c);
  return id && store.deleteBatch(id) ? c.json({ ok: true }) : c.json({ error: "Charge nicht gefunden" }, 404);
});

// Rezepte
api.get("/recipes", (c) => c.json(store.listRecipes()));
api.post("/recipes", async (c) => {
  const b = await body(c, recipeInputSchema);
  if (b instanceof Response) return b;
  return c.json({ id: store.createRecipe(b) }, 201);
});
api.put("/recipes/:id", async (c) => {
  const id = idParam(c);
  const b = await body(c, recipeInputSchema);
  if (b instanceof Response) return b;
  return id && store.updateRecipe(id, b) ? c.json({ id }) : c.json({ error: "Rezept nicht gefunden" }, 404);
});
api.delete("/recipes/:id", (c) => {
  const id = idParam(c);
  return id && store.deleteRecipe(id) ? c.json({ ok: true }) : c.json({ error: "Rezept nicht gefunden" }, 404);
});

// Bezüge
api.post("/brews", async (c) => {
  const b = await body(c, brewInputSchema);
  if (b instanceof Response) return b;
  const r = store.createBrew(b);
  return typeof r === "string" ? c.json({ error: r }, 400) : c.json({ id: r }, 201);
});
api.put("/brews/:id", async (c) => {
  const id = idParam(c);
  const b = await body(c, brewInputSchema);
  if (b instanceof Response) return b;
  if (!id) return c.json({ error: "Bezug nicht gefunden" }, 404);
  const r = store.updateBrew(id, b);
  if (typeof r === "string") return c.json({ error: r }, 400);
  return r ? c.json({ id }) : c.json({ error: "Bezug nicht gefunden" }, 404);
});
api.delete("/brews/:id", (c) => {
  const id = idParam(c);
  return id && store.deleteBrew(id) ? c.json({ ok: true }) : c.json({ error: "Bezug nicht gefunden" }, 404);
});

// Mühle (Mahlkönig Sync): Mahlvorgänge, vorher bei Bedarf abgleichen (höchstens alle 25 s)
api.get("/grinder/events", async (c) => {
  await syncGrinder();
  const hours = Number(c.req.query("hours"));
  const events = listGrinderEvents({
    since: queryTime(c, "since"),
    around: queryTime(c, "around"),
    hours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 72) : undefined,
    limit: queryLimit(c),
  });
  return c.json({ events, status: grinderStatus() });
});
api.post("/grinder/sync", async (c) => {
  await syncGrinder(true);
  return c.json(grinderStatus());
});
api.put("/grinder/account", async (c) => {
  const b = await body(c, grinderAccountSchema);
  if (b instanceof Response) return b;
  try {
    await connectGrinder(b);
  } catch (e) {
    if (e instanceof GrinderSyncError) return c.json({ error: e.message }, 400);
    throw e;
  }
  return c.json(settings());
});
api.delete("/grinder/account", (c) => {
  disconnectGrinder();
  return c.json(settings());
});
// Mühle im Heimnetz: Adresse prüfen (Datenbank einmal laden) und speichern
api.put("/grinder/local", async (c) => {
  const b = await body(c, grinderLocalSchema);
  if (b instanceof Response) return b;
  try {
    await connectLocal(b.host);
  } catch (e) {
    if (e instanceof GrinderLocalError) return c.json({ error: e.message }, 400);
    throw e;
  }
  return c.json(settings());
});
api.delete("/grinder/local", (c) => {
  disconnectLocal();
  return c.json(settings());
});

// Decent DE1: das Plugin der de1app schickt jeden Shot (Shot-JSON v2, mit Kurve gern einige 100 kB)
api.post("/decent/shots", bodyLimit({ maxSize: 16 * 1024 * 1024 }), async (c) => {
  const raw = await c.req.json().catch(() => null);
  try {
    return c.json(saveShot(raw));
  } catch (e) {
    if (e instanceof ShotError) return c.json({ error: e.message }, 400);
    throw e;
  }
});
// Archiv: jede Datei der de1app roh im Körper, Pfad relativ zum Datenordner der App (`history_v2/20261112T081500.json`)
api.post("/decent/files", bodyLimit({ maxSize: 32 * 1024 * 1024 }), async (c) => {
  const mtime = Number(c.req.query("mtime"));
  const body = new TextDecoder("utf-8").decode(await c.req.arrayBuffer());
  try {
    // Filter aus den Plugin-Einstellungen; ältere Plugins schicken keine, dann die Vorgaben
    const min = Number(c.req.query("min_seconds"));
    const skip = c.req.query("skip_types");
    const filter = {
      min_seconds: c.req.query("min_seconds") && Number.isFinite(min) && min >= 0 ? min : SHOT_FILTER.min_seconds,
      skip_types: skip == null ? SHOT_FILTER.skip_types : skip.split(/\s+/).filter(Boolean),
    };
    return c.json(saveArchiveFile(c.req.query("path") ?? "", Number.isFinite(mtime) ? mtime : null, body, filter));
  } catch (e) {
    if (e instanceof ArchiveError) return c.json({ error: e.message }, 400);
    throw e;
  }
});
// Profile für das Plugin: Tcl-Liste {Dateiname Stand Inhalt}, UTF-8 roh; mit since (Sekunden) nur die ab diesem Stand
api.get("/decent/profiles", (c) => {
  const since = Number(c.req.query("since"));
  const body = profilesForTablet(Number.isFinite(since) && since > 0 ? since : 0);
  return c.body(Buffer.from(body, "utf8"), 200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
});
api.get("/decent/shots", (c) => {
  const hours = Number(c.req.query("hours"));
  const shots = listShots({
    since: queryTime(c, "since"),
    around: queryTime(c, "around"),
    hours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 72) : undefined,
    limit: queryLimit(c),
  });
  return c.json({ shots, status: decentStatus() });
});
api.get("/decent/shots/:id", (c) => {
  const id = idParam(c);
  const shot = id ? getShot(id) : null;
  return shot ? c.json(shot) : c.json({ error: "Shot nicht gefunden" }, 404);
});
/** Plugin als ZIP, die Adresse in settings.tdb ist die, unter der die App gerade offen ist */
api.get("/decent/plugin.zip", async (c) => {
  const url = new URL(c.req.url);
  const proto = (c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0].trim();
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  const files = await pluginFiles(`${proto}://${host}`);
  const now = new Date();
  const tmp = path.join(DATA_DIR, `.plugin-${process.pid}-${Date.now()}.zip`);
  await writeZip(tmp, files.map((f) => ({ name: f.name, load: async () => f.data, compress: true, mtime: now })));
  const { size } = await stat(tmp);
  return sendFile(c, tmp, `${PLUGIN_NAME}-plugin.zip`, size, () => void rm(tmp, { force: true }));
});

// Home Assistant: Livewerte der Maschine und Schalter (an = wach, Dampf)
api.get("/ha/machine", async (c) => c.json(await machineLive()));
for (const what of ["power", "steam"] as const) {
  api.post(`/ha/${what}`, async (c) => {
    const b = await body(c, haSwitchSchema);
    if (b instanceof Response) return b;
    try {
      return c.json(await switchMachine(what, b.on));
    } catch (e) {
      if (e instanceof HaError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
}
api.put("/ha/account", async (c) => {
  const b = await body(c, haAccountSchema);
  if (b instanceof Response) return b;
  try {
    await connectHa(b);
  } catch (e) {
    if (e instanceof HaError) return c.json({ error: e.message }, 400);
    throw e;
  }
  return c.json(settings());
});
api.delete("/ha/account", (c) => {
  disconnectHa();
  return c.json(settings());
});

// Bilder
/** Fremdes Bild nur durchreichen (gleiche Herkunft fürs Canvas beim automatischen Ausrichten), nichts speichern */
api.post("/images/proxy", async (c) => {
  const raw = (await c.req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof raw.url !== "string") return c.json({ error: "url fehlt" }, 400);
  try {
    const { buf, type } = await fetchRemoteImage(raw.url);
    return c.body(Buffer.from(buf), 200, { "content-type": type, "cache-control": "no-store" });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Bild nicht ladbar" }, 400);
  }
});

api.post("/images", bodyLimit({ maxSize: 16 * 1024 * 1024 }), async (c) => {
  let raw: { data?: unknown; url?: unknown };
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Ungültiges JSON" }, 400);
  }
  try {
    if (typeof raw.data === "string") return c.json({ file: await saveDataUrl(raw.data) }, 201);
    if (typeof raw.url === "string") return c.json({ file: await downloadImage(raw.url) }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Bild nicht speicherbar" }, 400);
  }
  return c.json({ error: "data oder url angeben" }, 400);
});

// Claude-Auslesen. Mit accept: application/x-ndjson kommen Zwischenstände als Zeilen (Live-Ansicht)
api.post("/scrape", bodyLimit({ maxSize: 16 * 1024 * 1024 }), async (c) => {
  const b = await body(c, scrapeInputSchema);
  if (b instanceof Response) return b;
  if (c.req.header("accept")?.includes("application/x-ndjson")) {
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-cache, no-transform");
    c.header("x-accel-buffering", "no");
    return stream(c, async (s) => {
      const ac = new AbortController();
      s.onAbort(() => ac.abort());
      c.req.raw.signal.addEventListener("abort", () => ac.abort());
      // Schreiben nacheinander, damit Zeilen nie ineinanderlaufen
      let chain: Promise<unknown> = Promise.resolve();
      const emit = (e: ScrapeEvent) => {
        if (ac.signal.aborted) return;
        chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => ac.abort());
      };
      let uploaded: string | null = null;
      try {
        if (b.image) uploaded = await saveDataUrl(b.image);
        const draft = await scrape(b, uploaded, { emit, signal: ac.signal });
        emit({ t: "done", draft });
      } catch (e) {
        const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
        if (!ac.signal.aborted) console.error("scrape:", err.message);
        emit({ t: "error", message: err.message, status: err.status, uploaded_image: uploaded });
      }
      await chain;
    });
  }
  let uploaded: string | null = null;
  try {
    if (b.image) uploaded = await saveDataUrl(b.image);
    const draft = await scrape(b, uploaded);
    return c.json(draft);
  } catch (e) {
    const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
    console.error("scrape:", err.message);
    return c.json({ error: err.message, uploaded_image: uploaded }, err.status as 400);
  }
});

// Auslesen im Hintergrund: Auftrag anlegen, Liste, Verlauf als NDJSON (erst der bisherige Stand, dann live), abbrechen/verwerfen
api.post("/scrape/jobs", bodyLimit({ maxSize: 16 * 1024 * 1024 }), async (c) => {
  const b = await body(c, scrapeInputSchema);
  if (b instanceof Response) return b;
  if (!apiKey().key) return c.json({ error: "Kein API-Key hinterlegt. Bitte in den Einstellungen eintragen oder manuell erfassen." }, 400);
  try {
    return c.json(await startJob(b), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Auslesen nicht gestartet" }, 400);
  }
});

api.get("/scrape/jobs", (c) => c.json(listJobs()));

api.get("/scrape/jobs/:id", (c) => {
  const id = c.req.param("id");
  if (!getJob(id)) return c.json({ error: "Auslesen nicht gefunden (abgelaufen oder Server neu gestartet)" }, 404);
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    let chain: Promise<unknown> = Promise.resolve();
    let closed = false;
    const f = followJob(id, (e) => {
      if (closed) return;
      chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => (closed = true));
    });
    if (!f) return;
    // Ping gegen den Proxy-Timeout, solange Claude still arbeitet
    const ping = setInterval(() => {
      if (!closed) chain = chain.then(() => s.writeln("")).catch(() => (closed = true));
    }, 15_000);
    s.onAbort(() => {
      closed = true;
      f.stop();
    });
    await f.done;
    clearInterval(ping);
    await chain;
  });
});

api.delete("/scrape/jobs/:id", (c) => (removeJob(c.req.param("id")) ? c.body(null, 204) : c.json({ error: "Nicht gefunden" }, 404)));

// Nur die Röster-Rezepte eines erfassten Kaffees von der Shopseite holen (speichert nichts)
api.post("/scrape/recipes", async (c) => {
  const b = await body(c, recipesScrapeSchema);
  if (b instanceof Response) return b;
  try {
    return c.json({ recipes: await scrapeRecipes(b, c.req.raw.signal) });
  } catch (e) {
    const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
    console.error("scrape/recipes:", err.message);
    return c.json({ error: err.message }, err.status as 400);
  }
});

// „Was passt zu mir?“: letztes Ergebnis lesen, neue Suche per NDJSON (Schritte, alle 15 s ein ping gegen Proxy-Zeitlimits)
api.get("/recommend", (c) => c.json({ result: lastRecommendations() }));
api.post("/recommend", async (c) => {
  const b = await body(c, recommendInputSchema);
  if (b instanceof Response) return b;
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    const ac = new AbortController();
    s.onAbort(() => ac.abort());
    c.req.raw.signal.addEventListener("abort", () => ac.abort());
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (e: RecommendEvent) => {
      if (ac.signal.aborted) return;
      chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => ac.abort());
    };
    const ping = setInterval(() => emit({ t: "ping" }), 15_000);
    try {
      emit({ t: "step", label: "Profil", detail: "aus deinen Bewertungen" });
      emit({ t: "done", result: await recommend(b.hint, emit, ac.signal) });
    } catch (e) {
      const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
      if (!ac.signal.aborted) console.error("recommend:", err.message);
      emit({ t: "error", message: err.message, status: err.status });
    } finally {
      clearInterval(ping);
    }
    await chain;
  });
});

// Einstellungen
function settings(): Settings {
  const { key, source } = apiKey();
  return {
    api_key: { set: Boolean(key), source, hint: key ? `…${key.slice(-4)}` : null },
    model: model(),
    config: configView(),
    onboarded: store.getSetting("onboarded") != null || store.listCoffees().length > 0,
    grinder: store.getSetting("grinder") || DEFAULT_GRINDER,
    shot_targets: parseShotTargets(store.getSetting("shot_targets")),
    mahlkoenig: grinderStatus(),
    decent: decentStatus(),
    homeassistant: haStatus(),
  };
}
api.get("/settings", (c) => c.json(settings()));
api.put("/settings", async (c) => {
  const b = await body(c, settingsInputSchema);
  if (b instanceof Response) return b;
  if (b.api_key !== undefined) store.setSetting("anthropic_api_key", b.api_key);
  if (b.grinder !== undefined) store.setSetting("grinder", b.grinder);
  if (b.shot_targets !== undefined) store.setSetting("shot_targets", b.shot_targets ? JSON.stringify(parseShotTargets(JSON.stringify(b.shot_targets))) : null);
  if (b.onboarded !== undefined) store.setSetting("onboarded", b.onboarded ? new Date().toISOString() : null);
  if (b.config) {
    try {
      saveConfig(b.config);
    } catch (e) {
      if (e instanceof ConfigError) return c.json({ error: e.message }, 400);
      throw e;
    }
  }
  return c.json(settings());
});

api.get("/stats", (c) => c.json(store.stats()));
// Startwert für den Mahlgrad einer Tüte (Mahlkompass plus lokales Modell aus den gelungenen Bezügen) und Vorlage für einen ersten Bezug
api.get("/grind", async (c) => {
  const coffee_id = Number(c.req.query("coffee_id"));
  const batch_id = Number(c.req.query("batch_id")) || null;
  const method = (c.req.query("method") ?? "").slice(0, 60);
  if (!Number.isInteger(coffee_id) || coffee_id <= 0 || !method) return c.json({ error: "coffee_id und method angeben" }, 400);
  const q = c.req.query("today");
  const today = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : store.localToday();
  return c.json({
    prediction: await predictGrindAsync({ coffee_id, batch_id, method, grinder: (c.req.query("grinder") ?? "").slice(0, 80), today }),
    template: brewTemplate(method),
  });
});
api.get("/stock", (c) => c.json(store.listStock()));
api.get("/brews", (c) => c.json(store.brewLog()));
api.get("/export", (c) => {
  c.header("content-disposition", `attachment; filename="kaffeebibliothek-${store.localToday()}.json"`);
  return c.json(store.exportAll());
});

// Vollständige Sicherung (Datenbank, Bilder, JSON) als ZIP
function sendFile(c: Context, file: string, name: string, size: number, after?: () => void) {
  const rs = createReadStream(file);
  if (after) rs.on("close", after);
  return c.body(Readable.toWeb(rs) as ReadableStream, 200, {
    "content-type": "application/zip",
    "content-length": String(size),
    "content-disposition": `attachment; filename="${name}"`,
    "cache-control": "no-store",
  });
}
api.get("/backup", async (c) => {
  const now = new Date();
  const stamp = `${store.localToday(now)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const tmp = path.join(DATA_DIR, `.download-${process.pid}-${Date.now()}.zip`);
  await writeBackup(tmp);
  const { size } = await stat(tmp);
  return sendFile(c, tmp, `kaffeebibliothek-${stamp}.zip`, size, () => void rm(tmp, { force: true }));
});
api.get("/backups", async (c) => c.json({ enabled: backupDir() != null, list: await listBackups() }));
api.get("/backups/:name", async (c) => {
  const file = backupPath(c.req.param("name"));
  const st = file ? await stat(file).catch(() => null) : null;
  if (!file || !st) return c.json({ error: "Sicherung nicht gefunden" }, 404);
  return sendFile(c, file, c.req.param("name"), st.size);
});

app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Nicht gefunden" }, 404));
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: "Interner Fehler" }, 500);
});

app.use(
  "/images/*",
  serveStatic({
    root: IMAGE_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/images/, ""),
    onFound: (_p, c) => {
      c.header("cache-control", "public, max-age=31536000, immutable");
    },
  }),
);
app.get("/images/*", (c) => c.text("Nicht gefunden", 404));

const WEB_DIST = path.resolve("dist");
if (existsSync(WEB_DIST)) {
  const root = WEB_DIST;
  // Skript und Stile gepackt ausliefern (der Proxy davor packt nicht). Nur hier: die API streamt beim Auslesen und darf nicht puffern
  app.use("/assets/*", compress());
  app.use(
    "/assets/*",
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header("cache-control", "public, max-age=31536000, immutable");
      },
    }),
  );
  // index.html immer neu prüfen, sonst hängt eine installierte Web-App nach einem Deploy am alten Stand (die Assets tragen einen Hash)
  const fresh = (p: string, c: Context) => {
    if (p.endsWith("index.html")) c.header("cache-control", "no-cache");
  };
  app.use("/*", serveStatic({ root, onFound: fresh }));
  app.get("/*", serveStatic({ root, path: "index.html", onFound: fresh }));
}

applyTimezone();
scheduleBackups();
scheduleImagePrune();
scheduleGrinderSync();

const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, (i) => {
  console.log(`Kaffeebibliothek läuft auf http://localhost:${i.port}`);
});
