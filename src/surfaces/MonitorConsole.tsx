import type { ComponentProps } from "react";
import type Play from "./Play";

// MonitorConsole — the Monitor room's Live face as the console instrument cluster (plan
// 2026-07-10-console-hud-phase3-monitor; direction spec 2026-07-09-compy-console-hud-direction,
// Monitor row: the arc gauges + oscilloscope traces are REAL live telemetry, not decoration —
// deliberately NO hologram, NO parallax). Behind compy_monitor_console, DEFAULT OFF the whole
// phase; flag off, MonitorV2 renders exactly today's faces (pinned by
// monitor-console-flag.test.tsx). Presentation only over the SAME audited read-only polls the
// existing tiles run — zero new IPC, zero src-tauri.
//
// Task 1 stub: the flag + branch contract lands first (byte-identity pinned); the real
// instruments (Oscilloscope traces + ArcGauges over the ported polls) arrive in Task 3.

type Props = {
  active: boolean;
  vendor: NonNullable<ComponentProps<typeof Play>["vendor"]>;
  /** Basic shows the core instrument set; Advanced the full cluster (the existing faces' split). */
  mode: "basic" | "advanced";
  /** Mirrors the room's live capture state up to MonitorV2 (the V2-8 forward-door rule). */
  onFpsActive?: (active: boolean) => void;
  /** Basic's route into Advanced → Sessions (never a dead end) — same door MonitorBasic has. */
  onOpenSessions?: () => void;
};

export function MonitorConsole(_props: Props) {
  return <section className="monitor-console" aria-label="Live instruments" />;
}

export default MonitorConsole;
