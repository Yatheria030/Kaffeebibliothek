import { Maximize, Minus, Plus, Wand2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { loadImage } from "../lib/image.ts";
import { analyze, cutoutBackground, type Analysis, type Box } from "../lib/packshot.ts";
import { tileStyle } from "./Artwork.tsx";
import { Button, cx, Switch } from "./controls.tsx";
import { Sheet, toast } from "./overlay.tsx";

/**
 * Packungsbild auf ein Quadrat ausrichten, damit alle Kaffees im Regal gleich groß wirken.
 * Koordinaten in Bühnen-Einheiten: Kantenlänge der Bühne = 1. s = Bühnen-Einheiten je Bildpixel,
 * (cx, cy) = Bildmitte auf der Bühne.
 */

const OUT = 1000; // Kantenlänge der Ausgabe in px
const MARGIN = 0.02; // Rand des Packungsrahmens je Seite
const Z_MIN = -2; // log2 des Zooms relativ zu „ganzes Bild“
const Z_MAX = 2.6;

type T = { s: number; cx: number; cy: number };
/** Packung erkennen und wie „Automatisch“ in den Rahmen legen; liefert das fertige Quadrat als Data-URL */
export async function autoAlign(src: string): Promise<string> {
  const img = await loadImage(src);
  const a = analyze(img);
  return exportImage(img, autoT(a.box, img.naturalWidth, img.naturalHeight), a.bg, a.box);
}

const fitT = (w: number, h: number): T => ({ s: 1 / Math.max(w, h), cx: 0.5, cy: 0.5 });

function autoT(box: Box, w: number, h: number): T {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const s = (1 - 2 * MARGIN) / Math.max(bw, bh);
  return { s, cx: 0.5 - ((box.x0 + box.x1) / 2 - w / 2) * s, cy: 0.5 - ((box.y0 + box.y1) / 2 - h / 2) * s };
}

function exportImage(img: HTMLImageElement, t: T, bg: string | null, box?: Box): string {
  const canvas = document.createElement("canvas");
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, OUT, OUT);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const w = img.naturalWidth * t.s;
  const h = img.naturalHeight * t.s;
  const left = (t.cx - w / 2) * OUT;
  const top = (t.cy - h / 2) * OUT;
  ctx.drawImage(img, left, top, w * OUT, h * OUT);
  // Hintergrund freistellen, damit die Kachel ohne multiply auskommt und die Packung ungetönt bleibt
  const k = t.s * OUT;
  const cut = !!bg && !!box && cutoutBackground(ctx, OUT, OUT, bg, { x0: left + box.x0 * k, y0: top + box.y0 * k, x1: left + box.x1 * k, y1: top + box.y1 * k });
  const webp = canvas.toDataURL("image/webp", 0.9);
  if (webp.startsWith("data:image/webp")) return webp;
  return bg && !cut ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
}

/** Bild in Bühnen-Einheiten positioniert, skaliert mit jeder Containergröße */
function Placed({ img, t, className }: { img: HTMLImageElement; t: T; className?: string }) {
  const w = img.naturalWidth * t.s;
  const h = img.naturalHeight * t.s;
  return (
    <img
      src={img.src}
      alt=""
      draggable={false}
      className={cx("pointer-events-none absolute max-w-none select-none", className)}
      style={{ width: `${w * 100}%`, height: `${h * 100}%`, left: `${(t.cx - w / 2) * 100}%`, top: `${(t.cy - h / 2) * 100}%` }}
    />
  );
}

function Guides({ grid }: { grid: boolean }) {
  const m = MARGIN * 100;
  const line = (x1: number, y1: number, x2: number, y2: number, dash?: boolean) => (
    <g key={`${x1}-${y1}-${x2}-${y2}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeOpacity="0.7" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#17181b"
        strokeOpacity="0.45"
        strokeWidth="1"
        strokeDasharray={dash ? "4 4" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
      {/* Rand außerhalb des Rahmens abdunkeln */}
      <path
        d={`M0 0H100V100H0Z M${m} ${m}V${100 - m}H${100 - m}V${m}Z`}
        fillRule="evenodd"
        fill="#17181b"
        fillOpacity="0.12"
      />
      {grid && (
        <>
          {[100 / 3, 200 / 3].map((p) => line(p, 0, p, 100))}
          {[100 / 3, 200 / 3].map((p) => line(0, p, 100, p))}
          {line(50, 0, 50, 100, true)}
          {line(0, 50, 100, 50, true)}
        </>
      )}
      <rect
        x={m}
        y={m}
        width={100 - 2 * m}
        height={100 - 2 * m}
        fill="none"
        stroke="var(--c-accent)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ImageEditor({
  src,
  color,
  onClose,
  onApply,
}: {
  src: string;
  color: string;
  onClose: () => void;
  onApply: (dataUrl: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [info, setInfo] = useState<Analysis | null>(null);
  const [t, setT] = useState<T>({ s: 0, cx: 0.5, cy: 0.5 });
  const [grid, setGrid] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const size = useRef(1);
  const pts = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    let live = true;
    loadImage(src)
      .then((im) => {
        if (!live) return;
        const a = analyze(im);
        setImg(im);
        setInfo(a);
        setT(autoT(a.box, im.naturalWidth, im.naturalHeight));
      })
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : "Bild nicht ladbar"));
    return () => {
      live = false;
    };
  }, [src]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => (size.current = e.contentRect.width || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  const sFit = img ? 1 / Math.max(img.naturalWidth, img.naturalHeight) : 1;
  const zoom = t.s / sFit;

  /** Zoomen um einen Punkt der Bühne, der dabei unter dem Finger bleibt */
  const zoomAt = useCallback(
    (px: number, py: number, factor: number) =>
      setT((o) => {
        const s = Math.min(sFit * 2 ** Z_MAX, Math.max(sFit * 2 ** Z_MIN, o.s * factor));
        const k = s / o.s;
        return { s, cx: px + (o.cx - px) * k, cy: py + (o.cy - py) * k };
      }),
    [sFit],
  );

  // Mausrad braucht passive: false, sonst scrollt das Sheet mit
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, Math.exp(-e.deltaY * 0.0018));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, img]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, local(e));
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = pts.current.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (pts.current.size === 1) {
      pts.current.set(e.pointerId, cur);
      setT((o) => ({ ...o, cx: o.cx + cur.x - prev.x, cy: o.cy + cur.y - prev.y }));
      return;
    }
    // Zwei Finger: Abstand zoomt, Mittelpunkt verschiebt
    const other = [...pts.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
    pts.current.set(e.pointerId, cur);
    if (!other) return;
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
    const d1 = Math.hypot(cur.x - other.x, cur.y - other.y) || 1;
    const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
    const m1 = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
    setT((o) => ({ ...o, cx: o.cx + m1.x - m0.x, cy: o.cy + m1.y - m0.y }));
    zoomAt(m1.x, m1.y, d1 / d0);
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 10 : 2) / (size.current || 400);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setT((o) => ({ ...o, cx: o.cx + dx, cy: o.cy + dy }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAt(0.5, 0.5, 1.06);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomAt(0.5, 0.5, 1 / 1.06);
    }
  };

  const apply = () => {
    if (!img) return;
    try {
      onApply(exportImage(img, t, info?.bg ?? null, info?.box));
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Bild konnte nicht erzeugt werden", "error");
    }
  };

  const stageBg = info?.bg ?? undefined;

  return (
    <Sheet open onClose={onClose} title="Bild ausrichten" onSave={apply} saveLabel="Übernehmen" canSave={!!img} width={1000}>
      <div className="@container">
        <div className="grid items-start gap-5 @2xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="mx-auto w-full max-w-[620px]">
            <div
              ref={stage}
              role="application"
              aria-label="Bild verschieben mit Ziehen oder Pfeiltasten, zoomen mit Mausrad, zwei Fingern oder Plus und Minus"
              tabIndex={0}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={onKey}
              className={cx(
                "relative aspect-square w-full cursor-grab touch-none overflow-hidden rounded-[16px] shadow-card outline-none select-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent",
                !stageBg && "bg-[repeating-conic-gradient(var(--c-fill)_0_25%,var(--c-card)_0_50%)] bg-[length:24px_24px]",
              )}
              style={stageBg ? { background: stageBg } : undefined}
            >
              {img ? (
                <>
                  <Placed img={img} t={t} />
                  <Guides grid={grid} />
                </>
              ) : (
                <div className="flex size-full items-center justify-center text-[14px] text-ink2">
                  {failed ?? <span className="skeleton size-full" />}
                </div>
              )}
            </div>
            <p className="m-0 mt-2.5 px-1 text-[12px] leading-snug text-ink2">
              Packung mit der längeren Seite an den grünen Rahmen legen. Dann wirken alle Kaffees im Regal gleich groß.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-3 rounded-[16px] bg-card p-4 shadow-card">
              <div className="flex items-baseline justify-between">
                <label htmlFor="ie-zoom" className="text-[15px] font-bold">
                  Größe
                </label>
                <span className="tnum text-[14px] font-extrabold">{img ? `${Math.round(zoom * 100)} %` : "–"}</span>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                <button
                  type="button"
                  aria-label="Verkleinern"
                  disabled={!img}
                  onClick={() => zoomAt(0.5, 0.5, 1 / 1.1)}
                  className="flex size-8 items-center justify-center rounded-full bg-fill text-ink2 hover:bg-fill2 hover:text-ink disabled:opacity-35"
                >
                  <Minus size={14} strokeWidth={2.6} />
                </button>
                <input
                  id="ie-zoom"
                  type="range"
                  min={Z_MIN}
                  max={Z_MAX}
                  step={0.01}
                  disabled={!img}
                  value={img ? Math.log2(zoom) : 0}
                  onChange={(e) => zoomAt(0.5, 0.5, (sFit * 2 ** Number(e.target.value)) / t.s)}
                  aria-valuetext={`${Math.round(zoom * 100)} Prozent`}
                  className="range"
                  style={{ ["--p" as string]: `${((Math.log2(zoom || 1) - Z_MIN) / (Z_MAX - Z_MIN)) * 100}%` }}
                />
                <button
                  type="button"
                  aria-label="Vergrößern"
                  disabled={!img}
                  onClick={() => zoomAt(0.5, 0.5, 1.1)}
                  className="flex size-8 items-center justify-center rounded-full bg-fill text-ink2 hover:bg-fill2 hover:text-ink disabled:opacity-35"
                >
                  <Plus size={14} strokeWidth={2.6} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={Wand2}
                  disabled={!img || !info}
                  onClick={() => img && info && setT(autoT(info.box, img.naturalWidth, img.naturalHeight))}
                >
                  Automatisch
                </Button>
                <Button size="sm" icon={Maximize} disabled={!img} onClick={() => img && setT(fitT(img.naturalWidth, img.naturalHeight))}>
                  Ganzes Bild
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-sep pt-3">
                <span className="text-[14px] font-semibold">Hilfsraster</span>
                <Switch checked={grid} onChange={setGrid} label="Hilfsraster" />
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="m-0 px-1 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">So im Regal</h3>
              <div className="relative aspect-[6/5] w-full overflow-hidden rounded-[18px] shadow-card" style={tileStyle(color)}>
                {img && (
                  // Wie Artwork „md“ (p-[5%] der Breite, object-contain); ohne transform, sonst greift mix-blend nicht
                  <div className="absolute top-[6%] left-[13.3333%] aspect-square w-[73.3333%] overflow-hidden">
                    {stageBg && <div className="art-img absolute inset-0" style={{ background: stageBg }} />}
                    <Placed img={img} t={t} className="art-img" />
                  </div>
                )}
              </div>
              <p className="m-0 px-1 text-[12px] leading-snug text-ink2">
                Verschieben mit Ziehen oder Pfeiltasten, zoomen mit Mausrad, zwei Fingern oder dem Regler.
              </p>
            </section>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
