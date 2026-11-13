import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { buildProfile, profileText } from "../shared/profile.ts";
import type { RecommendEvent, Recommendations, Suggestion } from "../shared/types.ts";
import { apiKey, friendlyError, model, ScrapeError } from "./scrape.ts";
import { getSetting, listCoffees, setSetting } from "./store.ts";

/**
 * „Was passt zu mir?“: Claude sucht anhand des Geschmacksprofils bei den Röstereien aus der Bibliothek nach Kaffees,
 * die gerade zu kaufen sind. Kostet API-Nutzung (Websuche, Seitenabruf), läuft nur auf Knopfdruck.
 * Das letzte Ergebnis liegt in den Einstellungen (Schlüssel `recommendations`).
 */

const KEY = "recommendations";

const SYSTEM = `Du berätst bei Spezialitätenkaffee. Aus dem Geschmacksprofil einer Person (ihre eigenen Bewertungen je Herkunft, Aufbereitung, Varietät, Rösterei und Röstgrad) suchst du Kaffees, die ihr wahrscheinlich schmecken, und trägst sie mit suggest_coffees ein.

- Suche bei den genannten Röstereien (deren Shops), nur Kaffees, die dort gerade angeboten werden. Höchstens zwei Vorschläge von einer Rösterei außerhalb der Liste, und nur, wenn sie besonders gut passen.
- Keine Kaffees, die die Person schon hat (Liste unten). Andere Ernten oder Lots desselben Hofs sind erlaubt, wenn du es im Grund sagst.
- url: die Produktseite, die du wirklich gesehen hast, nie geraten. Fehlt sie, lass den Vorschlag weg.
- Felder nur aus der Seite übernehmen, sonst "" bzw. null. country und process auf Deutsch (Äthiopien, Gewaschen, Natural, Honey, Anaerob …). roast_level nur hell, mittel oder dunkel.
- reason: ein bis zwei Sätze auf Deutsch, warum er zum Profil passt (konkret: welche Merkmale gut abschneiden). Ehrlich, wenn etwas davon abweicht.
- 4 bis 6 Vorschläge, die besten zuerst, möglichst nicht alle von einer Rösterei.`;

const SUGGEST_TOOL: BetaToolUnion = {
  name: "suggest_coffees",
  description: "Trägt die Vorschläge ein. Genau einmal am Ende aufrufen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            roaster: { type: "string" },
            url: { type: "string" },
            country: { type: "string" },
            process: { type: "string" },
            varieties: { type: "array", items: { type: "string" } },
            roast_level: { anyOf: [{ type: "string", enum: ["hell", "mittel", "dunkel"] }, { type: "null" }] },
            price_eur: { anyOf: [{ type: "number" }, { type: "null" }] },
            weight_g: { anyOf: [{ type: "integer" }, { type: "null" }] },
            notes: { type: "array", items: { type: "string" }, description: "Geschmacksnoten laut Röster" },
            reason: { type: "string" },
          },
          required: ["name", "roaster", "url", "country", "process", "varieties", "roast_level", "price_eur", "weight_g", "notes", "reason"],
        },
      },
    },
    required: ["suggestions"],
  },
};

const s = (max: number) => z.string().transform((v) => v.trim().slice(0, max));
const suggestionSchema = z.object({
  name: s(200),
  roaster: s(200),
  url: s(2000),
  country: s(100),
  process: s(100),
  varieties: z.array(s(100)).transform((v) => v.filter(Boolean).slice(0, 10)),
  roast_level: z.enum(["hell", "mittel", "dunkel"]).nullable(),
  price_eur: z.number().nullable().transform((v) => (v != null && v > 0 && v < 10_000 ? v : null)),
  weight_g: z.number().nullable().transform((v) => (v != null && v > 0 && v < 100_000 ? Math.round(v) : null)),
  notes: z.array(s(60)).transform((v) => v.filter(Boolean).slice(0, 8)),
  reason: s(600),
});

export function lastRecommendations(): Recommendations | null {
  const raw = getSetting(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Recommendations;
  } catch {
    return null;
  }
}

const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export async function recommend(hint: string, emit: (e: RecommendEvent) => void, signal?: AbortSignal): Promise<Recommendations> {
  const { key } = apiKey();
  if (!key) throw new ScrapeError("Kein API-Key hinterlegt. Bitte in den Einstellungen eintragen.", 400);
  const coffees = listCoffees();
  const profile = buildProfile(coffees);
  if (!profile.basis) throw new ScrapeError("Noch keine Bewertungen: Bewerte erst ein paar Bezüge, dann gibt es ein Profil.", 400);

  // Röstereien nach Häufigkeit, mit Shop-Adresse aus den erfassten Links
  const roasters = new Map<string, { n: number; hosts: Set<string> }>();
  for (const c of coffees) {
    if (!c.roaster.trim()) continue;
    const r = roasters.get(c.roaster) ?? { n: 0, hosts: new Set<string>() };
    r.n++;
    const h = host(c.url);
    if (h) r.hosts.add(h);
    roasters.set(c.roaster, r);
  }
  const roasterLines = [...roasters.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 15)
    .map(([name, r]) => `- ${name}${r.hosts.size ? ` (${[...r.hosts].slice(0, 2).join(", ")})` : ""}`);
  const owned = coffees.map((c) => `- ${[c.roaster, c.name].filter(Boolean).join(" · ")}`);

  const text = [
    "Geschmacksprofil (eigene Bewertungen; SCA-Bogen und Sterne sind getrennte Skalen):",
    profileText(profile),
    profile.headline.length ? `Am besten schneidet ab: ${profile.headline.join(", ")}.` : "",
    hint ? `Wunsch der Person: ${hint}` : "",
    "",
    "Röstereien der Person (Shop):",
    ...roasterLines,
    "",
    "Schon vorhanden (nicht vorschlagen):",
    ...owned.slice(0, 120),
  ]
    .filter((l) => l !== "")
    .join("\n");

  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 8 * 60_000 });
  const messages: BetaMessageParam[] = [{ role: "user", content: [{ type: "text", text }] }];
  try {
    for (let round = 0; round < 8; round++) {
      const stream = client.beta.messages.stream(
        {
          model: model(),
          max_tokens: 16_000,
          system: SYSTEM,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 10 },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10, max_content_tokens: 20_000 },
            SUGGEST_TOOL,
          ],
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        },
        { signal },
      );
      // Suchen und Abrufe als Schritte melden, sobald ihre Eingabe vollständig ist
      stream.on("contentBlock", (b) => {
        if (b.type !== "server_tool_use") return;
        const input = (b.input ?? {}) as { query?: unknown; url?: unknown };
        if (b.name === "web_search" && typeof input.query === "string") emit({ t: "step", label: "Websuche", detail: input.query });
        else if (b.name === "web_fetch" && typeof input.url === "string") emit({ t: "step", label: "Seite lesen", detail: host(input.url) || input.url });
      });
      const res = await stream.finalMessage();
      if (res.stop_reason === "refusal") throw new ScrapeError("Die Anthropic-API hat die Anfrage abgelehnt.", 422);
      if (res.stop_reason === "max_tokens") throw new ScrapeError("Die Antwort wurde abgeschnitten. Bitte erneut versuchen.", 502);
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason === "pause_turn") continue;
      const call = res.content.find((b) => b.type === "tool_use" && b.name === "suggest_coffees");
      if (call && call.type === "tool_use") {
        const parsed = z.object({ suggestions: z.array(suggestionSchema) }).safeParse(call.input);
        if (parsed.success) {
          const items: Suggestion[] = parsed.data.suggestions.filter((x) => x.name && /^https?:\/\//i.test(x.url)).slice(0, 8);
          const result: Recommendations = { at: new Date().toISOString(), model: model(), hint, headline: profile.headline, items };
          setSetting(KEY, JSON.stringify(result));
          return result;
        }
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `INVALID_INPUT: ${parsed.error.issues[0]?.message ?? ""}. Bitte erneut aufrufen.` }],
        });
        continue;
      }
      messages.push({ role: "user", content: [{ type: "text", text: "Bitte trage jetzt deine Vorschläge mit suggest_coffees ein." }] });
    }
    throw new ScrapeError("Die Anthropic-API hat keine Vorschläge geliefert. Bitte erneut versuchen.", 502);
  } catch (e) {
    if (signal?.aborted) throw new ScrapeError("Abgebrochen", 499);
    throw friendlyError(e);
  }
}
