import { useTranslation } from "react-i18next";
import { Sheet } from "../design/bento";
import { friendlyLabel } from "../data/friendly-labels";
import { recMutation } from "../data/rec-mutations";
import { type Provenance, PROVENANCE_LABEL, PROVENANCE_NOTE } from "../data/provenance";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";

// Action details (owner: "lil pop-up windows tied to the function", 2026-06-15). ONE tweak in
// focus — what it does, EXACTLY what it changes on your PC (from the real apply paths), how it
// reverts, and the Apply / Roll back action. Pure Compy honesty made visible.
//
// WAS ActionDrawer.tsx, RETIRED 2026-08-13 (popout convergence). The content below is unchanged —
// same sections, same copy, same i18n keys, same handlers. What went away is the second popout
// IMPLEMENTATION it used to carry: its own portal, its own z-index (200), its own Escape handler
// (which, unlike the Sheet's, never stood down for a ConfirmDialog opened on top of it — so
// confirming an apply from inside the drawer and pressing Escape closed the drawer out from under
// the dialog), its own looser focus trap (it counted hidden and disabled controls as focusables),
// and a `backdrop-filter: blur(3px)` scrim that re-rasterised the whole window on every frame the
// live-ticking room behind it updated — the exact GPU cost the Sheet documents rejecting.
//
// The head, the close button, the footer rail and the dismissal contract are now the Sheet's. The
// BODY keeps its ad-* class names on purpose (wrap-don't-rename): the styles moved to Fix.css
// intact, so this panel reads exactly as it did.

export type ActionRec = {
  id: string;
  title: string;
  description?: string;
  impact?: string;
  provenance?: Provenance;
};

// Per-surface chip TONE only. The label + honesty note come from the shared source of truth
// (src/data/provenance.ts) so they can't drift from the Fix row / Home limiter wording.
const TONE: Record<Provenance, string> = {
  verified: "ready",
  "measured-signal": "accent",
  "expected-impact": "muted",
};

export function ActionDetailsSheet({
  rec,
  applied,
  busy,
  origin,
  restoresLabel,
  noUndo = false,
  onApply,
  onRollback,
  onClose,
}: {
  rec: ActionRec;
  applied: boolean;
  busy: boolean;
  /** CR-undo-entry-disable: the change's stored history resolves to no undo (`hasUndo` false), so
   *  Roll back is disabled here with the same reason line the Applied card shows. */
  noUndo?: boolean;
  /** The rect of the "Details ›" row, so the panel grows out of the row you opened it from. */
  origin?: DOMRect | null;
  restoresLabel?: string | null;
  onApply: () => void;
  onRollback: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const f = friendlyLabel(rec.id);
  const headline = f?.headline ?? rec.title;
  const tech = f?.tech ?? null;
  const mut = recMutation(rec.id);
  const prov = rec.provenance
    ? { label: PROVENANCE_LABEL[rec.provenance], tone: TONE[rec.provenance], note: PROVENANCE_NOTE[rec.provenance] }
    : null;
  const what = rec.impact || rec.description || "";

  return (
    <Sheet
      title={headline}
      // The quiet technical tag that used to sit under the headline as `.ad-tech`. Same string,
      // same place on screen — the Sheet's own sub-line owns that slot now.
      sub={tech ?? undefined}
      origin={origin}
      onClose={onClose}
      footer={
        <>
          {/* The drawer's footer Close stays: it was a real control with its own key, and a user
              who reads to the bottom of the panel should not have to travel back up to leave. */}
          <button className="ad-secondary" onClick={onClose}>
            {t("optimize.actionDrawer.close")}
          </button>
          {applied ? (
            <button className="ad-action ad-rollback" disabled={busy || noUndo} onClick={onRollback}>
              {busy ? t("optimize.actionDrawer.rollingBack") : t("optimize.actionDrawer.rollBack")}
            </button>
          ) : (
            <button className="ad-action ad-apply" disabled={busy} onClick={onApply}>
              {busy ? t("optimize.actionDrawer.applying") : t("optimize.actionDrawer.applyThisChange")}
            </button>
          )}
        </>
      }
    >
      {applied && noUndo && <p className="fix-rig-note ad-noundo">{t("optimize.fix.noSavedUndo")}</p>}
      {what && (
        <section className="ad-block">
          <span className="ad-eyebrow">{t("optimize.actionDrawer.whatItDoes")}</span>
          <p className="ad-text">{what}</p>
        </section>
      )}

      <section className="ad-block">
        <span className="ad-eyebrow">{t("optimize.actionDrawer.whatChangesOnPc")}</span>
        {mut ? (
          <>
            <p className="ad-text ad-mono-soft">{mut.changes}</p>
            <div className="ad-flags">
              {mut.elevated && <span className="ad-flag">{t("optimize.actionDrawer.needsAdminOk")}</span>}
              {mut.restart && (
                <span className="ad-flag ad-flag-warn">{t("optimize.actionDrawer.takesEffectAfterRestart")}</span>
              )}
            </div>
          </>
        ) : (
          <p className="ad-text ad-muted">{t("optimize.actionDrawer.singleScopedSettingFallback")}</p>
        )}
      </section>

      {prov && (
        <section className="ad-block">
          <span className="ad-eyebrow">{t("optimize.actionDrawer.evidence")}</span>
          <p className="ad-text">
            <span className={`ad-chip ad-tone-${prov.tone}`}>{prov.label}</span>
            {prov.note}
          </p>
        </section>
      )}

      <section className="ad-block ad-revert">
        <span className="ad-eyebrow">{t("optimize.actionDrawer.howItReverts")}</span>
        <p className="ad-text">
          {mut?.reverts ?? t("optimize.actionDrawer.revertsFallback")}
          {applied && restoresLabel
            ? t("optimize.actionDrawer.currentlyActive", { restoresLabel })
            : ""}
        </p>
      </section>
    </Sheet>
  );
}
