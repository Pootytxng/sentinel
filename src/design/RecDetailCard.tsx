import type { RecDetail } from "../data/rec-detail";
import { PROVENANCE_LABEL } from "../data/provenance";
import { TrustSwitch } from "./TrustSwitch";
import { Walkthrough } from "./Walkthrough";
import type { Walkthrough as WT, GpuVendor } from "../surfaces/walkthroughs";
import "./RecDetailCard.css";

// ONE named recommendation, with the real data behind it and the ONE action it honestly offers.
// Shared by every surface that resolves a priority row back into its recommendations (FirstCheck's
// arc, the Check tab) so a tweak reads the SAME way wherever the user meets it — the recovery
// train's anti-drift rule: parallel grammars for the same object are what made the app confusing.
//
// Answers, in order, the five questions a non-technical gamer actually has: what is it · what did
// Compy find on MY PC · what does it do · what changes (and how sure are we) · what's the catch.
// Every string is either the catalog's own text or the caller's copy — nothing claims a number
// Compy didn't measure, and the impact line always rides with its provenance tier.
//
// Deliberately dumb: it renders a RecDetail and calls back. Resolving the detail (rec-detail.ts),
// the walkthrough lookup (language-aware on Check, plain in the arc), and the apply dispatch all
// stay with the caller — this file introduces NO mutation path of its own.

export type RecDetailCardLabels = {
  /** Fact-row terms. */
  detected: string;
  what: string;
  changes: string;
  catch: string;
  /** Action affordances. */
  apply: string;
  applying: string;
  applyAria: (title: string) => string;
  applied: string;
  /** Fallback when the backend gave no reason for an ineligible rec. */
  ineligibleFallback: string;
  /** Why Compy won't touch a hands-on rec — with and without real steps behind it. */
  manual: string;
  manualWithSteps: string;
  steps: string;
};

export function RecDetailCard({
  d,
  labels,
  walkthrough,
  vendor,
  variant = "button",
  showTitle,
  busy,
  disabled,
  onApply,
}: {
  d: RecDetail;
  labels: RecDetailCardLabels;
  /** The real guided steps, already resolved by the caller — null when there are none. Never a
   *  "Compy shows you the steps" promise with nothing behind it. */
  walkthrough: WT | null;
  vendor: GpuVendor;
  /** "switch" = the shared TrustSwitch (rooms that speak in switches); "button" = a plain Apply. */
  variant?: "switch" | "button";
  /** The single-rec case already shows the name as the row headline — don't repeat it there. */
  showTitle: boolean;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <div className="rd-rec" data-action={d.action}>
      {showTitle && <div className="rd-rec-title">{d.title}</div>}
      <dl className="rd-rec-facts">
        <div className="rd-rec-fact">
          <dt>{labels.detected}</dt>
          <dd>{d.detected}</dd>
        </div>
        <div className="rd-rec-fact">
          <dt>{labels.what}</dt>
          <dd>{d.why}</dd>
        </div>
        <div className="rd-rec-fact">
          <dt>{labels.changes}</dt>
          <dd>
            {d.impact} <span className="rd-rec-prov">{PROVENANCE_LABEL[d.provenance]}</span>
          </dd>
        </div>
        {d.downside && (
          <div className="rd-rec-fact">
            <dt>{labels.catch}</dt>
            <dd>{d.downside}</dd>
          </div>
        )}
      </dl>

      <div className="rd-rec-foot">
        {d.action === "apply" &&
          (variant === "switch" ? (
            // The shared trust-switch, label-less so it introduces no copy of its own;
            // it triggers the SAME audited apply flow as the classic button.
            <TrustSwitch
              applied={false}
              busy={busy}
              onToggle={onApply}
              ariaLabel={labels.applyAria(d.title)}
            />
          ) : (
            <button className="rd-btn rd-btn-primary" disabled={disabled} onClick={onApply}>
              {busy ? labels.applying : labels.apply}
            </button>
          ))}
        {d.action === "applied" && <span className="rd-chip rd-chip-done">{labels.applied}</span>}
        {d.action === "ineligible" && (
          <span className="rd-chip rd-chip-muted">{d.ineligibleReason ?? labels.ineligibleFallback}</span>
        )}
        {d.action === "manual" && (
          <span className="rd-chip rd-chip-muted">
            {walkthrough ? labels.manualWithSteps : labels.manual}
          </span>
        )}
      </div>

      {walkthrough && (
        <details className="rd-rec-guide">
          <summary>{labels.steps}</summary>
          <Walkthrough walkthrough={walkthrough} vendor={vendor} />
        </details>
      )}
    </div>
  );
}
