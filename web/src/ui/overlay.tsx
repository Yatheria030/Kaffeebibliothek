import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, cx } from "./controls.tsx";

// ---------- Body-Scroll sperren, solange ein Overlay offen ist ----------

let locks = 0;
function lockScroll() {
  locks += 1;
  if (locks === 1) {
    const w = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = w > 0 ? `${w}px` : "";
  }
  return () => {
    locks -= 1;
    if (locks === 0) {
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    }
  };
}

function useEscape(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ref.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Tab bleibt im Dialog: vom letzten Element zum ersten und zurück, statt in die Seite dahinter zu wandern */
function trapTab(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const box = e.currentTarget;
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const cur = document.activeElement;
  if (e.shiftKey && (cur === first || cur === box)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && cur === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------- Sheet (Modal im iOS-Stil) ----------

export function Sheet({
  open,
  onClose,
  title,
  onSave,
  saveLabel = "Sichern",
  closeLabel = "Abbrechen",
  saving,
  canSave = true,
  children,
  footer,
  width = 620,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onSave?: () => void;
  saveLabel?: string;
  /** „Fertig“ für reine Ansichten ohne Sichern */
  closeLabel?: string;
  saving?: boolean;
  canSave?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => (open ? lockScroll() : undefined), [open]);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => prev?.focus?.();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6 lg:p-10">
      <div className="anim-fade absolute inset-0 bg-[var(--c-overlay)]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="anim-sheet relative flex h-[100dvh] w-full flex-col overflow-hidden bg-bg outline-none sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:rounded-[20px] sm:shadow-pop lg:max-h-[calc(100dvh-80px)]"
        style={{ maxWidth: width }}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSave && canSave && !saving) {
            e.preventDefault();
            onSave();
          }
        }}
      >
        <header className="frost sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-sep bg-[var(--c-toolbar)] px-3 pt-[max(env(safe-area-inset-top),0px)]">
          <div className="flex h-[52px] items-center">
            <button type="button" onClick={onClose} className="h-9 rounded-full px-2 text-[15px] text-accent hover:bg-accent-soft">
              {closeLabel}
            </button>
          </div>
          <h2 className="m-0 truncate text-center text-[15px] font-semibold">{title}</h2>
          <div className="flex justify-end">
            {onSave && (
              <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={!canSave}>
                {saveLabel}
              </Button>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-6">
          {children}
          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Bestätigungsdialog (Alert im Apple-Stil) ----------

type ConfirmReq = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
};

let confirmState: ConfirmReq | null = null;
const confirmListeners = new Set<() => void>();
const emitConfirm = () => confirmListeners.forEach((l) => l());

export function confirmDialog(opts: Omit<ConfirmReq, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState?.resolve(false);
    confirmState = { ...opts, resolve };
    emitConfirm();
  });
}

function closeConfirm(v: boolean) {
  confirmState?.resolve(v);
  confirmState = null;
  emitConfirm();
}

export function ConfirmHost() {
  const req = useSyncExternalStore(
    (cb) => {
      confirmListeners.add(cb);
      return () => confirmListeners.delete(cb);
    },
    () => confirmState,
  );
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => (req ? lockScroll() : undefined), [req]);
  useEffect(() => {
    if (req) btn.current?.focus();
  }, [req]);
  useEscape(Boolean(req), () => closeConfirm(false));
  if (!req) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
      <div className="anim-fade absolute inset-0 bg-[var(--c-overlay)]" onClick={() => closeConfirm(false)} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={req.title}
        onKeyDown={trapTab}
        className="anim-sheet frost relative w-full max-w-[300px] overflow-hidden rounded-[16px] bg-[color-mix(in_srgb,var(--c-card)_92%,transparent)] text-center shadow-pop"
      >
        <div className="px-5 pt-5 pb-4">
          <p className="m-0 text-[16px] font-semibold">{req.title}</p>
          {req.message && <p className="m-0 mt-1.5 text-[13px] leading-snug text-ink2">{req.message}</p>}
        </div>
        <div className="grid grid-cols-2 border-t border-sep">
          <button type="button" onClick={() => closeConfirm(false)} className="h-11 text-[16px] text-accent hover:bg-hover">
            Abbrechen
          </button>
          <button
            ref={btn}
            type="button"
            onClick={() => closeConfirm(true)}
            className={cx("h-11 border-l border-sep text-[16px] font-semibold hover:bg-hover", req.danger ? "text-bad" : "text-accent")}
          >
            {req.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toast ----------

type ToastMsg = { id: number; text: string; tone: "ok" | "error" };
let toasts: ToastMsg[] = [];
let toastId = 0;
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());

export function toast(text: string, tone: ToastMsg["tone"] = "ok") {
  const id = ++toastId;
  toasts = [...toasts.slice(-2), { id, text, tone }];
  emitToast();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emitToast();
    },
    tone === "error" ? 5200 : 2800,
  );
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toasts,
  );
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(20px,env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className="anim-sheet frost pointer-events-auto flex max-w-[520px] items-center gap-2.5 rounded-full bg-[color-mix(in_srgb,#17181b_92%,transparent)] py-2.5 pr-3 pl-3.5 text-[14px] text-white shadow-pop"
        >
          {t.tone === "error" ? (
            <CircleAlert size={17} className="shrink-0 text-[#FF6961]" />
          ) : (
            <CircleCheck size={17} className="shrink-0 text-[#30D158]" />
          )}
          <span className="min-w-0">{t.text}</span>
          <button
            type="button"
            aria-label="Schließen"
            onClick={() => {
              toasts = toasts.filter((x) => x.id !== t.id);
              emitToast();
            }}
            className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------- Drawer für die Seitenleiste auf kleinen Bildschirmen ----------

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Zwei Frames warten, damit die Einblendung animiert; beide Frames abbrechen, falls vorher geschlossen wird
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => (open ? lockScroll() : undefined), [open]);
  useEscape(open, onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Fokus in die Leiste holen (ohne Suchfeld, sonst springt auf dem Handy die Tastatur auf) und danach zurückgeben
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, [open]);
  if (!mounted && !open) return null;
  // Sichtbar nur, solange offen: Schließen wirkt sofort, auch wenn Frames oder Timer im Hintergrund-Tab hängen
  const visible = open && entered;
  return createPortal(
    <div className={cx("fixed inset-0 z-[55] lg:hidden", !open && "pointer-events-none")} aria-hidden={!open || undefined}>
      <div
        className={cx("absolute inset-0 bg-[var(--c-overlay)] transition-opacity duration-200", visible ? "opacity-100" : "opacity-0")}
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Seitenleiste"
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cx(
          "absolute inset-y-0 left-0 w-[min(300px,86vw)] shadow-pop outline-none transition-transform duration-200 ease-out",
          visible ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
