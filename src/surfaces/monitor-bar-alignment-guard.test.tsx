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
 *  itself. Declaration BODIES only — selectors keep their comments intact all the way to
 *  `matches()` (see `allRules()`); no string substitution is CSS-safe for a selector, because a
 *  comment can either fuse two tokens into a compound selector (`.a/**\/.b`) or sit strictly
 *  inside one identifier and split it (`di/**\/v` is NOT `div`) — jsdom's real `matches()` already
 *  parses both cases correctly, so the guard stops trying to re-implement CSS tokenization.
 *
 *  Quoted strings are skipped as ATOMIC spans first — same reasoning as `declarations()`'s own
 *  `stripComments()` in `src/test/css-margin.ts`: this codebase ships `content: "…"` beside real
 *  margin declarations (`dock.css`), so a `/*`-lookalike inside a quoted value must not be read as
 *  a real comment start (independent review, PR #268). */
function stripBlockComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Parse ONE stylesheet's raw text into its rules. Factored out of `allRules()` so a regression
 *  test can feed synthetic CSS through the EXACT walker the guard runs on real sheets, not a copy
 *  of it — a test that only calls `stripBlockComments()`, `split()` or `matches()` on a literal
 *  stays green if this walker itself regresses (selector-stripping reintroduced, or the quoted-span
 *  skip removed), because none of those callers touch the walker at all (Codex review, PR #268).
 *
 *  Walked char-by-char with block comments AND quoted strings skipped as ATOMIC spans, never split
 *  on a brace inside either — a prose comment in App.css embeds a literal `{ "settled": false }`
 *  (a comment-stripped whole-file string, the pre-review shape of this function, corrupted every
 *  rule around it), and this codebase ships real `content: "…"` values beside real declarations
 *  (`dock.css`), so an unterminated `/*`-lookalike inside a quoted string must not be read as a
 *  real comment start and consume the rest of the file (independent review, PR #268). Selector and
 *  body text keep their original comments until each is stripped with the substitution that side
 *  actually needs. */
function rulesFromCss(raw: string, file: string): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = [];
  let i = 0;
  let buf = "";
  let selector: string | null = null;
  while (i < raw.length) {
    if (raw[i] === '"' || raw[i] === "'") {
      const quote = raw[i];
      let j = i + 1;
      while (j < raw.length && raw[j] !== quote) j += raw[j] === "\\" ? 2 : 1;
      const str = raw.slice(i, Math.min(j + 1, raw.length));
      buf += str;
      i += str.length;
      continue;
    }
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
        // The selector KEEPS its original comments — see `stripBlockComments`'s doc for why no
        // substitution is safe here. `stripBlockComments(sel)` below classifies the at-rule
        // prelude only; it is never what gets pushed or matched.
        const sel = selector.trim();
        if (sel && !stripBlockComments(sel).trim().startsWith("@"))
          out.push({ file, selector: sel, body: stripBlockComments(buf) });
      }
      selector = null;
      buf = "";
    } else {
      buf += ch;
    }
    i++;
  }
  return out;
}

/** Every `selector { declarations }` rule in EVERY sheet the app ships.
 *
 *  Not just the room's own sheet. The bar is a plain element in a cascade fed by `shell-v2.css`,
 *  `monitor-console.css` and every other sheet loaded beside them — a push can arrive from any of
 *  them, and a guard that only read `monitor-v2.css` would be the same "checked the nesting, not
 *  the route" blind spot this suite exists to close. Reachability is decided by `matches()` below,
 *  so a wide read costs nothing: a rule only fails if it actually lands on the face switch. */
function allRules(): { file: string; selector: string; body: string }[] {
  return sheets().flatMap((file) => rulesFromCss(readFileSync(file, "utf8"), file));
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
 *  complex selectors live (hud-rooms.css is full of them). Comments are skipped as ATOMIC spans,
 *  same technique as `allRules()`'s walker — a comma, paren, or bracket inside a selector comment
 *  must not split the list or shift the depth count (Codex review, PR #268). */
function split(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let i = 0;
  while (i < list.length) {
    if (list[i] === "/" && list[i + 1] === "*") {
      const end = list.indexOf("*/", i + 2);
      const comment = end === -1 ? list.slice(i) : list.slice(i, end + 2);
      buf += comment;
      i += comment.length;
      continue;
    }
    const ch = list[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
    i++;
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

  it("a comment-lookalike inside a quoted string is not read as a real comment start — PR #268 review", () => {
    // an unrelated */ inside a LATER quoted string must not falsely close a fake comment that
    // started inside an earlier one, swallowing the real push declared between them
    const body = stripBlockComments('content: "/*"; margin-left: auto; --end: "*/"');
    expect(leftMarginIsAuto(body).auto).toBe(true);
  });

  it("a comment fused between adjacent selector tokens still matches as a compound selector — Codex review, PR #268", () => {
    const el = document.createElement("div");
    el.className = "mc-ov active";
    expect(el.matches(".mc-ov/**/.active")).toBe(true);
  });

  it("a comment inside an identifier does not silently heal the selector into a shorter tag — Codex review, PR #268", () => {
    const el = document.createElement("div");
    expect(el.matches("di/**/v")).toBe(false);
    expect(el.matches("div")).toBe(true);
  });

  it("real whitespace after a comment still produces a genuine descendant combinator — Codex review, PR #268", () => {
    const parent = document.createElement("div");
    parent.className = "mc-ov";
    const child = document.createElement("span");
    child.className = "active";
    parent.appendChild(child);
    expect(child.matches(".mc-ov/**/ .active")).toBe(true);
    // Same class, no ancestor with the first class: a compound would still match here, but a real
    // descendant combinator must not — proves the real space after the comment was not swallowed.
    const lone = document.createElement("span");
    lone.className = "active";
    expect(lone.matches(".mc-ov/**/ .active")).toBe(false);
  });

  it("a comma inside a selector comment does not split the selector list — Codex review, PR #268", () => {
    expect(split(".a/* one, two */.b, .c")).toEqual([".a/* one, two */.b", ".c"]);
  });

  // The six tests above prove `stripBlockComments()`, `split()` and native `matches()` each behave
  // correctly IN ISOLATION. None of them calls the walker (`rulesFromCss`/`allRules()`) that a real
  // guard run actually uses — reintroduce selector-stripping there, or drop its quoted-span skip,
  // and every test above stays green while the guard itself goes blind again. These route synthetic
  // CSS through `rulesFromCss`, the exact function the guard calls (Codex review, PR #268).
  describe("the same defects, routed through the real parser (rulesFromCss), not re-implemented", () => {
    it("a comment-fused compound selector survives the walker intact and still matches both classes", () => {
      const [rule] = rulesFromCss(".a/**/.b { margin-left: auto }", "fixture.css");
      expect(rule.selector).toBe(".a/**/.b");
      const el = document.createElement("div");
      el.className = "a b";
      expect(el.matches(rule.selector)).toBe(true);
    });

    it("a comment splitting an identifier is not healed by the walker into a shorter tag", () => {
      const [rule] = rulesFromCss("di/**/v { margin-left: auto }", "fixture.css");
      expect(rule.selector).toBe("di/**/v");
      expect(document.createElement("div").matches(rule.selector)).toBe(false);
    });

    it("real whitespace after a comment survives the walker as a genuine descendant combinator", () => {
      const [rule] = rulesFromCss(".a/**/ .b { margin-left: auto }", "fixture.css");
      expect(rule.selector).toBe(".a/**/ .b");
      const parent = document.createElement("div");
      parent.className = "a";
      const child = document.createElement("span");
      child.className = "b";
      parent.appendChild(child);
      expect(child.matches(rule.selector)).toBe(true);
      expect(document.createElement("span").matches(rule.selector)).toBe(false);
    });

    it("a comma inside a selector comment does not split the rule the walker produces", () => {
      const [rule] = rulesFromCss(".a/* one, two */.b, .c { margin-left: auto }", "fixture.css");
      expect(split(rule.selector)).toEqual([".a/* one, two */.b", ".c"]);
    });

    it("a quoted comment-lookalike does not swallow the rule that follows it, or the one after that", () => {
      const css = [
        '.before { content: "/*"; }',
        ".target { margin-left: auto; }",
        '.decoy { --end: "*/"; }',
        ".after { color: red; }",
      ].join("\n");
      const rules = rulesFromCss(css, "fixture.css");
      expect(rules.map((r) => r.selector)).toEqual([".before", ".target", ".decoy", ".after"]);
      const target = rules.find((r) => r.selector === ".target")!;
      expect(leftMarginIsAuto(target.body).auto).toBe(true);
    });

    it("a literal brace inside a stylesheet comment does not corrupt rule splitting", () => {
      const css = '.a { margin-left: auto; /* a stray { "settled": false } in prose */ }\n.b { color: red }';
      const rules = rulesFromCss(css, "fixture.css");
      expect(rules.map((r) => r.selector)).toEqual([".a", ".b"]);
      expect(leftMarginIsAuto(rules[0].body).auto).toBe(true);
    });

    // #274 — the walker above was already quote-aware; the DECLARATION split inside
    // `leftMarginIsAuto` was not, so a `;` in a quoted value manufactured declarations. Both
    // directions reach this guard through the same route a real run takes: whole rule text ->
    // rulesFromCss -> leftMarginIsAuto. Asserting it on a bare body would prove nothing about
    // the route, which is the blind spot this whole describe block exists to close.
    it("FALSE NEGATIVE control: a quoted `;` must not hide the push this guard exists to catch", () => {
      const css = '.target { margin-left: auto; content: "; margin-left: 0;"; }';
      const [rule] = rulesFromCss(css, "fixture.css");
      expect(rule.selector).toBe(".target");
      const verdict = leftMarginIsAuto(rule.body);
      expect(verdict.auto).toBe(true);
      expect(verdict.source).toBe("margin-left: auto");
    });

    it("FALSE POSITIVE control: a push that exists only inside a string must not fail valid CSS", () => {
      const css = '.decoy { content: "; margin-left: auto;"; margin-right: 0; }';
      const [rule] = rulesFromCss(css, "fixture.css");
      expect(rule.selector).toBe(".decoy");
      expect(leftMarginIsAuto(rule.body).auto).toBe(false);
    });

    it("NEGATIVE control: a plain, real `margin-left: auto` still trips the invariant", () => {
      // the repair must not have been bought by making the guard quieter. This is the shape a
      // genuine regression takes, with nothing clever in it.
      const [rule] = rulesFromCss(".face-switch { margin-left: auto; }", "fixture.css");
      expect(leftMarginIsAuto(rule.body).auto).toBe(true);
    });

    it("a semicolon inside an unquoted url() is not a declaration boundary on this route", () => {
      const css = ".target { background: url(data:image/png;base64,iVBORw0KGgo=); margin-left: auto; }";
      const [rule] = rulesFromCss(css, "fixture.css");
      expect(leftMarginIsAuto(rule.body).auto).toBe(true);
    });
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
      if (face === "sessions") fireEvent.click(screen.getByRole("button", { name: "Sessions" }));

      const bar = container.querySelector(".mv2-bar");
      expect(bar, "the room must render its face-switch bar").not.toBeNull();
      // Located by CLASS, not by role: this is a LAYOUT guard, and .seg-control is the element the
      // margin rules below actually target. #237 changed the switch's role from tablist to group
      // (it never implemented the tabs keyboard pattern); keying the locator to a role the CSS does
      // not use would make this guard break on a semantics change it has no opinion about.
      const seg = bar!.querySelector(".seg-control") as HTMLElement | null;
      expect(seg, "the face switch is the segmented control inside that bar").not.toBeNull();

      // The bar leads with its switch — a control the eye reads first cannot be preceded by
      // spacer children that would make the alignment accidental.
      expect(bar!.firstElementChild, "the switch leads the bar").toBe(seg);

      const offenders: string[] = [];
      for (const rule of pushingRules()) {
        for (const sel of split(rule.selector)) {
          // A selector this jsdom build cannot parse must not silently pass as "no match".
          let hitsSeg = false;
          let hitsBar = false;
          try {
            hitsSeg = seg!.matches(sel);
            hitsBar = (bar as HTMLElement).matches(sel);
          } catch (e) {
            throw new Error(`unparseable selector in monitor-v2.css: ${sel} (${String(e)})`);
          }
          if (hitsSeg || hitsBar)
            offenders.push(`${rule.file}: ${sel} { ${rule.push.source} }  →  ${hitsSeg ? "the switch" : "the bar"}`);
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
