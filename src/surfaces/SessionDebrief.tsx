import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  SessionSummary,
  Priorities,
  Recommendation,
  AppliedChange,
  ComparisonResult,
} from "../types";
import { Term } from "../design/Term";
import { useConfirm } from "../design/ConfirmDialog";
import { TuningDebrief } from "./TuningDebrief";
import { type GpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, gradeGpuTempC, gradeColor, type Grade } from "../data/metric-grade";
import { readDisplayRefreshHz } from "../design/theme";

// Session debrief cluster — extracted verbatim from App.tsx so it can render in place inside Play
// (halfway-home §1, owner-greenlit). Locked copy unchanged. Styles are global (App.css / arc).

function CmpReceipt({ label, before, after }: { label: string; before: number; after: number }) {
  const max = Math.max(before, after, 1);
  return (
    <div className="cmp-receipt">
      <span className="cmp-receipt-label">{label}</span>
      <div className="cmp-receipt-bars">
        <div className="cmp-bar cmp-bar-before" style={{ width: `${(before / max) * 100}%` }}>
          <span>{before.toFixed(0)}</span>
        </div>
        <div className="cmp-bar cmp-bar-after" style={{ width: `${(after / max) * 100}%` }}>
          <span>{after.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}

// The comparison verdict card. Replaces the debrief insight box once an armed comparison resolves.
// Null result = neutral (never red): the instrument working. Win = same layout + evidence standard,
// credit split. Regressed = honest, revert-forward.
function ComparisonCard({
  r,
  nextSuspect,
  onRevert,
  onDismiss,
  reverting,
  arcV2 = false,
}: {
  r: ComparisonResult;
  nextSuspect: string | null;
  onRevert: () => void;
  onDismiss: () => void;
  reverting: boolean;
  arcV2?: boolean;
}) {
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  // Only these verdicts are a fair measured comparison — confounded/expired show no numbers.
  const isMeasured =
    r.verdict === "no-change" || r.verdict === "improved" || r.verdict === "regressed";
  // Show the delta in both units — FPS (what you feel) and % (what the noise floor is in).
  const dAvgFps = Math.round(r.after_avg_fps - r.baseline_avg_fps);
  const dLowFps = Math.round(r.after_low1_fps - r.baseline_low1_fps);
  const deltaLine = `Δ avg ${sign(dAvgFps)} FPS (${sign(r.delta_avg_pct)}%) · 1% low ${sign(
    dLowFps,
  )} FPS (${sign(r.delta_low1_pct)}%) — ${
    r.verdict === "no-change" ? "inside" : "outside"
  } the ±${r.noise_floor_pct}% noise floor`;

  return (
    <div className={`cmp cmp-${r.verdict}${arcV2 ? " arc-v2" : ""}`}>
      <div className="cmp-head">
        <span>COMPARISON · {r.rec_title} · two {r.game} sessions</span>
        <span className="cmp-nf">noise floor ±{r.noise_floor_pct}%</span>
      </div>

      {r.verdict === "no-change" && (
        <>
          <h2 className="cmp-headline">No measurable change</h2>
          <p className="cmp-sub">
            The difference is smaller than this rig's own session-to-session noise. Claiming a win
            here would be lying.
          </p>
        </>
      )}
      {r.verdict === "improved" && (
        <>
          <h2 className="cmp-headline cmp-win">
            Measured improvement — {sign(r.delta_low1_pct)}% on your{" "}
            <Term id="one-percent-lows">1% low</Term>
          </h2>
          <p className="cmp-sub">
            Measured on this rig, in {r.game}, above its own noise across these two sessions — a real
            signal, not a guarantee for every game or session. You applied it; Compy measured it.
          </p>
        </>
      )}
      {r.verdict === "regressed" && (
        <>
          <h2 className="cmp-headline cmp-bad">This made it worse here</h2>
          <p className="cmp-sub">
            Your 1% low dropped past the <Term id="noise-floor">noise floor</Term> in {r.game}. No
            spin — take it back.
          </p>
        </>
      )}
      {r.verdict === "confounded" && (
        <>
          <h2 className="cmp-headline">Can't call this one</h2>
          <p className="cmp-sub">
            Other changes landed between these two sessions — this delta can't be honestly attributed
            to {r.rec_title}. No credit either way.
          </p>
        </>
      )}
      {r.verdict === "expired" && (
        <>
          <h2 className="cmp-headline">Baseline too old to compare</h2>
          <p className="cmp-sub">
            This was armed too long ago to compare fairly — drivers, games, and Windows move on.
            Re-arm fresh from a new debrief.
          </p>
        </>
      )}

      {isMeasured && (
        <>
          <div className="cmp-receipts">
            <CmpReceipt label="Avg FPS" before={r.baseline_avg_fps} after={r.after_avg_fps} />
            <CmpReceipt label="1% low" before={r.baseline_low1_fps} after={r.after_low1_fps} />
          </div>
          <p className="cmp-delta">{deltaLine}</p>
        </>
      )}

      {r.verdict === "no-change" && (
        <div className="cmp-means">
          That's a real answer, not a failure — a lesser tool would have called this a win. One
          suspect cleared: <strong>your dips aren't {r.rec_title.toLowerCase()}.</strong> It didn't
          help this game; it may still help heavier ones. Keep it or take it back — one click either
          way.
        </div>
      )}

      <div className="cmp-actions">
        {nextSuspect && (
          <button className="btn-small" onClick={onDismiss}>
            Chase suspect #2 — {nextSuspect}
          </button>
        )}
        {r.verdict === "improved" ? (
          <button className="btn-small btn-small-on" onClick={onDismiss}>
            Keep it — measured win, logged
          </button>
        ) : (
          <button className="btn-small" disabled={reverting} onClick={onRevert}>
            {reverting ? "Reverting…" : "Revert it — no shame"}
          </button>
        )}
      </div>

      <div className="cmp-tally">honest answers: 1 · fake wins sold: 0</div>
    </div>
  );
}

// Moment 3 verdict bands from the 1%-low/avg ratio. The ~0.60 band copy is verbatim from the spec;
// the others are conservative extrapolations (tunable) — see the spec's "conservative, tunable" note.
// Owner-tunable bands (set 2026-06-04). The middle subtitle is the spec's verbatim line.
function verdictBand(ratio: number): { h: string; sub: string } {
  const pct = Math.round(ratio * 100);
  if (ratio >= 0.75)
    return {
      h: "Smooth session",
      sub: `Even your worst moments held at ${pct}% of your average — steady.`,
    };
  if (ratio >= 0.55)
    return {
      h: "Mostly smooth — dips under pressure",
      sub: `High average, but your worst moments ran at ${pct}% of it. That gap is what stutter feels like.`,
    };
  return {
    h: "Rough — frequent stutter",
    sub: `Your worst moments dropped to ${pct}% of your average — that gap is felt as stutter.`,
  };
}

// Moment 3 — session debrief card (first-experience arc). The most-recent session, read honestly:
// verdict sentence, four tiles (1% low always labeled an estimate), at most ONE insight, a
// context strip, and the #1-fix CTA. Copy verbatim from the spec where the spec specifies it.
export function SessionDebrief({
  s,
  priorities,
  recs,
  apply,
  busyId,
  onExport,
  changes,
  rollback,
  arcV2 = false,
  vendor,
  sessions,
}: {
  s: SessionSummary;
  priorities: Priorities | null;
  recs: Recommendation[];
  apply: (rec: Recommendation) => Promise<void>;
  busyId: string | null;
  onExport: () => void;
  changes: AppliedChange[];
  rollback: (c: AppliedChange) => Promise<void>;
  arcV2?: boolean;
  /** Tuning before/after (spec 2026-06-08) — provided only where the full session list + GPU vendor
   *  are available (Play). Absent → the tuning cluster doesn't render (classic Sessions tab). */
  vendor?: GpuVendor;
  sessions?: SessionSummary[];
}) {
  const [ctxOpen, setCtxOpen] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [reverting, setReverting] = useState(false);
  const confirm = useConfirm();
  // Show a resolved comparison only if it's for THIS session's game (Moment 4). A TUNING result is
  // NOT a fix comparison — it has no ledger entry to revert — so it's excluded here and rendered by
  // the dedicated TuningDebrief instead (no duplicate card, no meaningless revert button).
  useEffect(() => {
    invoke<ComparisonResult | null>("get_latest_comparison")
      .then((c) => setComparison(c && c.game === s.process_name && c.kind !== "tuning" ? c : null))
      .catch(() => {});
  }, [s.process_name]);
  const ratio = s.avg_fps > 0 ? Math.min(1, s.low1_fps_est / s.avg_fps) : 1;
  const v = verdictBand(ratio);

  const fmtDur = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
  };
  const when = new Date(s.started_at);
  const end = new Date(when.getTime() + s.duration_secs * 1000);
  const range = `${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${end.toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit" },
  )}`;

  // At most ONE insight: (a) GPU-vs-system hint, (b) prime-suspect open limiter, else none.
  const topLimiter = priorities?.limiters?.[0] ?? null;
  const gpuLoafed = s.peak_gpu_usage_pct != null && s.peak_gpu_usage_pct < 70 && ratio < 0.7;
  let insight: string | null = null;
  if (gpuLoafed) {
    insight = `Your GPU only reached ${s.peak_gpu_usage_pct}% at its peak while frames dipped — so the GPU probably isn't the bottleneck here. Prime suspect: a CPU or system limiter.`;
  } else if (topLimiter && ratio < 0.75) {
    insight = `Prime suspect: ${topLimiter.title.toLowerCase()}. ${topLimiter.reason}`;
  }
  // A concrete stutter correlation outranks the generic insight for the single "one thing" slot.
  const shownInsight = s.stutter_insight || insight;

  const topRec = topLimiter
    ? recs.find((r) => r.id === (topLimiter.linked ?? topLimiter.id))
    : undefined;
  const canArm = !!topRec && !topRec.currently_applied;
  const cleanSession = ratio >= 0.75 && !shownInsight && !canArm;

  const nextSuspect = priorities?.limiters?.[1]?.title ?? null;
  const dismissCmp = async () => {
    await invoke("dismiss_comparison").catch(() => {});
    setComparison(null);
  };
  const revertCmp = async () => {
    const active = changes.find((c) => c.rec_id === comparison?.rec_id && c.is_still_active);
    if (active) {
      setReverting(true);
      await rollback(active);
      setReverting(false);
    }
    await dismissCmp();
  };

  return (
    <div className={`debrief${arcV2 ? " arc-v2" : ""}`}>
      <div className="debrief-head">
        <span className="debrief-title">
          {s.process_name || "Last session"} · {fmtDur(s.duration_secs)} · {range}
        </span>
        <button className="btn-small" onClick={onExport}>
          Share
        </button>
      </div>

      <h2 className="debrief-verdict">{v.h}</h2>
      <p className="debrief-sub">{v.sub}</p>

      <div className="debrief-tiles">
        <DebriefTile
          label={<Term id="hz-vs-fps">Avg FPS</Term>}
          value={s.avg_fps.toFixed(0)}
          grade={gradeFps(s.avg_fps, { refreshHz: readDisplayRefreshHz() })}
        />
        <DebriefTile
          label={<Term id="one-percent-lows">1% low</Term>}
          value={s.low1_fps_est.toFixed(0)}
          note="estimate"
          grade={gradeLow1(s.low1_fps_est, s.avg_fps)}
        />
        {/* Peak GPU is utilization — left neutral on purpose (high is good while gaming). */}
        <DebriefTile
          label="Peak GPU"
          value={s.peak_gpu_usage_pct == null ? "—" : `${s.peak_gpu_usage_pct}%`}
        />
        <DebriefTile
          label="Peak temp"
          value={s.peak_gpu_temp_c == null ? "—" : `${s.peak_gpu_temp_c}°C`}
          grade={gradeGpuTempC(s.peak_gpu_temp_c)}
        />
      </div>

      {comparison ? (
        <ComparisonCard
          r={comparison}
          nextSuspect={nextSuspect}
          onRevert={revertCmp}
          onDismiss={dismissCmp}
          reverting={reverting}
          arcV2={arcV2}
        />
      ) : (
        shownInsight && (
          <div className="debrief-insight">
            <div className="debrief-insight-tag">THE ONE THING WORTH KNOWING</div>
            <p>{shownInsight}</p>
          </div>
        )
      )}

      {/* Tuning before/after — temp + stability delta beside the FPS delta (spec §3). Read-only +
          advisory: arming records a vendor-tool undervolt session-side, never a mutating ledger entry. */}
      {vendor && sessions && <TuningDebrief s={s} vendor={vendor} sessions={sessions} />}

      <div className="debrief-ctx">
        <button
          className="debrief-ctx-head"
          onClick={() => setCtxOpen((o) => !o)}
          aria-expanded={ctxOpen}
        >
          <span>During this session: {s.compy_changes_active} Compy changes active</span>
          <span>{ctxOpen ? "▾" : "▸"}</span>
        </button>
        {ctxOpen && (
          <div className="debrief-ctx-body">
            <div>
              capture · <Term id="etw">ETW</Term>, external — no injection
            </div>
            {s.hw_fingerprint && (
              <div>
                rig · {s.hw_fingerprint.gpu || "GPU —"} · {s.hw_fingerprint.ram_gb}GB
                {s.hw_fingerprint.display ? ` · ${s.hw_fingerprint.display}` : ""}
              </div>
            )}
            {s.compy_changes_active === 0 && (
              <div>0 changes active — you played on stock settings (an honest baseline).</div>
            )}
          </div>
        )}
      </div>

      {canArm && topRec ? (
        <button
          className="debrief-cta"
          disabled={busyId !== null}
          onClick={async () => {
            // Don't silently clobber a pending comparison — confirm before replacing its baseline.
            const existing = await invoke<{
              rec_id: string;
              rec_title: string;
              game: string;
            } | null>("get_armed_comparison").catch(() => null);
            if (
              existing &&
              (existing.rec_id !== topRec.id || existing.game !== s.process_name)
            ) {
              const ok = await confirm({
                title: "Replace the armed comparison?",
                body:
                  `A comparison is already armed (${existing.rec_title} · ${existing.game}). ` +
                  "Applying this replaces that baseline with a fresh one.",
                confirmLabel: "Replace & apply",
              });
              if (!ok) return; // keep the pending comparison; don't apply a confounding change
            }
            await apply(topRec);
            // Arm the cross-session comparison: this session's metrics are the baseline.
            await invoke("arm_comparison", {
              recId: topRec.id,
              recTitle: topRec.title,
              game: s.process_name,
              baselineAvgFps: s.avg_fps,
              baselineLow1Fps: s.low1_fps_est,
            }).catch(() => {});
          }}
        >
          {busyId === topRec.id ? "Applying…" : "Apply the #1 fix — compare next session"}
        </button>
      ) : cleanSession ? (
        <p className="debrief-clean">Good session, good rig. Nothing worth changing.</p>
      ) : null}
    </div>
  );
}

function DebriefTile({
  label,
  value,
  note,
  grade,
}: {
  label: ReactNode;
  value: string;
  note?: string;
  grade?: Grade;
}) {
  // Hardware-tailored grade color (green/amber/red); neutral metrics inherit the ink.
  const color = grade ? gradeColor(grade) : "";
  return (
    <div className="debrief-tile">
      <div className="debrief-tile-value" style={color ? { color } : undefined}>{value}</div>
      <div className="debrief-tile-label">
        {label}
        {note && <span className="debrief-tile-note"> · {note}</span>}
      </div>
    </div>
  );
}
