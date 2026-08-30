import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { leftMarginIsAuto } from "../test/css-margin";
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

/** Replace a CSS block comment with a single space, never `""` — emptying it fuses the tokens on
 *  either side of an empty comment (`margin:0` immediately followed by `auto`, becoming `0auto`),
 *  hiding a real push from `leftMarginIsAuto` the same way #240 found inside `declarations()`
 *  itself. Declaration BODIES only — see `stripSelectorComments` for why selectors need the
 *  opposite substitution. */
function stripBlockComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Strip a CSS comment from a SELECTOR to nothing, never a space. Unlike a declaration value, two
 *  adjacent selector tokens with an EMPTY comment and no real whitespace between them stay a
 *  compound (same-element) selector (`.a` immediately followed by `.b` tokenizes as `.a.b`, not
 *  the descendant `.a .b`) — a comment is consumed during tokenization without producing a
 *  whitespace token. Substituting a space here would rewrite a real compound selector into a
 *  descendant one and make `matches()` miss the element a shipped auto-margin rule actually lands
 *  on (Codex review, PR #268). */
function stripSelectorComments(selector: string): string {
  return selector.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `selector { declarations }` rule in EVERY sheet the app ships.
 *
 *  Not just the room's own sheet. The bar is a plain element in a cascade fed by `shell-v2.css`,
 *  `monitor-console.css` and every other sheet loaded beside them — a push can arrive from any of
 *  them, and a guard that only read `monitor-v2.css` would be the same "checked the nesting, not
 *  the route" blind spot this suite exists to close. Reachability is decided by `matches()` below,
 *  so a wide read costs nothing: a rule only fails if it actually lands on the face switch.
 *
 *  Walked char-by-char with block comments skipped as ATOMIC spans, never split on a brace inside
 *  one — a prose comment in App.css embeds a literal `{ "settled": false }`, and splitting on a
 *  comment-stripped whole-file string (the pre-review shape of this function) would corrupt every
 *  rule around it. Selector and body text keep their original comments until each is stripped
 *  with the substitution that side actually needs. */
function allRules(): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = [];
  for (const file of sheets()) {
    const raw = readFileSync(file, "utf8");
    let i = 0;
    let buf = "";
    let selector: string | null = null;
    while (i < raw.length) {
      if (raw[i] === "/" && raw[i + 1] === "*") {
        const end = raw.indexOf("*/", i + 2);
        const comment = end === -1 ? raw.slice(i) : raw.slice(i, end + 2);
        buf += comment;
        i += comment.length;
        continue;
      }
      const ch = raw[i];
      if (ch === "{") {
        selector = buf;
        buf = "";
      } else if (ch === "}") {
        if (selector !== null) {
          const sel = stripSelectorComments(selector).trim();
          // Skip at-rule preludes (`@media …`, `@keyframes …`) — they are not element selectors.
          if (sel && !sel.startsWith("@")) out.push({ file, selector: sel, body: stripBlockComments(buf) });
        }
        selector = null;
        buf = "";
      } else {
        buf += ch;
      }
      i++;
    }
  }
  return out;
}

/** Every stylesheet under src/, recursively. */
function sheets(dir = "src"): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((p) => p.endsWith(".css"))
    .map((p) => join(dir, p));
}


/** One selector list -> its individual selectors, splitting on TOP-LEVEL commas only.
 *  `:is(a, b) .c` is ONE selector; a naive `.split(",")` shears it into two broken fragments,
 *  and a guard that then skips what it cannot parse goes blind exactly where the app's most
 *  complex selectors live (hud-rooms.css is full of them). */
function split(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Rules that push their subject away from the left edge with an automatic start margin.
 *
 *  The margin reasoning itself lives in `src/test/css-margin.ts` and is proved by its own focused
 *  examples. It used to be a regex here that read the WORD `auto` anywhere in a `margin` shorthand,
 *  which reported `margin: auto 0` and `margin: 0 auto 0 0` — valid CSS that does not touch the left
 *  margin — as pushes. A guard that fails correct CSS gets deleted, so the semantics are shared and
 *  tested rather than re-guessed per guard. */
function pushingRules() {
  return allRules()
    .map((rule) => ({ ...rule, push: leftMarginIsAuto(rule.body) }))
    .filter((rule) => rule.push.auto);
}

describe("Live room — the face switch sits on the content grid (issue #236)", () => {
  it("a comment-fused margin push survives this guard's own comment stripping — #240", () => {
    const body = stripBlockComments("margin:0/**/auto");
    expect(leftMarginIsAuto(body).auto).toBe(true);
  });

  it("a comment between adjacent selector tokens stays a compound selector, not a descendant one — Codex review, PR #268", () => {
    expect(stripSelectorComments(".mc-ov/**/.active")).toBe(".mc-ov.active");
  });

  it("a literal brace inside a stylesheet comment does not corrupt rule splitting (App.css:2159)", () => {
    const [file] = sheets().filter((f) => f.endsWith("App.css"));
    expect(file, "App.css must ship, or this proof is vacuous").toBeDefined();
    const rules = allRules().filter((r) => r.file === file);
    // The file has real, matchable rules on both sides of the brace-containing comment; a splitter
    // that got confused by it would either throw or silently drop/garble surrounding rules.
    expect(rules.length).toBeGreaterThan(10);
  });

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
            offenders.push(`${rule.file}: ${sel} { ${rule.push.source} }  →  ${hitsTablist ? "the tablist" : "the bar"}`);
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
