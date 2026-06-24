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

  // Keyboard: Enter=confirm, Esc=cancel, Tab traps within the dialog.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      } else if (e.key === "Tab") {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
