import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type AnchorHTMLAttributes, type PointerEvent } from "react";
import { api } from "../api.ts";
import { href } from "../lib/router.ts";

/**
 * Link auf einen Kaffee. Lädt das Detail schon, wenn die Maus kurz darauf ruht, beim Antippen oder beim Fokus,
 * damit die Seite ohne Ladezustand aufgeht.
 */
export function CoffeeLink({
  id,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "id" | "href"> & { id: number }) {
  const qc = useQueryClient();
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const load = () => void qc.prefetchQuery({ queryKey: ["coffee", id], queryFn: () => api.coffee(id) });
  return (
    <a
      {...rest}
      href={href(`/kaffee/${id}`)}
      onPointerEnter={(e: PointerEvent<HTMLAnchorElement>) => {
        // Kurz warten: wer nur über das Regal fährt, soll nicht jede Karte laden
        if (e.pointerType === "mouse") timer.current = window.setTimeout(load, 70);
        onPointerEnter?.(e);
      }}
      onPointerLeave={(e) => {
        clearTimeout(timer.current);
        onPointerLeave?.(e);
      }}
      onPointerDown={(e) => {
        load();
        onPointerDown?.(e);
      }}
      onFocus={(e) => {
        load();
        onFocus?.(e);
      }}
    />
  );
}
