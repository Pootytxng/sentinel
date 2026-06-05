import { Card, SectionHeader, StatusPill, Stat, Gauge, Sparkline, TrustCue, EmptyState } from "./index";

export function Gallery() {
  return (
    <div style={{ display: "grid", gap: 16, padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Card>
        <SectionHeader title="Status vocabulary" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status="ready" /><StatusPill status="attention" />
          <StatusPill status="protected" /><StatusPill status="scanning" /><StatusPill status="unknown" />
        </div>
      </Card>
      <Card>
        <SectionHeader title="Stats" />
        <div style={{ display: "flex", gap: 24 }}>
          <Stat value="142" unit="fps" label="Average" tone="ready" />
          <Stat value="7.0" unit="ms" label="Frametime" />
          <Stat value="98" unit="fps" label="1% low · estimate" />
        </div>
      </Card>
      <Card>
        <SectionHeader title="Instrument cluster" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          <Gauge value={61} display="61" unit="°C" label="GPU temp" colorVar="var(--ready)" />
          <Gauge value={84} display="84" unit="%" label="GPU usage" />
          <Gauge value={47} display="47" unit="%" label="Fan" />
          <Gauge value={66} display="214" unit="W" label="Power" colorVar="var(--attention)" />
        </div>
        <Sparkline values={[30, 28, 31, 22, 26, 18, 24, 16, 20, 14, 22, 12]} />
      </Card>
      <Card><TrustCue title="You're protected" detail="4 changes active — all reversible from the Ledger." /></Card>
      <Card>
        <EmptyState icon="chart" title="No sessions yet">
          Play a game with monitoring on and Compy will write a debrief here.
        </EmptyState>
      </Card>
    </div>
  );
}
