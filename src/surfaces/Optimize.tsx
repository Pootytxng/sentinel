import { useState, useRef, useLayoutEffect, useEffect } from "react";
import type { ReactNode } from "react";
import type { AppliedChange, Recommendation, SessionSummary, StartupEntry } from "../types";
import type { GpuVendor } from "./walkthroughs";
import Check from "./Check";
import Fix from "./Fix";
import "./Optimize.css";

// Optimize — the merged Check + Tune surface (phase 1a, spec 2026-06-21-optimize-merge-design).
// A thin shell: it owns the segmented control + the persistent "active · undo" chip + the segment
// state, and COMPOSES the existing Check and Fix surfaces verbatim (Fix gains a `view` prop so the
// same component renders fixes-only or ledger-only). No new IPC, no new mutation path, no restyle
// (V0 polish is phase 1b) — this proves the merge works before it's made beautiful.
//
// Three segments (council-renamed from the over-promising originals):
//   • Fixes   (default) — diagnose + act: <Check> (the scan + ranked limiters) then the featured
//                         Gaming Mode slot then <Fix view="fixes"> (recs / guided / startup).
//   • Applied — the Trust Ledger "active on this PC" layer (what Compy is doing now + one-tap undo),
//               via <Fix view="applied">.
//   • History — the full audit trail, via <Fix view="history">.
// Applied and History are DISTINCT views (each segment shows what the other doesn't); the V0 visual
// treatment of these layers is phase 1b.

// A GpuDriverInfo subset Check wants for driver freshness (object covariance lets GpuInfo pass).
type GpuDriverInfo = { name: string; driver_age_days: number | null };

type Segment = "fixes" | "applied" | "history";

type Props = {
  // ── Check half (passed straight through — identical to App's <Check> wiring) ──
  isAppliable: (recId: string) => boolean;
  onOpenLibrary: (focusId?: string) => void;
  onChanged: () => void;
  vendor: GpuVendor;
  sessions?: SessionSummary[];
  gpus?: GpuDriverInfo[];
  // ── Fix half (passed straight through — identical to App's <Fix> wiring; view is set per-segment) ──
  recs: Recommendation[];
  startup: StartupEntry[];
  changes: AppliedChange[];
  busyId: string | null;
  activeChangeFor: (recId: string) => AppliedChange | undefined;
  onToggleRec: (recId: string) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  onRollback: (c: AppliedChange) => void;
  onApplyBatch: (recIds: string[]) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
  // ── Shell ──
  activeCount: number; // = compy_changes_active — drives the persistent chip
  gamingSlot?: ReactNode; // App renders <GamingMode/> here only when the gate is on
};

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "fixes", label: "Fixes" },
  { id: "applied", label: "Applied" },
  { id: "history", label: "History" },
];

export function Optimize({
  isAppliable,
  onOpenLibrary,
  onChanged,
  vendor,
  sessions = [],
  gpus = [],
  recs,
  startup,
  changes,
  busyId,
  activeChangeFor,
  onToggleRec,
  onToggleStartup,
  onRollback,
  onApplyBatch,
  activeCount,
  gamingSlot,
}: Props) {
  const [segment, setSegment] = useState<Segment>("fixes");

  // Gliding active indicator (phase 1b motion): ONE accent pill that smoothly travels between segments
  // on selection — the satisfying "react to the interaction" motion, purposeful not playful. Measured
  // from the live DOM (offsetLeft/Width of the selected tab) so it fits any label width; useLayoutEffect
  // seats it before paint (no first-frame jump) and a ResizeObserver re-seats it on layout changes.
  const segmentsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number; ready: boolean }>({ left: 0, width: 0, ready: false });
  const measurePill = () => {
    const el = segmentsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  };
  useLayoutEffect(measurePill, [segment]);
  useEffect(() => {
    const c = segmentsRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measurePill);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Land-on-Applied (council Contrarian: the panic-user must see undo, not "apply more"). Every apply
  // entry point — a worth-fixing toggle, the batch, Check's inline limiter/drift applies (which fire
  // onChanged) — switches the shell to the Applied segment. Rollback is NOT an apply, so onRollback is
  // passed through untouched (no yank away from where the user is undoing).
  const landOnApplied = () => setSegment("applied");
  const onToggleRecLanding = (recId: string) => {
    onToggleRec(recId); // routed through unchanged — same audited apply/rollback path
    landOnApplied();
  };
  const onApplyBatchLanding = (recIds: string[]) => {
    landOnApplied();
    return onApplyBatch(recIds);
  };
  const onChangedLanding = () => {
    onChanged();
    landOnApplied();
  };

  return (
    <section className="optimize-root">
      <header className="optimize-bar">
        <div className="optimize-segments" role="tablist" aria-label="Optimize sections" ref={segmentsRef}>
          {/* the gliding accent pill — sits behind the active tab's text, glides to the selection */}
          <span
            className="optimize-indicator"
            aria-hidden="true"
            style={{ transform: `translateX(${pill.left}px)`, width: `${pill.width}px`, opacity: pill.ready ? 1 : 0 }}
          />
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={segment === s.id}
              className={`optimize-segment ${segment === s.id ? "optimize-segment-on" : ""}`}
              onClick={() => setSegment(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/* Persistent active-changes affordance (council First-Principles: rollback is one glance from
            anywhere, not buried at the bottom of a tab). Hidden when nothing is active. */}
        {activeCount > 0 && (
          <button
            className="optimize-chip"
            onClick={landOnApplied}
            title="See what Compy has active and roll any of it back"
          >
            <span className="optimize-chip-count">{activeCount}</span> active · undo
          </button>
        )}
      </header>

      <div className="optimize-body">
        {segment === "fixes" && (
          <>
            <Check
              isAppliable={isAppliable}
              onOpenLibrary={onOpenLibrary}
              onChanged={onChangedLanding}
              vendor={vendor}
              sessions={sessions}
              gpus={gpus}
            />
            {gamingSlot && <div className="optimize-gaming">{gamingSlot}</div>}
            <Fix
              recs={recs}
              startup={startup}
              changes={changes}
              busyId={busyId}
              isAppliable={isAppliable}
              activeChangeFor={activeChangeFor}
              onToggleRec={onToggleRecLanding}
              onToggleStartup={onToggleStartup}
              onRollback={onRollback}
              onApplyBatch={onApplyBatchLanding}
              onOpenLibrary={onOpenLibrary}
              vendor={vendor}
              view="fixes"
            />
          </>
        )}

        {(segment === "applied" || segment === "history") && (
          <Fix
            recs={recs}
            startup={startup}
            changes={changes}
            busyId={busyId}
            isAppliable={isAppliable}
            activeChangeFor={activeChangeFor}
            onToggleRec={onToggleRecLanding}
            onToggleStartup={onToggleStartup}
            onRollback={onRollback}
            onApplyBatch={onApplyBatchLanding}
            onOpenLibrary={onOpenLibrary}
            vendor={vendor}
            // Applied = the active layer ("what's on now"); History = the full audit trail. Distinct
            // views, not a mirror — the third segment shows something the second doesn't.
            view={segment === "history" ? "history" : "applied"}
          />
        )}
      </div>
    </section>
  );
}

export default Optimize;
