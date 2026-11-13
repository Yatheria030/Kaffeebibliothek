// Aromarad nach dem SCA/WCR Coffee Taster's Flavor Wheel, auf Deutsch.
// Kategorie -> Gruppe -> Noten. IDs sind stabil und werden in den Bezügen gespeichert.

export type FlavorCategory = {
  id: string;
  label: string;
  color: string;
  colorDark: string;
  groups: { label: string; notes: string[] }[];
};

export const FLAVOR_WHEEL: FlavorCategory[] = [
  {
    id: "fruchtig",
    label: "Fruchtig",
    color: "#FF3B30",
    colorDark: "#FF453A",
    groups: [
      { label: "Beeren", notes: ["Brombeere", "Himbeere", "Blaubeere", "Erdbeere", "Johannisbeere"] },
      { label: "Trockenfrüchte", notes: ["Rosine", "Pflaume", "Dattel", "Feige"] },
      {
        label: "Andere Früchte",
        notes: ["Kirsche", "Granatapfel", "Ananas", "Traube", "Apfel", "Pfirsich", "Aprikose", "Birne", "Mango", "Maracuja", "Kokos"],
      },
      { label: "Zitrus", notes: ["Grapefruit", "Orange", "Zitrone", "Limette", "Mandarine", "Bergamotte"] },
    ],
  },
  {
    id: "blumig",
    label: "Blumig",
    color: "#AF52DE",
    colorDark: "#BF5AF2",
    groups: [
      { label: "Tee", notes: ["Schwarzer Tee", "Earl Grey"] },
      { label: "Blüten", notes: ["Jasmin", "Rose", "Kamille", "Hibiskus", "Holunderblüte", "Lavendel"] },
    ],
  },
  {
    id: "suess",
    label: "Süß",
    color: "#FF9500",
    colorDark: "#FF9F0A",
    groups: [
      { label: "Brauner Zucker", notes: ["Karamell", "Honig", "Ahornsirup", "Melasse", "Rohrzucker", "Toffee"] },
      { label: "Weitere", notes: ["Vanille", "Marzipan", "Nougat"] },
    ],
  },
  {
    id: "nussig-kakao",
    label: "Nussig & Kakao",
    color: "#A2845E",
    colorDark: "#AC8E68",
    groups: [
      { label: "Nüsse", notes: ["Haselnuss", "Mandel", "Erdnuss", "Walnuss", "Pekannuss"] },
      { label: "Kakao", notes: ["Schokolade", "Zartbitterschokolade", "Milchschokolade", "Kakao"] },
    ],
  },
  {
    id: "wuerzig",
    label: "Würzig",
    color: "#5856D6",
    colorDark: "#5E5CE6",
    groups: [{ label: "Gewürze", notes: ["Zimt", "Nelke", "Muskat", "Anis", "Pfeffer", "Kardamom", "Ingwer"] }],
  },
  {
    id: "sauer-fermentiert",
    label: "Sauer & Fermentiert",
    color: "#FFCC00",
    colorDark: "#FFD60A",
    groups: [
      { label: "Fermentiert", notes: ["Wein", "Rum", "Whisky", "Likör", "Fermentiert", "Überreif"] },
      { label: "Säuren", notes: ["Essig", "Joghurt", "Zitronensäure", "Apfelsäure"] },
    ],
  },
  {
    id: "gruen",
    label: "Grün & Pflanzlich",
    color: "#34C759",
    colorDark: "#30D158",
    groups: [{ label: "Pflanzlich", notes: ["Grüner Tee", "Kräuter", "Gras", "Heu", "Erbse", "Olivenöl", "Tomate"] }],
  },
  {
    id: "roestig",
    label: "Röstig",
    color: "#8E6C4A",
    colorDark: "#A0805E",
    groups: [
      { label: "Getreide", notes: ["Getreide", "Malz", "Brot", "Keks"] },
      { label: "Geröstet", notes: ["Tabak", "Rauchig", "Zeder", "Dunkel geröstet"] },
    ],
  },
  {
    id: "sonstiges",
    label: "Fehlnoten",
    color: "#8E8E93",
    colorDark: "#98989D",
    groups: [{ label: "Fehlnoten", notes: ["Papier", "Muffig", "Erdig", "Holzig", "Gummi", "Bitter", "Adstringierend"] }],
  },
];

export type FlavorNote = { id: string; label: string; category: string; group: string };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const FLAVOR_NOTES: FlavorNote[] = FLAVOR_WHEEL.flatMap((c) =>
  c.groups.flatMap((g) => g.notes.map((n) => ({ id: slug(n), label: n, category: c.id, group: g.label }))),
);

export const FLAVOR_BY_ID = new Map(FLAVOR_NOTES.map((n) => [n.id, n]));
export const CATEGORY_BY_ID = new Map(FLAVOR_WHEEL.map((c) => [c.id, c]));

// Zusätzliche Schlüsselwörter, damit freie Röster-Notizen ("Blaubeermarmelade", "Dark Chocolate")
// einer Kategorie zugeordnet werden.
const EXTRA_KEYWORDS: Record<string, string[]> = {
  fruchtig: ["beere", "berry", "frucht", "fruit", "kirsch", "cherry", "zitrus", "citrus", "apfel", "apple", "pfirsich", "peach", "plum", "pflaum", "orange", "lemon", "lime", "grape", "traube", "tropical", "tropisch", "melone", "melon", "papaya", "lychee", "litschi", "cassis", "marmelade", "jam", "rhabarber", "nektarine"],
  blumig: ["blüte", "blume", "floral", "flower", "jasmin", "jasmine", "rose", "tee", "tea", "bergamot", "lavendel", "lavender", "hibiscus"],
  suess: ["karamell", "caramel", "honig", "honey", "zucker", "sugar", "sirup", "syrup", "toffee", "vanill", "marzipan", "nougat", "panela", "melasse", "molasses", "süß", "sweet", "brown sugar", "candy"],
  "nussig-kakao": ["nuss", "nut", "mandel", "almond", "schoko", "choco", "kakao", "cocoa", "cacao", "praline", "praliné", "brownie"],
  wuerzig: ["gewürz", "spice", "zimt", "cinnamon", "nelke", "clove", "pfeffer", "pepper", "anis", "kardamom", "cardamom", "ingwer", "ginger", "muskat"],
  "sauer-fermentiert": ["wein", "wine", "rum", "whisky", "likör", "liqueur", "ferment", "boozy", "joghurt", "yogurt", "essig"],
  gruen: ["kräuter", "herb", "gras", "grass", "heu", "hay", "grün", "green", "oliv", "tomate", "minze", "mint"],
  roestig: ["malz", "malt", "getreide", "cereal", "brot", "bread", "keks", "biscuit", "cookie", "tabak", "tobacco", "rauch", "smok", "zeder", "cedar", "röst", "roast", "toast"],
};

export function categoriesForNotes(notes: string[]): string[] {
  const out = new Set<string>();
  for (const raw of notes) {
    const n = raw.toLowerCase();
    for (const f of FLAVOR_NOTES) {
      if (f.category === "sonstiges") continue;
      if (n.includes(f.label.toLowerCase())) out.add(f.category);
    }
    for (const [cat, kws] of Object.entries(EXTRA_KEYWORDS)) {
      if (kws.some((k) => n.includes(k))) out.add(cat);
    }
  }
  return [...out];
}
