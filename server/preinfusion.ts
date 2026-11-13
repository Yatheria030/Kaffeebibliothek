// Preinfusion eines Decent-Shots aus Schrittwechseln und Profil; ohne Datenbank, damit auch die Migration sie nutzen kann

const PI_STEP = /pre.?inf|soak|fill|bloom|wet/i;

/**
 * Preinfusion in Sekunden: Zeit bis zum ersten Schritt nach der Preinfusion. Die de1app nennt diesen Schritt im Profil
 * (`target_volume_count_start`, ab dort zählt sie auch das Volumen), sonst der erste Schritt, der nicht nach Preinfusion heißt.
 * `state_change` springt bei jedem Schrittwechsel, der erste Sprung ist der Start von Schritt 0. Endet der Shot vorher: null.
 */
export function preinfusionOf(t: number[], stateChange: number[], profile: Record<string, unknown>): number | null {
  const steps = Array.isArray(profile.steps) ? (profile.steps as { name?: unknown }[]).map((x) => String(x?.name ?? "")) : [];
  const raw = profile.target_volume_count_start;
  let k = raw === "" || raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  if (k == null && steps.length) {
    const i = steps.findIndex((n) => !PI_STEP.test(n));
    k = i < 0 ? null : i;
  }
  if (k == null || k < 0) return null;
  if (k === 0) return 0;
  const starts: number[] = [];
  for (let i = 1; i < stateChange.length && i < t.length; i++) if (stateChange[i] !== stateChange[i - 1]) starts.push(t[i]);
  return k < starts.length ? Math.round(starts[k] * 10) / 10 : null;
}
