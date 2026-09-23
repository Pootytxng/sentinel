import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import { Card, SectionHeader, StatusPill } from "../design";
import {
  changeAttribution,
  componentLabel,
  verdictLabel,
  verdictTone,
  fmtDelta,
  type BenchmarkAttribution,
} from "./benchmark-view";
import { hasMeasuredPair } from "./two-futures-view";
import type { BenchmarkState } from "../types";
import type { HardwareInfo } from "../App";

const TwoFuturesScene = lazy(() => import("./rig/TwoFuturesScene"));

// A caller that has not read the Machine Model has no attribution to make — the line prints nothing.
const PENDING: BenchmarkAttribution = { kind: "pending" };

// Two Futures — the measured split view (spec 2026-07-07-two-futures-measured-split, flag
// compy_two_futures). THE ONE LAW: no measured pair → no split view, ever. Every number here
// is a field read straight off the BenchmarkState struct (per-component before/after/delta,
// verdicts, noise floor, run dates) — no estimates, no projections, nothing canned, no
// literal fallbacks (guard-tested). The empty state sells the feature honestly instead.

export function TwoFutures({
  bench,
  hw,
  attribution = PENDING,
}: {
  bench: BenchmarkState | null;
  hw: HardwareInfo | null;
  /** Which Compy changes the measured pair covers, read off the Machine Model (#452) — the
      attribution the efficacy card carried (this card subsumes it when the flag is on, so the line
      moves here). Defaults to pending, which prints nothing. */
  attribution?: BenchmarkAttribution;
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
  return (
    <Card>
      <SectionHeader
        title={t("gaming.twoFutures.heading")}
        right={<StatusPill status={verdictTone(eff.overall)} label={verdictLabel(eff.overall, t)} />}
      />
      <div data-testid="two-futures-split">
        <AttributionLine attribution={attribution} empty={t("gaming.twoFutures.noChangesRecorded")} />
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

/**
 * The one attribution sentence both Test cards print (#452). Pending prints nothing: a caller that
 * has not read the model has no claim to make. Unknown withdraws: "No Compy changes recorded … this
 * reflects manual or ambient changes" is a causal claim, and a record Compy cannot read supports
 * none. Counted names what the window covers and, separately, what it does not know — rows applied
 * on another PC are never credited, rows whose PC the ledger could not name are said to be so, and
 * a display-capped list is called a floor.
 */
export function AttributionLine({
  attribution,
  empty,
}: {
  attribution: BenchmarkAttribution;
  /** The caller's own "no Compy changes in this window" sentence — each card keeps its key. */
  empty: string;
}) {
  const { t } = useTranslation();
  if (attribution.kind === "pending") return null;
  if (attribution.kind === "unknown") {
    return <p className="bench-change">{t("common.ledgerHealth.attributionUnknown")}</p>;
  }
  const { credited, otherRig, rigUnknown, truncated, listed, totalRecorded } = attribution;
  const attr = changeAttribution(credited.length, t);
  const notes: string[] = [];
  if (otherRig > 0) notes.push(t("common.attribution.otherRig", { count: otherRig }));
  if (rigUnknown > 0) notes.push(t("common.attribution.rigUnknown", { count: rigUnknown }));
  if (truncated) {
    notes.push(t("common.attribution.listTruncated", { shown: listed, total: totalRecorded }));
  }
  return (
    <p className="bench-change">
      {credited.length > 0 ? (
        <>
          {attr.lead} <strong>{credited.map((c) => c.title).join(", ")}</strong>.
          {attr.caveat ? ` ${attr.caveat}` : ""}
        </>
      ) : (
        empty
      )}
      {notes.length > 0 ? ` ${notes.join(" ")}` : ""}
    </p>
  );
}
