// „Was passt zu mir?“: aus den eigenen Bewertungen je Merkmal (Land, Aufbereitung, Varietät, Rösterei, Röstgrad) ein Profil.
// SCA und Sterne bleiben getrennt: jedes Merkmal hat Ø SCA und Ø Sterne, gerankt wird nach SCA, ohne SCA nach Sternen.

import type { CoffeeListItem } from "./types.ts";

export type ProfileValue = { label: string; sca: number | null; sca_n: number; stars: number | null; stars_n: number; coffees: number[] };
export type ProfileDim = { id: "country" | "process" | "variety" | "roaster" | "roast"; label: string; values: ProfileValue[] };
export type TasteProfile = {
  /** wonach der Satz oben gebildet ist */
  basis: "sca" | "stars" | null;
  rated: number;
  headline: string[];
  dims: ProfileDim[];
  /** Ø über alle bewerteten Kaffees, zum Vergleich */
  avg_sca: number | null;
  avg_stars: number | null;
};

type C = Pick<CoffeeListItem, "id" | "country" | "process" | "varieties" | "roaster" | "roast_level" | "avg_score" | "avg_rating">;

const ROAST: Record<string, string> = { hell: "Hell", mittel: "Mittel", dunkel: "Dunkel" };

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function buildProfile(list: C[]): TasteProfile {
  const rated = list.filter((c) => c.avg_score != null || c.avg_rating != null);
  const scaN = rated.filter((c) => c.avg_score != null).length;
  const starsN = rated.filter((c) => c.avg_rating != null).length;
  const basis: TasteProfile["basis"] = scaN >= 2 ? "sca" : starsN >= 2 ? "stars" : scaN || starsN ? (scaN ? "sca" : "stars") : null;

  const dim = (id: ProfileDim["id"], label: string, keys: (c: C) => string[]): ProfileDim => {
    const map = new Map<string, C[]>();
    for (const c of rated) for (const k of keys(c)) if (k) map.set(k, [...(map.get(k) ?? []), c]);
    const values = [...map.entries()].map(([k, cs]) => {
      const sca = cs.map((c) => c.avg_score).filter((v): v is number => v != null);
      const stars = cs.map((c) => c.avg_rating).filter((v): v is number => v != null);
      const r = (v: number | null, d: number) => (v == null ? null : Math.round(v * d) / d);
      return { label: k, sca: r(mean(sca), 100), sca_n: sca.length, stars: r(mean(stars), 10), stars_n: stars.length, coffees: cs.map((c) => c.id) };
    });
    values.sort((a, b) => {
      const ka = basis === "stars" ? a.stars : a.sca;
      const kb = basis === "stars" ? b.stars : b.sca;
      if (ka != null && kb != null && ka !== kb) return kb - ka;
      if (ka == null !== (kb == null)) return ka == null ? 1 : -1;
      return (b.stars ?? 0) - (a.stars ?? 0) || b.coffees.length - a.coffees.length || a.label.localeCompare(b.label, "de");
    });
    return { id, label, values };
  };

  const dims: ProfileDim[] = [
    dim("country", "Herkunft", (c) => [c.country.trim()]),
    dim("process", "Aufbereitung", (c) => [c.process.trim()]),
    dim("variety", "Varietät", (c) => c.varieties.map((v) => v.trim())),
    dim("roaster", "Rösterei", (c) => [c.roaster.trim()]),
    dim("roast", "Röstgrad", (c) => [c.roast_level ? ROAST[c.roast_level] : ""]),
  ];

  // Satz oben: jeweils das Beste aus Land, Aufbereitung, Varietät, wenn es über dem eigenen Schnitt liegt.
  // Merkmale mit mindestens zwei bewerteten Kaffees gehen vor: ein einzelner Kaffee ist eher Zufall als Vorliebe
  const avgSca = mean(rated.map((c) => c.avg_score).filter((v): v is number => v != null));
  const avgStars = mean(rated.map((c) => c.avg_rating).filter((v): v is number => v != null));
  const headline: string[] = [];
  if (basis)
    for (const d of dims.slice(0, 3)) {
      const val = (x: ProfileValue) => (basis === "sca" ? x.sca : x.stars);
      const top = d.values.find((x) => val(x) != null && x.coffees.length >= 2) ?? d.values[0];
      const v = top ? val(top) : null;
      const avg = basis === "sca" ? avgSca : avgStars;
      if (top && v != null && avg != null && v >= avg && d.values.length > 1) headline.push(top.label);
    }

  return {
    basis,
    rated: rated.length,
    headline,
    dims,
    avg_sca: avgSca == null ? null : Math.round(avgSca * 100) / 100,
    avg_stars: avgStars == null ? null : Math.round(avgStars * 10) / 10,
  };
}

/** Kurzfassung für Claude: je Merkmal die besten und schwächsten Werte */
export function profileText(p: TasteProfile): string {
  const fmt = (v: { sca: number | null; sca_n: number; stars: number | null; stars_n: number; coffees: number[] }) =>
    [v.sca != null ? `Ø SCA ${v.sca.toFixed(2)}` : null, v.stars != null ? `Ø ${v.stars.toFixed(1)} Sterne` : null, `${v.coffees.length} Kaffee(s)`]
      .filter(Boolean)
      .join(", ");
  const lines = [
    `Bewertete Kaffees: ${p.rated}. Schnitt: ${p.avg_sca != null ? `SCA ${p.avg_sca.toFixed(2)}` : "kein SCA"}${p.avg_stars != null ? `, ${p.avg_stars.toFixed(1)} Sterne` : ""}.`,
  ];
  for (const d of p.dims) {
    if (!d.values.length) continue;
    const top = d.values.slice(0, 4).map((v) => `${v.label} (${fmt(v)})`);
    const low = d.values.length > 5 ? d.values.slice(-2).map((v) => `${v.label} (${fmt(v)})`) : [];
    lines.push(`${d.label}: oben ${top.join("; ")}${low.length ? ` | unten ${low.join("; ")}` : ""}`);
  }
  return lines.join("\n");
}
