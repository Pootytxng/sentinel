import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PriorityItem } from "../types";
import { TrustSwitch } from "../design/TrustSwitch";
import { PulseC } from "../design/PulseC";
import { useScan, rowVerdict, type ScanRecLite } from "./use-scan";
import { ScanStream } from "./ScanStream";
import "./FirstCheck.css";

// Moment 2 of the first-experience arc — the first-run "first check" landing.
// Spec: docs/superpowers/specs/2026-06-04-first-experience-arc-design.md (copy VERBATIM).
// Shown once after onboarding (gated on FIRST_CHECK_KEY); later launches go straight to the app
// with a "Re-run check" affordance. The scan (real commands, honest elapsed, streamed rows) now
// lives in the shared useScan/ScanStream (one source of truth with the Check surface); this file
// keeps the arc's verdict + spotlight + copy.

export const FIRST_CHECK_KEY = "compy_first_check_v1";

export default function FirstCheck({ onDone, arcV2 = false }: { onDone: () => void; arcV2?: boolean }) {
  const { readiness, priorities, recs, running, elapsed, shownRows, phase, rerun } = useScan();
  const [greenOpen, setGreenOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const finish = () => {
    try {
      localStorage.setItem(FIRST_CHECK_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onDone();
  };

  const recFor = (lim: PriorityItem | null): ScanRecLite | null => {
    if (!lim) return null;
    const id = lim.linked ?? lim.id;
    const rec = recs.find((r) => r.id === id);
    return rec && !rec.currently_applied ? rec : null;
  };

  const applyLimiter = async (lim: PriorityItem) => {
    const rec = recFor(lim);
    if (!rec) return;
    if (
      !window.confirm(
        `Apply "${rec.title}"?\n\nCompy snapshots the prior state so you can roll this back at any time.`,
      )
    )
      return;
    setApplyingId(rec.id);
    try {
      await invoke("apply_recommendation", { recId: rec.id, recTitle: rec.title });
      await rerun(); // re-run so the verdict + limiters reflect the change
    } catch {
      /* reload surfaces state */
    } finally {
      setApplyingId(null);
    }
  };

  const checks = readiness?.checks ?? [];
  const limiters = priorities?.limiters ?? [];
  const fixCount = limiters.length;
  const top = limiters[0] ?? null;
  const rest = limiters.slice(1);
  const greenChecks = checks.filter((c) => rowVerdict(c.status) === "ok");

  return (
    <div className={`fc-backdrop ${arcV2 ? "arc-v2" : ""}`}>
      <div className="fc-screen">
        <header className="fc-head">
          <span className="fc-brand">
            {arcV2 && <PulseC size={20} />}
            Compy
          </span>
          <span className="fc-status">
            {running
              ? "first check · running"
              : `first check · ${checks.length} checks · ${elapsed?.toFixed(1) ?? "—"}s`}
          </span>
        </header>

        {/* Scan rows — stream in as the (real) checks display, with a light sweep passing across. */}
        <ScanStream readiness={readiness} shownRows={shownRows} running={running} phase={phase} />

        {/* Verdict — appears after the rows have streamed. */}
        {phase === "verdict" && (
          <div className="fc-verdict">
            <div className="fc-tag">VERDICT</div>
            <h1 className="fc-headline">
              {fixCount === 0
                ? "Ready to play — nothing worth fixing today"
                : `Ready to play — ${fixCount} thing${fixCount === 1 ? "" : "s"} worth fixing`}
            </h1>
            <p className="fc-subtitle">
              {fixCount === 0
                ? "Everything on this rig is already where it should be."
                : "Both reversible. Everything else on this rig is already where it should be."}
            </p>

            {/* #1 biggest limiter spotlight */}
            {top && (
              <div className="fc-spotlight">
                <div className="fc-spotlight-tag">#1 BIGGEST LIMITER</div>
                <div className="fc-spotlight-title">{top.title}</div>
                <p className="fc-spotlight-reason">{top.reason}</p>
                <div className="fc-spotlight-foot">
                  <span className="fc-chip">Expected impact · not yet measured on this rig</span>
                  {recFor(top) ? (
                    arcV2 ? (
                      // The shared trust-switch, label-less to introduce no copy into the locked arc;
                      // it triggers the SAME applyLimiter flow as the classic button.
                      <TrustSwitch
                        applied={false}
                        busy={applyingId === recFor(top)?.id}
                        onToggle={() => applyLimiter(top)}
                        ariaLabel={`Apply ${top.title}`}
                      />
                    ) : (
                      <button
                        className="fc-btn fc-btn-primary"
                        disabled={applyingId !== null}
                        onClick={() => applyLimiter(top)}
                      >
                        {applyingId === recFor(top)?.id ? "Applying…" : "Apply"}
                      </button>
                    )
                  ) : (
                    <span className="fc-chip fc-chip-muted">advisory — no one-click change</span>
                  )}
                </div>
              </div>
            )}

            {/* #2…N compact */}
            {rest.length > 0 && (
              <div className="fc-rest">
                {rest.map((lim) => (
                  <div key={lim.id} className="fc-rest-row">
                    <span className="fc-rest-title">{lim.title}</span>
                    <span className="fc-rest-conf">{lim.confidence} confidence</span>
                  </div>
                ))}
              </div>
            )}

            {/* Green strip — collapsed, expandable */}
            {greenChecks.length > 0 && (
              <div className="fc-green">
                <button className="fc-green-head" onClick={() => setGreenOpen((o) => !o)}>
                  <span>{greenChecks.length} checks already perfect — nothing to sell you here</span>
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
