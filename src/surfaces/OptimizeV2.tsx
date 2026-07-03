import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  AppliedChange,
  GameReadiness,
  Recommendation,
  SessionSummary,
  StartupEntry,
} from "../types";
import type { GpuVendor } from "./walkthroughs";
import Check from "./Check";
import Fix from "./Fix";
import { RoomShell } from "../design/room-shell";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { SidePileContext } from "./side-pile";
import { optimizeVerdict, optimizeMeasuredLine } from "./optimize-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "./optimize-v2.css";

// OptimizeV2 (V2-4, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Optimize room on the V2
// shell, laid out per the owner-approved mockup: verdict → measured line → segments (the room's
// working areas) → quiet "nothing else needs attention" expander → forward door (RoomShell
// provides the door from DOOR_MAP: fix → Monitor, "Watch it live").
//
// This is the classic Optimize shell's EXACT composition on RoomShell — Check and Fix render
// verbatim with the same props and the same audited apply/rollback handlers (no new mutation
// path, zero new IPC). What's new is presentation only: the verdict/measured lines are pure
// derivations from the same real data (optimize-v2-data.ts), the "N active · undo" chip becomes
// the room's one primary action (navigation-only — the council's rollback-one-glance-away rule,
// v2 skin), and the side-pile expander moves into RoomShell's quiet slot. The classic surfaces
// re-skin via the token re-point in optimize-v2.css — the SAME mechanism the five instrument
// themes use, so TrustSwitch/GamingMode internals stay byte-untouched.

type GpuDriverInfo = { name: string; driver_age_days: number | null };

type Segment = "fixes" | "gaming" | "applied";

type Props = {
  // ── Check half (identical to the classic Optimize wiring) ──
  isAppliable: (recId: string) => boolean;
  onOpenLibrary: (focusId?: string) => void;
  onChanged: () => void;
  vendor: GpuVendor;
  sessions?: SessionSummary[];
  gpus?: GpuDriverInfo[];
  // ── Fix half (identical; view set per segment) ──
  // recs stays nullable here (unlike the classic shell) so the verdict can tell "still
  // checking" from "measured zero" — the honest loading state.
  recs: Recommendation[] | null;
  startup: StartupEntry[];
  changes: AppliedChange[];
  busyId: string | null;
  activeChangeFor: (recId: string) => AppliedChange | undefined;
  onToggleRec: (recId: string) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  onRollback: (c: AppliedChange) => void;
  onApplyBatch: (
    recIds: string[],
  ) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
  // ── Room shell ──
  readiness: GameReadiness | null; // feeds the measured provenance line
  activeCount: number;
  gamingSlot?: ReactNode; // App renders <GamingMode/> here only when the gate is on
  onExport?: () => void;
  exporting?: boolean;
};

const BASE_SEGMENTS: { id: Segment; label: string }[] = [
  { id: "fixes", label: "Fixes" },
  { id: "applied", label: "Applied" },
];

export function OptimizeV2({
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
  readiness,
  activeCount,
  gamingSlot,
  onExport,
  exporting,
}: Props) {
  const reduced = useReducedMotion();
  const [segment, setSegment] = useState<Segment>("fixes");
  const [pileOpen, setPileOpen] = useState(false);
  const [pileHost, setPileHost] = useState<HTMLElement | null>(null);
  const recList = recs ?? [];

  const gamingDoored = Boolean(gamingSlot);
  const segments = gamingDoored
    ? [BASE_SEGMENTS[0], { id: "gaming" as Segment, label: "Gaming Mode" }, BASE_SEGMENTS[1]]
    : BASE_SEGMENTS;

  // Land-on-Applied (council Contrarian, same contract as the classic shell): every apply entry
  // point switches to Applied so the panic-user sees undo, not "apply more". Rollback is NOT an
  // apply — onRollback passes through untouched.
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

  // If the room the user is standing in disappears (gate off), snap back to Fixes.
  useEffect(() => {
    if (segment === "gaming" && !gamingDoored) setSegment("fixes");
  }, [segment, gamingDoored]);

  const verdict = optimizeVerdict(recs, isAppliable, activeCount);
  const measured = optimizeMeasuredLine(readiness, recs);

  const fixProps = {
    recs: recList,
    startup,
    changes,
    busyId,
    isAppliable,
    activeChangeFor,
    onToggleRec: onToggleRecLanding,
    onToggleStartup,
    onRollback,
    onApplyBatch: onApplyBatchLanding,
    onOpenLibrary,
    vendor,
  };

  return (
    <SidePileContext.Provider value={{ host: pileHost }}>
      <RoomShell
        room="fix"
        verdict={
          reduced || !verdict.settled ? (
            verdict.headline
          ) : (
            // The "measurement arriving" moment (adopt list: verdict lines ONLY) — resolves
            // character-by-character once the catalog has actually settled. The text is the
            // pure helper's real output; the animation never alters what is claimed.
            <DecryptedText
              key={verdict.headline}
              text={verdict.headline}
              animateOn="view"
              sequential
              speed={22}
              useOriginalCharsOnly
            />
          )
        }
        sub={verdict.sub}
        measured={measured}
        primaryAction={
          activeCount > 0 ? (
            <button
              type="button"
              className="ov2-chip"
              onClick={landOnApplied}
              title="See what Compy has active and roll any of it back"
            >
              <span className="ov2-chip-count">{activeCount}</span> active · undo
            </button>
          ) : undefined
        }
        quiet={
          segment === "fixes" ? (
            <>
              {/* THE one quiet expander (P5 calm chrome): the six "leave it alone" piles from
                  Check + Fix portal their existing markup in via SidePileContext. The head names
                  what's inside (information scent) — no invented item count. */}
              <button
                type="button"
                className="v2-quiet"
                onClick={() => setPileOpen((o) => !o)}
                aria-expanded={pileOpen}
                aria-controls="ov2-sidepile-body"
              >
                <span aria-hidden="true">{pileOpen ? "▾" : "▸"}</span>
                Nothing else needs attention
                <span className="ov2-quiet-hint">
                  measured fine · set aside · deliberately refused · past tweaks
                </span>
              </button>
              <div
                id="ov2-sidepile-body"
                className="ov2-sidepile-body"
                hidden={!pileOpen}
                ref={setPileHost}
              />
            </>
          ) : undefined
        }
      >
        <div className="ov2-bar">
          <SegmentedControl
            segments={segments}
            value={segment}
            onChange={(id) => setSegment(id as Segment)}
            aria-label="Optimize sections"
          />
        </div>

        <div className="ov2-body">
          {segment === "fixes" && (
            <>
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
              <Fix {...fixProps} view="fixes" />
            </>
          )}

          {/* The Gaming Mode room (P5.5 placement law) — the same <GamingMode/> App always
              passed, in its own clearly-doored segment. The switch, QA contract, and rollback
              path are untouched. */}
          {segment === "gaming" && gamingDoored && (
            <div className="ov2-gaming">{gamingSlot}</div>
          )}

          {segment === "applied" && <Fix {...fixProps} view="ledger" />}
        </div>
      </RoomShell>
    </SidePileContext.Provider>
  );
}

export default OptimizeV2;
