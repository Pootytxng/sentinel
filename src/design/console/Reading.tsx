/* Console kit — Reading. ONE measured fact, stated three ways: what it is, what it reads, and
   whether we actually measured it. Promoted out of HomeConsole.tsx (issue #49 slice 3) unchanged in
   behaviour; Health proved it over eleven self-review rounds and Live/History/Test all state the
   same kind of fact, so the pattern belongs where the next room will find it instead of being
   re-derived — re-deriving it is what rounds 6–11 were.

   HONESTY (the reason this component exists at all): `value == null` is a real state, not a zero,
   and it never renders as one. A measured cell prints its number and the MEASURED attestation; an
   unmeasured cell prints the em-dash pair and, in that same slot, WHY there is no reading — the
   caller's own plain-English line where it has one (Health's CPU temp keeps its "see below", the
   C-19 dead-end fix travelling with the fact), otherwise ArcGauge's own "no reading". Two shapes,
   never a third, and never a zero. */
import React from "react";
import { useTranslation } from "react-i18next";
import type { ArcTone } from "./ArcGauge";
import "./reading.css";

/** THE PARENT CONTRACT, and it is not optional.
 *
 *  A Reading renders exactly these three rows — label, value, attestation — and subgrids onto its
 *  PARENT's rows rather than sizing its own. That is what keeps a row of readings a row: row 1 is
 *  as tall as the tallest LABEL across the whole strip, so a label that wraps to two lines in one
 *  language cannot push only its own value down and stagger the line of numbers. Health shipped the
 *  staggered version and a full self-review round was spent finding it (round 10, 1280x720, "GPU
 *  TEMP" wrapping where "AVG FPS" did not).
 *
 *  So a strip that places Readings MUST:
 *    1. be `display: grid` with exactly READING_ROWS row tracks, and
 *    2. give every sibling cell that is NOT a Reading (an ArcGauge wrapper, say) the same
 *       `grid-row: span READING_ROWS`, or that sibling sits in the label's row alone.
 *  Widening the columns is NOT an alternative fix: there is no width to give at 1280x720, and the
 *  next translation wraps a different label anyway.
 *
 *  Where subgrid is unavailable the declaration is ignored and each cell falls back to its own
 *  three auto rows — the old behaviour, not a broken one.
 *
 *  Exported as a number so the guards can assert the CSS `span N` and a consumer strip's track
 *  count against ONE source instead of three hand-copied 3s. */
export const READING_ROWS = 3;

export function Reading({
  id,
  label,
  value,
  unit,
  tone = "neutral",
  note,
}: {
  /** Stable name for this reading, on `data-read`. It is what the honesty guards anchor to, and it
      is the reason they survived the move off Health's canvas: they used to select the CORNER a
      gauge was pinned to (.hc-tl/.hc-tr/.hc-bl/.hc-br), so re-laying-out the room silently unhooked
      them. A reading's identity is which fact it states, never where it sits. */
  id: string;
  /** ReactNode so a caller can gloss jargon inline (the <Term> on "1% low"). */
  label: React.ReactNode;
  value: number | null;
  /** Short only (°C, fps) — the same rail as ArcGauge's unit.length <= 3. */
  unit?: string;
  /** ArcGauge's own ArcTone, through the caller's arcTone() map — not a second scale. */
  tone?: ArcTone;
  /** This reading's specific reason for having no reading, when it has one to give. */
  note?: string;
}) {
  const { t } = useTranslation();
  const empty = value == null;
  return (
    <div className={`reading rd-${tone} ${empty ? "rd-empty" : ""}`} data-read={id}>
      <span className="rd-label">{label}</span>
      <span className="rd-v">
        {/* The number is its own node so the unit never rides along in its text — the honesty
            guards read this span and compare it to the reading they expect. */}
        {/* ONE em dash (2026-08-23, comp fidelity): the comps draw a single rule where a number
            would be. The doubled dash was reading as a redacted value rather than an absent one,
            and it is wider than any real reading in the strip, so the empty cell was the loudest
            thing in a row of measurements. */}
        <span className="rd-n">{empty ? "—" : Math.round(value)}</span>
        {!empty && unit && <span className="rd-u">{unit}</span>}
      </span>
      {empty ? (
        <span className="rd-none">{note ?? t("common.arcGauge.noReading")}</span>
      ) : (
        <span className="rd-tag">{t("common.arcGauge.measured")}</span>
      )}
    </div>
  );
}
