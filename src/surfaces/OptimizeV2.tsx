import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AppliedChange,
  GameReadiness,
  Priorities,
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
import { buildSetupSummary, deriveReverted } from "./use-scan";
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
  priorities: Priorities | null; // feeds the setup summary (Applied — a record, V2-4b)
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
  priorities,
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

  // V2-4b IA: the drifted list (applied with Compy, since turned off outside Compy) — pure
  // derivation from the same ledger the classic drift limiter used; Fix renders each as its
  // ONE row (one-mention law).
  const reverted = useMemo(() => deriveReverted(changes), [changes]);
  // Setup summary — a record of what the check measured, so it lives with the records on
  // Applied (owner: it felt unrelated in the fixes flow). Same pure builder Check used.
  const setupSummary = buildSetupSummary(readiness, priorities);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const copySetupSummary = async () => {
    try {
      await navigator.clipboard.writeText(setupSummary);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 1500);
    } catch {
      /* clipboard blocked — the summary text stays on screen to select manually */
    }
  };
  // Upgrade path, demoted (V2-4b): rendered HERE, below the action groups, as a labeled-early
  // quiet card (Check's copy suppressed under v2Ia so demoted content never leads the room).
  // Links stay copy-only. Real development is its own future spec (Receipts Phase-C).
  const [copiedRetail, setCopiedRetail] = useState<string | null>(null);
  const copyRetailLink = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRetail(key);
      setTimeout(() => setCopiedRetail(null), 1500);
    } catch {
      /* clipboard blocked — the button tooltip already names the retailer */
    }
  };

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
                v2Ia
              />
              <Fix {...fixProps} view="fixes" v2Ia reverted={reverted} />
              {priorities?.upgrade_path && (
                <div className="ov2-upgrade">
                  <div className="ov2-upgrade-head">
                    <span className="ov2-upgrade-label">Upgrade path (advisory)</span>
                    {/* Honesty label — the owner called the link-dump underdeveloped; until the
                        per-rig evidence-gated engine is designed, the card says so plainly. */}
                    <span className="ov2-early">early — being developed</span>
                  </div>
                  {priorities.upgrade_path.items.map((item) => (
                    <div key={item.kind} className="ov2-upgrade-item">
                      <span className="ov2-upgrade-title">{item.title}</span>
                      <p className="ov2-upgrade-why">{item.why}</p>
                      <div className="ov2-upgrade-links">
                        {item.links.map((l) => (
                          <button
                            key={l.retailer}
                            type="button"
                            className="btn btn-small"
                            title={`Copies a plain ${l.retailer} search link to open in your browser. No affiliate tag today.`}
                            onClick={() => copyRetailLink(`${item.kind}-${l.retailer}`, l.url)}
                          >
                            {copiedRetail === `${item.kind}-${l.retailer}`
                              ? "Copied!"
                              : `Copy ${l.retailer} search link`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* Same truthful no-affiliate line Check renders (its guard pins the classic
                      copy) — swap BOTH to the backend disclosure in the commit that arms tags. */}
                  <p className="ov2-upgrade-disclosure">
                    Compy earns nothing from these links today — they're plain searches with no
                    affiliate tag. What you buy never affects verdicts.
                  </p>
                </div>
              )}
            </>
          )}

          {/* The Gaming Mode room (P5.5 placement law) — the same <GamingMode/> App always
              passed, in its own clearly-doored segment. The switch, QA contract, and rollback
              path are untouched. */}
          {segment === "gaming" && gamingDoored && (
            <div className="ov2-gaming">{gamingSlot}</div>
          )}

          {segment === "applied" && (
            <>
              <Fix {...fixProps} view="ledger" />
              {/* V2-4b: the setup summary is a RECORD of what the check measured, so it lives
                  here with the other records (owner: it read unrelated in the fixes flow). Same
                  pure builder + copy/export affordances Check carried; read-only, no mutation. */}
              {setupSummary && (
                <div className="ov2-summary">
                  <div className="ov2-summary-head">
                    <span className="ov2-summary-title">Setup summary</span>
                    <span className="ov2-summary-actions">
                      {onExport && (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={onExport}
                          disabled={exporting}
                        >
                          {exporting ? "Exporting…" : "Export full report"}
                        </button>
                      )}
                      <button type="button" className="btn btn-small" onClick={copySetupSummary}>
                        {copiedSummary ? "Copied ✓" : "Copy summary"}
                      </button>
                    </span>
                  </div>
                  <p className="ov2-summary-blurb">
                    A plain-English recap of what the last check measured — copy it to share your
                    setup.
                  </p>
                  <pre className="ov2-summary-text">{setupSummary}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </RoomShell>
    </SidePileContext.Provider>
  );
}

export default OptimizeV2;
