import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AppliedChange, Recommendation, SessionSummary, StartupEntry } from "../types";
import type { GpuVendor } from "./walkthroughs";
import Check from "./Check";
import Fix from "./Fix";
import { SegmentedControl } from "../design/SegmentedControl";
import { SidePileContext } from "./side-pile";
import "./Optimize.css";

// Optimize — the merged Check + Tune surface (phase 1a, spec 2026-06-21-optimize-merge-design).
// A thin shell: it owns the segmented control + the persistent "active · undo" chip + the segment
// state, and COMPOSES the existing Check and Fix surfaces verbatim (Fix gains a `view` prop so the
// same component renders fixes-only or ledger-only). No new IPC, no new mutation path, no restyle
// (V0 polish is phase 1b) — this proves the merge works before it's made beautiful.
//
// Segments (P5.5 owner critique 2026-07-02 — History's empty room removed, Gaming Mode doored):
//   • Fixes       (default) — diagnose + act: <Check> (the scan + ranked limiters) then
//                             <Fix view="fixes"> (recs / guided / startup).
//   • Gaming Mode (only when the gate is on + compy_gm_door on) — the mutation feature's own
//                             clearly-doored room; flag off ⇒ the classic inline Fixes slot.
//   • Applied     — the whole Trust Ledger room: the "active on this PC" layer + the full audit
//                             trail collapsed under one "History (N)" expander (<Fix view="ledger">).

// A GpuDriverInfo subset Check wants for driver freshness (object covariance lets GpuInfo pass).
type GpuDriverInfo = { name: string; driver_age_days: number | null };

type Segment = "fixes" | "gaming" | "applied";

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
  // Calm chrome (P5): Export rides with the scan results instead of the app header — forwarded to
  // Check's setup-summary card. Same App-owned handler + modal; only the button's home moves.
  onExport?: () => void;
  exporting?: boolean;
};

// P5.5 (owner critique 2026-07-02): the standalone History segment is GONE — the full trail now
// lives inside Applied as one collapsed "History (N)" expander (Fix view="ledger"), so there's no
// near-empty third room. "Gaming Mode" appears as its own clearly-doored segment when the gate is
// on and compy_gm_door is on (placement law: a mutation feature is a room, not a mid-scroll card).
const BASE_SEGMENTS: { id: Segment; label: string }[] = [
  { id: "fixes", label: "Fixes" },
  { id: "applied", label: "Applied" },
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
  onExport,
  exporting,
}: Props) {
  const [segment, setSegment] = useState<Segment>("fixes");

  // Calm chrome (P5, compy_calm_chrome — DEFAULT OFF): the Fixes segment's six "leave it alone"
  // piles collapse under ONE quiet "Nothing else needs attention" expander owned here; Check and
  // Fix teleport their piles in via SidePileContext (see side-pile.tsx). DOM-read + live event,
  // same pattern as the other preview flags. Flag off ⇒ no provider ⇒ classic, byte-identical.
  const [calm, setCalm] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.dataset.calmChrome === "on",
  );
  useEffect(() => {
    const on = () => setCalm(document.documentElement.dataset.calmChrome === "on");
    window.addEventListener("compy:calmchrome-changed", on);
    return () => window.removeEventListener("compy:calmchrome-changed", on);
  }, []);
  const [pileOpen, setPileOpen] = useState(false);
  // The expander body element — set via callback ref so the piles portal in only once it exists.
  const [pileHost, setPileHost] = useState<HTMLElement | null>(null);

  // Gaming Mode door (P5.5, compy_gm_door — DEFAULT ON): same DOM-read + live-event pattern as
  // calm chrome. On ⇒ Gaming Mode gets its own segment; off ⇒ the classic inline Fixes slot.
  const [gmDoor, setGmDoor] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.dataset.gmDoor === "on",
  );
  useEffect(() => {
    const on = () => setGmDoor(document.documentElement.dataset.gmDoor === "on");
    window.addEventListener("compy:gmdoor-changed", on);
    return () => window.removeEventListener("compy:gmdoor-changed", on);
  }, []);
  const gamingDoored = Boolean(gamingSlot) && gmDoor;
  const segments = gamingDoored
    ? [BASE_SEGMENTS[0], { id: "gaming" as Segment, label: "Gaming Mode" }, BASE_SEGMENTS[1]]
    : BASE_SEGMENTS;

  // The gliding active indicator (one accent pill measured from the live DOM) is now the shared
  // <SegmentedControl> — extracted to src/design so Optimize, Monitor, and future tabs use ONE
  // measured-glide control. The chip + segment-state logic below stay here (consumer-specific).

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

  // If the room the user is standing in disappears (gate off, flag flipped live), snap back to
  // Fixes rather than rendering a segment the control no longer offers.
  useEffect(() => {
    if (segment === "gaming" && !gamingDoored) setSegment("fixes");
  }, [segment, gamingDoored]);

  return (
    <section className="optimize-root">
      <header className="optimize-bar">
        <SegmentedControl
          segments={segments}
          value={segment}
          onChange={(id) => setSegment(id as Segment)}
          aria-label="Optimize sections"
        />
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
          <SidePileContext.Provider value={calm ? { host: pileHost } : null}>
            <Check
              isAppliable={isAppliable}
              onOpenLibrary={onOpenLibrary}
              onChanged={onChangedLanding}
              vendor={vendor}
              sessions={sessions}
              gpus={gpus}
              embedded
              onExport={onExport}
              exporting={exporting}
            />
            {/* Classic slot (compy_gm_door off): Gaming Mode inline on the scroll, as before. */}
            {gamingSlot && !gamingDoored && <div className="optimize-gaming">{gamingSlot}</div>}
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
            {/* THE one side-pile expander (plan §4.1: "one quiet expander swallows all the
                side-piles"). The hint names what's inside (NN/g: information scent — a bare
                chevron isn't enough). Content renders via portals from Check + Fix above. */}
            {calm && (
              <div className="optimize-sidepile">
                <button
                  type="button"
                  className="optimize-sidepile-head"
                  onClick={() => setPileOpen((o) => !o)}
                  aria-expanded={pileOpen}
                  aria-controls="optimize-sidepile-body"
                >
                  <span className="optimize-sidepile-title">Nothing else needs attention</span>
                  <span className="optimize-sidepile-hint">
                    measured fine · set aside · deliberately refused · past tweaks
                  </span>
                  <span aria-hidden="true">{pileOpen ? "▾" : "▸"}</span>
                </button>
                <div
                  id="optimize-sidepile-body"
                  className="optimize-sidepile-body"
                  hidden={!pileOpen}
                  ref={setPileHost}
                />
              </div>
            )}
          </SidePileContext.Provider>
        )}

        {/* The Gaming Mode room (P5.5): the same <GamingMode/> App always passed, in its own
            clearly-doored segment instead of mid-scroll between fixes. Placement only — the
            switch, QA contract, and rollback path are untouched. */}
        {segment === "gaming" && gamingDoored && (
          <div className="optimize-gaming optimize-gaming-room">{gamingSlot}</div>
        )}

        {segment === "applied" && (
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
            // P5.5: Applied is the ONE ledger room — the active layer up top, the full audit trail
            // collapsed under a single "History (N)" expander at the bottom (view="ledger"). The
            // standalone History segment (a near-empty third room) is gone.
            view="ledger"
          />
        )}
      </div>
    </section>
  );
}

export default Optimize;
