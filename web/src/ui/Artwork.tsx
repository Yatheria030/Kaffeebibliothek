import { Star } from "lucide-react";
import { useState, type CSSProperties, type ImgHTMLAttributes, type ReactNode } from "react";
import { formatScore } from "../../../shared/sca.ts";
import { ROAST_LEVELS, type RoastLevel } from "../../../shared/types.ts";
import { imageUrl } from "../api.ts";
import { luminance } from "../lib/image.ts";
import { cx } from "./controls.tsx";
import { fmtStars } from "./Stars.tsx";

export function roastColor(level: RoastLevel | null): string {
  return ROAST_LEVELS.find((r) => r.id === level)?.color ?? "#8E8E93";
}

export function bagColors(color: string | null, roast: RoastLevel | null) {
  const bag = color ?? roastColor(roast) ?? "#8A5A3B";
  const label = luminance(bag) > 0.45 ? "#2C2A27" : "#F4E9D8";
  return { bag, label };
}

/** Schein hinter der Packung: mittig am kräftigsten, nach außen läuft er in die Kartenfarbe aus (keine Kante zum Textteil) */
function glowStyle(c: string): string {
  return `radial-gradient(ellipse at 50% 46%, color-mix(in srgb, ${c} 20%, var(--c-tile-b)) 0%, color-mix(in srgb, ${c} 10%, var(--c-tile-a)) 38%, var(--c-card) 76%)`;
}

/** Getönte Kachel hinter dem Cover, hell wie dunkel */
export function tileStyle(color: string | null): CSSProperties {
  const c = color ?? "#8E8E93";
  return {
    background: `linear-gradient(160deg, color-mix(in srgb, ${c} 9%, var(--c-tile-a)), color-mix(in srgb, ${c} 20%, var(--c-tile-b)))`,
  };
}

export function BagSvg({ bag, label, detailed = true, className }: { bag: string; label: string; detailed?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" className={className}>
      <rect x="20" y="6" width="80" height="12" rx="3" fill={bag} />
      <path d="M16 18 H104 L110 148 Q110 156 102 156 H18 Q10 156 10 148 Z" fill={bag} />
      <path d="M16 18 H104" stroke="#000" strokeOpacity="0.18" strokeWidth="2" />
      {detailed && <circle cx="60" cy="38" r="6" fill="none" stroke={label} strokeWidth="2" />}
      <rect x="28" y="58" width="64" height="70" rx="5" fill={label} />
      {detailed && (
        <>
          <rect x="36" y="70" width="48" height="6" rx="3" fill={bag} />
          <rect x="36" y="84" width="34" height="4" rx="2" fill={bag} fillOpacity="0.6" />
          <rect x="36" y="94" width="40" height="4" rx="2" fill={bag} fillOpacity="0.6" />
        </>
      )}
    </svg>
  );
}

const cutCache = new Map<string, boolean>();
/** Schon einmal geladene Bilder: die erscheinen sofort, nur neue blenden ein */
const seen = new Set<string>();

/** Transparente Ecken = freigestellt. Fremde Bilder ohne CORS lassen sich nicht lesen und gelten als nicht freigestellt. */
function isCutout(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return false;
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    return [0, 7, 56, 63].some((p) => d[p * 4 + 3] < 250);
  } catch {
    return false;
  }
}

/**
 * Packungsbild auf der Kachel. Im hellen Modus blendet multiply weiße Shop-Hintergründe aus, tönt aber auch die
 * Packung mit der Kachelfarbe. Freigestellte Bilder brauchen das nicht und bleiben deshalb ungetönt.
 */
export function ArtImg({ src, className, onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [, rerender] = useState(0);
  const [shown, setShown] = useState(() => seen.has(src));
  const cut = cutCache.get(src) === true;
  return (
    <img
      src={src}
      {...rest}
      // Falls das Bild schon fertig ist, bevor ein load-Ereignis ankommt: nie unsichtbar hängen bleiben
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0 && !shown) setShown(true);
      }}
      onLoad={(e) => {
        seen.add(src);
        setShown(true);
        if (!cutCache.has(src)) cutCache.set(src, isCutout(e.currentTarget));
        // auch weitere Kopien desselben Bilds neu zeichnen, die vor dem Eintrag gerendert wurden
        if (cutCache.get(src) !== cut) rerender((n) => n + 1);
        onLoad?.(e);
      }}
      className={cx("art-img transition-opacity duration-300", !shown && "opacity-0", cut && "art-cut", className)}
    />
  );
}

type ArtCoffee = { image: string | null; color: string | null; roast_level: RoastLevel | null; name: string };

/**
 * Cover eines Kaffees: Packungsfoto auf getönter Kachel, sonst gezeichnete Tüte.
 * Im hellen Modus wird ein nicht freigestelltes Foto per multiply eingeblendet, damit weiße Shop-Hintergründe verschwinden.
 */
export function Artwork({
  coffee,
  size,
  className,
  rounded = 14,
  fade = false,
  children,
}: {
  coffee: ArtCoffee;
  size: "xs" | "sm" | "md" | "lg";
  className?: string;
  rounded?: number;
  /** Statt Fläche ein Schein, der zu allen Rändern in die Karte ausläuft. Nur der Grund, die Packung davor bleibt unberührt */
  fade?: boolean;
  children?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const { bag, label } = bagColors(coffee.color, coffee.roast_level);
  const showImg = coffee.image && !broken;
  const background = fade ? glowStyle(coffee.color ?? bag) : tileStyle(coffee.color ?? bag).background;
  return (
    <div
      className={cx("relative flex shrink-0 items-center justify-center overflow-hidden", className)}
      style={{ background, borderRadius: rounded }}
    >
      {showImg ? (
        <ArtImg
          src={imageUrl(coffee.image!)}
          alt={`Packung ${coffee.name}`}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className={cx(
            "h-full w-full object-contain",
            size === "xs" ? "p-[4%]" : "p-[5%]",
          )}
        />
      ) : (
        <BagSvg bag={bag} label={label} detailed={size !== "xs"} className={size === "xs" ? "w-[52%]" : "w-[46%]"} />
      )}
      {children}
    </div>
  );
}

/** Bester SCA-Score; ohne SCA-Bogen der Schnitt der Schnellbewertungen als „4,2/5“ */
export function ScoreCapsule({ score, stars = null, className }: { score: number | null; stars?: number | null; className?: string }) {
  if (score == null && stars == null) return null;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[12px] font-extrabold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)] tnum",
        className,
      )}
    >
      <Star size={10} fill="var(--c-star)" stroke="none" aria-hidden="true" />
      {score != null ? (
        <>
          <span className="sr-only">Bester Score </span>
          {formatScore(score)}
        </>
      ) : (
        <>
          <span className="sr-only">Schnitt der Sterne </span>
          {fmtStars(stars)}
          <span className="font-semibold text-ink3">/5</span>
        </>
      )}
    </span>
  );
}

export function RoastDot({ level, size = 8 }: { level: RoastLevel | null; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.2)]"
      style={{ width: size, height: size, background: roastColor(level) }}
    />
  );
}
