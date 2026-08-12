import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../../i18n";
import { useReducedMotion } from "../use-motion";
import "./bento.css";

// SHEET — the popout half of the bento system, in the owner's own words (2026-08-11): "bring
// forward a popout template in the forground of the app itself ... whilst all still keeping it
// within the app and not actually opening another browser or application".
//
// It is a modal panel that GROWS OUT OF the tile you clicked, while the room behind it fades and
// settles back. The growth is the whole trick: a panel that fades in from nowhere reads as a
// context switch, and a panel that expands from the tile reads as the same object opening. That is
// what keeps a deep section from feeling like another place to get lost in — the point of the
// redesign, since the standing tester complaint is that Compy is overwhelming to navigate.
//
// WHY IT PORTALS TO <body>. The dim is applied to `.v2-shell` (the rail + room, ShellV2.tsx). A
// sheet rendered inside the shell would dim itself along with the room. Portalling out is what lets
// one CSS rule dim absolutely everything except the sheet.
//
// WHY NO BLUR. The obvious treatment is `backdrop-filter: blur()` on the scrim, and it is rejected
// on purpose: the room behind a sheet has live-ticking gauges, so a backdrop-filter re-rasterises a
// full-window blur on every frame the background updates. That is a continuous GPU cost for a
// decorative effect, and it contradicts the standing bar that Compy must be the least
// resource-hungry app on the machine (owner, 2026-08-06). The scrim is a flat fill and the settle
// is compositor-only opacity + transform — both free after the first frame. See bento.css.
//
// KEYS ARE TRAPPED, NOT SHARED. Same reasoning as ConfirmDialog: a modal that lets Escape leak to
// background window handlers tears down whatever else is listening. One deliberate exception — if a
// ConfirmDialog is open ON TOP of this sheet, Escape belongs to the confirm, so this handler stands
// down. Without that check, confirming a mutation from inside a sheet and pressing Escape would
// close the sheet out from under the dialog instead of cancelling the dialog.

/** True while a ConfirmDialog is open above us — it owns the keyboard when it is. */
function confirmIsOpen(): boolean {
  try {
    return document.querySelector(".cmp-confirm-backdrop") != null;
  } catch {
    return false;
  }
}

export type SheetProps = {
  /** The panel's name. Also its accessible label. */
  title: string;
  /** Optional one-line answer under the title — what this panel is FOR, in plain words. */
  sub?: string;
  /** The rect of the tile that opened it, so the panel can grow out of exactly that tile. */
  origin?: DOMRect | null;
  onClose: () => void;
  /** Pinned to the bottom of the panel — the one primary action, if this sheet has one. */
  footer?: ReactNode;
  children: ReactNode;
};

export function Sheet({ title, sub, origin, onClose, footer, children }: SheetProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  // Capture the opener BEFORE we move focus, so focus can return to the exact tile on close.
  if (trigger.current === null) trigger.current = (document.activeElement as HTMLElement) ?? null;

  // Dim the room behind us. Written on <html> so ONE rule in bento.css can settle the whole shell,
  // and removed on unmount so an unmounted sheet can never leave the app greyed out.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sheet = "open";
    return () => {
      delete root.dataset.sheet;
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const opener = trigger.current;
    return () => opener?.focus?.();
  }, []);

  // Grow out of the tile. Measured, so it lands on the panel's real size rather than a guessed one;
  // JS-driven, so unlike the CSS transitions it needs its own reduced-motion branch.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !origin || reduced) return;
    const to = panel.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    // Uniform scale (width ratio): a non-uniform one would visibly squash the panel's contents for
    // the length of the animation.
    const scale = Math.min(1, Math.max(0.4, origin.width / to.width));
    const dx = origin.left + origin.width / 2 - (to.left + to.width / 2);
    const dy = origin.top + origin.height / 2 - (to.top + to.height / 2);
    panel.style.transition = "none";
    panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    panel.style.opacity = "0";
    void panel.offsetWidth; // flush the start frame, or the browser coalesces both into no motion
    panel.style.transition = "";
    panel.style.transform = "";
    panel.style.opacity = "";
  }, [origin, reduced]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmIsOpen()) return; // the dialog above us owns the keyboard
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      } else if (e.key === "Tab") {
        const p = panelRef.current;
        if (!p) return;
        const f = Array.from(
          p.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (f.length === 0) return;
        e.stopImmediatePropagation();
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
  }, [close]);

  return createPortal(
    <div className="v2-sheet-backdrop" onClick={close}>
      <div
        ref={panelRef}
        className="v2-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="v2-sheet-head">
          <div className="v2-sheet-heading">
            <h2 className="v2-sheet-title">{title}</h2>
            {sub && <p className="v2-sheet-sub">{sub}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="v2-sheet-close"
            onClick={close}
            aria-label={t("common.sheet.close")}
          >
            {t("common.sheet.close")}
          </button>
        </header>
        <div className="v2-sheet-body v2-sheet-reveal">{children}</div>
        {footer && <footer className="v2-sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The state half of the pattern, so a room doesn't hand-roll it per tile.
 *
 *   const sheet = useSheet<"fixes" | "specs">();
 *   <BentoTile … open={{ label: t("home.tiles.seeAll"), onOpen: sheet.opener("fixes") }} />
 *   {sheet.is("fixes") && <Sheet title={…} origin={sheet.origin} onClose={sheet.close}>…</Sheet>}
 */
export function useSheet<T extends string>() {
  const [state, setState] = useState<{ id: T; origin: DOMRect } | null>(null);
  const opener = useCallback((id: T) => (origin: DOMRect) => setState({ id, origin }), []);
  const close = useCallback(() => setState(null), []);
  return {
    id: state?.id ?? null,
    origin: state?.origin ?? null,
    is: (id: T) => state?.id === id,
    opener,
    close,
  };
}
