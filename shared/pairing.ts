// Mahlvorgang ↔ Shot über die Zeit paaren: Der Mahlvorgang liegt vor dem Start des Shots (Mühle füllt den Siebträger, dann Bezug).
// Durchlauf in Zeitfolge: Jeder Shot nimmt den jüngsten noch offenen Mahlvorgang aus den Minuten davor. So bleiben zwei Bezüge kurz
// hintereinander getrennt (Mahlen, Shot, Mahlen, Shot), ein verworfener Siebträger (zweimal gemahlen, ein Shot) gibt dem Shot den
// neueren, und zwei vorbereitete Siebträger gehen nacheinander weg. Nur Zeitstempel, keine Dosis: die steht in der de1app oft veraltet.

/** so lange vor dem Shot darf gemahlen worden sein */
export const PAIR_BEFORE_MS = 15 * 60_000;
/** Uhren von Mühle und Tablet gehen nicht gleich: so viel darf der Mahlvorgang scheinbar nach dem Start liegen (nur ohne früheren) */
export const PAIR_SKEW_MS = 30_000;

type Grind = { id: number; ground_at: string };
type Shot = { id: number; shot_at: string };

export type Pairs = { grindOfShot: Map<number, number>; shotOfGrind: Map<number, number> };

export function pairGrinds(grinds: Grind[], shots: Shot[]): Pairs {
  const grindOfShot = new Map<number, number>();
  const shotOfGrind = new Map<number, number>();
  const gs = grinds.map((g) => ({ id: g.id, t: Date.parse(g.ground_at) })).filter((g) => Number.isFinite(g.t)).sort((a, b) => a.t - b.t);
  const ss = shots.map((s) => ({ id: s.id, t: Date.parse(s.shot_at) })).filter((s) => Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
  const open: { id: number; t: number }[] = [];
  let i = 0;
  for (const s of ss) {
    while (i < gs.length && gs[i].t <= s.t) open.push(gs[i++]);
    // Wartende, die zu alt sind, gehören zu keinem Shot mehr
    while (open.length && open[0].t < s.t - PAIR_BEFORE_MS) open.shift();
    // erst vor dem Start gemahlen; nur wenn da nichts ist, ein Mahlvorgang knapp danach (Uhren)
    const g = open.pop() ?? (i < gs.length && gs[i].t <= s.t + PAIR_SKEW_MS ? gs[i++] : undefined);
    if (!g) continue;
    grindOfShot.set(s.id, g.id);
    shotOfGrind.set(g.id, s.id);
  }
  return { grindOfShot, shotOfGrind };
}
