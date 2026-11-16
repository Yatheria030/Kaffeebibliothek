import { BookOpenText, Coffee, Droplets, Flame, Earth, Leaf, Sparkles, type LucideIcon } from "lucide-react";
import { FLAVOR_WHEEL } from "../../../shared/flavors.ts";
import { CUP_KEYS, QUALITY_KEYS, SCORE_HINTS, SCORE_LABELS } from "../../../shared/sca.ts";
import { compassRules, E64WS } from "../../../shared/compass.ts";
import { ROAST_LEVELS } from "../../../shared/types.ts";
import { DEFAULT_SHOT_TARGETS, fmtRatio, targetLine } from "../../../shared/shot.ts";

// Kaffeewissen: kurze Artikel zu Grundlagen, Aufbereitung, Röstung, Varietäten, Herkunft, Zubereitung und Verkostung.
// `match` verbindet einen Artikel mit Feldern der Kaffees: Links aus dem Kaffee-Detail und „In deiner Bibliothek“.

export type WikiTopic = { id: string; title: string; blurb: string; icon: LucideIcon; color: string };

/** Absatz, Begriffsliste oder Hinweis */
export type WikiBlock = string | { list: [string, string][] } | { tip: string };
export type WikiSection = { h: string; body: WikiBlock[] };
export type WikiField = "process" | "varieties" | "country" | "roast_level" | "roast_for";

export type WikiArticle = {
  slug: string;
  topic: string;
  title: string;
  lead: string;
  /** Steckbrief */
  facts?: [string, string][];
  /** Tendenz 1–5, z. B. Säure oder Körper */
  profile?: { label: string; value: number }[];
  sections: WikiSection[];
  related?: string[];
  match?: { field: WikiField; values: string[] };
};

export const WIKI_TOPICS: WikiTopic[] = [
  { id: "grundlagen", title: "Grundlagen", blurb: "Von der Kirsche zur Bohne, Arabica und Robusta, was Specialty heißt.", icon: BookOpenText, color: "#2F6B4F" },
  { id: "aufbereitung", title: "Aufbereitung", blurb: "Was nach der Ernte passiert und warum es so viel Geschmack macht.", icon: Droplets, color: "#3E7CB1" },
  { id: "roestung", title: "Röstung", blurb: "Röstgrade, Filter oder Espresso, Ruhezeit und Lagerung.", icon: Flame, color: "#B5540F" },
  { id: "varietaeten", title: "Varietäten", blurb: "Die Pflanzen hinter dem Kaffee, von Typica bis Gesha.", icon: Leaf, color: "#5E8C3A" },
  { id: "herkunft", title: "Herkunft", blurb: "Anbauhöhe und die wichtigsten Länder mit ihrem Profil.", icon: Earth, color: "#8A5CB8" },
  { id: "zubereitung", title: "Zubereitung", blurb: "Verhältnis, Mahlgrad, Extraktion, Wasser und Methoden.", icon: Coffee, color: "#8A5A3B" },
  { id: "verkostung", title: "Verkostung", blurb: "Cupping, der SCA-Bogen, Aromarad und die Sprache des Geschmacks.", icon: Sparkles, color: "#C98A1B" },
];

const P = (saeure: number, koerper: number, suesse: number, frucht: number) => [
  { label: "Säure", value: saeure },
  { label: "Körper", value: koerper },
  { label: "Süße", value: suesse },
  { label: "Fruchtigkeit", value: frucht },
];

export const WIKI_ARTICLES: WikiArticle[] = [
  // ---------- Grundlagen ----------
  {
    slug: "kirsche",
    topic: "grundlagen",
    title: "Von der Kirsche zur Bohne",
    lead: "Kaffee ist der Samen einer Steinfrucht. Was in der Tasse landet, hängt schon an der Reife der Kirsche.",
    facts: [
      ["Pflanze", "Coffea, ein Rötegewächs"],
      ["Frucht", "Kaffeekirsche, meist mit zwei Samen"],
      ["Reifezeit", "6 bis 9 Monate nach der Blüte"],
      ["Rohkaffee", "Getrocknet auf 10–12 % Feuchte"],
    ],
    sections: [
      {
        h: "Aufbau der Kirsche",
        body: [
          "Unter der roten oder gelben Schale liegt süßes Fruchtfleisch, darunter eine klebrige Schleimschicht (Mucilage). Dann folgen die Pergamenthaut, ein dünnes Silberhäutchen und schließlich die Bohne. Wie viel von diesen Schichten beim Trocknen dranbleibt, ist genau das, was die Aufbereitung unterscheidet.",
        ],
      },
      {
        h: "Ernte",
        body: [
          "Spezialitätenkaffee wird meist selektiv von Hand gepflückt: Nur reife Kirschen kommen in den Korb, Pflücker gehen mehrmals durch dieselben Reihen. Beim Stripping oder maschinell (vor allem in Brasilien) landen reife und unreife Kirschen gemeinsam im Sack und werden danach sortiert.",
          { tip: "Reife Kirschen enthalten mehr Zucker. Das schmeckt man später als Süße in der Tasse." },
        ],
      },
      {
        h: "Peaberry",
        body: [
          "In etwa fünf bis zehn Prozent der Kirschen wächst nur ein runder Samen statt zwei flacher. Diese Perlbohnen werden manchmal getrennt verkauft (in Kenia und Tansania als Klasse „PB“).",
        ],
      },
    ],
    related: ["gewaschen", "natural", "arabica-robusta"],
  },
  {
    slug: "arabica-robusta",
    topic: "grundlagen",
    title: "Arabica und Robusta",
    lead: "Zwei Arten tragen fast den ganzen Weltmarkt. Specialty Coffee ist überwiegend Arabica, Robusta holt aber auf.",
    facts: [
      ["Arabica", "Coffea arabica, rund 60 % der Ernte"],
      ["Robusta", "Coffea canephora, rund 40 %"],
      ["Koffein", "Arabica etwa 1,2–1,5 %, Robusta etwa 2–2,7 %"],
    ],
    sections: [
      {
        h: "Arabica",
        body: [
          "Wächst am besten in Höhen von 1.000 bis 2.300 m, ist empfindlich gegen Hitze und Krankheiten wie Kaffeerost. Mehr Zucker und Fette ergeben mehr Süße, Säure und Aromenvielfalt. Fast alle Varietäten in dieser Bibliothek sind Arabica.",
        ],
      },
      {
        h: "Robusta",
        body: [
          "Robuster, ertragreicher und auch im Tiefland anbaubar. Schmeckt kräftiger, bitterer und erdiger, bringt mehr Körper und eine stabile Crema. Darum steckt er oft in italienischen Espresso-Blends. Sorgfältig aufbereiteter „Fine Robusta“ kann überraschend schokoladig und sauber sein.",
        ],
      },
      {
        h: "Weitere Arten",
        body: ["Liberica und Excelsa spielen nur eine Nebenrolle, gewinnen aber als klimafeste Alternativen an Bedeutung."],
      },
    ],
    related: ["kirsche", "indien", "hoehe"],
  },
  {
    slug: "specialty",
    topic: "grundlagen",
    title: "Specialty Coffee und Cup Score",
    lead: "Specialty heißt: Bei der Bewertung nach SCA-Bogen erreicht der Kaffee mindestens 80 von 100 Punkten.",
    facts: [
      ["Specialty", "ab 80 Punkten"],
      ["Sehr gut", "80–84,99"],
      ["Exzellent", "85–89,99"],
      ["Herausragend", "ab 90"],
    ],
    sections: [
      {
        h: "Was der Cup Score ist",
        body: [
          "Röster und Importeure geben oft einen Cup Score an, etwa „85 Punkte“. Er stammt aus einem Cupping nach dem Bogen der Specialty Coffee Association, meist von einem Q-Grader oder dem Röster selbst. Bewertet wird der Rohkaffee bzw. die Partie, nicht deine Packung.",
        ],
      },
      {
        h: "Offiziell ist er nicht",
        body: [
          "Es gibt keine Stelle, die einzelne Packungen zertifiziert. Der Score ist eine fachliche Einschätzung und zwischen Anbietern nur grob vergleichbar: Manche bewerten streng, manche großzügig. In dieser App steht er deshalb als „Cup Score (Röster)“ getrennt von deinen eigenen Bewertungen.",
          { tip: "Seit 2024 führt die SCA mit dem Coffee Value Assessment ein neues Bewertungssystem ein. Die meisten Röster nennen weiterhin Punkte nach dem klassischen 100-Punkte-Bogen." },
        ],
      },
      {
        h: "Q-Grader",
        body: ["Q-Grader sind vom Coffee Quality Institute geprüfte Verkoster. Sie bewerten Kaffee nach festem Protokoll und müssen ihre Lizenz regelmäßig erneuern."],
      },
    ],
    related: ["sca-bogen", "cupping"],
  },

  // ---------- Aufbereitung ----------
  {
    slug: "gewaschen",
    topic: "aufbereitung",
    title: "Gewaschen",
    lead: "Fruchtfleisch und Schleimschicht kommen vor dem Trocknen ab. Das Ergebnis schmeckt klar, mit heller Säure.",
    facts: [
      ["Auch genannt", "Washed, Fully Washed, nass aufbereitet"],
      ["Dauer", "Fermentation 12–72 h, Trocknung 1–3 Wochen"],
      ["Typisch für", "Kenia, Kolumbien, Zentralamerika, Ruanda"],
    ],
    profile: P(5, 2, 3, 3),
    sections: [
      {
        h: "So läuft es",
        body: [
          {
            list: [
              ["Entpulpen", "Eine Maschine quetscht die Bohnen aus der Kirsche."],
              ["Fermentieren", "In Tanks lösen Mikroorganismen die Schleimschicht, mit oder ohne Wasser."],
              ["Waschen", "Reste werden in Kanälen abgespült, schwimmende Bohnen aussortiert."],
              ["Trocknen", "Auf Patios oder Hochbetten bis etwa 11 % Feuchte, danach ruht der Kaffee im Pergament."],
            ],
          },
        ],
      },
      {
        h: "Geschmack",
        body: [
          "Weil kaum Frucht mittrocknet, zeigt sich die Bohne selbst: Varietät, Höhe und Boden kommen deutlich durch. Typisch sind saubere, saftige Säure, florale Noten und ein leichterer Körper.",
          { tip: "Kenia fermentiert oft zweimal mit Waschgang dazwischen („double washed“). Das ergibt die besonders klare, intensive Säure." },
        ],
      },
    ],
    related: ["natural", "honey", "kenia"],
    match: { field: "process", values: ["Gewaschen"] },
  },
  {
    slug: "natural",
    topic: "aufbereitung",
    title: "Natural",
    lead: "Die ganze Kirsche trocknet mit der Bohne darin. Fruchtzucker zieht ein: süß, beerig, voll.",
    facts: [
      ["Auch genannt", "Dry Process, trocken aufbereitet"],
      ["Dauer", "Trocknung 2–6 Wochen"],
      ["Typisch für", "Äthiopien, Brasilien, Jemen"],
    ],
    profile: P(3, 4, 5, 5),
    sections: [
      {
        h: "So läuft es",
        body: [
          "Die Kirschen werden sortiert und auf Patios oder Hochbetten ausgebreitet. Sie müssen täglich gewendet werden, damit sie gleichmäßig trocknen und nicht schimmeln. Erst danach entfernt die Trockenmühle die harte Hülle.",
        ],
      },
      {
        h: "Geschmack",
        body: [
          "Fruchtig bis tropisch, Erdbeere, Blaubeere, Rotwein. Dazu viel Süße und ein runder, schwerer Körper. Schlecht geführt wird es schnell muffig oder alkoholisch-vergoren.",
          { tip: "Natural braucht trockenes, sonniges Wetter. Deshalb ist es dort traditionell, wo Wasser knapp ist." },
        ],
      },
    ],
    related: ["gewaschen", "honey", "anaerob", "aethiopien"],
    match: { field: "process", values: ["Natural"] },
  },
  {
    slug: "honey",
    topic: "aufbereitung",
    title: "Honey und Pulped Natural",
    lead: "Die Schale kommt ab, die klebrige Schleimschicht bleibt dran. Geschmacklich liegt das zwischen gewaschen und natural.",
    facts: [
      ["Name", "Von der honigartig klebrigen Schicht, nicht vom Honig"],
      ["Stufen", "White, Yellow, Red, Black"],
      ["Typisch für", "Costa Rica, El Salvador, Brasilien"],
    ],
    profile: P(3, 3, 5, 4),
    sections: [
      {
        h: "Die Farben",
        body: [
          "Je mehr Schleimschicht dranbleibt und je langsamer getrocknet wird, desto dunkler wird die Bohne und desto fruchtiger der Kaffee.",
          {
            list: [
              ["White / Yellow", "Wenig Mucilage, schnelle Trocknung. Nah am gewaschenen Kaffee."],
              ["Red", "Mehr Mucilage, schattiger und langsamer getrocknet."],
              ["Black", "Fast alles bleibt dran, sehr langsam getrocknet. Am süßesten und fruchtigsten."],
            ],
          },
        ],
      },
      {
        h: "Pulped Natural",
        body: [
          "In Brasilien heißt das Verfahren Pulped Natural: entpulpt und mit der Schleimschicht getrocknet. In dieser Bibliothek läuft es deshalb unter Honey, mit dem Zusatz „Pulped Natural“.",
        ],
      },
    ],
    related: ["gewaschen", "natural", "zentralamerika"],
    match: { field: "process", values: ["Honey", "Pulped Natural"] },
  },
  {
    slug: "anaerob",
    topic: "aufbereitung",
    title: "Anaerob",
    lead: "Fermentation unter Luftabschluss. Kräftige, oft ungewohnte Aromen von tropischer Frucht bis Zimt.",
    facts: [
      ["Prinzip", "Verschlossene Tanks, CO₂ verdrängt den Sauerstoff"],
      ["Dauer", "Meist 24–120 h"],
      ["Danach", "Gewaschen oder als Natural getrocknet"],
    ],
    profile: P(3, 4, 4, 5),
    sections: [
      {
        h: "So läuft es",
        body: [
          "Kirschen oder entpulpte Bohnen kommen in dichte Tanks oder Fässer. Ohne Sauerstoff arbeiten andere Mikroorganismen, vor allem Milchsäurebakterien und Hefen. Viele Produzenten steuern Temperatur, pH-Wert und Zeit sehr genau, manche impfen gezielt Hefe dazu.",
        ],
      },
      {
        h: "Geschmack",
        body: [
          "Intensiv und eigen: Likör, Zimt, Mango, Joghurt, Kaugummi. Manche lieben es, andere finden es zu laut. In der Bibliothek steht „Anaerob“ als Art, Details wie „Natural, 72 h“ im Zusatz.",
        ],
      },
      {
        h: "Verwandte Verfahren",
        body: [
          {
            list: [
              ["Carbonic Maceration", "Ganze Kirschen in CO₂-gefluteten Tanks, aus dem Weinbau übernommen."],
              ["Lactic", "Fermentation mit Fokus auf Milchsäure, cremig und rund."],
              ["Yeast inoculated", "Mit zugesetzten Hefen für kontrollierte Aromen."],
            ],
          },
        ],
      },
    ],
    related: ["carbonic-maceration", "natural", "kolumbien"],
    match: { field: "process", values: ["Anaerob"] },
  },
  {
    slug: "carbonic-maceration",
    topic: "aufbereitung",
    title: "Carbonic Maceration",
    lead: "Ein Verfahren aus dem Beaujolais: ganze Kirschen fermentieren in Tanks voller Kohlendioxid.",
    facts: [
      ["Herkunft", "Weinbau, im Kaffee seit etwa 2015 bekannt"],
      ["Bekannt durch", "Saša Šestić, Barista-Weltmeister 2015"],
    ],
    profile: P(4, 3, 4, 5),
    sections: [
      {
        h: "So läuft es",
        body: [
          "Die Kirschen bleiben ganz und liegen in Tanks, die mit CO₂ gespült wurden. Die Fermentation beginnt in der Frucht selbst. Danach wird meist als Natural getrocknet.",
        ],
      },
      {
        h: "Geschmack",
        body: ["Sehr fruchtig und weinig: rote Beeren, Traube, Kaugummi, oft mit klarer Säure. Ein typischer Wettbewerbskaffee."],
      },
    ],
    related: ["anaerob", "natural"],
    match: { field: "process", values: ["Carbonic Maceration"] },
  },
  {
    slug: "wet-hulled",
    topic: "aufbereitung",
    title: "Wet Hulled",
    lead: "Indonesiens eigenes Verfahren: Die Bohne wird noch feucht geschält. Erdig, würzig, schwer.",
    facts: [
      ["Lokal", "Giling Basah"],
      ["Typisch für", "Sumatra, Sulawesi"],
      ["Erkennbar", "Bläulich-grüne Rohbohnen"],
    ],
    profile: P(1, 5, 3, 1),
    sections: [
      {
        h: "So läuft es",
        body: [
          "Kleinbauern entpulpen und fermentieren kurz, trocknen nur an. Bei 30 bis 50 % Feuchte schält ein Händler das Pergament ab. Die nackte Bohne trocknet dann fertig. Das spart Zeit im feuchten Klima.",
        ],
      },
      {
        h: "Geschmack",
        body: ["Wenig Säure, schwerer Körper, Noten von Zeder, Tabak, Kräutern, Gewürzen und feuchter Erde. Gut für Espresso und dunklere Röstungen."],
      },
    ],
    related: ["indonesien", "semi-washed"],
    match: { field: "process", values: ["Wet Hulled"] },
  },
  {
    slug: "semi-washed",
    topic: "aufbereitung",
    title: "Semi-Washed",
    lead: "Ein unscharfer Begriff. Was gemeint ist, hängt vom Land ab.",
    sections: [
      {
        h: "Bedeutungen",
        body: [
          {
            list: [
              ["Brasilien", "Die Schleimschicht wird mechanisch abgerieben, ohne lange Fermentation. Liegt zwischen Honey und gewaschen."],
              ["Indonesien", "Oft als anderer Name für Wet Hulled verwendet."],
              ["Sonst", "Manchmal einfach ein Synonym für Honey."],
            ],
          },
          { tip: "Steht nur „semi-washed“ auf der Packung, lohnt ein Blick auf Land und Röster-Beschreibung. Im Zusatz kannst du festhalten, was gemeint ist." },
        ],
      },
    ],
    related: ["honey", "wet-hulled", "gewaschen"],
    match: { field: "process", values: ["Semi-Washed"] },
  },
  {
    slug: "monsooned",
    topic: "aufbereitung",
    title: "Monsooned",
    lead: "Indiens Sonderweg: Der fertige Rohkaffee liegt wochenlang im feuchten Monsunwind. Kaum Säure, viel Körper, würzig-erdig.",
    facts: [
      ["Bekannt als", "Monsooned Malabar"],
      ["Herkunft", "Malabarküste, Karnataka und Kerala"],
      ["Dauer", "Etwa 12 bis 16 Wochen"],
      ["Erkennbar", "Große, blassgelbe Rohbohnen"],
    ],
    profile: P(1, 5, 3, 1),
    sections: [
      {
        h: "So läuft es",
        body: [
          "Getrockneter Rohkaffee, meist Natural, kommt in offene Lagerhallen an der Küste. Während des Monsuns von Juni bis September zieht feuchte Seeluft hindurch, die Bohnen werden regelmäßig umgeschichtet. Sie quellen auf, werden fast doppelt so groß und verlieren ihre grüne Farbe.",
          "Das Verfahren ahmt nach, was früher auf monatelangen Schiffsreisen nach Europa von selbst geschah.",
        ],
      },
      {
        h: "Geschmack",
        body: [
          "Sehr wenig Säure, schwerer Körper, Noten von Gewürzen, Holz, Tabak und Erde. Beliebt in Espresso-Blends und für Milchgetränke.",
          { tip: "Monsooned-Bohnen sind leichter und poröser. Oft braucht es einen gröberen Mahlgrad als bei einem gewöhnlichen Natural." },
        ],
      },
      {
        h: "In der Bibliothek",
        body: ["„Monsooned“ steht als Art, die ursprüngliche Aufbereitung oder Lagerdauer im Zusatz."],
      },
    ],
    related: ["indien", "natural", "wet-hulled"],
    match: { field: "process", values: ["Monsooned"] },
  },
  {
    slug: "entkoffeiniert",
    topic: "aufbereitung",
    title: "Entkoffeiniert",
    lead: "Das Koffein wird aus dem Rohkaffee gelöst, bevor er geröstet wird. Gute Decafs schmecken heute kaum anders.",
    facts: [
      ["Grenzwert EU", "Höchstens 0,1 % Koffein im Röstkaffee"],
      ["Zeitpunkt", "Am grünen Kaffee, vor der Röstung"],
    ],
    sections: [
      {
        h: "Verfahren",
        body: [
          {
            list: [
              ["Swiss Water", "Nur Wasser und Aktivkohlefilter, ohne Lösungsmittel. Bio-tauglich."],
              ["CO₂", "Überkritisches Kohlendioxid löst das Koffein gezielt heraus. Schonend für Aromen."],
              ["Zuckerrohr (EA)", "Ethylacetat aus vergorener Melasse, verbreitet in Kolumbien. Oft leicht fruchtig-süß."],
              ["Methylenchlorid", "Klassisches Lösungsmittelverfahren, in der EU mit strengen Rückstandsgrenzen erlaubt."],
            ],
          },
        ],
      },
      {
        h: "In der Bibliothek",
        body: ["„Entkoffeiniert“ steht als Art, das Verfahren im Zusatz, etwa „CO₂-Verfahren“ oder „Swiss Water“."],
      },
    ],
    related: ["gewaschen", "roestprozess"],
    match: { field: "process", values: ["Entkoffeiniert"] },
  },
  {
    slug: "mischung",
    topic: "aufbereitung",
    title: "Mischung",
    lead: "Blends kombinieren Kaffees mit verschiedenen Aufbereitungen, oft für Espresso.",
    sections: [
      {
        h: "Warum mischen",
        body: [
          "Ein Natural aus Brasilien bringt Körper und Schokolade, ein gewaschener Äthiopier Säure und Frucht. Zusammen ergibt das eine runde Tasse, die das ganze Jahr gleich schmecken soll.",
          { tip: "Im Zusatz stehen die Anteile, zum Beispiel „75 % gewaschen, 25 % natural“." },
        ],
      },
    ],
    related: ["gewaschen", "natural", "filter-espresso"],
    match: { field: "process", values: ["Mischung"] },
  },

  // ---------- Röstung ----------
  {
    slug: "roestprozess",
    topic: "roestung",
    title: "Was beim Rösten passiert",
    lead: "In zehn bis fünfzehn Minuten wird aus einer grasigen, harten Bohne ein Aromenträger mit über 800 Stoffen.",
    facts: [
      ["First Crack", "etwa 196–205 °C"],
      ["Second Crack", "etwa 224–230 °C"],
      ["Gewichtsverlust", "12–20 %, vor allem Wasser"],
    ],
    sections: [
      {
        h: "Die Phasen",
        body: [
          {
            list: [
              ["Trocknung", "Die Bohne verliert Wasser, wird gelb und riecht nach Heu und Brot."],
              ["Maillard", "Zucker und Aminosäuren reagieren: Bräunung, Röstaromen, Karamell, Nuss."],
              ["First Crack", "Dampf und CO₂ sprengen die Zellen hörbar auf. Ab hier ist Kaffee trinkbar."],
              ["Entwicklung", "Die Zeit nach dem First Crack entscheidet über Säure, Süße und Körper."],
              ["Second Crack", "Die Zellwände brechen erneut, Öle treten aus. Röstaromen übernehmen."],
            ],
          },
        ],
      },
      {
        h: "Was sich verschiebt",
        body: [
          "Je länger und heißer, desto mehr Säure wird abgebaut und desto mehr Bitterkeit und Körper entstehen. Herkunftsaromen treten zurück, Röstaromen nach vorn.",
        ],
      },
    ],
    related: ["hell", "mittel", "dunkel", "ruhezeit"],
  },
  {
    slug: "hell",
    topic: "roestung",
    title: "Helle Röstung",
    lead: "Endet kurz nach dem First Crack. Die Herkunft steht im Vordergrund: Frucht, Blüten, lebendige Säure.",
    facts: [
      ["Ende", "Kurz nach First Crack"],
      ["Passt zu", "Filter, Omni, moderne Espressi"],
      ["Auch", "Nordische Röstung, Filterröstung"],
    ],
    profile: P(5, 2, 3, 5),
    sections: [
      {
        h: "Geschmack",
        body: ["Zitrus, Beeren, Steinobst, Jasmin, Tee. Leichter Körper, klare Süße. Zu hell oder zu schnell geröstet schmeckt es grasig, nach Erdnuss oder sauer."],
      },
      {
        h: "Zubereitung",
        body: ["Helle Bohnen sind dichter und lösen sich schwerer. Feiner mahlen und heißeres Wasser (94–96 °C) helfen bei der Extraktion."],
      },
    ],
    related: ["mittel", "roestprozess", "extraktion"],
    match: { field: "roast_level", values: ["hell"] },
  },
  {
    slug: "mittel",
    topic: "roestung",
    title: "Mittlere Röstung",
    lead: "Säure und Röstaromen in Balance: Karamell, Schokolade, Nuss, darunter noch Frucht.",
    facts: [
      ["Ende", "Deutlich nach First Crack, vor Second Crack"],
      ["Passt zu", "Espresso, Milchgetränke, Omni"],
    ],
    profile: P(3, 4, 5, 3),
    sections: [
      {
        h: "Geschmack",
        body: ["Rund und zugänglich, mehr Körper und Süße als hell, weniger Bitterkeit als dunkel. Viele Espressoröstungen von Specialty-Röstern liegen hier."],
      },
    ],
    related: ["hell", "dunkel", "filter-espresso"],
    match: { field: "roast_level", values: ["mittel"] },
  },
  {
    slug: "dunkel",
    topic: "roestung",
    title: "Dunkle Röstung",
    lead: "Bis an oder über den Second Crack. Röstaromen, Bitterschokolade, schwerer Körper, wenig Säure.",
    facts: [
      ["Ende", "Um oder nach Second Crack"],
      ["Erkennbar", "Glänzende, ölige Oberfläche"],
      ["Passt zu", "Klassischer italienischer Espresso, Moka"],
    ],
    profile: P(1, 5, 3, 1),
    sections: [
      {
        h: "Geschmack",
        body: ["Dunkle Schokolade, Kakao, Rauch, Lakritz. Herkunft und Varietät treten weit zurück. Mit Milch sehr verträglich."],
      },
      {
        h: "Zubereitung",
        body: ["Dunkle Bohnen extrahieren leicht. Etwas kühleres Wasser (88–92 °C) und gröberer Mahlgrad halten die Bitterkeit im Zaum."],
      },
    ],
    related: ["mittel", "roestprozess", "arabica-robusta"],
    match: { field: "roast_level", values: ["dunkel"] },
  },
  {
    slug: "filter-espresso",
    topic: "roestung",
    title: "Filter, Espresso, Omni",
    lead: "Röster stimmen die Röstung auf die Zubereitung ab. Die Angabe sagt, wofür der Kaffee gedacht ist.",
    sections: [
      {
        h: "Die drei Profile",
        body: [
          {
            list: [
              ["Filter", "Heller, um Klarheit und Säure zu zeigen. Beim langsamen Durchlauf entsteht keine harte Säure."],
              ["Espresso", "Etwas länger entwickelt. Unter Druck und mit wenig Wasser würde eine Filterröstung oft zu sauer schmecken."],
              ["Omni", "Ein Kompromiss für beides. Gut, wenn du einen Kaffee für Siebträger und Handfilter willst."],
            ],
          },
          { tip: "Eine Filterröstung als Espresso klappt oft mit längerem Bezug (1:2,5 bis 1:3) und höherer Temperatur." },
        ],
      },
    ],
    related: ["hell", "mittel", "bruehverhaeltnis", "methoden"],
    match: { field: "roast_for", values: ["filter", "espresso", "omni"] },
  },
  {
    slug: "ruhezeit",
    topic: "roestung",
    title: "Röstdatum, Ruhezeit und Lagerung",
    lead: "Frisch geröstet ist nicht sofort am besten. Kaffee muss entgasen, bevor er sein Hoch erreicht.",
    facts: [
      ["Filter (mittel)", "ab Tag 5, am besten bis Tag 28"],
      ["Omni (mittel)", "ab Tag 7, am besten bis Tag 30"],
      ["Espresso (mittel)", "ab Tag 9, am besten bis Tag 30"],
      ["Gut trinkbar", "Hell 10, mittel 8, dunkel 5 Wochen"],
      ["Lagerung", "Luftdicht, dunkel, kühl, nicht im Kühlschrank"],
    ],
    sections: [
      {
        h: "Warum Ruhezeit",
        body: [
          "Beim Rösten entsteht viel CO₂, das in den ersten Tagen entweicht. Zu frischer Kaffee blubbert stark, extrahiert ungleichmäßig und schmeckt oft scharf oder hohl. Espresso braucht mehr Ruhe als Filter, weil das CO₂ unter Druck die Extraktion stärker stört.",
          "Der Röstgrad verschiebt das Fenster: Helle Röstungen sind dichter, entgasen langsamer und brauchen länger, als Espresso etwa zwei Wochen. Dunkle Röstungen geben ihr CO₂ schneller ab, sind nach wenigen Tagen bereit und verlieren ihr Aroma auch früher. Omni-Röstungen liegen dazwischen.",
          "Richtwerte in Tagen ab Röstung (trinkbereit ab / am besten bis / noch gut bis): Filter hell 7/35/70, mittel 5/28/56, dunkel 3/14/35. Omni hell 10/38/70, mittel 7/30/56, dunkel 4/18/35. Espresso hell 14/42/70, mittel 9/30/56, dunkel 5/21/35. Sie fassen Empfehlungen von Röstern wie Tim Wendelboe, La Cabra, Partners Coffee und Simon & Bearns zusammen; Studien belegen nur die Richtung, keine festen Tage.",
          { tip: "In der Bibliothek zählt „Tag N“ ab Röstdatum. Der Verlauf zeigt, wann dir ein Kaffee am besten geschmeckt hat, das Lager rechnet für jede Packung ihr Trinkfenster." },
        ],
      },
      {
        h: "Lagerung",
        body: [
          "Sauerstoff, Licht, Wärme und Feuchtigkeit lassen Aromen schneller verfliegen. Der Röstbeutel mit Ventil ist ein guter Ort. Helle Röstungen bleiben länger gut als dunkle, nach dem Fenster wird Kaffee langsam flacher, nicht schlecht. Offene Packungen lieber zügig aufbrauchen und eine nach der anderen öffnen.",
          "Einfrieren funktioniert gut, wenn der Kaffee portioniert und luftdicht verpackt ist. Bei −18 °C altert er praktisch nicht. Eine ganze Tüte geschlossen auftauen lassen, bis sie Raumtemperatur hat, erst dann öffnen, sonst schlägt sich Wasser auf den Bohnen nieder. Portionen kann man auch gefroren direkt mahlen. Nicht wiederholt auftauen und einfrieren.",
          { tip: "Im Lager markierst du eine Tüte als eingefroren; die Tage im Gefrierfach zählen nicht zum Alter. Hast du mehr als die nächste Packung im Vorrat, empfiehlt das Lager, die übrigen einzufrieren." },
        ],
      },
    ],
    related: ["roestprozess", "extraktion"],
  },

  // ---------- Varietäten ----------
  {
    slug: "gesha",
    topic: "varietaeten",
    title: "Gesha",
    lead: "Die berühmteste Varietät: floral, teeartig, mit Bergamotte und Jasmin. Teuer, weil selten und ertragsarm.",
    facts: [
      ["Ursprung", "Gesha-Region, Äthiopien"],
      ["Bekannt seit", "2004, Hacienda La Esmeralda, Panama"],
      ["Ertrag", "Niedrig"],
    ],
    sections: [
      {
        h: "Geschichte",
        body: ["In den 1930ern in Äthiopien gesammelt, kam Gesha über Forschungsstationen nach Mittelamerika. Lange unbeachtet, bis ein Gesha aus Panama 2004 einen Wettbewerb mit Abstand gewann und Rekordpreise erzielte."],
      },
      {
        h: "Geschmack",
        body: ["Jasmin, Bergamotte, Pfirsich, Zitrusschale, sehr klar und leicht im Körper. Am besten hell geröstet und als Filter."],
      },
    ],
    related: ["heirloom", "zentralamerika", "aethiopien"],
    match: { field: "varieties", values: ["Gesha", "Geisha"] },
  },
  {
    slug: "bourbon",
    topic: "varietaeten",
    title: "Bourbon",
    lead: "Eine klassische Arabica-Linie, benannt nach der Insel Bourbon (heute Réunion). Süß, rund, ausgewogen.",
    facts: [
      ["Ursprung", "Aus dem Jemen, im 18. Jh. nach Réunion"],
      ["Formen", "Red, Yellow, Orange, Pink"],
      ["Ertrag", "Mittel, anfällig für Rost"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Karamell, Steinobst, Milchschokolade, elegante Säure. Viele moderne Varietäten wie Caturra stammen von Bourbon ab. In Ruanda und Burundi ist er die Hauptvarietät."],
      },
      {
        h: "Pink Bourbon",
        body: ["Kommt aus Huila in Kolumbien und hat rosa Kirschen. Trotz des Namens zeigen Erbgutanalysen eher eine Nähe zu äthiopischen Landsorten. Floral und fruchtig, sehr gefragt."],
      },
    ],
    related: ["typica", "caturra-catuai", "ruanda-burundi"],
    match: { field: "varieties", values: ["Bourbon", "Red Bourbon", "Yellow Bourbon", "Pink Bourbon", "Orange Bourbon"] },
  },
  {
    slug: "typica",
    topic: "varietaeten",
    title: "Typica",
    lead: "Eine der ältesten kultivierten Varietäten und Stammform vieler anderer. Sauber, süß, mild.",
    facts: [
      ["Weg", "Jemen, Indien, Java, Amsterdam, Karibik"],
      ["Ertrag", "Niedrig, krankheitsanfällig"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Klar und süß, mit feiner Säure. Hohe Qualität, aber wenig Ertrag. Darum wurde Typica vielerorts durch robustere Sorten ersetzt. Java, Blue Mountain und Kona gehen auf Typica zurück."],
      },
    ],
    related: ["bourbon", "indonesien"],
    match: { field: "varieties", values: ["Typica", "Java"] },
  },
  {
    slug: "caturra-catuai",
    topic: "varietaeten",
    title: "Caturra und Catuai",
    lead: "Kompakte Arbeitspferde Lateinamerikas: kleine Pflanzen, hoher Ertrag, solide Tasse.",
    facts: [
      ["Caturra", "Zwergmutation von Bourbon, Brasilien 1937"],
      ["Catuai", "Kreuzung Mundo Novo × Caturra, Brasilien"],
    ],
    sections: [
      {
        h: "Warum so verbreitet",
        body: ["Kleine Pflanzen lassen sich dicht pflanzen und leicht ernten. In der Tasse eher hell und klar (Caturra) bzw. ausgewogen und mild (Catuai). Beide sind anfällig für Kaffeerost."],
      },
    ],
    related: ["bourbon", "castillo", "brasilien"],
    match: { field: "varieties", values: ["Caturra", "Catuai", "Mundo Novo"] },
  },
  {
    slug: "sl28-sl34",
    topic: "varietaeten",
    title: "SL28 und SL34",
    lead: "Kenias Qualitätsvarietäten. Ihnen verdankt kenianischer Kaffee die schwarze Johannisbeere und die saftige Säure.",
    facts: [
      ["Herkunft", "Scott Agricultural Laboratories, Kenia, 1930er"],
      ["Stärke", "SL28 verträgt Trockenheit gut"],
      ["Schwäche", "Anfällig für Rost und Kaffeebeerenkrankheit"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Schwarze Johannisbeere, Grapefruit, Tomate, Rotwein. Sehr intensive, phosphorig-spritzige Säure. Neuere kenianische Sorten wie Ruiru 11 und Batian sind robuster, gelten aber als weniger komplex."],
      },
    ],
    related: ["kenia", "gewaschen"],
    match: { field: "varieties", values: ["SL28", "SL34", "Ruiru 11", "Batian"] },
  },
  {
    slug: "pacamara",
    topic: "varietaeten",
    title: "Pacamara",
    lead: "Riesenbohnen aus El Salvador. Komplex, mal kräuterig, mal tropisch-fruchtig.",
    facts: [
      ["Kreuzung", "Pacas × Maragogype, El Salvador 1958"],
      ["Bohnen", "Sehr groß"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Kann polarisieren: Kräuter, grüne Paprika oder aber Mango, Schokolade, Blüten. Bei guter Aufbereitung oft ein Wettbewerbskaffee."],
      },
    ],
    related: ["bourbon", "zentralamerika"],
    match: { field: "varieties", values: ["Pacamara", "Maragogype", "Pacas"] },
  },
  {
    slug: "heirloom",
    topic: "varietaeten",
    title: "Äthiopische Landsorten",
    lead: "„Heirloom“ steht für tausende wilde und halbwilde Arabica-Formen aus Äthiopien, der Heimat des Kaffees.",
    facts: [
      ["Bekannte Nummern", "74110, 74112 (JARC-Selektionen)"],
      ["Herkunft", "Jimma Agricultural Research Center"],
    ],
    sections: [
      {
        h: "Was dahintersteckt",
        body: [
          "Auf einer Farm wachsen oft viele Typen durcheinander, die niemand einzeln benennt. Das Forschungszentrum in Jimma hat in den 1970ern widerstandsfähige Pflanzen ausgewählt und nummeriert. 74110 und 74112 sind heute weit verbreitet.",
        ],
      },
      {
        h: "Geschmack",
        body: ["Blumig, Zitrus, Bergamotte, Beeren. Gewaschen teeartig und klar, als Natural saftig und süß."],
      },
    ],
    related: ["aethiopien", "gesha"],
    match: { field: "varieties", values: ["Heirloom", "74110", "74112", "Landrace"] },
  },
  {
    slug: "castillo",
    topic: "varietaeten",
    title: "Castillo",
    lead: "Kolumbiens heute häufigste Varietät: gegen Kaffeerost gezüchtet, mit guter Aufbereitung überraschend fein.",
    facts: [
      ["Herkunft", "Cenicafé, Kolumbien, 2005"],
      ["Stärke", "Resistent gegen Kaffeerost"],
      ["Abstammung", "Mit Timor-Hybrid (enthält Robusta-Erbgut)"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Lange als reine Ertragssorte belächelt. Gut gepflückt und sorgfältig fermentiert liefert Castillo rote Früchte, Karamell und saubere Säure. Viele experimentelle Aufbereitungen aus Kolumbien nutzen ihn."],
      },
    ],
    related: ["kolumbien", "caturra-catuai", "anaerob"],
    match: { field: "varieties", values: ["Castillo", "Colombia", "Cenicafé 1"] },
  },
  {
    slug: "sidra",
    topic: "varietaeten",
    title: "Sidra",
    lead: "Ein Liebling der Wettbewerbe aus Ecuador. Floral und fruchtig, Herkunft nicht ganz geklärt.",
    facts: [["Herkunft", "Ecuador, Abstammung umstritten"]],
    sections: [
      {
        h: "Geschmack",
        body: ["Blüten, Steinobst, Zitrus, eine Gesha-ähnliche Klarheit. Früher als Kreuzung aus Bourbon und Typica beschrieben, Analysen deuten eher auf äthiopische Wurzeln."],
      },
    ],
    related: ["gesha", "heirloom"],
    match: { field: "varieties", values: ["Sidra"] },
  },

  // ---------- Herkunft ----------
  {
    slug: "hoehe",
    topic: "herkunft",
    title: "Anbauhöhe",
    lead: "Höher heißt kühler. Die Kirschen reifen langsamer, die Bohnen werden dichter, die Säure komplexer.",
    facts: [
      ["Spezialität", "Meist 1.200–2.300 m"],
      ["SHB", "Strictly Hard Bean, über etwa 1.350 m (Mittelamerika)"],
    ],
    sections: [
      {
        h: "Warum Höhe zählt",
        body: [
          "Kühle Nächte bremsen das Wachstum, die Pflanze lagert mehr Zucker und Säuren ein. Das zeigt sich als lebendige Säure und vielschichtige Aromen.",
          "Höhe ist relativ zum Breitengrad: Nah am Äquator (Kolumbien, Kenia) braucht es mehr Höhe für dasselbe Klima als weiter weg (Brasilien, Mexiko).",
        ],
      },
    ],
    related: ["arabica-robusta", "kenia", "brasilien"],
  },
  {
    slug: "aethiopien",
    topic: "herkunft",
    title: "Äthiopien",
    lead: "Die Heimat des Arabica. Florale, teeartige gewaschene Kaffees und beerige Naturals.",
    facts: [
      ["Regionen", "Yirgacheffe, Sidama, Guji, Limu, Harrar"],
      ["Höhe", "1.500–2.300 m"],
      ["Ernte", "Oktober bis Januar"],
      ["Aufbereitung", "Gewaschen und Natural"],
    ],
    sections: [
      {
        h: "Anbau",
        body: ["Fast alles stammt von Kleinbauern mit wenigen hundert Bäumen im Garten oder Wald. Sie liefern Kirschen an Washing Stations, nach denen der Kaffee oft benannt ist."],
      },
      {
        h: "Geschmack",
        body: ["Gewaschen: Jasmin, Bergamotte, Zitrone, schwarzer Tee. Natural: Blaubeere, Erdbeere, tropische Frucht."],
      },
    ],
    related: ["heirloom", "natural", "gesha"],
    match: { field: "country", values: ["Äthiopien"] },
  },
  {
    slug: "kenia",
    topic: "herkunft",
    title: "Kenia",
    lead: "Intensiv, saftig, unverwechselbar: schwarze Johannisbeere und spritzige Säure.",
    facts: [
      ["Regionen", "Nyeri, Kirinyaga, Murang'a, Embu"],
      ["Varietäten", "SL28, SL34, Ruiru 11, Batian"],
      ["Ernte", "Oktober bis Dezember, Nebenernte im Sommer"],
      ["Klassen", "AA, AB, PB nach Bohnengröße"],
    ],
    sections: [
      {
        h: "Besonderheiten",
        body: ["Genossenschaften mit eigenen Factories (Nassmühlen) prägen das Bild. Aufbereitet wird fast immer gewaschen, oft mit doppelter Fermentation. Die Größenklassen sagen nichts über den Geschmack, nur über die Bohnengröße."],
      },
    ],
    related: ["sl28-sl34", "gewaschen"],
    match: { field: "country", values: ["Kenia"] },
  },
  {
    slug: "kolumbien",
    topic: "herkunft",
    title: "Kolumbien",
    lead: "Vielseitig und ganzjährig frisch, vom ausgewogenen Klassiker bis zum wilden Fermentations-Experiment.",
    facts: [
      ["Regionen", "Huila, Nariño, Cauca, Tolima, Antioquia"],
      ["Varietäten", "Castillo, Caturra, Colombia, Pink Bourbon"],
      ["Ernte", "Haupt- und Nebenernte (Mitaca), je nach Region fast ganzjährig"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Klassisch gewaschen: Karamell, rote Äpfel, Schokolade, klare Säure. Kolumbien ist zugleich das Land der Experimente mit anaeroben und Hefe-Fermentationen."],
      },
    ],
    related: ["castillo", "anaerob", "bourbon"],
    match: { field: "country", values: ["Kolumbien"] },
  },
  {
    slug: "brasilien",
    topic: "herkunft",
    title: "Brasilien",
    lead: "Der größte Produzent der Welt. Nussig, schokoladig, wenig Säure, die Basis vieler Espresso-Blends.",
    facts: [
      ["Anteil", "Etwa ein Drittel der Weltproduktion"],
      ["Regionen", "Sul de Minas, Cerrado Mineiro, Mogiana, Bahia"],
      ["Höhe", "800–1.300 m"],
      ["Ernte", "Mai bis September"],
    ],
    sections: [
      {
        h: "Anbau",
        body: ["Große, flache Farmen ernten oft maschinell. Natural und Pulped Natural überwiegen. Die geringere Höhe ergibt weniger Säure und mehr Körper."],
      },
    ],
    related: ["natural", "honey", "caturra-catuai"],
    match: { field: "country", values: ["Brasilien"] },
  },
  {
    slug: "zentralamerika",
    topic: "herkunft",
    title: "Mittelamerika",
    lead: "Von Guatemala bis Panama: klare, süße Kaffees mit Schokolade, Karamell und Steinobst.",
    facts: [
      ["Länder", "Guatemala, Honduras, El Salvador, Nicaragua, Costa Rica, Panama, Mexiko"],
      ["Ernte", "November bis März"],
      ["Aufbereitung", "Überwiegend gewaschen, Costa Rica viel Honey"],
    ],
    sections: [
      {
        h: "Die Länder",
        body: [
          {
            list: [
              ["Guatemala", "Vulkanböden in Antigua und Huehuetenango. Schokolade, Gewürze, kräftige Säure."],
              ["Costa Rica", "Kleine Micro Mills, Pioniere der Honey-Aufbereitung. Süß und sauber."],
              ["El Salvador", "Viel Bourbon und Pacamara, oft im Schatten angebaut."],
              ["Honduras", "Größter Produzent der Region, viele Kleinbauern."],
              ["Panama", "Boquete, die Heimat der Gesha-Rekorde."],
            ],
          },
        ],
      },
    ],
    related: ["honey", "gesha", "pacamara"],
    match: {
      field: "country",
      values: ["Guatemala", "Costa Rica", "Honduras", "El Salvador", "Nicaragua", "Panama", "Mexiko"],
    },
  },
  {
    slug: "ruanda-burundi",
    topic: "herkunft",
    title: "Ruanda und Burundi",
    lead: "Hochland mit fast nur Bourbon: rote Früchte, Tee und Blüten.",
    facts: [
      ["Höhe", "1.500–2.000 m"],
      ["Varietät", "Vor allem Bourbon"],
      ["Aufbereitung", "Meist gewaschen an Washing Stations"],
    ],
    sections: [
      {
        h: "Der Kartoffeldefekt",
        body: [
          "Manchmal riecht eine einzelne Bohne nach roher Kartoffel, ausgelöst durch Bakterien nach Insektenbefall. Das betrifft nur wenige Bohnen und wird beim Mahlen frei. Wer es schmeckt: Die Tasse wegschütten, der Rest der Packung ist meist in Ordnung.",
        ],
      },
    ],
    related: ["bourbon", "gewaschen"],
    match: { field: "country", values: ["Ruanda", "Burundi"] },
  },
  {
    slug: "indonesien",
    topic: "herkunft",
    title: "Indonesien",
    lead: "Inseln mit eigenem Charakter: erdig, würzig, schwerer Körper, wenig Säure.",
    facts: [
      ["Inseln", "Sumatra (Gayo, Lintong), Java, Sulawesi, Flores, Bali"],
      ["Aufbereitung", "Vor allem Wet Hulled"],
    ],
    sections: [
      {
        h: "Geschmack",
        body: ["Zeder, Tabak, Kräuter, dunkle Schokolade. Gewaschene Kaffees aus Java oder Bali sind klarer und heller. Sumatra ist ein Klassiker für dunkle Röstungen."],
      },
    ],
    related: ["wet-hulled", "typica"],
    match: { field: "country", values: ["Indonesien"] },
  },
  {
    slug: "indien",
    topic: "herkunft",
    title: "Indien",
    lead: "Schattenanbau zwischen Pfeffer und Kardamom, Arabica und Robusta Seite an Seite.",
    facts: [
      ["Regionen", "Karnataka (Chikmagalur), Kerala, Tamil Nadu"],
      ["Besonderheit", "Monsooned Malabar"],
    ],
    sections: [
      {
        h: "Monsooned Malabar",
        body: ["Rohkaffee wird in offenen Lagern den feuchten Monsunwinden ausgesetzt. Die Bohnen quellen auf, verlieren ihre Säure und schmecken erdig-würzig. Ein Überbleibsel aus der Zeit, als Kaffee monatelang per Schiff reiste."],
      },
      {
        h: "Robusta",
        body: ["Indien liefert sehr sauberen, gewaschenen Robusta, der in Espresso-Blends für Körper und Crema sorgt."],
      },
    ],
    related: ["arabica-robusta", "mischung", "monsooned"],
    match: { field: "country", values: ["Indien"] },
  },

  // ---------- Zubereitung ----------
  {
    slug: "bruehverhaeltnis",
    topic: "zubereitung",
    title: "Brühverhältnis",
    lead: "Wie viel Kaffee auf wie viel Wasser. Das Verhältnis bestimmt die Stärke, der Mahlgrad die Extraktion.",
    facts: [
      ["Filter", "1:15–1:17, also 60–65 g pro Liter"],
      ["Espresso", "1:2, z. B. 18 g zu 36 g in 25–30 s"],
      ["Ristretto / Lungo", "1:1–1:1,5 / 1:3 und mehr"],
      ["Temperatur", "88–96 °C, hell heißer, dunkel kühler"],
    ],
    sections: [
      {
        h: "Stärke statt Bitterkeit",
        body: [
          "Ein Verhältnis von 1:15 ergibt eine kräftige Tasse, 1:17 eine leichtere. Schmeckt ein Kaffee zu dünn, aber nicht sauer, nimm mehr Kaffee statt feiner zu mahlen.",
          { tip: "Wiege immer: Ein Löffel Bohnen wiegt je nach Röstung und Größe zwischen 5 und 9 g." },
        ],
      },
    ],
    related: ["extraktion", "methoden", "wasser"],
  },
  {
    slug: "extraktion",
    topic: "zubereitung",
    title: "Extraktion und Mahlgrad",
    lead: "Wasser löst erst Säuren, dann Zucker, zuletzt Bitterstoffe. Die Kunst ist, im richtigen Moment aufzuhören.",
    facts: [
      ["Ideal", "Etwa 18–22 % der Kaffeemasse gelöst"],
      ["Stellschrauben", "Mahlgrad, Zeit, Temperatur, Rühren"],
    ],
    sections: [
      {
        h: "Woran du es schmeckst",
        body: [
          {
            list: [
              ["Unterextrahiert", "Sauer, salzig, dünn, kurzer Abgang. Feiner mahlen, heißer oder länger brühen."],
              ["Überextrahiert", "Bitter, trocken, adstringierend, hohl. Gröber mahlen, kühler oder kürzer brühen."],
              ["Ausgewogen", "Süß, klare Säure, langer Nachgeschmack."],
            ],
          },
          { tip: "Ändere immer nur eine Sache. Am meisten bewirkt der Mahlgrad." },
        ],
      },
      {
        h: "Gleichmäßigkeit",
        body: ["Eine gute Mühle mit gleichmäßigem Mahlgut ist wichtiger als jede Maschine. Feinstaub überextrahiert, grobe Brocken bleiben sauer."],
      },
    ],
    related: ["bruehverhaeltnis", "saeure-koerper", "mahlkompass"],
  },
  {
    slug: "mahlkompass",
    topic: "zubereitung",
    title: "Mahlkompass",
    lead: "Wo du bei einem neuen Kaffee anfängst: ein Startwert für deine Mühle aus Röstung, Herkunft und Röstalter, der mit jedem Shot genauer wird.",
    facts: [
      ["Mühle", `${E64WS.name}, in ${E64WS.unit} ab Nullpunkt`],
      ...E64WS.bases.map((b): [string, string] => [b.label === "Filter" ? "Filter (V60 u. a.)" : b.label, `${b.value} ${E64WS.unit} ± ${b.spread}${b.rough ? ", geschätzt" : ""}`]),
      ["Eine Stufe", `${E64WS.nudge} ${E64WS.unit}`],
      ["Je Sekunde", `etwa ${E64WS.shotK} ${E64WS.unit} (Annahme, wird gelernt)`],
    ],
    sections: [
      {
        h: "Wie er rechnet",
        body: [
          "Jede Zubereitung hat einen Ausgangswert, gedacht für einen mittel gerösteten, gewaschenen Arabica um 1.500 m, zwei Wochen nach der Röstung. Die Regeln verschieben ihn um Anteile, damit sie für Espresso und Filter gleich gelten:",
          { list: compassRules(E64WS) },
          "Dichte Bohnen (hell, hoch gewachsen) geben ihren Geschmack schwerer ab und brauchen feineres Mahlgut. Lösliche Bohnen (Natural, Fermentation, dunkel) und viel Feinanteil (Decaf) laufen langsamer, dort darf es gröber sein.",
        ],
      },
      {
        h: "Das Ziel zuerst",
        body: [
          "Jeder Espresso hat ein Ziel: Dosis, Verhältnis und Zeitfenster. Den Standard je Röstgrad stellst du in den Einstellungen ein, am Kaffee lässt er sich unter Einstellen → Anpassen überschreiben. Ohne Röstgrad gilt mittel.",
          { list: ROAST_LEVELS.map((l): [string, string] => [l.label, `${fmtRatio(DEFAULT_SHOT_TARGETS[l.id].ratio)}, ${targetLine(DEFAULT_SHOT_TARGETS[l.id])}`]) },
          "Helle Röstungen sind dicht und lösen schwer, sie bekommen mehr Ausbeute und etwas mehr Zeit. Dunkle lösen leicht und werden schnell bitter, also kürzer. Die Werte oben sind die eingebauten Startwerte.",
        ],
      },
      {
        h: "Preinfusion und Bezugszeit",
        body: [
          "Die Zeit im Ziel ist die Bezugszeit ohne Preinfusion: ab dem Schritt, in dem der Druck steigt. Die Preinfusion davor hat ein eigenes Fenster, angezeigt wird beides als „7 + 29 s“. Shots der Decent liefern beides getrennt (der Schritt, ab dem die de1app das Volumen zählt), sonst trägst du sie im Bewertungsdialog ein.",
          {
            list: ROAST_LEVELS.map((l): [string, string] => {
              const t = DEFAULT_SHOT_TARGETS[l.id];
              return [l.label, `${t.pi.join("–")} s Preinfusion mit ${t.pi_flow} ml/s bis ${t.pi_bar} bar, ${t.temp.join("–")} °C`];
            }),
          },
          "Helle, dichte Bohnen brauchen länger, bis der Puck gleichmäßig durchnässt ist (Profile für helle Röstungen gehen bis 30 s). Dunkle, poröse sind schnell satt, eine lange Preinfusion zieht dort eher Bitteres. Sauer im Zeitfenster bei zu kurzer Preinfusion: erst länger vorbrühen, dann am Mahlgrad drehen. Bitter bei zu langer: kürzer.",
          "In der Decent heißt das: Preinfusion mit festem Fluss, bis der Abbruchdruck erreicht ist, höchstens die eingestellten Sekunden. Jeder Kaffee hat dafür ein eigenes Profil „# Rösterei - Kaffee“, das die Bibliothek aufs Tablet legt. Am Kaffee siehst du, wie weit seine Werte von der Empfehlung abweichen, und änderst sie dort oder am Tablet.",
        ],
      },
      {
        h: "Er lernt nur, was er nicht weiß",
        body: [
          "Jede Mühle ist ein wenig anders kalibriert und jeder Gaumen auch. Deshalb merkt sich die Bibliothek nicht den Mahlgrad selbst, sondern wie weit deine Shots vom Kompass entfernt lagen. Ab der ersten Tüte kommt diese Abweichung dazu, ab drei Tüten rechnet ein kleines Modell, welche Merkmale bei dir anders wirken.",
          {
            list: [
              ["Zeit", "Ist objektiv und gilt über alle Kaffees. Jeder Shot mit Zeit zählt, auch ein misslungener: Er wird auf das Zielverhältnis umgerechnet und um die Sekunden bis zur Mitte des Zielfensters verschoben. Daraus wird der Mahlgrad, der das Ziel getroffen hätte. Weit danebenliegende Shots zählen weniger."],
              ["Sekunden je µm", "Wie stark der Mahlgrad die Zeit verschiebt, lernt er aus Shots derselben Tüte mit verschiedenem Mahlgrad. Bis dahin gilt die Annahme der Mühle."],
              ["Geschmack", "Ist je Kaffee verschieden und wird nicht übertragen. „Zu sauer“ im Zeitfenster heißt: Dieser Kaffee will feiner, als die Zeit allein sagt. „Zu bitter“ heißt gröber. Daraus wird ein gedämpfter Versatz nur für diesen Kaffee."],
              ["Ohne Zeit", "Gelungene Shots ohne Zeit (ausgewogen, ab 4 Sternen oder SCA ab 84) zählen halb."],
            ],
          },
          "In einer Tüte, die schon läuft, rechnet der Tipp vom letzten Shot aus. Liegt die Zeit außerhalb des Fensters, sagt er, wie viele µm feiner oder gröber es sein sollen. Liegt sie drin, entscheidet der Geschmack: eine halbe Stufe, mehr oder weniger Ausbeute, oder es passt.",
          { tip: `${E64WS.note} Nach dem Kalibrieren liegen alle E64 WS in vergleichbaren Bereichen, die Filterwerte sind trotzdem nur ein Anfang.` },
        ],
      },
      {
        h: "Der Regler",
        body: [
          {
            list: [
              ["Ziehen", "Das Maßband unter der Nadel verschieben, mit Schwung geht es weiter. Antippen springt an die Stelle."],
              ["Tasten", "Doppel-Plus und -Minus für fünf Striche, einfach für einen. Pfeiltasten, Bild auf/ab und Mausrad gehen auch, Pos1 springt zum Kompass."],
              ["Chips", "Kompass, Tipp, zuletzt gut und letzter Bezug mit einem Tipp übernehmen. Die grüne Fläche ist die übliche Spanne."],
              ["Zahl", "Antippen und eintippen, wenn du den Wert schon kennst."],
            ],
          },
        ],
      },
    ],
    related: ["extraktion", "ruhezeit", "hell", "hoehe"],
  },
  {
    slug: "wasser",
    topic: "zubereitung",
    title: "Wasser",
    lead: "Eine Tasse besteht zu über 98 % aus Wasser. Seine Härte entscheidet mit, wie Säure und Süße ankommen.",
    facts: [
      ["Gesamthärte", "Etwa 4–8 °dH"],
      ["Karbonathärte", "Niedrig, etwa 2–4 °dH"],
      ["Nie", "Destilliertes Wasser"],
    ],
    sections: [
      {
        h: "Zu hart, zu weich",
        body: [
          "Viel Kalk (Hydrogencarbonat) puffert die Säure. Der Kaffee schmeckt flach und kreidig, die Maschine verkalkt. Ganz weiches Wasser löst zu wenig und schmeckt spitz und leer.",
          "Magnesium und Calcium helfen beim Lösen der Aromen, Hydrogencarbonat dämpft die Säure. Ein Tischfilter oder ein Rezept mit Mineralsalzen bringt hartes Leitungswasser in den guten Bereich.",
        ],
      },
    ],
    related: ["extraktion", "bruehverhaeltnis"],
  },
  {
    slug: "methoden",
    topic: "zubereitung",
    title: "Brühmethoden",
    lead: "Filter, Immersion oder Druck: Jede Methode betont etwas anderes.",
    sections: [
      {
        h: "Handfilter",
        body: [
          {
            list: [
              ["V60", "Konisch mit großem Loch. Schnell, klar, verzeiht wenig."],
              ["Flachboden", "Kalita, Orea, April. Gleichmäßiger Durchlauf, sehr konstant."],
              ["Chemex", "Dicker Papierfilter, sehr sauber und leicht."],
            ],
          },
        ],
      },
      {
        h: "Immersion und Druck",
        body: [
          {
            list: [
              ["French Press", "Metallsieb lässt Öle durch, voller Körper, etwas Trübstoff."],
              ["AeroPress", "Ziehen plus leichter Druck, sehr vielseitig und robust."],
              ["Espresso", "Etwa 9 bar Druck, 25–30 s, konzentriert mit Crema."],
              ["Mokkakanne", "Dampfdruck auf dem Herd, kräftig, eher dunkle Röstung."],
              ["Cold Brew", "12–24 h kalt ziehen, mild, wenig Säure."],
            ],
          },
        ],
      },
    ],
    related: ["bruehverhaeltnis", "filter-espresso"],
  },

  // ---------- Verkostung ----------
  {
    slug: "cupping",
    topic: "verkostung",
    title: "Cupping",
    lead: "Das Standardverfahren, um Kaffees vergleichbar zu verkosten: ohne Filter, ohne Technik, nur Kaffee und Wasser.",
    facts: [
      ["Verhältnis", "8,25 g auf 150 ml Wasser"],
      ["Wasser", "Etwa 93 °C"],
      ["Mahlgrad", "Mittel bis grob"],
      ["Tassen", "Fünf je Kaffee"],
    ],
    sections: [
      {
        h: "Ablauf",
        body: [
          {
            list: [
              ["Riechen", "Trockenes Mahlgut riechen (Duft)."],
              ["Aufgießen", "Vier Minuten ziehen lassen, dabei bildet sich eine Kruste."],
              ["Kruste brechen", "Mit dem Löffel durchstoßen und das nasse Aroma einatmen, Schaum abnehmen."],
              ["Schlürfen", "Ab etwa 70 °C kräftig vom Löffel schlürfen, damit sich der Kaffee im Mund verteilt."],
              ["Bewerten", "Beim Abkühlen mehrmals probieren. Säure und Süße zeigen sich lauwarm am besten."],
            ],
          },
        ],
      },
    ],
    related: ["sca-bogen", "aromarad", "specialty"],
  },
  {
    slug: "sca-bogen",
    topic: "verkostung",
    title: "Der SCA-Bogen",
    lead: "So bewertest du in dieser Bibliothek: zehn Attribute, Abzüge für Defekte, am Ende eine Zahl bis 100.",
    facts: [
      ["Qualität", "7 Attribute, je 6–10 in 0,25er-Schritten"],
      ["Tasse", "Gleichmäßigkeit, Sauberkeit, Süße je 0–10"],
      ["Abzüge", "Defekte 0–40"],
    ],
    sections: [
      {
        h: "Die Qualitätsattribute",
        body: [{ list: QUALITY_KEYS.map((k) => [SCORE_LABELS[k], SCORE_HINTS[k]] as [string, string]) }],
      },
      {
        h: "Tasse und Defekte",
        body: [
          { list: CUP_KEYS.map((k) => [SCORE_LABELS[k], SCORE_HINTS[k]] as [string, string]) },
          "Defekte sind Fehlnoten wie muffig, faulig oder Kartoffel. Sie werden von der Summe abgezogen.",
          { tip: "Dein Score und der Cup Score des Rösters messen dasselbe Prinzip, aber deiner gilt für deine Zubereitung am jeweiligen Tag." },
        ],
      },
    ],
    related: ["specialty", "cupping", "saeure-koerper"],
  },
  {
    slug: "aromarad",
    topic: "verkostung",
    title: "Das Aromarad",
    lead: "Vom Groben ins Feine: Erst die Kategorie finden, dann die genaue Note.",
    facts: [
      ["Vorlage", "SCA/WCR Coffee Taster's Flavor Wheel, 2016"],
      ["Kategorien", `${FLAVOR_WHEEL.length} Hauptgruppen`],
    ],
    sections: [
      {
        h: "So benutzt du es",
        body: [
          "Innen stehen die großen Kategorien, außen die konkreten Noten. Schmeckst du „irgendwie fruchtig“, geh nach außen: Beere oder Zitrus? Bei Beere: eher Blaubeere oder Johannisbeere?",
          { list: FLAVOR_WHEEL.map((c) => [c.label, c.groups.map((g) => g.label).join(", ")] as [string, string]) },
        ],
      },
      {
        h: "In der Bibliothek",
        body: ["Geschmacksnoten vom Röster und aus deinen Bezügen werden diesen Kategorien zugeordnet. Daraus entstehen die farbigen Punkte und die Filter in der Seitenleiste."],
      },
    ],
    related: ["saeure-koerper", "cupping"],
  },
  {
    slug: "saeure-koerper",
    topic: "verkostung",
    title: "Säure, Süße, Körper",
    lead: "Die drei Grundpfeiler einer Tasse. Säure ist dabei kein Fehler, sondern Lebendigkeit.",
    sections: [
      {
        h: "Säure",
        body: [
          {
            list: [
              ["Zitronensäure", "Zitrus, frisch, typisch für hoch gewachsene Kaffees."],
              ["Apfelsäure", "Grüner Apfel, Steinobst."],
              ["Phosphorsäure", "Spritzig, prickelnd, bekannt aus Kenia."],
              ["Essigsäure", "In Maßen weinig, zu viel wirkt vergoren."],
              ["Milchsäure", "Weich und cremig, oft nach anaerober Fermentation."],
            ],
          },
        ],
      },
      {
        h: "Süße",
        body: ["Kommt aus reifen Kirschen und karamellisiertem Zucker. Sie rundet Säure ab und macht einen Kaffee angenehm, auch ohne Zucker."],
      },
      {
        h: "Körper",
        body: ["Das Mundgefühl: leicht wie Tee, cremig wie Milch, schwer wie Sirup. Öle und Schwebstoffe machen es voller, Papierfilter halten beides zurück."],
      },
    ],
    related: ["sca-bogen", "aromarad", "extraktion"],
  },
];

export const ARTICLE_BY_SLUG = new Map(WIKI_ARTICLES.map((a) => [a.slug, a]));
export const TOPIC_BY_ID = new Map(WIKI_TOPICS.map((t) => [t.id, t]));

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Passt ein Feldwert (z. B. Aufbereitung „Natural“, Varietät „Red Bourbon“) zu einem Artikel? */
export function articleMatches(a: WikiArticle, field: WikiField, value: string): boolean {
  if (a.match?.field !== field || !value.trim()) return false;
  const v = norm(value);
  return a.match.values.some((m) => norm(m) === v || (field === "varieties" && v.includes(norm(m))));
}

export function articleFor(field: WikiField, value: string | null | undefined): WikiArticle | null {
  if (!value) return null;
  return WIKI_ARTICLES.find((a) => articleMatches(a, field, value)) ?? null;
}

function blockText(b: WikiBlock): string {
  return typeof b === "string" ? b : "list" in b ? b.list.flat().join(" ") : b.tip;
}

export function searchArticles(q: string): WikiArticle[] {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return WIKI_ARTICLES.map((a) => {
    const title = norm(a.title);
    const lead = norm(a.lead);
    const hay = norm(
      [a.title, a.lead, ...(a.facts ?? []).flat(), ...a.sections.flatMap((s) => [s.h, ...s.body.map(blockText)])].join(" "),
    );
    const hit = terms.every((t) => hay.includes(t));
    return { a, score: hit ? terms.filter((t) => title.includes(t)).length * 10 + terms.filter((t) => lead.includes(t)).length * 3 + 1 : 0 };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
