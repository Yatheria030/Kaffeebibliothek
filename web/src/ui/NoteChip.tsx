import { CATEGORY_BY_ID, categoriesForNotes } from "../../../shared/flavors.ts";
import { cx } from "./controls.tsx";

/** Röster-Note mit Farbpunkt ihrer Aromarad-Kategorie */
export function NoteChip({ note, className }: { note: string; className?: string }) {
  const cat = CATEGORY_BY_ID.get(categoriesForNotes([note])[0] ?? "");
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[13px] text-ink", className)}
      style={{ background: cat ? `color-mix(in srgb, ${cat.color} 13%, transparent)` : "var(--c-fill)" }}
    >
      {cat && <span className="size-2 rounded-full" style={{ background: `light-dark(${cat.color}, ${cat.colorDark})` }} />}
      {note}
    </span>
  );
}
