import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import {
  BREW_METHODS,
  matchRoaster,
  PROCESS_TYPES,
  splitProcess,
  type CoffeeFields,
  type RoasterRecipe,
  type ScrapeDraft,
  type ScrapeEvent,
  type ScrapePartial,
  type ScrapeStep,
} from "../shared/types.ts";
import { cfg } from "./config.ts";
import { getSetting, knownRoasters } from "./store.ts";

/** Modell aus den Einstellungen, sonst SCRAPE_MODEL, sonst eingebaut */
export const model = () => cfg().model;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

export class ScrapeError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export function apiKey(): { key: string | null; source: "env" | "db" | null } {
  const db = getSetting("anthropic_api_key");
  if (db) return { key: db, source: "db" };
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return { key: env, source: "env" };
  return { key: null, source: null };
}

// ---------- Vorab-Abruf der Shopseite ----------

type Prefetch = {
  finalUrl: string;
  title: string;
  meta: Record<string, string>;
  jsonld: string[];
  shopify: string | null;
  images: string[];
  text: string;
};

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function absolutize(src: string, base: string): string | null {
  try {
    const u = new URL(decode(src.trim()), base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function collectJsonLdImages(node: unknown, out: string[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectJsonLdImages(n, out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "image" || k === "contentUrl") {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) for (const x of v) typeof x === "string" ? out.push(x) : collectJsonLdImages(x, out);
      else if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") out.push((v as { url: string }).url);
    } else if (v && typeof v === "object") collectJsonLdImages(v, out);
  }
}

async function fetchText(url: string, accept: string, timeoutMs = 12_000): Promise<{ text: string; url: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept, "accept-language": "de-DE,de;q=0.9,en;q=0.7" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return { text: text.slice(0, 3_000_000), url: res.url || url };
  } catch {
    return null;
  }
}

export async function prefetch(url: string): Promise<Prefetch | null> {
  const page = await fetchText(url, "text/html,application/xhtml+xml");
  if (!page) return null;
  const html = page.text;
  const base = page.url;

  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const key = tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content && !meta[key] && /^(og:|twitter:|product:|description|keywords|price|og_)/.test(key))
      meta[key] = decode(content).slice(0, 600);
  }

  const jsonld: string[] = [];
  const ldImages: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      collectJsonLdImages(parsed, ldImages);
      jsonld.push(JSON.stringify(parsed).slice(0, 8000));
    } catch {
      jsonld.push(raw.slice(0, 4000));
    }
  }

  let shopify: string | null = null;
  const shopImages: string[] = [];
  const u = new URL(base);
  if (/\/products\/[^/]+\/?$/.test(u.pathname)) {
    const js = await fetchText(`${u.origin}${u.pathname.replace(/\/$/, "")}.js`, "application/json", 8000);
    if (js) {
      try {
        const p = JSON.parse(js.text) as {
          title?: string;
          vendor?: string;
          description?: string;
          tags?: string[];
          images?: string[];
          variants?: { title?: string; price?: number }[];
        };
        for (const img of p.images ?? []) shopImages.push(img.startsWith("//") ? "https:" + img : img);
        shopify = JSON.stringify({
          title: p.title,
          vendor: p.vendor,
          tags: p.tags,
          description: (p.description ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .slice(0, 5000),
          variants: (p.variants ?? []).slice(0, 8).map((v) => ({ title: v.title, price_eur: v.price != null ? v.price / 100 : null })),
        });
      } catch {
        /* keine Shopify-Seite */
      }
    }
  }

  const imgs: string[] = [];
  const push = (s: string | undefined | null) => {
    if (!s) return;
    const a = absolutize(s, base);
    if (!a) return;
    if (/\.svg(\?|$)|logo|icon|sprite|favicon|placeholder|payment|badge|flag/i.test(a)) return;
    if (!imgs.includes(a)) imgs.push(a);
  };
  push(meta["og:image"]);
  push(meta["og:image:secure_url"]);
  push(meta["twitter:image"]);
  for (const s of shopImages) push(s);
  for (const s of ldImages) push(s);
  for (const m of html.matchAll(/<img\s[^>]*>/gi)) {
    const tag = m[0];
    const srcset = tag.match(/(?:data-)?srcset\s*=\s*["']([^"']+)["']/i)?.[1];
    if (srcset) {
      const best = srcset
        .split(",")
        .map((p) => p.trim().split(/\s+/))
        .map(([src, w]) => ({ src, w: parseInt(w ?? "0", 10) || 0 }))
        .sort((a, b) => b.w - a.w)[0];
      push(best?.src);
    } else push(tag.match(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (imgs.length >= 30) break;
  }

  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 14_000);

  return { finalUrl: base, title, meta, jsonld: jsonld.slice(0, 4), shopify, images: imgs.slice(0, 30), text };
}

// ---------- Claude ----------

const RECIPE_RULES = `Nur übernehmen, was ausdrücklich dasteht, nichts ergänzen oder schätzen; fehlende Werte null bzw. "". title: kurzer Name wie beim Röster ("V60", "Espresso", "AeroPress invertiert"). method: passende Methode aus der Liste, sonst "Sonstiges". dose_g Kaffee in Gramm; water_g Wasser in Gramm (1 ml = 1 g), bei Espresso die Ausbeute in der Tasse; temp_c in °C; grind Mahlgrad wie angegeben ("mittelfein", "20 Klicks Comandante"); time_s Gesamtzeit in Sekunden (2:30 min = 150). Bei Spannen ("92–94 °C", "25–30 s") die Mitte als Zahl und die Spanne in notes. notes: Ablauf kurz auf Deutsch (Bloom, Aufgüsse, Tipps), sonst "". Leere Liste, wenn der Röster keine Zubereitung angibt.`;

const SYSTEM = `Du pflegst eine private Kaffeebibliothek. Aus einem Shop-Link, einem Kaffeenamen oder einem Foto der Packung ermittelst du die Stammdaten eines Spezialitätenkaffees und trägst sie mit dem Werkzeug save_coffee ein.

Vorgehen:
- Liegt ein vorab geladener Seiteninhalt bei und reicht er, trage direkt ein. Sonst rufe die Seite mit web_fetch ab oder suche mit web_search nach der Produktseite des Rösters (Röster + Kaffeename). Bevorzuge die Seite des Rösters vor Händlern.
- Bei einem Foto: lies alles von der Packung ab (Röster, Name, Herkunft, Varietät, Aufbereitung, Röstdatum, Gewicht, Noten) und suche danach die Produktseite des Rösters für fehlende Angaben und Produktbilder.
- Erfinde nichts. Unbekanntes bleibt leer ("" bzw. null, leere Liste). Schreibe Unsicheres in notes.
- Rufe save_coffee genau einmal auf, sobald du genug weißt. Spätestens nach wenigen Suchen.

Felder:
- name: Kaffeename ohne Röster, z. B. "Guji Hambela". Bei Blends den Blendnamen.
- roaster: Name der Rösterei.
- country: Herkunftsland auf Deutsch ("Äthiopien", "Kolumbien"). Bei Blends "Blend".
- region, farm (Farm, Station, Washing Station oder Kooperative), producer.
- varieties: Varietäten einzeln, z. B. ["Gesha"], ["Caturra", "Castillo"], ["Heirloom 74110"].
- process: nur die Art der Aufbereitung, genau eine aus: ${PROCESS_TYPES.map((p) => `"${p}"`).join(", ")}. Pulped Natural zählt als "Honey", Anaerob Natural oder Anaerob Washed als "Anaerob", Kaffees aus mehreren Aufbereitungen (z. B. Blends) als "Mischung", Decaf als "Entkoffeiniert", Monsooned Malabar und andere monsunierte Kaffees als "Monsooned". "", wenn unbekannt.
- process_detail: Zusatz zur Aufbereitung, kurz auf Deutsch: Fermentation (Dauer, anaerob, Hefe), Trocknung (Hochbetten, Patio, Dauer), Honey-Farbe, Decaf-Verfahren, bei Mischungen die Anteile je Aufbereitung ("75 % gewaschen, 25 % natural"). Wiederhole die Art nicht. "", wenn nichts bekannt ist.
- altitude: z. B. "1.950–2.250 m". harvest: z. B. "2025/26".
- roast_level: "hell", "mittel" oder "dunkel". Filterröstungen und nordische Röstungen sind hell; klassische italienische Espressoröstungen dunkel; Omni- und Espressoröstungen von Specialty-Röstern meist mittel. null, wenn nicht ableitbar.
- roast_for: "filter", "espresso" oder "omni" (für beides empfohlen). null, wenn unbekannt.
- roaster_notes: die Geschmacksnoten des Rösters, auf Deutsch, je Note ein Eintrag ("Blaubeere", "Jasmin", "Milchschokolade").
- description: 2 bis 4 sachliche Sätze auf Deutsch, eigene Worte, keine Werbesprache.
- weight_g: Packungsgröße in Gramm der Standardvariante (meist 250). price_eur: Preis dieser Variante in Euro, sonst null.
- cup_score: Cup Score bzw. SCA-Punkte, die der Röster oder Importeur für diesen Kaffee angibt (z. B. 85 oder 86.5), als Zahl. Nur übernehmen, wenn er ausdrücklich genannt ist, nie schätzen; sonst null.
- roaster_recipes: Zubereitungen, die der Röster für genau diesen Kaffee vorschlägt (Rezept, Brew Guide, Zubereitungsempfehlung auf der Produktseite), je Methode ein Eintrag. ${RECIPE_RULES}
- url: Produktseite des Rösters, sonst "".
- image_urls: bis zu 6 direkte Bild-URLs (https) der Packung bzw. des Produkts, bestes Packungsfoto zuerst. Nimm nur URLs, die tatsächlich in Seiten oder Kandidatenlisten vorkommen. Keine Logos.
- sources: die URLs, aus denen die Daten stammen.
- notes: ein kurzer Satz an den Nutzer, was fehlt oder unsicher ist. Leer, wenn alles klar ist.`;

const nullableEnum = (values: string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
const nullableNum = (type: "number" | "integer" = "number") => ({ anyOf: [{ type }, { type: "null" }] });

const RECIPE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      method: { type: "string", enum: [...BREW_METHODS] },
      dose_g: nullableNum(),
      water_g: nullableNum(),
      temp_c: nullableNum(),
      grind: { type: "string" },
      time_s: nullableNum("integer"),
      notes: { type: "string" },
    },
    required: ["title", "method", "dose_g", "water_g", "temp_c", "grind", "time_s", "notes"],
  },
};

const SAVE_TOOL: BetaToolUnion = {
  name: "save_coffee",
  description: "Trägt die ermittelten Stammdaten des Kaffees in die Bibliothek ein. Genau einmal aufrufen.",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      roaster: { type: "string" },
      country: { type: "string" },
      region: { type: "string" },
      farm: { type: "string" },
      producer: { type: "string" },
      varieties: { type: "array", items: { type: "string" } },
      process: { type: "string" },
      process_detail: { type: "string" },
      altitude: { type: "string" },
      harvest: { type: "string" },
      roast_level: nullableEnum(["hell", "mittel", "dunkel"]),
      roast_for: nullableEnum(["filter", "espresso", "omni"]),
      roaster_notes: { type: "array", items: { type: "string" } },
      description: { type: "string" },
      weight_g: { anyOf: [{ type: "integer" }, { type: "null" }] },
      price_eur: { anyOf: [{ type: "number" }, { type: "null" }] },
      cup_score: { anyOf: [{ type: "number" }, { type: "null" }] },
      roaster_recipes: RECIPE_SCHEMA,
      url: { type: "string" },
      image_urls: { type: "array", items: { type: "string" } },
      sources: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
    required: [
      "name", "roaster", "country", "region", "farm", "producer", "varieties", "process", "process_detail", "altitude",
      "harvest",
      "roast_level", "roast_for", "roaster_notes", "description", "weight_g", "price_eur", "cup_score", "roaster_recipes", "url",
      "image_urls", "sources", "notes",
    ],
  },
};

const TOOLS: BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 30_000 },
  SAVE_TOOL,
];

const s = (max: number) => z.string().transform((v) => v.trim().slice(0, max));
const list = (max: number) =>
  z.array(z.string()).transform((a) => [...new Set(a.map((x) => x.trim()).filter(Boolean))].slice(0, max));

const pos = (max: number) => z.number().nullable().transform((v) => (v != null && v > 0 && v <= max ? Math.round(v * 10) / 10 : null));
const recipeInput = z
  .array(
    z.object({
      title: s(80),
      method: s(60),
      dose_g: pos(2000),
      water_g: pos(20_000),
      temp_c: pos(100),
      grind: s(120),
      time_s: z.number().nullable().transform((v) => (v != null && v > 0 && v <= 24 * 3600 ? Math.round(v) : null)),
      notes: s(2000),
    }),
  )
  // Einträge ohne einen einzigen Wert sind keine Rezepte
  .transform((a) => a.filter((r) => r.dose_g != null || r.water_g != null || r.temp_c != null || r.time_s != null || r.grind || r.notes).slice(0, 8));

const toolInput = z.object({
  name: s(200),
  roaster: s(200),
  country: s(100),
  region: s(200),
  farm: s(200),
  producer: s(200),
  varieties: list(20),
  process: s(100),
  process_detail: s(400),
  altitude: s(100),
  harvest: s(100),
  roast_level: z.enum(["hell", "mittel", "dunkel"]).nullable(),
  roast_for: z.enum(["filter", "espresso", "omni"]).nullable(),
  roaster_notes: list(20),
  description: s(4000),
  weight_g: z.number().nullable(),
  price_eur: z.number().nullable(),
  cup_score: z.number().nullable(),
  roaster_recipes: recipeInput,
  url: s(2000),
  image_urls: list(10),
  sources: list(12),
  notes: s(1000),
});

export function friendlyError(e: unknown): ScrapeError {
  if (e instanceof ScrapeError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new ScrapeError("Der API-Key wird nicht akzeptiert. Bitte in den Einstellungen prüfen.", 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new ScrapeError("Der API-Key hat keine Berechtigung für dieses Modell oder die Websuche.", 403);
  if (e instanceof Anthropic.RateLimitError) return new ScrapeError("Rate-Limit erreicht. Bitte in einer Minute erneut versuchen.", 429);
  if (e instanceof Anthropic.BadRequestError) return new ScrapeError(`Anfrage abgelehnt: ${e.message}`, 400);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ScrapeError("Zeitüberschreitung bei der Anthropic-API.", 504);
  if (e instanceof Anthropic.APIConnectionError) return new ScrapeError("Keine Verbindung zur Anthropic-API.", 502);
  if (e instanceof Anthropic.InternalServerError) return new ScrapeError("Die Anthropic-API ist gerade überlastet. Bitte erneut versuchen.", 503);
  if (e instanceof Anthropic.APIError) return new ScrapeError(`Anthropic-API: ${e.message}`, 502);
  return new ScrapeError(e instanceof Error ? e.message : String(e), 500);
}

export type ScrapeInput = { url?: string; name?: string; image?: string };
export type ScrapeOptions = { emit?: (e: ScrapeEvent) => void; signal?: AbortSignal };

// ---------- Live-Ansicht ----------

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
const shortUrl = (u: string) => {
  try {
    const x = new URL(u);
    const p = x.pathname.length > 1 ? x.pathname.replace(/\/$/, "") : "";
    return x.hostname.replace(/^www\./, "") + (p.length > 32 ? p.slice(0, 31) + "…" : p);
  } catch {
    return u.slice(0, 48);
  }
};

const TEXT_KEYS = [
  "name", "roaster", "country", "region", "farm", "producer", "process", "process_detail", "altitude", "harvest", "description",
] as const;
const LIST_KEYS = ["varieties", "roaster_notes", "image_urls"] as const;

/**
 * Halbfertige save_coffee-Eingabe auf bekannte Felder mit passenden Typen reduzieren.
 * Die Reihenfolge der Eingabe bleibt erhalten: der letzte Schlüssel ist der, den Claude gerade schreibt.
 */
function partialFields(input: unknown): ScrapePartial {
  if (!input || typeof input !== "object") return {};
  const o = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if ((TEXT_KEYS as readonly string[]).includes(k)) {
      if (typeof v === "string" && v) out[k] = v.slice(0, 4000);
    } else if ((LIST_KEYS as readonly string[]).includes(k)) {
      const items = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 20) : [];
      if (items.length) out[k] = items;
    } else if (k === "roast_level") {
      if (v === "hell" || v === "mittel" || v === "dunkel") out[k] = v;
    } else if (k === "roast_for") {
      if (v === "filter" || v === "espresso" || v === "omni") out[k] = v;
    } else if (k === "weight_g") {
      if (typeof v === "number" && v > 0) out[k] = Math.round(v);
    } else if (k === "price_eur") {
      if (typeof v === "number" && v >= 0) out[k] = v;
    } else if (k === "cup_score") {
      if (typeof v === "number" && v > 0 && v <= 100) out[k] = v;
    } else if (k === "roaster_recipes") {
      // für die Live-Ansicht reichen Titel und Methode
      const items = Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && typeof x.method === "string").slice(0, 8) : [];
      if (items.length) out[k] = items.map((x) => ({ title: typeof x.title === "string" ? x.title : "", method: x.method }));
    }
  }
  return out as ScrapePartial;
}

/**
 * Teil-JSON so schließen, dass ein angefangener String mit seinem bisherigen Text erhalten bleibt
 * (der SDK-Parser lässt ihn weg). Klappt das nicht eindeutig, gilt der SDK-Stand.
 */
function openInput(raw: string, fallback: Record<string, unknown>): Record<string, unknown> {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of raw) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (!inStr) return fallback; // Zahl, Schlüssel ohne Wert usw.: das kann der SDK-Parser besser
  let s = raw;
  if (esc) s = s.slice(0, -1);
  s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  try {
    const v = JSON.parse(s + '"' + stack.reverse().join(""));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fallback;
  } catch {
    return fallback;
  }
}

/** Hängt sich an einen Claude-Stream und meldet Suchen, Abrufe und die entstehenden Felder */
function watchStream(stream: BetaMessageStream, emit: (e: ScrapeEvent) => void, steps: Map<string, ScrapeStep>, onFirstBlock: () => void) {
  const put = (st: ScrapeStep) => {
    steps.set(st.id, st);
    emit({ t: "step", ...st });
  };
  const last = new Map<string, number>();
  const throttled = (key: string, ms: number, fn: () => void, force = false) => {
    const now = Date.now();
    if (!force && now - (last.get(key) ?? 0) < ms) return;
    last.set(key, now);
    fn();
  };
  const inputOf = (block: unknown): Record<string, unknown> => {
    try {
      const i = (block as { input?: unknown }).input;
      return i && typeof i === "object" ? (i as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const serverDetail = (st: ScrapeStep, input: Record<string, unknown>) =>
    st.kind === "search" && typeof input.query === "string"
      ? `„${input.query}“`
      : st.kind === "fetch" && typeof input.url === "string"
        ? shortUrl(input.url)
        : st.detail;

  const raws = new Map<number, string>();
  let first = true;
  stream.on("streamEvent", (event, snapshot) => {
    if (event.type === "content_block_start") {
      const b = event.content_block;
      if (first && b.type !== "thinking" && b.type !== "redacted_thinking") {
        first = false;
        onFirstBlock();
      }
      if (b.type === "server_tool_use") {
        const kind: ScrapeStep["kind"] = b.name === "web_search" ? "search" : b.name === "web_fetch" ? "fetch" : "filter";
        const label = kind === "search" ? "Websuche" : kind === "fetch" ? "Seite lesen" : "Treffer sichten";
        const st: ScrapeStep = { id: b.id, kind, label, detail: "", state: "run" };
        put({ ...st, detail: serverDetail(st, inputOf(b)) });
      } else if (b.type === "web_search_tool_result") {
        const st = steps.get(b.tool_use_id);
        if (!st) return;
        if (Array.isArray(b.content)) {
          const hits = b.content
            .filter((r) => r.type === "web_search_result")
            .slice(0, 6)
            .map((r) => ({ title: r.title.slice(0, 120), url: r.url }));
          put({ ...st, state: "ok", hits });
        } else put({ ...st, state: "fail" });
      } else if (b.type === "web_fetch_tool_result") {
        const st = steps.get(b.tool_use_id);
        if (!st) return;
        if (b.content.type === "web_fetch_result") {
          const title = b.content.content.title?.trim();
          put({ ...st, state: "ok", detail: title ? title.slice(0, 90) : shortUrl(b.content.url) });
        } else put({ ...st, state: "fail" });
      } else if ("tool_use_id" in b && typeof b.tool_use_id === "string") {
        const st = steps.get(b.tool_use_id);
        if (st && st.state === "run") put({ ...st, state: "ok" });
      } else if (b.type === "tool_use" && b.name === "save_coffee") {
        raws.set(event.index, "");
        put({ id: "write", kind: "write", label: "Daten eintragen", detail: "", state: "run" });
      }
      return;
    }

    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      const block = snapshot.content[event.index];
      if (!block) return;
      if (block.type === "server_tool_use") {
        const st = steps.get(block.id);
        if (st) throttled(block.id, 150, () => put({ ...st, detail: serverDetail(st, inputOf(block)) }));
      } else if (block.type === "tool_use" && block.name === "save_coffee") {
        const raw = (raws.get(event.index) ?? "") + event.delta.partial_json;
        raws.set(event.index, raw);
        throttled("fields", 90, () => emit({ t: "fields", fields: partialFields(openInput(raw, inputOf(block))) }));
      }
      return;
    }

    if (event.type === "content_block_stop") {
      const block = snapshot.content[event.index];
      if (block?.type === "server_tool_use") {
        const st = steps.get(block.id);
        if (st) put({ ...st, detail: serverDetail(st, inputOf(block)) });
      } else if (block?.type === "tool_use" && block.name === "save_coffee") {
        emit({ t: "fields", fields: partialFields(inputOf(block)) });
      }
    }
  });
}

export async function scrape(input: ScrapeInput, uploadedImage: string | null, opts: ScrapeOptions = {}): Promise<ScrapeDraft> {
  const { emit, signal } = opts;
  const steps = new Map<string, ScrapeStep>();
  const step = (st: ScrapeStep) => {
    steps.set(st.id, st);
    emit?.({ t: "step", ...st });
  };
  const { key } = apiKey();
  if (!key) throw new ScrapeError("Kein API-Key hinterlegt. Bitte in den Einstellungen eintragen oder manuell erfassen.", 400);

  const content: BetaContentBlockParam[] = [];
  let kind: ScrapeDraft["source"]["kind"] = "name";
  let sourceInput = input.name ?? "";
  let candidates: string[] = [];

  if (input.image) {
    kind = "photo";
    sourceInput = input.name || input.url || "Foto";
    const m = input.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!m) throw new ScrapeError("Ungültiges Foto", 400);
    content.push({
      type: "image",
      source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: m[2] },
    });
    content.push({ type: "text", text: "Das ist ein Foto der Kaffeepackung. Lies sie aus und ergänze fehlende Angaben aus dem Web." });
    step({ id: "photo", kind: "photo", label: "Packungsfoto lesen", detail: "", state: "run" });
  }

  if (input.url) {
    let url = input.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
      new URL(url);
    } catch {
      throw new ScrapeError("Der Link ist ungültig.", 400);
    }
    if (kind !== "photo") {
      kind = "url";
      sourceInput = url;
    }
    step({ id: "page", kind: "page", label: "Shopseite laden", detail: host(url), state: "run" });
    const pre = await prefetch(url);
    if (pre) {
      step({ id: "page", kind: "page", label: "Shopseite geladen", detail: (pre.title || host(pre.finalUrl)).slice(0, 90), state: "ok" });
      if (pre.images.length) emit?.({ t: "images", urls: pre.images.slice(0, 8) });
      candidates = pre.images;
      content.push({
        type: "text",
        text: [
          `Shop-Link: ${url}`,
          `Vorab geladene Seite (${pre.finalUrl}):`,
          `<title>${pre.title}</title>`,
          `<meta>${JSON.stringify(pre.meta)}</meta>`,
          pre.shopify ? `<shopify_product>${pre.shopify}</shopify_product>` : "",
          pre.jsonld.length ? `<json_ld>${pre.jsonld.join("\n")}</json_ld>` : "",
          `<bild_kandidaten>${pre.images.join("\n")}</bild_kandidaten>`,
          `<seitentext>${pre.text}</seitentext>`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } else {
      step({ id: "page", kind: "page", label: "Shopseite nicht direkt ladbar", detail: "Die API ruft sie selbst ab", state: "fail" });
      content.push({
        type: "text",
        text: `Shop-Link: ${url}\nDie Seite ließ sich vorab nicht laden. Rufe sie mit web_fetch ab oder suche nach dem Kaffee.`,
      });
    }
  }

  if (input.name) {
    content.push({ type: "text", text: `Kaffee: ${input.name}` });
  }
  const roasters = knownRoasters();
  if (roasters.length) {
    content.push({
      type: "text",
      text: `Röstereien, die schon in der Bibliothek stehen: ${roasters.join(", ")}. Ist es eine davon, übernimm für roaster genau diese Schreibweise.`,
    });
  }
  if (!input.url) {
    content.push({ type: "text", text: "Suche die Produktseite des Rösters und trage die Daten ein." });
  }

  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 5 * 60_000 });
  const messages: BetaMessageParam[] = [{ role: "user", content }];
  let nudged = false;

  try {
    for (let round = 0; round < 8; round++) {
      const stream = client.beta.messages.stream(
        {
          model: model(),
          max_tokens: 16_000,
          system: SYSTEM,
          tools: TOOLS,
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        },
        { signal },
      );
      if (emit) {
        watchStream(stream, emit, steps, () => {
          const p = steps.get("photo");
          if (p?.state === "run") step({ ...p, label: "Packungsfoto gelesen", state: "ok" });
        });
      }
      const res = await stream.finalMessage();

      if (res.stop_reason === "refusal") {
        throw new ScrapeError("Die Anthropic-API hat die Anfrage abgelehnt. Bitte manuell erfassen.", 422);
      }
      if (res.stop_reason === "max_tokens") {
        throw new ScrapeError("Die Antwort wurde abgeschnitten. Bitte erneut versuchen.", 502);
      }
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }

      const call = res.content.find((b) => b.type === "tool_use" && b.name === "save_coffee");
      if (call && call.type === "tool_use") {
        const parsed = toolInput.safeParse(call.input);
        if (parsed.success) {
          const w = steps.get("write");
          if (w) step({ ...w, label: "Daten eingetragen", state: "ok" });
          const t = parsed.data;
          // Hält sich Claude nicht an die Arten („Gewaschen (48 h)“), wie den Altbestand aufteilen
          const [process, processDetail] =
            PROCESS_TYPES.includes(t.process) || !t.process ? [t.process, t.process_detail] : splitProcess(t.process);
          const fields: CoffeeFields = {
            name: t.name || input.name || "Unbenannter Kaffee",
            roaster: matchRoaster(t.roaster, roasters),
            country: t.country,
            region: t.region,
            farm: t.farm,
            producer: t.producer,
            varieties: t.varieties,
            process,
            process_detail: [processDetail, processDetail === t.process_detail ? "" : t.process_detail].filter(Boolean).join(", "),
            altitude: t.altitude,
            harvest: t.harvest,
            roast_level: t.roast_level,
            roast_for: t.roast_for,
            roaster_notes: t.roaster_notes,
            description: t.description,
            weight_g: t.weight_g != null && t.weight_g > 0 ? Math.round(t.weight_g) : null,
            price_eur: t.price_eur != null && t.price_eur >= 0 ? Math.round(t.price_eur * 100) / 100 : null,
            // nur plausible Werte der SCA-Skala; Röster nennen meist 80–90
            cup_score: t.cup_score != null && t.cup_score > 0 && t.cup_score <= 100 ? Math.round(t.cup_score * 100) / 100 : null,
            roaster_recipes: t.roaster_recipes.map((r) => ({ ...r, title: r.title || r.method })),
            url: /^https?:\/\//.test(t.url) ? t.url : input.url && kind === "url" ? sourceInput : "",
          };
          const images = [...new Set([...t.image_urls, ...candidates])]
            .filter((x) => /^https?:\/\//.test(x))
            .slice(0, 12);
          return {
            fields,
            image_urls: images,
            uploaded_image: uploadedImage,
            notes: t.notes,
            source: { kind, input: sourceInput.slice(0, 2000), at: new Date().toISOString(), model: res.model },
            sources_used: t.sources.filter((x) => /^https?:\/\//.test(x)),
          };
        }
        messages.push({ role: "assistant", content: res.content });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: call.id,
              is_error: true,
              content: `INVALID_INPUT: ${parsed.error.issues
                .slice(0, 5)
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")}. Bitte save_coffee mit vollständigen Feldern erneut aufrufen.`,
            },
          ],
        });
        continue;
      }

      if (nudged) break;
      nudged = true;
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: "Bitte trage jetzt alles, was du gefunden hast, mit save_coffee ein." });
    }
  } catch (e) {
    if (signal?.aborted) throw new ScrapeError("Abgebrochen", 499);
    throw friendlyError(e);
  }
  throw new ScrapeError("Die Anthropic-API hat keine Daten geliefert. Bitte erneut versuchen oder manuell erfassen.", 502);
}

// ---------- Nur Röster-Rezepte ----------

const RECIPES_TOOL: BetaToolUnion = {
  name: "save_recipes",
  description: "Trägt die Zubereitungen ein, die der Röster für diesen Kaffee vorschlägt. Genau einmal aufrufen, auch mit leerer Liste.",
  strict: true,
  input_schema: { type: "object", additionalProperties: false, properties: { roaster_recipes: RECIPE_SCHEMA }, required: ["roaster_recipes"] },
};

/** Röster-Rezepte eines schon erfassten Kaffees von seiner Shopseite nachladen */
export async function scrapeRecipes(input: { url: string; name: string; roaster: string }, signal?: AbortSignal): Promise<RoasterRecipe[]> {
  const { key } = apiKey();
  if (!key) throw new ScrapeError("Kein API-Key hinterlegt. Bitte in den Einstellungen eintragen.", 400);
  let url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    new URL(url);
  } catch {
    throw new ScrapeError("Der Shop-Link ist ungültig.", 400);
  }
  const pre = await prefetch(url);
  const text = [
    `Kaffee: ${[input.roaster, input.name].filter(Boolean).join(" · ")}`,
    `Shop-Link: ${url}`,
    pre
      ? [
          `Vorab geladene Seite (${pre.finalUrl}):`,
          `<title>${pre.title}</title>`,
          pre.shopify ? `<shopify_product>${pre.shopify}</shopify_product>` : "",
          pre.jsonld.length ? `<json_ld>${pre.jsonld.join("\n")}</json_ld>` : "",
          `<seitentext>${pre.text}</seitentext>`,
        ]
          .filter(Boolean)
          .join("\n")
      : "Die Seite ließ sich vorab nicht laden. Rufe sie mit web_fetch ab.",
    "Trage mit save_recipes die Zubereitungen ein, die der Röster für diesen Kaffee vorschlägt. Verlinkt die Seite eine Zubereitungsanleitung zu diesem Kaffee, darfst du sie mit web_fetch abrufen.",
  ].join("\n");

  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 3 * 60_000 });
  const messages: BetaMessageParam[] = [{ role: "user", content: [{ type: "text", text }] }];
  try {
    for (let round = 0; round < 5; round++) {
      const res = await client.beta.messages
        .stream(
          {
            model: model(),
            max_tokens: 8000,
            system: `Du liest von der Shopseite eines Spezialitätenkaffees die Zubereitungsempfehlungen des Rösters aus. ${RECIPE_RULES}`,
            tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 20_000 }, RECIPES_TOOL],
            output_config: { effort: "low" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages,
          },
          { signal },
        )
        .finalMessage();
      if (res.stop_reason === "refusal") throw new ScrapeError("Die Anthropic-API hat die Anfrage abgelehnt.", 422);
      if (res.stop_reason === "max_tokens") throw new ScrapeError("Die Antwort wurde abgeschnitten. Bitte erneut versuchen.", 502);
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason === "pause_turn") continue;
      const call = res.content.find((b) => b.type === "tool_use" && b.name === "save_recipes");
      if (call && call.type === "tool_use") {
        const parsed = z.object({ roaster_recipes: recipeInput }).safeParse(call.input);
        if (parsed.success) return parsed.data.roaster_recipes.map((r) => ({ ...r, title: r.title || r.method }));
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `INVALID_INPUT: ${parsed.error.issues[0]?.message ?? ""}. Bitte erneut aufrufen.` }],
        });
        continue;
      }
      messages.push({ role: "user", content: [{ type: "text", text: "Bitte jetzt save_recipes aufrufen, notfalls mit leerer Liste." }] });
    }
    throw new ScrapeError("Die Anthropic-API hat keine Rezepte eingetragen. Bitte erneut versuchen.", 502);
  } catch (e) {
    throw friendlyError(e);
  }
}
