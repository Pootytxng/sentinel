import "./CarriedTag.css";

/**
 * "From your check" marker — this row is one the user was just shown in a check and carried here by
 * the handoff contract (`data/check-handoff.ts`).
 *
 * Presentational ONLY, and shared so every row primitive marks a carried row identically: it never
 * changes the row's control, action, or semantics. The caller owns the wording (localized).
 */
export function CarriedTag({ label }: { label: string }) {
  return <span className="cmp-carried-tag">{label}</span>;
}
