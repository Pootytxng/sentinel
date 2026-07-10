import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// HomeConsole — Home as the console cold-open (plan 2026-07-10-console-hud-phase2-home,
// Phase 2 of the Console HUD; design source 2026-07-09-compy-console-hud-direction).
// Task-1 STUB: renders the console root so the HomeRoom branch compiles + the flag pin can
// assert on it. The real stage (hologram center + honest corner gauges + masthead) lands in
// Task 2 over these SAME props — presentation only, zero new IPC.

type Props = {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  onRunCheck: () => void;
  onSeeInFix: () => void;
  /** Where limiter jumps land: "Lab" on the proving-ground rail, "Optimize" classic. */
  fixRoomLabel?: string;
};

export function HomeConsole(_props: Props) {
  return <div className="home-console" />;
}

export default HomeConsole;
