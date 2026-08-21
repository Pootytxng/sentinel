import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// CPU-TEMPERATURE REACHABILITY GUARD (C-19, 2026-08-18).
//
// C-19 was filed as "CPU temperature is three clicks deep behind Advanced". The premise was
// generous. The reading had NO path at all on default flags:
//
//   CpuTempOffer's only mount was monitor-panels.tsx (CpuMonitorPanel) → MonitorDomainCards →
//   MonitoringTab → Play's `deepMonitoring` slot. That slot renders only while `showLive`
//   (`view !== "sessions"`), and MonitorV2 only reaches Play at advanced + segment "sessions",
//   where `showLive` is false. Verified live as well as in source: .mdc-root and .play-monitor
//   were both absent from the shipped build. Nothing was deleted (BACKLOG C-18 — a prior audit
//   falsely called these files unmounted and would have removed live code); the offer was
//   RE-MOUNTED on a reachable path.
//
// Meanwhile Home asserted the negative it had never measured: HomeConsole hardcoded "no CPU temp
// — needs a sensor app" with no probe behind it, so it said that even while HWiNFO was publishing
// a reading. Under the honest-measurement law an unmeasured claim is a fabricated claim, and under
// name-it-AND-fix-it-inline a flag with no fix beside it is a dead end.
//
// The three cases below pin the three fixes. Source-text, for the same reason as the front-door
// guard: a render test cannot prove a route stays reachable, and a green suite cannot prove
// absence — every case here fails on the RETURN of the defect.

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Surfaces a default-flag user actually lands on. HomeRoom: compy_home_console ON unless "0"
 *  (read in src/design/theme.ts); MonitorV2's Live face is MonitorConsole UNCONDITIONALLY since
 *  the 2026-08-20 comprehensibility sweep retired compy_monitor_console (issue #180). */
const DEFAULT_SURFACES = {
  home: join("src", "surfaces", "HomeConsole.tsx"),
  live: join("src", "surfaces", "MonitorConsole.tsx"),
} as const;

describe("CPU temperature reachability (C-19)", () => {
  it("the routes to those surfaces still hold (flag default / unconditional mount)", () => {
    // If the Home default flips, the surface this guard checks stops being the one users see, and
    // every case below would pass while the reading went dark again.
    const theme = stripComments(read("src", "design", "theme.ts"));
    const fn = new RegExp(
      `const\\s+\\w+\\s*=\\s*"compy_home_console"[\\s\\S]{0,400}?localStorage\\.getItem\\(\\s*\\w+\\s*\\)\\s*!==\\s*"0"`,
    );
    expect(
      fn.test(theme),
      `compy_home_console no longer resolves ON-unless-"0" — this guard is checking the wrong surface`,
    ).toBe(true);
    // MonitorConsole has no flag anymore — MonitorV2 must mount it as the Live face directly.
    const mv2 = stripComments(read("src", "surfaces", "MonitorV2.tsx"));
    expect(
      /<MonitorConsole\b/.test(mv2),
      "MonitorV2 no longer mounts MonitorConsole — this guard is checking the wrong Live surface",
    ).toBe(true);
  });

  it("the default Live face shows CPU temperature without the Advanced toggle", () => {
    const src = stripComments(read(DEFAULT_SURFACES.live));

    expect(
      /invoke<[^>]*>\(\s*["'`]get_cpu_temp["'`]/.test(src) ||
        /invoke\(\s*["'`]get_cpu_temp["'`]/.test(src),
      "MonitorConsole must poll get_cpu_temp",
    ).toBe(true);
    expect(
      /monitor\.monitorConsole\.cpuTempLabel/.test(src),
      "MonitorConsole must render a labelled CPU-temperature gauge",
    ).toBe(true);

    // ...and it must be an UNCONDITIONAL sibling of the GPU-temperature gauge. Since the
    // 2026-08-20 sweep removed the mode fork there is no Advanced toggle left to hide behind —
    // so the strongest form of C-19 is now: NOTHING in this file branches on a view mode at all,
    // and the CPU gauge sits at the same nesting depth as the GPU gauge.
    expect(
      /mode\s*===/.test(src),
      "MonitorConsole gained a mode condition again — the one-face rule (issue #180) forbids it",
    ).toBe(false);
    const indentOf = (labelKey: string) => {
      const at = src.indexOf(labelKey);
      expect(at, `${labelKey} not found in MonitorConsole`).toBeGreaterThan(-1);
      const tagAt = src.lastIndexOf("<ArcGauge", at);
      const lineStart = src.lastIndexOf("\n", tagAt) + 1;
      return tagAt - lineStart;
    };
    expect(
      indentOf("cpuTempLabel"),
      "the CPU-temperature gauge is nested deeper than the GPU-temperature gauge, which means a " +
        "condition wraps it — C-19 is exactly that it must not sit behind a reveal",
    ).toBe(indentOf("gpuTempLabel"));
  });

  it("Home measures the CPU temperature instead of asserting it is missing", () => {
    const src = stripComments(read(DEFAULT_SURFACES.home));

    expect(
      /invoke<[^>]*>\(\s*["'`]get_cpu_temp["'`]/.test(src) ||
        /invoke\(\s*["'`]get_cpu_temp["'`]/.test(src),
      "HomeConsole prints a CPU-temperature verdict, so it must read get_cpu_temp — printing " +
        "'no CPU temp' without probing is a fabricated claim",
    ).toBe(true);

    // The no-temp string may only be reached from state derived from that probe.
    const noTempAt = src.indexOf("callout.cpuNoTemp");
    expect(noTempAt, "the no-temp copy key vanished — update this guard with the new key").toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, noTempAt - 600), noTempAt + 200);
    expect(
      /cpuTemp/.test(window),
      "the 'no CPU temp' copy is not guarded by the cpuTemp reading — it would print while a " +
        "sensor app is publishing one",
    ).toBe(true);
  });

  it("the offer that turns 'no reading' into a reading is reachable on default flags", () => {
    const src = stripComments(read(DEFAULT_SURFACES.home));
    expect(
      /<CpuTempOffer\b/.test(src),
      "CpuTempOffer must be mounted on a default-reachable surface. Its historical mount " +
        "(monitor-panels.tsx) hangs off Play's deepMonitoring slot, which no default-flag route " +
        "ever renders — that is the whole of C-19. Do NOT satisfy this by deleting the old mount " +
        "(BACKLOG C-18).",
    ).toBe(true);
  });

  it("the setup lesson does not teach the dead end", () => {
    // It used to say CPU temperature "needs a kernel driver to read, and this build ships none",
    // full stop — true of the direct read, and silent about the monitor-app path cpu_temp.rs
    // actually uses. Stating the gap without the working path is a dead end.
    const steps = read("src", "surfaces", "setup", "setup-steps.ts");
    const note = steps.match(/note:\s*"([^"]*kernel driver[^"]*)"/);
    if (note) {
      expect(
        /HWiNFO|LibreHardwareMonitor/i.test(note[1]),
        "the CPU lesson names the kernel-driver gap without naming the monitor-app path that works",
      ).toBe(true);
    }
  });
});
