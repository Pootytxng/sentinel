import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { MonitorV2 } from "./MonitorV2";
import type { SessionSummary } from "../types";

// bug→guard — issue #236, "the Live/Sessions control is parked in the wrong place".
//
// THE DEFECT. `monitor-v2.css` carried `.mv2-bar > :last-child { margin-left: auto }`, written at
// V2-5 (b913d6bf) when the bar held TWO controls: the room's Live/Sessions segments and a second
// "Detail level" segmented control, which that rule pushed to the far edge. The 2026-08-20
// comprehensibility sweep (issue #180) retired the Basic/Advanced fork and deleted the detail
// control — leaving the face switch as the bar's only child and therefore its OWN `:last-child`.
// The rule then pushed the room's primary navigation off the content grid to the right margin,
// on both faces, at every width. Nothing failed: no test reads layout, and the rule it broke was
// the one it used to serve.
//
// WHY A REACHABILITY GUARD AND NOT A STRING MATCH. Deleting the offending declaration and pinning
// its absence by text would guard the 2026-08 spelling of one bug. The invariant that actually
// holds is about the ELEMENT: the room's face switch is a tab bar, and a tab bar follows the app's
// normal tab alignment — flush with the left edge of the content it switches (History's
// `.bbv2-bar` is the reference: `display:flex; align-items:center`, no push). So this suite renders
// the REAL room on BOTH faces, collects every rule in EVERY sheet the app ships that pushes an
// element with an automatic left margin, and asserts none of those selectors MATCHES the live tablist.
// A future detail control may return and be pushed to the edge by a rule that names IT — that
// still passes. Only a rule that lands on the face switch fails.
//
// This is the `vendor-honesty-line-guard` lesson applied to layout: prove the rule cannot reach the
// element, not that the element is nested somewhere plausible.

vi.mock("./Play", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    default: () => <div data-testid="play-face" />,
  };
});
// The two heavy canvases have their own suites; stubbing them keeps this guard about the bar while
// leaving the REAL MonitorConsole — and therefore the real RoomShell split — in the tree. Mocking
// MonitorConsole itself would delete the very ancestors (`.v2-room[data-room="play"]`,
// `[data-layout="split"]`) the room's selectors are scoped to, and the guard would prove nothing
// about the Live face.
vi.mock("./monitor/DeckScope", () => ({ DeckScope: () => <div data-testid="deck-scope" /> }));
vi.mock("./monitor/SessionStack", () => ({ SessionStack: () => <div data-testid="session-stack" /> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_sensors")
      return Promise.resolve({
        usage_overall_pct: 34.2,
        frequency_mhz: 5100,
        ram_used_bytes: 14.2 * 1024 ** 3,
        ram_total_bytes: 29.4 * 1024 ** 3,
      });
    if (cmd === "get_gpu_sensors")
      return Promise.resolve([{ vendor: "amd", temperature_c: 62, utilization_gpu_pct: 97 }]);
    if (cmd === "get_fps_status") return Promise.resolve({ active: false, status: "idle", sample: null });
    return Promise.resolve(null);
  }),
}));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

beforeEach(() => {
  localStorage.setItem("compy_editorial", "0");
  // Every selector in the room's sheet is scoped under `:root[data-v2="on"]` (the flag-off
  // byte-identity mechanism). Without this the `matches()` checks below would pass vacuously.
  document.documentElement.setAttribute("data-v2", "on");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-v2");
});

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at: "2026-07-03T00:00:00Z",
    duration_secs: 2520,
    process_name: "valorant.exe",
    samples: 3412,
    avg_fps: 240.2,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190.1,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 1,
    ...over,
  }) as SessionSummary;

function mount(over: Record<string, unknown> = {}) {
  const props = {
    active: true,
    sessions: [session()],
    sessionsSeenAt: "",
    priorities: null,
    recs: [],
    apply: vi.fn(),
    busyId: null,
    onExport: vi.fn(),
    changes: [],
    rollback: vi.fn(),
    vendor: "amd" as const,
    ...over,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<MonitorV2 {...(props as any)} />);
}

/** Every `selector { declarations }` rule in EVERY sheet the app ships, comments stripped.
 *
 *  Not just the room's own sheet. The bar is a plain element in a cascade fed by `shell-v2.css`,
 *  `monitor-console.css` and every other sheet loaded beside them — a push can arrive from any of
 *  them, and a guard that only read `monitor-v2.css` would be the same "checked the nesting, not
 *  the route" blind spot this suite exists to close. Reachability is decided by `matches()` below,
 *  so a wide read costs nothing: a rule only fails if it actually lands on the face switch. */
function allRules(): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = [];
  for (const file of sheets()) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      // Skip at-rule preludes (`@media …`, `@keyframes …`) — they are not element selectors, and
      // their nested rules are picked up by the same pass because this splits on braces.
      if (!selector || selector.startsWith("@")) continue;
      out.push({ file, selector, body: m[2] });
    }
  }
  return out;
}

/** Every stylesheet under src/, recursively. */
function sheets(dir = "src"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sheets(p));
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** One selector list → its individual selectors. */
const split = (selector: string) => selector.split(",").map((s) => s.trim()).filter(Boolean);

/** Rules that push their subject away from the left edge with an automatic start margin. */
function pushingRules() {
  return allRules().filter(({ body }) =>
    /margin(?:-left|-inline-start)\s*:\s*auto/.test(body) ||
    // `margin: <top> auto` / `margin: <t> <r> <b> auto` also produce an auto LEFT margin.
    /margin\s*:\s*[^;]*\bauto\b[^;]*;?/.test(body.replace(/margin-(top|right|bottom|left|inline-start|inline-end)\s*:[^;]*;?/g, "")),
  );
}

describe("Live room — the face switch sits on the content grid (issue #236)", () => {
  for (const face of ["live", "sessions"] as const) {
    it(`no shipped rule gives the ${face} face's tab bar an automatic left margin`, () => {
      const { container } = mount();
      if (face === "sessions") fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));

      const bar = container.querySelector(".mv2-bar");
      expect(bar, "the room must render its face-switch bar").not.toBeNull();
      const tablist = bar!.querySelector('[role="tablist"]') as HTMLElement | null;
      expect(tablist, "the face switch is the tablist inside that bar").not.toBeNull();

      // The bar leads with its tab bar — a control the eye reads first cannot be preceded by
      // spacer children that would make the alignment accidental.
      expect(bar!.firstElementChild, "the tablist leads the bar").toBe(tablist);

      const offenders: string[] = [];
      for (const rule of pushingRules()) {
        for (const sel of split(rule.selector)) {
          // A selector this jsdom build cannot parse must not silently pass as "no match".
          let hitsTablist = false;
          let hitsBar = false;
          try {
            hitsTablist = tablist!.matches(sel);
            hitsBar = (bar as HTMLElement).matches(sel);
          } catch (e) {
            throw new Error(`unparseable selector in monitor-v2.css: ${sel} (${String(e)})`);
          }
          if (hitsTablist || hitsBar)
            offenders.push(`${rule.file}: ${sel}  →  ${hitsTablist ? "the tablist" : "the bar"}`);
        }
      }
      expect(
        offenders,
        `the Live/Sessions switch must follow the app's normal tab alignment (History's .bbv2-bar ` +
          `is the reference — no push). These rules push it off the room's content grid:\n` +
          offenders.join("\n"),
      ).toEqual([]);
    });
  }

  it("the bar itself introduces no horizontal offset from the room's content column", () => {
    // The bar is the tab row's own container. If IT gains a left margin or padding, the tabs
    // drift off the grid even with no auto margin anywhere — same defect, different property.
    const { container } = mount();
    const bar = container.querySelector(".mv2-bar") as HTMLElement;
    const offenders: string[] = [];
    for (const rule of allRules()) {
      const left = [...rule.body.matchAll(/(?:^|;)\s*(margin-left|padding-left|margin-inline-start|padding-inline-start)\s*:\s*([^;]+)/g)];
      if (!left.length) continue;
      for (const sel of split(rule.selector)) {
        if (!bar.matches(sel)) continue;
        for (const [, prop, value] of left) {
          if (!/^(0|0px|0rem)$/.test(value.trim()))
            offenders.push(`${rule.file}: ${sel} { ${prop}: ${value.trim()} }`);
        }
      }
    }
    expect(offenders, `the bar must start where the room's content starts:\n${offenders.join("\n")}`).toEqual([]);
  });
});
