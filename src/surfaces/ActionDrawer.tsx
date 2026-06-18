import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { friendlyLabel } from "../data/friendly-labels";
import { recMutation } from "../data/rec-mutations";
import "./ActionDrawer.css";

// Action Drawer (owner: "lil pop-up windows tied to the function", 2026-06-15). A premium right-sliding
// Sheet that presents ONE tweak in focus — what it does, EXACTLY what it changes on your PC (from the
// real apply paths), how it reverts, and the Apply / Roll back action. Pure Compy honesty made visible.
// Backdrop dims + blurs the app behind; Esc / click-outside / Close to dismiss; reduced-motion safe.

export type DrawerRec = {
  id: string;
  title: string;
  description?: string;
  impact?: string;
  provenance?: "verified" | "measured-signal" | "expected-impact";
};

const PROVENANCE: Record<string, { label: string; tone: string; note: string }> = {
  verified: { label: "Measured", tone: "ready", note: "Compy has observed this gain on real hardware." },
  "measured-signal": { label: "Measured signal", tone: "accent", note: "Backed by third-party / community measurement." },
  "expected-impact": { label: "Expected", tone: "muted", note: "Sound from how Windows works — not yet benchmarked here." },
};

export function ActionDrawer({
  rec,
  applied,
  busy,
  restoresLabel,
  onApply,
  onRollback,
  onClose,
}: {
  rec: DrawerRec;
  applied: boolean;
  busy: boolean;
  restoresLabel?: string | null;
  onApply: () => void;
  onRollback: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Restore focus to whatever opened the drawer (the "Details ›" button) on close.
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab within the dialog (aria-modal): keyboard focus must not escape to the app behind.
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const f = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
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
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [onClose]);

  const f = friendlyLabel(rec.id);
  const headline = f?.headline ?? rec.title;
  const tech = f?.tech ?? null;
  const mut = recMutation(rec.id);
  const prov = rec.provenance ? PROVENANCE[rec.provenance] : null;
  const what = rec.impact || rec.description || "";

  // Portal to <body> so the fixed backdrop/sheet escapes any transformed/animated ancestor (the Living
  // Instrument entrance transforms create a containing block that otherwise traps position:fixed).
  return createPortal(
    <div className="ad-backdrop" onClick={onClose}>
      <div
        className="ad-panel"
        role="dialog"
        aria-modal="true"
        aria-label={headline}
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ad-head">
          <div className="ad-head-text">
            <h2 className="ad-headline">{headline}</h2>
            {tech && <span className="ad-tech">{tech}</span>}
          </div>
          <button className="ad-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="ad-body">
          {what && (
            <section className="ad-block">
              <span className="ad-eyebrow">What it does</span>
              <p className="ad-text">{what}</p>
            </section>
          )}

          <section className="ad-block">
            <span className="ad-eyebrow">What changes on your PC</span>
            {mut ? (
              <>
                <p className="ad-text ad-mono-soft">{mut.changes}</p>
                <div className="ad-flags">
                  {mut.elevated && <span className="ad-flag">Needs one admin OK</span>}
                  {mut.restart && <span className="ad-flag ad-flag-warn">Takes effect after restart</span>}
                </div>
              </>
            ) : (
              <p className="ad-text ad-muted">
                A single, scoped Windows setting — Compy snapshots its exact prior value before touching it.
              </p>
            )}
          </section>

          {prov && (
            <section className="ad-block">
              <span className="ad-eyebrow">Evidence</span>
              <p className="ad-text">
                <span className={`ad-chip ad-tone-${prov.tone}`}>{prov.label}</span>
                {prov.note}
              </p>
            </section>
          )}

          <section className="ad-block ad-revert">
            <span className="ad-eyebrow">How it reverts</span>
            <p className="ad-text">
              {mut?.reverts ??
                "Compy captures the exact prior state before changing anything, and restores it on rollback."}
              {applied && restoresLabel ? ` Currently active — rolls back to: ${restoresLabel}.` : ""}
            </p>
          </section>
        </div>

        <footer className="ad-foot">
          <button className="ad-secondary" onClick={onClose}>
            Close
          </button>
          {applied ? (
            <button className="ad-action ad-rollback" disabled={busy} onClick={onRollback}>
              {busy ? "Rolling back…" : "Roll back"}
            </button>
          ) : (
            <button className="ad-action ad-apply" disabled={busy} onClick={onApply}>
              {busy ? "Applying…" : "Apply this change"}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
