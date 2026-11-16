// Auslesen als Auftrag im Server: läuft weiter, wenn die Seite zu ist, das Handy schläft oder man woanders hinklickt.
// Nur im Speicher (ein Neustart verwirft laufende Aufträge), fertige bleiben 24 h, bis sie gesichert oder verworfen sind.
import { randomUUID } from "node:crypto";
import type { ScrapeDraft, ScrapeEvent, ScrapeJob, ScrapeJobInput, ScrapePartial, ScrapeStep } from "../shared/types.ts";
import { saveDataUrl } from "./images.ts";
import { scrape, ScrapeError } from "./scrape.ts";

type Job = ScrapeJob & {
  steps: Map<string, ScrapeStep>;
  fields: ScrapePartial;
  images: string[];
  draft: ScrapeDraft | null;
  failure: Extract<ScrapeEvent, { t: "error" }> | null;
  ac: AbortController;
  listeners: Set<(e: ScrapeEvent) => void>;
};

const KEEP_MS = 24 * 3600_000;
const jobs = new Map<string, Job>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function view(j: Job): ScrapeJob {
  return {
    id: j.id,
    what: j.what,
    input: j.input,
    photo: j.photo,
    started: j.started,
    finished: j.finished,
    state: j.state,
    name: j.draft?.fields.name || j.fields.name || null,
    roaster: j.draft?.fields.roaster || j.fields.roaster || null,
    image: j.draft?.image_urls[0] ?? j.fields.image_urls?.[0] ?? j.images[0] ?? null,
    activity: j.state === "run" ? ([...j.steps.values()].filter((s) => s.state === "run").at(-1)?.label ?? null) : null,
    error: j.failure?.message ?? null,
  };
}

function prune() {
  const now = Date.now();
  for (const j of jobs.values()) if (j.finished && now - j.finished > KEEP_MS) drop(j);
}

/** Auftrag entfernen (ein hochgeladenes Foto bleibt liegen wie beim direkten Auslesen, der Kaffee kann es übernommen haben) */
function drop(j: Job) {
  j.ac.abort();
  jobs.delete(j.id);
  j.listeners.clear();
}

export async function startJob(b: { url?: string; name?: string; image?: string }): Promise<ScrapeJob> {
  prune();
  const photo = b.image ? await saveDataUrl(b.image) : null;
  const input: ScrapeJobInput = b.url ? { url: b.url } : b.name ? { name: b.name } : { image: true };
  const j: Job = {
    id: randomUUID(),
    what: b.url ? hostOf(b.url) : b.name ? `„${b.name}“` : "das Foto",
    input,
    photo,
    started: Date.now(),
    finished: null,
    state: "run",
    name: null,
    roaster: null,
    image: null,
    activity: null,
    error: null,
    steps: new Map(),
    fields: {},
    images: [],
    draft: null,
    failure: null,
    ac: new AbortController(),
    listeners: new Set(),
  };
  jobs.set(j.id, j);
  const emit = (e: ScrapeEvent) => {
    if (e.t === "step") {
      const { t: _t, ...st } = e;
      j.steps.set(st.id, st);
    } else if (e.t === "fields") j.fields = e.fields;
    else if (e.t === "images") j.images = e.urls;
    for (const l of j.listeners) l(e);
  };
  void (async () => {
    try {
      const draft = await scrape(b, photo, { emit, signal: j.ac.signal });
      j.draft = draft;
      j.state = "done";
      for (const [id, st] of j.steps) if (st.state === "run") j.steps.set(id, { ...st, state: "ok" });
      j.finished = Date.now();
      emit({ t: "done", draft });
    } catch (e) {
      if (j.ac.signal.aborted) return;
      const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
      console.error("scrape:", err.message);
      j.failure = { t: "error", message: err.message, status: err.status, uploaded_image: photo };
      j.state = "error";
      j.finished = Date.now();
      emit(j.failure);
    }
  })();
  return view(j);
}

export function listJobs(): ScrapeJob[] {
  prune();
  return [...jobs.values()].map(view).sort((a, b) => b.started - a.started);
}

export function getJob(id: string): ScrapeJob | null {
  const j = jobs.get(id);
  return j ? view(j) : null;
}

/** Bisherigen Stand nachspielen, danach live weiter, bis der Auftrag fertig ist oder der Aufrufer abbricht */
export function followJob(id: string, onEvent: (e: ScrapeEvent) => void): { done: Promise<void>; stop: () => void } | null {
  const j = jobs.get(id);
  if (!j) return null;
  for (const st of j.steps.values()) onEvent({ t: "step", ...st });
  if (Object.keys(j.fields).length) onEvent({ t: "fields", fields: j.fields });
  if (j.images.length) onEvent({ t: "images", urls: j.images });
  if (j.draft) onEvent({ t: "done", draft: j.draft });
  if (j.failure) onEvent(j.failure);
  if (j.state !== "run") return { done: Promise.resolve(), stop: () => {} };
  let finish = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const listener = (e: ScrapeEvent) => {
    onEvent(e);
    if (e.t === "done" || e.t === "error") stop();
  };
  const stop = () => {
    j.listeners.delete(listener);
    finish();
  };
  j.listeners.add(listener);
  j.ac.signal.addEventListener("abort", stop);
  return { done, stop };
}

/** Abbrechen, verwerfen oder nach dem Sichern abräumen */
export function removeJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j) return false;
  drop(j);
  return true;
}
