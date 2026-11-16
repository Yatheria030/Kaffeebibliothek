import { X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { numInput, parseNum, parseSeconds, parseTime, secondsInput, timeInput } from "../lib/format.ts";
import { cx } from "./controls.tsx";

/** Gruppierte Liste wie in den iOS-/macOS-Einstellungen */
export function Group({ title, footer, children, className }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex flex-col gap-1.5", className)}>
      {title && <h3 className="m-0 px-1 pb-0.5 text-[12px] font-bold tracking-[0.06em] text-ink2 uppercase">{title}</h3>}
      <div className="overflow-hidden rounded-[16px] bg-card shadow-card [&>*+*]:border-t [&>*+*]:border-sep">{children}</div>
      {footer && <p className="m-0 px-1 text-[12px] leading-snug text-ink2">{footer}</p>}
    </section>
  );
}

export function Row({
  label,
  htmlFor,
  children,
  stacked,
  hint,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  stacked?: boolean;
  hint?: ReactNode;
}) {
  if (stacked)
    return (
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <label htmlFor={htmlFor} className="text-[13px] text-ink2">
          {label}
        </label>
        {children}
        {hint && <span className="text-[12px] text-ink3">{hint}</span>}
      </div>
    );
  return (
    <div className="grid min-h-[46px] grid-cols-[minmax(96px,34%)_minmax(0,1fr)] items-center gap-3 px-4 py-1.5 sm:grid-cols-[150px_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className="text-[15px] text-ink">
        {label}
      </label>
      <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
      {hint && <span className="col-span-2 -mt-1 pb-1 text-[12px] text-ink3">{hint}</span>}
    </div>
  );
}

const inputCls = "field h-9 text-[15px]";

export function TextField({
  value,
  onChange,
  className,
  align = "right",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
  align?: "left" | "right";
}) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(inputCls, align === "left" ? "text-left" : "text-right", className)}
    />
  );
}

/** Zahl mit deutschem Komma; Text bleibt beim Tippen erhalten */
export function NumField({
  value,
  onChange,
  suffix,
  id,
  placeholder,
  label,
  integer,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  integer?: boolean;
}) {
  const [text, setText] = useState(numInput(value));
  useEffect(() => {
    if (parseNum(text) !== value) setText(numInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="flex min-w-0 items-center justify-end gap-1">
      <input
        id={id}
        aria-label={label}
        inputMode={integer ? "numeric" : "decimal"}
        placeholder={placeholder ?? "–"}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,-]/g, "");
          setText(t);
          const n = parseNum(t);
          onChange(n == null ? null : integer ? Math.round(n) : n);
        }}
        className={cx(inputCls, "tnum w-full max-w-[140px] text-right")}
      />
      {suffix && <span className="shrink-0 text-[15px] text-ink3">{suffix}</span>}
    </span>
  );
}

/** Zeit als m:ss, mit `seconds` (Espresso) in Sekunden mit Zehnteln wie von Mühle und Maschine: „26,8“ */
export function TimeField({
  value,
  onChange,
  id,
  label,
  seconds,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  label?: string;
  seconds?: boolean;
}) {
  const parse = seconds ? parseSeconds : parseTime;
  const show = seconds ? secondsInput : timeInput;
  const [text, setText] = useState(show(value));
  useEffect(() => {
    if (parse(text) !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, seconds]);
  const invalid = text.trim() !== "" && parse(text) == null;
  return (
    <span className="flex min-w-0 items-center justify-end gap-1">
      <input
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        inputMode={seconds ? "decimal" : "numeric"}
        placeholder={seconds ? "0,0" : "m:ss"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
        className={cx(inputCls, "tnum w-full max-w-[140px] text-right", invalid && "text-bad")}
      />
      <span className="shrink-0 text-[15px] text-ink3">{seconds ? "s" : "min"}</span>
    </span>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  id,
  rows = 4,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
  label?: string;
}) {
  return (
    <textarea
      id={id}
      aria-label={label}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="field block resize-y px-4 py-3 text-[15px] leading-relaxed"
    />
  );
}

export function SelectField<T extends string | number>({
  value,
  onChange,
  options,
  id,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  id?: string;
  label?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className="field h-9 max-w-full cursor-pointer appearance-none truncate bg-transparent pr-5 text-right text-[15px] text-ink2 [background-image:linear-gradient(45deg,transparent_50%,currentColor_50%),linear-gradient(135deg,currentColor_50%,transparent_50%)] [background-position:calc(100%-6px)_55%,calc(100%-2px)_55%] [background-repeat:no-repeat] [background-size:4px_4px,4px_4px]"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Chips mit Eingabe; Enter oder Komma fügt hinzu */
export function TagInput({
  values,
  onChange,
  suggestions = [],
  placeholder,
  id,
  label,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  id?: string;
  label?: string;
}) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, 20));
    setText("");
  };
  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(t) && !values.some((v) => v.toLowerCase() === s.toLowerCase()))
      .sort((a, b) => Number(!a.toLowerCase().startsWith(t)) - Number(!b.toLowerCase().startsWith(t)))
      .slice(0, 6);
  }, [text, suggestions, values]);
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5" onClick={() => input.current?.focus()}>
        {values.map((v) => (
          <span key={v} className="inline-flex h-7 items-center gap-1 rounded-full bg-fill pr-1 pl-3 text-[13px]">
            {v}
            <button
              type="button"
              aria-label={`${v} entfernen`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(values.filter((x) => x !== v));
              }}
              className="flex size-5 items-center justify-center rounded-full text-ink3 hover:bg-fill2 hover:text-ink"
            >
              <X size={12} strokeWidth={2.6} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          aria-label={label}
          aria-controls={listId}
          value={text}
          placeholder={values.length ? "" : placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            if (text.trim()) add(text);
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]/.test(v)) add(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) add(matches[0] && matches[0].toLowerCase().startsWith(text.trim().toLowerCase()) ? matches[0] : text);
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          className="field h-7 min-w-[120px] flex-1 text-[15px]"
        />
      </div>
      {focus && matches.length > 0 && (
        <div id={listId} className="mt-2 flex flex-wrap gap-1.5">
          {matches.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(m)}
              className="h-7 rounded-full border border-sep px-3 text-[13px] text-accent hover:bg-accent-soft"
            >
              + {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
