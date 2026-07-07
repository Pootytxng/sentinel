import { lazy, Suspense } from "react";
import { Card, SectionHeader, StatusPill } from "../design";
import { componentLabel, verdictLabel, verdictTone, fmtDelta } from "./benchmark-view";
import { hasMeasuredPair } from "./two-futures-view";
import type { AppliedChange, BenchmarkState } from "../types";
import type { HardwareInfo } from "../App";

const TwoFuturesScene = lazy(() => import("./rig/TwoFuturesScene"));

// Two Futures — the measured split view (spec 2026-07-07-two-futures-measured-split, flag
// compy_two_futures). THE ONE LAW: no measured pair → no split view, ever. Every number here
// is a field read straight off the BenchmarkState struct (per-component before/after/delta,
// verdicts, noise floor, run dates) — no estimates, no projections, nothing canned, no
// literal fallbacks (guard-tested). The empty state sells the feature honestly instead.

export function TwoFutures({
  bench,
  hw,
  changes = [],
}: {
  bench: BenchmarkState | null;
  hw: HardwareInfo | null;
  /** Trust-Ledger changes applied between the two runs — the attribution the efficacy card
      carried (this card subsumes it when the flag is on, so the line moves here). */
  changes?: AppliedChange[];
}) {
  if (!hasMeasuredPair(bench)) {
    return (
      <Card>
        <SectionHeader title="Two futures" />
        <div data-testid="two-futures-empty">
          <p className="bench-muted">
            Run a benchmark before and after a fix to earn this view: your rig as it measured
            at the baseline, next to how it measures now.
          </p>
          <p className="bench-fine">
            Set a baseline above, change one thing, then re-measure — the split renders only
            from those two real runs.
          </p>
        </div>
      </Card>
    );
  }

  const eff = bench.efficacy;
  return (
    <Card>
      <SectionHeader
        title="Two futures"
        right={<StatusPill status={verdictTone(eff.overall)} label={verdictLabel(eff.overall)} />}
      />
      <div data-testid="two-futures-split">
        <p className="bench-change">
          {changes.length > 0 ? (
            <>
              Measuring the effect of:{" "}
              <strong>{changes.map((c) => c.rec_title).join(", ")}</strong>.
            </>
          ) : (
            <>No Compy changes recorded since the baseline — this reflects manual or ambient changes.</>
          )}
        </p>
        <div className="tf-heads">
          <div className="tf-head">
            <span className="tf-eyebrow">Baseline</span>
            <span className="tf-date">{fmtWhen(bench.baseline_at)}</span>
          </div>
          <div className="tf-head tf-head-now">
            <span className="tf-eyebrow">Now</span>
            <span className="tf-date">{fmtWhen(bench.latest_at)}</span>
          </div>
        </div>
        {hw && (
          <div className="tf-stage">
            <Suspense fallback={<div className="tf-loading">Loading the split…</div>}>
              <TwoFuturesScene hw={hw} efficacy={eff} />
            </Suspense>
          </div>
        )}
        <div className="tf-rail">
          {eff.per_component.map((c) => (
            <div className="tf-row" key={c.component}>
              <span className="tf-label">{componentLabel(c.component)}</span>
              <span className="tf-pair">
                {c.before} <span className="tf-arrow">→</span> {c.after}
              </span>
              <span className={`bench-eff-delta is-${verdictTone(c.verdict)}`}>
                {fmtDelta(c.delta_pct)}
              </span>
              <StatusPill status={verdictTone(c.verdict)} label={verdictLabel(c.verdict)} />
            </div>
          ))}
        </div>
        <p className="bench-fine">
          Relative scores (0–100) from your own two runs — changes within ±{eff.noise_floor_pct}%
          read as “no measurable change”.
        </p>
      </div>
    </Card>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
