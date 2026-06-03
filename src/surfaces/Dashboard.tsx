import "./Dashboard.css";
import { Card, SectionHeader, StatusPill, Stat, TrustCue, EmptyState } from "../design";
import { activeChangeCount, topLimiters, leaveAloneCount, latestSession } from "./dashboard-data";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";

export type DashboardProps = {
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  changes: AppliedChange[];
  sessions: SessionSummary[];
  onNavigate: (tab: string) => void;
  onExport: () => void;
};

// Home-base cards answering Q2–Q7 (Q1 "am I ready?" is the always-on CommandHero).
export function Dashboard(p: DashboardProps) {
  const limiters = topLimiters(p.priorities, 3);
  const active = activeChangeCount(p.changes);
  const leaveAlone = leaveAloneCount(p.priorities);
  const last = latestSession(p.sessions);

  return (
    <div className="dash">
      <div className="dash-grid">
        {/* Q2: What's holding this PC back? */}
        <Card className="col8" interactive>
          <SectionHeader title="What's holding this PC back" right={
            <StatusPill status={limiters.length ? "attention" : "ready"} label={limiters.length ? `${limiters.length} to look at` : "Nothing urgent"} />
          } />
          {limiters.length === 0 ? (
            <p className="dash-honesty">No real limiters for this rig right now. Nothing here is worth touching.</p>
          ) : (
            limiters.map((l) => (
              <div className="dash-limiter" key={l.id}>
                <span className="t">{l.title}</span><span className="r">{l.reason}</span>
              </div>
            ))
          )}
          <div style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => p.onNavigate("Priorities")}>See all priorities</button>
          </div>
        </Card>

        {/* Q3 + Q4: What has Sentinel improved? / What not to touch? */}
        <Card className="col4">
          <TrustCue title={active > 0 ? "You're protected" : "Nothing changed yet"}
            detail={active > 0 ? `${active} change${active === 1 ? "" : "s"} active — all reversible from the Ledger.` : "No changes applied. Your system is untouched."} />
          <div style={{ marginTop: 12 }}>
            <Stat value={String(leaveAlone)} label="Checked & fine — leave alone" />
          </div>
        </Card>

        {/* Q5: How did the last session perform? */}
        <Card className="col8" interactive>
          <SectionHeader title="Last session" right={last ? <StatusPill status="unknown" label={last.process_name} /> : undefined} />
          {last ? (
            <div style={{ display: "flex", gap: 24 }}>
              <Stat value={last.avg_fps.toFixed(0)} unit="fps" label="Average" tone="ready" />
              <Stat value={last.avg_frametime_ms.toFixed(1)} unit="ms" label="Frametime" />
              <Stat value={last.low1_fps_est.toFixed(0)} unit="fps" label="1% low · estimate" />
            </div>
          ) : (
            <EmptyState icon="chart" title="No sessions yet">
              Play a game with monitoring on and a debrief lands here.
            </EmptyState>
          )}
        </Card>

        {/* Q6 + Q7: Share / honesty */}
        <Card className="col4">
          <SectionHeader title="Share & honesty" />
          <button className="btn" onClick={p.onExport}>Export a diagnostic report</button>
          <p className="dash-honesty" style={{ marginTop: 12 }}>
            Sentinel shows measured facts and reversible changes — never fake percentages, boost
            claims, or an opaque "score." 1% low is a live estimate. No CPU temp by design.
          </p>
        </Card>
      </div>
    </div>
  );
}
