import { useId, useState, type ReactNode } from "react";

// ── Quiet Pit Wall component contracts (Phase B step 3, issue #49) ─────────────────────
// The Direction D law is "glance first, proof on demand, full detail when requested". These five
// primitives are that law made structural, so a room CANNOT accidentally violate it:
//
//   GLANCE    Verdict      one conclusion per room, and one supporting sentence
//             Reading      one measured value with an interpretation, or an honest empty
//             ActionRow    one filled primary, one quiet second, the rest bare
//   PROOF     EvidenceChip the four honest answers and no fifth
//   ADVANCED  Disclosure   everything else, genuinely absent until asked for
//
// Every one of them is scoped by qpw-components.css under [data-qpw="on"] and is inert until a
// room opts in. Contracts are pinned in qpw-contracts.test.tsx.

/* ═══ PROOF ═══════════════════════════════════════════════════════════════════════════ */

/** The four honest answers about a piece of evidence. There is no fifth, and none of them lies.
 *  - measured    Compy read it on THIS PC.
 *  - expected    Catalog guidance. Believed, not measured here. Must never be shown as measured.
 *  - unknown     Compy could read it and hasn't yet.
 *  - unavailable Compy cannot read it on this machine at all. */
export type EvidenceState = "measured" | "expected" | "unknown" | "unavailable";

const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  measured: "MEASURED",
  expected: "EXPECTED",
  unknown: "UNKNOWN",
  unavailable: "UNAVAILABLE",
};

/** Spoken form for assistive tech — the abbreviation alone is not an explanation. */
const EVIDENCE_MEANING: Record<EvidenceState, string> = {
  measured: "Measured on this PC",
  expected: "Expected — general guidance, not measured on this PC",
  unknown: "Unknown — not read yet",
  unavailable: "Unavailable — Compy cannot read this on this PC",
};

export function EvidenceChip({
  state,
  label,
  detail,
}: {
  state: EvidenceState;
  /** Override the visible text (i18n). The spoken meaning still travels. */
  label?: string;
  /** Optional qualifier, e.g. "1 session · 11 min". Kept short; it is telemetry, not prose. */
  detail?: string;
}) {
  return (
    <span className="qpw-chip" data-state={state}>
      <span className="qpw-chip-dot" aria-hidden="true" />
      <span className="qpw-chip-text">
        {label ?? EVIDENCE_LABEL[state]}
        {detail ? ` · ${detail}` : ""}
      </span>
      <span className="qpw-sr">{EVIDENCE_MEANING[state]}</span>
    </span>
  );
}

/* ═══ ADVANCED ════════════════════════════════════════════════════════════════════════ */

/** Progressive disclosure with the one property that matters: when it is closed the content is
 *  REMOVED from the accessibility tree and the focus order, not merely made transparent. A
 *  keyboard or screen-reader user must not tab into something a sighted user cannot see. */
export function Disclosure({
  summary,
  count,
  children,
  defaultOpen = false,
  openLabel = "Show",
  closeLabel = "Hide",
}: {
  summary: string;
  /** Optional item count, rendered as telemetry rather than folded into the sentence. */
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  openLabel?: string;
  closeLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="qpw-disc" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="qpw-disc-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="qpw-disc-summary">
          {summary}
          {typeof count === "number" ? <span className="qpw-disc-count"> {count}</span> : null}
        </span>
        <span className="qpw-disc-affordance">{open ? closeLabel : openLabel}</span>
      </button>
      {/* `hidden` (not opacity, not visibility) is the contract: closed means gone from
          focus order and from the a11y tree. */}
      <div className="qpw-disc-panel" id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/* ═══ GLANCE ══════════════════════════════════════════════════════════════════════════ */

/** The room's ONE conclusion, in plain language, plus at most one supporting sentence.
 *  A score is not a conclusion — pass a named state, never a number. */
export function Verdict({
  children,
  lede,
  crumb,
}: {
  children: string;
  lede?: string;
  crumb?: string;
}) {
  return (
    <header className="qpw-verdict-block">
      {crumb ? <p className="qpw-crumb">{crumb}</p> : null}
      <h1 className="qpw-verdict">{children}</h1>
      {lede ? <p className="qpw-lede">{lede}</p> : null}
    </header>
  );
}

/** One reading in the health strip. `value === null` is the HONEST EMPTY: it renders the
 *  unavailable wording and draws no bar, because an empty bar reads as "zero" and that is a lie. */
export function Reading({
  name,
  value,
  interpretation,
  fill,
  tone = "proof",
  unavailableText = "Not available",
}: {
  name: string;
  /** null means Compy has no reading. Never substitute a zero or a placeholder number. */
  value: string | null;
  interpretation: string;
  /** 0–1. Ignored entirely when value is null. */
  fill?: number;
  tone?: "proof" | "judge" | "fail";
  unavailableText?: string;
}) {
  const unavailable = value === null;
  const pct = Math.max(0, Math.min(1, fill ?? 0));
  return (
    <div className="qpw-read" data-unavailable={unavailable ? "true" : "false"} data-tone={tone}>
      <p className="qpw-read-name">{name}</p>
      <p className="qpw-read-value">{unavailable ? unavailableText : value}</p>
      <p className="qpw-read-interp">{interpretation}</p>
      {unavailable ? null : (
        <div className="qpw-read-bar">
          <i style={{ width: `${(pct * 100).toFixed(1)}%` }} />
        </div>
      )}
    </div>
  );
}

/* ═══ ACTION HIERARCHY ════════════════════════════════════════════════════════════════ */

export type ActionVariant = "primary" | "quiet" | "bare";

export function Action({
  variant = "quiet",
  children,
  onClick,
  disabled,
}: {
  variant?: ActionVariant;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="qpw-action" data-variant={variant} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** One filled primary per viewport is the law. This counts its own children and refuses to
 *  render a second filled action — it demotes the extras to `quiet` and says so loudly in dev,
 *  rather than shipping two equally-weighted "do this" buttons to a nontechnical user. */
export function ActionRow({ children }: { children: ReactNode }) {
  const kids = Array.isArray(children) ? children : [children];
  let seenPrimary = false;
  let demoted = 0;

  const mapped = kids.map((child, i) => {
    const el = child as { type?: unknown; props?: { variant?: ActionVariant } } | null;
    if (!el || typeof el !== "object" || !el.props) return child;
    if (el.props.variant !== "primary") return child;
    if (!seenPrimary) {
      seenPrimary = true;
      return child;
    }
    demoted += 1;
    const cloneable = el as unknown as { props: Record<string, unknown> };
    return (
      <Action key={`demoted-${i}`} variant="quiet" onClick={cloneable.props.onClick as (() => void) | undefined}>
        {cloneable.props.children as ReactNode}
      </Action>
    );
  });

  if (demoted > 0 && typeof console !== "undefined") {
    console.error(
      `[qpw] ActionRow received ${demoted + 1} primary actions. One filled primary per viewport is ` +
        `the Direction D law; the extras were demoted to quiet. Fix the caller, not this warning.`,
    );
  }

  return (
    <div className="qpw-actions" data-primary-count={seenPrimary ? 1 : 0} data-demoted={demoted}>
      {mapped}
    </div>
  );
}
