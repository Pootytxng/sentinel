import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PriorityItem } from "../types";
import { Wordmark } from "../design/Wordmark";
import { useConfirm } from "../design/ConfirmDialog";
import { useScan, rowVerdict } from "./use-scan";
import { ScanStream } from "./ScanStream";
import { BootTheater } from "./BootTheater";
import { readFirstCheckTheater } from "../design/theme";
import { useReducedMotion } from "../design/use-motion";
import { recordLastCheck } from "./last-check";
import { actionable, describePriority, type RecDetail } from "../data/rec-detail";
import { recDisplayLabel, rowDisplayLabel, rowNamesItsRec } from "../data/friendly-labels";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
import { RecDetailCard, type RecDetailCardLabels } from "../design/RecDetailCard";
import { RecNameText } from "../design/RecName";
import "./FirstCheck.css";

// Moment 2 of the first-experience arc — the first-run "first check" landing.
// Spec: docs/superpowers/specs/2026-06-04-first-experience-arc-design.md (copy VERBATIM).
// Shown once after onboarding (gated on FIRST_CHECK_KEY); later launches go straight to the app
// with a "Re-run check" affordance. The scan (real commands, honest elapsed, streamed rows) now
// lives in the shared useScan/ScanStream (one source of truth with the Check surface); this file
// keeps the arc's verdict + spotlight + copy.

export const FIRST_CHECK_KEY = "compy_first_check_v1";

// The arc's copy for the shared named-recommendation card (design/RecDetailCard). The arc is
// spec-locked English (first-run, pre-language-picker), so its wording lives here verbatim while
// the card's structure is shared with the Check tab — one grammar for a tweak, two voices.
const ARC_REC_LABELS: RecDetailCardLabels = {
  detected: "On your PC",
  what: "What it does",
  changes: "What changes",
  catch: "The catch",
  apply: "Apply",
  applying: "Applying…",
  applyAria: (title) => `Apply ${title}`,
  applied: "Already on — nothing to do here.",
  ineligibleFallback: "Not for this rig — Compy left it alone.",
  manual:
    "Compy only flips settings it can snapshot and undo for you. This one lives outside that, so you make the change.",
  manualWithSteps:
    "Compy only flips settings it can snapshot and undo for you. This one lives outside that, so you make the change — here's exactly where it lives.",
  steps: "Show me the steps",
};

// One named recommendation in the arc. The real guided steps come from the same shipped walkthrough
// system Fix and Check use; the old copy promised "Compy shows you the steps" and then showed
// nothing, so a rec with no walkthrough behind it now says so plainly instead.
function RecCard({
  d,
  showTitle,
  vendor,
  arcV2,
  busy,
  disabled,
  onApply,
}: {
  d: RecDetail;
  /** The single-rec case already shows the name as the row headline — don't repeat it. */
  showTitle: boolean;
  vendor: GpuVendor;
  arcV2: boolean;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <RecDetailCard
      d={d}
      labels={ARC_REC_LABELS}
      walkthrough={d.action === "manual" ? (walkthroughForKey(d.id) ?? null) : null}
      vendor={vendor}
      variant={arcV2 ? "switch" : "button"}
      showTitle={showTitle}
      busy={busy}
      disabled={disabled}
      onApply={onApply}
    />
  );
}

export default function FirstCheck({
  onDone,
  onGoToLab,
  isAppliable,
  vendor = "any",
  arcV2 = false,
}: {
  onDone: () => void;
  // Post-check route into the Lab's Optimize station (tester J 2026-07-22). Optional: when absent
  // the verdict shows only "Open the dashboard" (byte-identical to before this prop).
  // It hands over the EXACT rec ids this check found actionable — identity, not prose — so the
  // destination can lead with them instead of dropping the user at the top of a full surface.
  onGoToLab?: (recIds: string[]) => void;
  /** The frontend mirror of the backend's APPLIABLE_REC_IDS (App.tsx). Required to tell an
   *  applyable fix from an advisory one — without it the arc offered "Apply" on recs
   *  `apply_recommendation` can't dispatch, which throws at the IPC boundary. */
  isAppliable: (recId: string) => boolean;
  /** Picks the right walkthrough variant for this rig's GPU. */
  vendor?: GpuVendor;
  arcV2?: boolean;
}) {
  // Boot theater (T2+T4a, default ON; classic ScanStream is the failsafe). Read once at mount —
  // this is a full-screen arc, Settings can't flip beneath it. Theater tightens the reveal to
  // 200ms/row so 16 checks land inside the ~3–4s ceiling; a click skips to the verdict.
  const [theater] = useState(readFirstCheckTheater);
  const reduced = useReducedMotion();
  const { readiness, priorities, recs, running, elapsed, shownRows, phase, rerun, skip } = useScan(
    theater ? { staggerMs: 200 } : undefined,
  );
  const [greenOpen, setGreenOpen] = useState(false);
  const [openRestId, setOpenRestId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const finish = () => {
    try {
      localStorage.setItem(FIRST_CHECK_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onDone();
  };

  // What a limiter row is ACTUALLY about — resolved from the ids the payload carries
  // (PriorityItem.rec_ids), never guessed from the row's prose. An aggregate row like "2 safe tweaks
  // not applied" used to resolve to nothing and fell through to a chip promising steps it never
  // showed; now every rec behind the row comes back named, with its own honest action.
  const detailsFor = (lim: PriorityItem | null): RecDetail[] =>
    lim ? describePriority(lim, recs, isAppliable) : [];

  const applyRec = async (d: RecDetail) => {
    if (d.action !== "apply") return; // the audited path only dispatches APPLIABLE_REC_IDS
    const ok = await confirm({
      // The name the user just read on the row/card — asking "Apply <a name they've never seen>?"
      // is how a confirm dialog stops being a confirmation. The IPC call below still sends the raw
      // catalog title: the Trust Ledger and exports record what Compy really did.
      title: `Apply "${recDisplayLabel(d.id, d.title).headline}"?`,
      body: "Compy snapshots the prior state so you can roll this back anytime.",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setApplyingId(d.id);
    try {
      await invoke("apply_recommendation", { recId: d.id, recTitle: d.title });
      await rerun(); // re-run so the verdict + limiters reflect the change
    } catch (e) {
      setApplyingId(null);
      // Tell the user it didn't apply (e.g. a declined UAC prompt) instead of silently moving on.
      await confirm({
        title: "Couldn't apply that fix",
        body: String(e),
        confirmLabel: "OK",
        acknowledge: true,
      });
    } finally {
      setApplyingId(null);
    }
  };

  const checks = readiness?.checks ?? [];
  const limiters = priorities?.limiters ?? [];
  const fixCount = limiters.length;
  const top = limiters[0] ?? null;
  const topDetails = detailsFor(top);
  // When the #1 row IS a single tweak, it wears that tweak's display name — the same one the Lab
  // prints. A count row ("2 safe tweaks not applied") or a readiness observation keeps its own words.
  const topLabel = rowDisplayLabel(top?.title ?? "", topDetails);
  const rest = limiters.slice(1);
  const greenChecks = checks.filter((c) => rowVerdict(c.status) === "ok");

  // What this check found that the user can actually act on — the payload of the Lab handoff.
  // Limiter order is Compy's own ranking, so the destination inherits the priority it just showed.
  // Deduped: two rows can legitimately be about the same rec (an aggregate + its own line).
  const carriedRecIds = Array.from(
    new Set(limiters.flatMap((lim) => actionable(detailsFor(lim)).map((d) => d.id))),
  );

  // Persist the honest last-check record when a real check resolves to a verdict — Home's Re-run
  // band reads this to show "2h ago · N/N clean". Re-fires if an in-arc apply re-runs the scan (the
  // record tracks the LATEST result). The count summary is stored WITH its timestamp so the band
  // never pairs a live count with an implied time (honesty law).
  useEffect(() => {
    if (phase !== "verdict") return;
    recordLastCheck({ total: checks.length, green: greenChecks.length, fixCount });
  }, [phase, checks.length, greenChecks.length, fixCount]);

  // The arc is a full-screen overlay drawn OVER the still-mounted app (App.tsx renders it as a
  // sibling), so a keyboard user used to Tab straight off the visible verdict into the nav rail,
  // the theme picker and the whole Lab behind it — ~17 stops with nothing focused on screen
  // (self-review round 5). It's a modal in every way except the two things that say so, so it now
  // declares itself one and cycles Tab inside itself, the same contract ConfirmDialog honours.
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    backdropRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = backdropRef.current;
      if (!root) return;
      // A ConfirmDialog can open ON TOP of the arc (applying a rec from the spotlight). It renders
      // outside this backdrop and runs its own trap, so stand down rather than yanking focus off
      // its buttons.
      if (document.querySelector(".cmp-confirm-modal")) return;
      const f = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active) || active === root) {
        // Focus escaped (or sits on the backdrop itself) — pull it back in instead of letting the
        // next Tab land on background chrome the user cannot see.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  return (
    <div
      ref={backdropRef}
      className={`fc-backdrop ${arcV2 ? "arc-v2" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Compy first check"
      tabIndex={-1}
    >
      <div className={`fc-screen ${theater && (running || phase === "scan") ? "fc-screen-theater" : ""}`}>
        <header className="fc-head">
          <span className="fc-brand">
            <Wordmark size={20} />
          </span>
          <span className="fc-status">
            {running
              ? "first check · running"
              : `first check · ${checks.length} checks · ${elapsed?.toFixed(1) ?? "—"}s`}
          </span>
        </header>

        {/* Scan rows — stream in as the (real) checks display. Scan phase ONLY: on verdict the
            run-list resolves INTO the verdict below (the green collapsible carries the per-check
            detail) — never both stacked (owner bug, 2026-07-06). Theater ON: the HUD boot readout
            (active check prominent, completed stack, queued count); OFF: the classic light sweep. */}
        {(running || phase === "scan") &&
          (theater ? (
            <BootTheater
              readiness={readiness}
              shownRows={shownRows}
              running={running}
              reduced={reduced}
              onSkip={skip}
            />
          ) : (
            <ScanStream readiness={readiness} shownRows={shownRows} running={running} phase={phase} />
          ))}

        {/* Verdict — appears after the rows have streamed. */}
        {phase === "verdict" && (
          <div className="fc-verdict">
            <div className="fc-tag">VERDICT</div>
            <h1 className="fc-headline">
              {fixCount === 0
                ? "Ready to play — this rig measured clean"
                : `Ready to play — ${fixCount} thing${fixCount === 1 ? "" : "s"} worth fixing`}
            </h1>
            <p className="fc-subtitle">
              {fixCount === 0
                ? "Every check came back right — measured on this rig, not assumed."
                : `Reversible, every${fixCount === 1 ? "" : " single"} one. Everything else came back right — measured on this rig, not assumed.`}
            </p>

            {/* #1 biggest limiter spotlight */}
            {top && (
              <div className="fc-spotlight">
                <div className="fc-spotlight-tag">#1 biggest limiter</div>
                <div className="fc-spotlight-title">
                  <RecNameText label={topLabel} />
                </div>
                <p className="fc-spotlight-reason">{top.reason}</p>
                {topDetails.length === 0 ? (
                  // Nothing in the catalog behind this row (a readiness check, not a tweak). It gets
                  // the arc's honesty chip and NO action affordance — the old code showed a
                  // "Compy shows you the steps" chip here that led nowhere at all.
                  <div className="fc-spotlight-foot">
                    <span className="fc-chip">Expected impact · not yet measured on this rig</span>
                  </div>
                ) : (
                  // Each rec is NAMED with its own real data + its own honest action. The name is
                  // repeated on the card unless the row headline above IS already that rec's title
                  // (the collapsed single-rec case) — a count-only headline must never hide the
                  // tweak's identity. Every rec carries its own provenance chip, which is why the
                  // blanket "Expected impact" chip isn't stacked on top of it here.
                  <div className="fc-recs">
                    {topDetails.length > 1 && (
                      <p className="fc-recs-lede">
                        {topDetails.length} of them, and here is each one:
                      </p>
                    )}
                    {topDetails.map((d) => (
                      <RecCard
                        key={d.id}
                        d={d}
                        showTitle={!rowNamesItsRec(top.title, topDetails)}
                        vendor={vendor}
                        arcV2={arcV2}
                        busy={applyingId === d.id}
                        disabled={applyingId !== null}
                        onApply={() => applyRec(d)}
                      />
                    ))}
                  </div>
                )}
                {/* Restore guarantee — STANDING on the card, not trapped in the post-Apply confirm
                    dialog (bug→guard: a user who never clicks Apply must still see the core
                    reversibility promise). Same true promise as applyRec's confirm body; shown
                    only when there's an applyable fix (a hands-on fix has nothing for Compy to roll
                    back). Guard: FirstCheck.test.tsx "surfaces the restore-guarantee as a standing line". */}
                {topDetails.some((d) => d.action === "apply") && (
                  <p className="fc-spotlight-reversible">
                    <span className="fc-rev-mark" aria-hidden="true">
                      ↺
                    </span>
                    Compy snapshots the prior state so you can roll this back anytime.
                  </p>
                )}
              </div>
            )}

            {/* #2…N compact — expandable so a tapped row reveals WHICH tweak it is + an Apply/Fix
                affordance (bug→guard: previously a dead-end row, tester had no way to see or act
                on "1 safe tweak not applied"). */}
            {rest.length > 0 && (
              <div className="fc-rest">
                {rest.map((lim) => {
                  const open = openRestId === lim.id;
                  const details = detailsFor(lim);
                  const label = rowDisplayLabel(lim.title, details);
                  return (
                    <div key={lim.id} className="fc-rest-item">
                      <button
                        className="fc-rest-row"
                        onClick={() => setOpenRestId(open ? null : lim.id)}
                        aria-expanded={open}
                      >
                        <span className="fc-rest-title">
                          <RecNameText label={label} />
                        </span>
                        <span className="fc-rest-right">
                          <span className="fc-rest-conf">
                            {lim.confidence[0].toUpperCase() + lim.confidence.slice(1)} confidence
                          </span>
                          <span className="fc-rest-caret">{open ? "▾" : "▸"}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="fc-rest-detail">
                          <p className="fc-rest-reason">{lim.reason}</p>
                          {/* Same rule as the spotlight: name every rec behind the row and give it
                              its own real action. A row with nothing in the catalog behind it gets
                              no action affordance rather than a promise Compy can't keep. */}
                          {details.map((d) => (
                            <RecCard
                              key={d.id}
                              d={d}
                              showTitle={!rowNamesItsRec(lim.title, details)}
                              vendor={vendor}
                              arcV2={arcV2}
                              busy={applyingId === d.id}
                              disabled={applyingId !== null}
                              onApply={() => applyRec(d)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Green strip — collapsed, expandable */}
            {greenChecks.length > 0 && (
              <div className="fc-green">
                <button
                  className="fc-green-head"
                  onClick={() => setGreenOpen((o) => !o)}
                  aria-expanded={greenOpen}
                >
                  <span>{greenChecks.length} checks measured perfect — confirmed right on this rig</span>
                  <span className="fc-green-caret">{greenOpen ? "▾" : "▸"}</span>
                </button>
                {greenOpen && (
                  <div className="fc-green-list">
                    {greenChecks.map((c) => (
                      <div key={c.id} className="fc-green-row">
                        <span className="fc-row-mark fc-row-ok">✓</span>
                        <span>{c.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="fc-footer">
              Nothing else on this PC is worth touching — and Compy won't invent work to look busy.
              Play something tonight; the <strong>session debrief</strong> will tell you how it
              actually went.
            </p>

            <div className="fc-actions">
              {onGoToLab && (
                <button
                  className="fc-btn fc-btn-lab"
                  onClick={() => {
                    try {
                      localStorage.setItem(FIRST_CHECK_KEY, "1");
                    } catch {
                      /* non-fatal */
                    }
                    onGoToLab(carriedRecIds);
                  }}
                >
                  {/* Name the destination only when there IS something to do there. With nothing
                      actionable, "Take me to Optimize" would promise work that doesn't exist. */}
                  {carriedRecIds.length > 0 ? "Take me to Optimize" : "Take me to the Lab"}
                </button>
              )}
              <button className="fc-btn fc-btn-go" onClick={finish}>
                Open the dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
