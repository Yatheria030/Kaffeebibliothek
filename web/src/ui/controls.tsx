import { Check, CloudOff, LoaderCircle, Minus, Plus, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// ---------- Segmented Control ----------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  full = false,
  wrap = false,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode; title?: string }[];
  label: string;
  size?: "sm" | "md";
  full?: boolean;
  /** Schmal (unter 640 px) als 2×2-Raster, z. B. für vier lange Beschriftungen */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "flex max-w-full rounded-[11px] bg-fill p-[3px]",
        full ? "w-full" : "w-fit",
        wrap && "max-sm:grid max-sm:grid-cols-2 max-sm:gap-[3px]",
        size === "sm" && "rounded-[10px]",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={cx(
              "flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-ink transition-[background,box-shadow] duration-150",
              full && "flex-1",
              size === "sm" ? "h-[26px] rounded-[7px] text-[12px]" : "h-[30px] rounded-[8px] text-[13px]",
              on ? "bg-[var(--c-seg-active)] font-bold shadow-seg" : "font-semibold text-ink2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Buttons ----------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "plain" | "danger" | "dark";
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon: Icon, loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[11px] font-bold whitespace-nowrap transition-[background,opacity,transform] duration-150 active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100",
        size === "sm" && "h-[32px] rounded-[10px] px-3.5 text-[13px]",
        size === "md" && "h-9 px-4 text-[14px]",
        size === "lg" && "h-12 rounded-[12px] px-5 text-[15px]",
        variant === "primary" && "bg-accent font-extrabold text-on-accent hover:bg-accent-hover",
        variant === "secondary" && "bg-card text-ink shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2",
        variant === "plain" && "px-2 text-accent hover:bg-accent-soft",
        variant === "danger" && "bg-bad-soft text-bad hover:brightness-95",
        variant === "dark" && "bg-ink text-bg hover:opacity-90",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={size === "lg" ? 17 : 15} className="animate-spin" />
      ) : Icon ? (
        <Icon size={size === "lg" ? 17 : 15} strokeWidth={2.4} />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className,
  active,
  size = 32,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; active?: boolean; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-[10px] transition-colors duration-150",
        active ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--c-accent)]" : "bg-card text-ink shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-card2",
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.1} />
    </button>
  );
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cx("animate-spin text-ink3", className)} aria-label="Lädt" />;
}

// ---------- Switch & Stepper ----------

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-60",
        checked ? "bg-accent" : "bg-fill2",
      )}
    >
      <span
        className={cx(
          "absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format = (v) => String(v),
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="tnum min-w-[2.5rem] text-right text-[15px] font-semibold" aria-live="polite">
        {format(value)}
      </span>
      <div className="flex h-8 overflow-hidden rounded-[8px] bg-fill">
        <button
          type="button"
          aria-label={`${label} verringern`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          className="flex w-11 items-center justify-center hover:bg-hover disabled:opacity-35"
        >
          <Minus size={15} strokeWidth={2.4} />
        </button>
        <span className="my-1.5 w-px bg-sep" />
        <button
          type="button"
          aria-label={`${label} erhöhen`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          className="flex w-11 items-center justify-center hover:bg-hover disabled:opacity-35"
        >
          <Plus size={15} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

// ---------- Popover-Menü ----------

export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      icon?: LucideIcon;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
    }
  | "sep";

export function Menu({
  items,
  align = "end",
  trigger,
  label,
}: {
  items: MenuItem[];
  align?: "start" | "end";
  label: string;
  trigger: (p: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; "aria-controls": string }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const h = menuRef.current.offsetHeight;
    setUp(r.bottom + h + 12 > window.innerHeight && r.top > h + 12);
    menuRef.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu", "aria-controls": id })}
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const btns = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
            const i = btns.indexOf(document.activeElement as HTMLButtonElement);
            btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
          }}
          className={cx(
            "anim-fade frost absolute z-50 min-w-[220px] rounded-[12px] bg-[color-mix(in_srgb,var(--c-card)_88%,transparent)] p-[5px] shadow-pop",
            align === "end" ? "right-0" : "left-0",
            up ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="mx-2.5 my-[5px] h-px bg-sep" />
            ) : (
              <button
                key={i}
                type="button"
                role={it.checked !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={it.checked}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cx(
                  "flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] outline-none hover:bg-accent-soft hover:text-accent focus-visible:bg-accent-soft focus-visible:text-accent disabled:opacity-40 disabled:hover:bg-transparent",
                  it.danger ? "text-bad" : "text-ink",
                )}
              >
                <span className="flex w-4 justify-center">
                  {it.checked ? <Check size={14} strokeWidth={2.6} /> : it.icon ? <it.icon size={15} strokeWidth={2} /> : null}
                </span>
                <span className="flex-1">{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Layout-Bausteine ----------

export function SectionTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="m-0 text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{children}</h2>
        {sub && <p className="m-0 text-[13px] text-ink2">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cx("rounded-[22px] bg-card shadow-card", padded && "p-5 sm:p-6", className)}>{children}</section>;
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="mb-1 flex size-14 items-center justify-center rounded-[16px] bg-fill text-ink3">
        <Icon size={26} strokeWidth={1.8} />
      </span>
      <p className="m-0 text-[17px] font-semibold">{title}</p>
      {text && <p className="m-0 max-w-[400px] text-[14px] text-ink2">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Banner({
  tone = "info",
  icon: Icon,
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "success";
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-start gap-3 rounded-[14px] px-4 py-3 text-[14px]",
        tone === "info" && "bg-accent-soft",
        tone === "warn" && "bg-[color-mix(in_srgb,var(--c-star)_14%,transparent)]",
        tone === "error" && "bg-bad-soft",
        tone === "success" && "bg-good-soft",
      )}
    >
      <Icon
        size={18}
        strokeWidth={2.1}
        className={cx(
          "mt-[1px] shrink-0",
          tone === "info" && "text-accent",
          tone === "warn" && "text-[var(--c-orange)]",
          tone === "error" && "text-bad",
          tone === "success" && "text-good",
        )}
      />
      <div className="min-w-0 flex-[1_1_240px] leading-snug">{children}</div>
      {action}
    </div>
  );
}

/** Ladefehler einer Seite: was fehlt, warum, und ein Knopf zum erneuten Laden */
export function LoadError({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  return (
    <Banner
      tone="error"
      icon={CloudOff}
      action={
        <Button size="sm" onClick={retry}>
          Erneut laden
        </Button>
      }
    >
      {what} nicht geladen: {error instanceof Error ? error.message : "unbekannter Fehler"}
    </Banner>
  );
}
