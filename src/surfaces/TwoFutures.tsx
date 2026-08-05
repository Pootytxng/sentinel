import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import { Card, SectionHeader, StatusPill } from "../design";
import { changeAttribution, componentLabel, verdictLabel, verdictTone, fmtDelta } from "./benchmark-view";
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
  ledgerIncomplete = false,
}: {
  bench: BenchmarkState | null;
  hw: HardwareInfo | null;
  /** Trust-Ledger changes applied between the two runs — the attribution the efficacy card
      carried (this card subsumes it when the flag is on, so the line moves here). */
  changes?: AppliedChange[];
  /** The ledger is KNOWN incomplete, so an empty `changes` is the output of a read that failed,
      not evidence that Compy changed nothing. Defaults false — every other caller is unchanged. */
  ledgerIncomplete?: boolean;
}) {
  const { t } = useTranslation();
  if (!hasMeasuredPair(bench)) {
    return (
      <Card>
        <SectionHeader title={t("gaming.twoFutures.heading")} />
        <div data-testid="two-futures-empty">
          <p className="bench-muted">{t("gaming.twoFutures.emptyIntro")}</p>
          <p className="bench-fine">{t("gaming.twoFutures.emptyHint")}</p>
        </div>
      </Card>
    );
  }

  const eff = bench.efficacy;
  const attr = changeAttribution(changes.length, t);
  return (
    <Card>
      <SectionHeader
        title={t("gaming.twoFutures.heading")}
        right={<StatusPill status={verdictTone(eff.overall)} label={verdictLabel(eff.overall, t)} />}
      />
      <div data-testid="two-futures-split">
        <p className="bench-change">
          {changes.length > 0 ? (
            <>
              {attr.lead} <strong>{changes.map((c) => c.rec_title).join(", ")}</strong>.
              {attr.caveat ? ` ${attr.caveat}` : ""}
            </>
          ) : ledgerIncomplete ? (
            // Same refusal as the efficacy card this one subsumes: "…this reflects manual or
            // ambient changes" is a causal claim, and an unreadable record cannot support one.
            <>{t("common.ledgerHealth.attributionUnknown")}</>
          ) : (
            <>{t("gaming.twoFutures.noChangesRecorded")}</>
          )}
        </p>
        <div className="tf-heads">
          <div className="tf-head">
            <span className="tf-eyebrow">{t("gaming.twoFutures.baselineLabel")}</span>
            <span className="tf-date">{fmtWhen(bench.baseline_at)}</span>
          </div>
          <div className="tf-head tf-head-now">
            <span className="tf-eyebrow">{t("gaming.twoFutures.nowLabel")}</span>
            <span className="tf-date">{fmtWhen(bench.latest_at)}</span>
          </div>
        </div>
        {hw && (
          <div className="tf-stage">
            <Suspense fallback={<div className="tf-loading">{t("gaming.twoFutures.loadingSplit")}</div>}>
              <TwoFuturesScene hw={hw} efficacy={eff} />
            </Suspense>
          </div>
        )}
        <div className="tf-rail">
          {eff.per_component.map((c) => (
            <div className="tf-row" key={c.component}>
              <span className="tf-label">{componentLabel(c.component, t)}</span>
              <span className="tf-pair">
                {c.before} <span className="tf-arrow">→</span> {c.after}
              </span>
              <span className={`bench-eff-delta is-${verdictTone(c.verdict)}`}>
                {fmtDelta(c.delta_pct)}
              </span>
              <StatusPill status={verdictTone(c.verdict)} label={verdictLabel(c.verdict, t)} />
            </div>
          ))}
        </div>
        <p className="bench-fine">
          {t("gaming.twoFutures.scoresNote", { pct: eff.noise_floor_pct })}
        </p>
      </div>
    </Card>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
