import { useState, type ComponentProps } from "react";
import Play from "./Play";
import { SegmentedControl } from "../design/SegmentedControl";
import "./Monitor.css";

// Monitor — the restructured live+sessions surface (spec 2026-06-21-monitor-restructure, tab #2 of the
// app-wide restructure). A thin shell: it owns the Sessions/Live segmented control and composes the
// existing <Play> surface via its `view` prop (Play renders sessions-only or live-only). Sessions is the
// DEFAULT (owner pick) — you open Monitor to review the last game; the buried debrief is now the face.
// Reuses the shared SegmentedControl (the gliding-indicator pattern from Optimize). No new IPC.

type Segment = "sessions" | "live";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "live", label: "Live" },
];

// Same props App passes to <Play>, minus `view` (the shell drives that from the segment).
type Props = Omit<ComponentProps<typeof Play>, "view">;

export function Monitor(props: Props) {
  const [segment, setSegment] = useState<Segment>("sessions");
  return (
    <section className="monitor-root">
      <header className="monitor-bar">
        <SegmentedControl
          segments={SEGMENTS}
          value={segment}
          onChange={(id) => setSegment(id as Segment)}
          aria-label="Monitor sections"
        />
      </header>
      <Play {...props} view={segment} />
    </section>
  );
}

export default Monitor;
