import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PriorityItem } from "../types";
import { TrustSwitch } from "../design/TrustSwitch";
import { Wordmark } from "../design/Wordmark";
import { useConfirm } from "../design/ConfirmDialog";
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
  const confirm = useConfirm();

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
    const ok = await confirm({
      title: `Apply "${rec.title}"?`,
      body: "Compy snapshots the prior state so you can roll this back anytime.",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setApplyingId(rec.id);
    try {
      await invoke("apply_recommendation", { recId: rec.id, recTitle: rec.title });
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
  const rest = limiters.slice(1);
  const greenChecks = checks.filter((c) => rowVerdict(c.status) === "ok");

  return (
    <div className={`fc-backdrop ${arcV2 ? "arc-v2" : ""}`}>
      <div className="fc-screen">
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

        {/* Scan rows — stream in as the (real) checks display, with a light sweep passing across.
            Scan phase ONLY: on verdict the run-list resolves INTO the verdict below (the green
            collapsible carries the per-check detail) — never both stacked (owner bug, 2026-07-06). */}
        {(running || phase === "scan") && (
          <ScanStream readiness={readiness} shownRows={shownRows} running={running} phase={phase} />
        )}

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
                    <span className="fc-chip fc-chip-muted">
                      Hands-on fix — no switch to flip, but Compy shows you the steps
                    </span>
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
                    <span className="fc-rest-conf">{lim.confidence[0].toUpperCase() + lim.confidence.slice(1)} confidence</span>
                  </div>
                ))}
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
