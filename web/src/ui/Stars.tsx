import { Star } from "lucide-react";
import { RATING_LABELS, TASTE_TAGS, type TasteTag } from "../../../shared/types.ts";
import { cx } from "./controls.tsx";

export const fmtStars = (v: number | null | undefined) => (v == null ? "–" : Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","));

/** Sterne als Anzeige, z. B. in Listen: ★ 4 oder ★ 4,2 */
export function StarsValue({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cx("tnum inline-flex items-center gap-1", className)} aria-label={value == null ? "ohne Sterne" : `${fmtStars(value)} von 5 Sternen`}>
      <Star size={13} strokeWidth={0} className="shrink-0 fill-[var(--c-star)]" aria-hidden="true" />
      {fmtStars(value)}
    </span>
  );
}

/** 1–5 Sterne wählen; nochmals auf denselben Stern tippen nimmt die Sterne wieder weg (sie sind freiwillig) */
export function StarInput({ value, onChange, size = 34 }: { value: number | null; onChange: (v: number | null) => void; size?: number }) {
  return (
    <div role="radiogroup" aria-label="Sterne" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} ${n === 1 ? "Stern" : "Sterne"}: ${RATING_LABELS[n]}`}
            onClick={() => onChange(n === value ? null : n)}
            className="flex items-center justify-center rounded-[10px] p-1 hover:bg-hover"
          >
            <Star
              size={size}
              strokeWidth={on ? 0 : 1.6}
              className={cx("transition-colors", on ? "fill-[var(--c-star)]" : "text-ink4")}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

/** Kurzurteil: „Ausgewogen“ schließt die „zu …“-Urteile aus */
export function TastePicker({ value, onChange }: { value: TasteTag[]; onChange: (v: TasteTag[]) => void }) {
  const toggle = (t: TasteTag) => {
    if (value.includes(t)) return onChange(value.filter((x) => x !== t));
    if (t === "ausgewogen") return onChange(["ausgewogen"]);
    // Gegensätze schließen sich aus
    const opposite: Partial<Record<TasteTag, TasteTag>> = { sauer: "bitter", bitter: "sauer", duenn: "kraeftig", kraeftig: "duenn" };
    const keepBoth = t === "sauer" || t === "bitter"; // sauer und bitter zugleich gibt es (Channeling)
    onChange([...value.filter((x) => x !== "ausgewogen" && (keepBoth || x !== opposite[t])), t]);
  };
  return (
    <div role="group" aria-label="Kurzurteil" className="flex flex-wrap gap-1.5">
      {TASTE_TAGS.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t.id)}
            className={cx(
              "h-[32px] rounded-full px-3.5 text-[13px] transition-colors",
              on
                ? t.id === "ausgewogen"
                  ? "bg-good-soft font-bold text-good shadow-[inset_0_0_0_1.5px_var(--c-green)]"
                  : "bg-accent-soft font-bold text-ink shadow-[inset_0_0_0_1.5px_var(--c-accent)]"
                : "bg-card text-ink shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
