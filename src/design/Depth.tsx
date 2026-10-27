import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { useExpertView } from "./use-expert-view";
import "./Depth.css";

// P7-depth (ROADMAP Phase 7 bullet 2; Constitution §13 "One truth, several depths"): ONE shared block
// for every material conclusion. The ANSWER is always shown. The EXPLANATION (why it applies to this
// PC, and the tradeoff) is one tap. The TECHNICAL RECEIPT (exact state, mechanism, evidence,
// provenance) is one more tap — and under Expert view (`use-expert-view.ts`) both open by default,
// since that preference un-hides what Compy already knows. Presentation only: the three layers are
// three views of the same data the caller already holds; nothing here fetches or computes.
//
// Controlled `<details>`, as WalkthroughDisclosure: React state is the one source of truth for
// `open`, and a layer's children MOUNT only while it is open (a closed `<details>` still mounts its
// children otherwise, so anything with effects inside a receipt would run unseen).
export function Depth({
  answer,
  explanation,
  receipt,
  className,
  testId,
  whyLabel,
}: {
  /** Always shown. */
  answer: ReactNode;
  /** One tap. Omit when there is nothing beyond the answer to say. */
  explanation?: ReactNode;
  /** One more tap (open by default under Expert view). Omit when there is no receipt. */
  receipt?: ReactNode;
  className?: string;
  testId?: string;
  /** The explanation door's label when "Why this, for this PC" has no referent (an adopter that
   *  explains an absence, say). Default: common.depth.why. */
  whyLabel?: string;
}) {
  const { t } = useTranslation();
  const expert = useExpertView();
  const [why, setWhy] = useState(expert);
  const [rec, setRec] = useState(expert);
  // Flipping Expert view in Settings opens (or closes) every mounted block, live.
  useEffect(() => {
    setWhy(expert);
    setRec(expert);
  }, [expert]);
  return (
    <div className={`depth${className ? ` ${className}` : ""}`} data-testid={testId} data-expert={expert ? "on" : "off"}>
      <div className="depth-answer">{answer}</div>
      {explanation != null && (
        <details className="depth-layer depth-explanation" open={why} data-testid={testId ? `${testId}-why` : undefined}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setWhy((o) => !o);
            }}
          >
            {whyLabel ?? t("common.depth.why")}
          </summary>
          {why && <div className="depth-body">{explanation}</div>}
        </details>
      )}
      {receipt != null && (
        <details className="depth-layer depth-receipt" open={rec} data-testid={testId ? `${testId}-receipt` : undefined}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setRec((o) => !o);
            }}
          >
            {t("common.depth.receipt")}
          </summary>
          {rec && <div className="depth-body">{receipt}</div>}
        </details>
      )}
    </div>
  );
}

/** A signed percentage for a receipt, one decimal: "+4.2%", "-18.5%", and "0.0%" (no sign) when it
 *  rounds to zero — never "-0.0%" in one place and "+0%" in another. null when not a finite number. */
export function receiptPct(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = n.toFixed(1);
  return Number(v) === 0 ? "0.0%" : `${n > 0 ? "+" : ""}${v}%`;
}

/** A band/floor figure for a receipt: "±3%" (up to one decimal, trailing zero dropped). */
export function receiptBand(n: number | null | undefined): string | null {
  return n == null || !Number.isFinite(n) ? null : `±${Number(n.toFixed(1))}%`;
}

/** A receipt row: an exact field and its value, as recorded. Values are shown verbatim. */
export function ReceiptRow({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
