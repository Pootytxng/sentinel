import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./ConfirmDialog.css";

// Themed Confirm Dialog (spec 2026-06-07) — replaces the native window.confirm() ("tauri.localhost
// says") with ONE shared Instrument surface. Promise-based so the existing async apply/rollback
// handlers just `await confirm({...})` in place of the sync boolean. Reuses the §4 apply-all sheet's
// obsidian-glass treatment; ink-law confirm button; Esc=cancel / Enter=confirm / focus-trap /
// backdrop-cancel / focus-return; reduced-motion instant. Frontend-only, zero IPC.
export type ConfirmOpts = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Single-button NOTICE mode: hide the cancel button so the dialog is a dismiss-only
   *  acknowledgement (e.g. surfacing an apply failure the user can only read + close).
   *  The promise still resolves true on the button / false on Esc/backdrop — callers that
   *  only need to notify can ignore the result. */
  acknowledge?: boolean;
};

type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const confirmBtn = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    // Re-entrancy guard: if a dialog is already open (two triggers firing close together — an Enter
    // auto-repeat, or two async effects each opening a confirm), auto-cancel the FIRST (resolve false)
    // before installing the new resolver. Without this the prior promise never settled, so any await'd
    // cleanup gated on it (clearing a spinner, re-enabling a button) hung for the rest of the session.
    resolver.current?.(false);
    trigger.current = (document.activeElement as HTMLElement) ?? null;
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setOpts(null);
    resolver.current?.(result);
    resolver.current = null;
    trigger.current?.focus?.(); // focus returns to whatever opened the dialog
  }, []);

  // Focus the confirm button on open.
  useEffect(() => {
    if (opts) confirmBtn.current?.focus();
  }, [opts]);

  // Keyboard: Enter=confirm, Esc=cancel, Tab traps within the dialog. Registered in the CAPTURE phase
  // with stopImmediatePropagation on every key we own — a modal must TRAP its keys so they never leak to
  // background window handlers. Without this, a host that also listens on window for Escape (e.g. the
  // SetupTour, whose Escape calls finish()) fired alongside us: dismissing this confirm also tore down
  // the whole tour. Capture + stopImmediatePropagation makes this dialog the sole responder while open.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close(true);
      } else if (e.key === "Tab") {
        e.stopImmediatePropagation();
        const m = modalRef.current;
        if (!m) return;
        const f = Array.from(m.querySelectorAll<HTMLElement>("button"));
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [opts, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="cmp-confirm-backdrop" onClick={() => close(false)}>
          <div
            ref={modalRef}
            className="cmp-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={opts.title}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="cmp-confirm-title">{opts.title}</h3>
            {opts.body && <p className="cmp-confirm-body">{opts.body}</p>}
            <div className="cmp-confirm-actions">
              {!opts.acknowledge && (
                <button type="button" className="cmp-confirm-cancel" onClick={() => close(false)}>
                  {opts.cancelLabel ?? "Cancel"}
                </button>
              )}
              <button
                ref={confirmBtn}
                type="button"
                className="cmp-confirm-go"
                onClick={() => close(true)}
              >
                {opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
