import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { leftMarginIsAuto } from "../test/css-margin";
import { MonitorV2 } from "./MonitorV2";
import type { SessionSummary } from "../types";

// issue #236, second half — "improve first-viewport hierarchy so there is one clear primary
// action", "demote/group secondary controls", "delete or hide nothing", "preserve tab order".
//
// WHAT THE INSTALLED 73b629ed BUILD MEASURED. On the Live face the room's narrative column is
// ~312px wide (the evidence aside takes the rest), and nine to eleven controls sit above the fold
// in it. Two of them competed with the room's one dominant action:
//
//   1. `.mc-ov { margin-left: auto }` stranded the overlay cluster at the far right edge of that
//      narrow column, disconnected from the capture status it qualifies — the SAME defect family
//      as the tab bar's push one row above (see monitor-bar-alignment-guard.test.tsx), in the same
//      room, out of the same idiom.
//   2. `.mc-cap` wore accent text on an accent border while `.mc-start` — the room's ONE dominant
//      action — wears an accent FILL. Two accent-painted controls stacked in a ~312px column read
//      as two calls to action, which is the thing the first-viewport contract forbids.
//
// So this suite pins three invariants, and none of them is a string match on the fix:
//   A. no shipped rule strands the overlay cluster with an automatic left margin;
//   B. at REST, exactly one control in the room's narrative column is painted with an accent
//      background or border — the primary action. State classes (`-on`) and interaction states
//      (:hover/:focus/:active) are excluded: feedback is not competition;
//   C. the room's focusable controls, in DOM order, are exactly the ones that shipped — a census,
//      so "demote and group" can never quietly become "delete or hide", and so the change cannot
//      reorder Tab.

vi.mock("./Play", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, default: () => <div data-testid="play-face" /> };
});
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
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Obs;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Obs;
});

beforeEach(() => {
  localStorage.setItem("compy_editorial", "0");
  localStorage.setItem("compy_motion", "reduced");
  document.documentElement.setAttribute("data-v2", "on");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-v2");
});

const session = (): SessionSummary =>
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
    stutter_events: [],
  }) as SessionSummary;

function mount() {
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
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<MonitorV2 {...(props as any)} />);
}

/** Every stylesheet under src/, recursively. */
function sheets(dir = "src"): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((p) => p.endsWith(".css"))
    .map((p) => join(dir, p));
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

/** Every `selector { declarations }` rule the app ships.
 *
 *  Walked char-by-char with block comments AND quoted strings skipped as ATOMIC spans, never split
 *  on a brace inside either — a prose comment in App.css embeds a literal `{ "settled": false }`
 *  (a comment-stripped whole-file string, the pre-review shape of this function, corrupted every
 *  rule around it), and this codebase ships real `content: "…"` values beside real declarations
 *  (`dock.css`), so an unterminated `/*`-lookalike inside a quoted string must not be read as a
 *  real comment start and consume the rest of the file (independent review, PR #268). Selector text
 *  keeps its original comments; body text is stripped with the substitution declarations need. */
function allRules(): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = [];
  for (const file of sheets()) {
    const raw = readFileSync(file, "utf8");
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
          // KEEPS its original comments — see `stripBlockComments`'s doc for why no substitution is
          // safe here. `stripBlockComments(sel)` below classifies the at-rule prelude only; it is
          // never what gets pushed or matched.
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
  }
  return out;
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

/** `el.matches(sel)`, but an unparseable selector THROWS rather than reading as "no match" — a
 *  guard that silently skips what it cannot parse is a guard that grows blind spots. */
function hits(el: Element, sel: string): boolean {
  try {
    return el.matches(sel);
  } catch (e) {
    throw new Error(`unparseable selector: ${sel} (${String(e)})`);
  }
}

/** Open the overlay cluster — its sub-controls only exist once the overlay is on, and the census
 *  has to see the room at its BUSIEST, which is the state the hierarchy contract is about. */
async function openOverlay(container: HTMLElement) {
  const cap = container.querySelector(".mc-cap") as HTMLButtonElement;
  expect(cap, "the overlay toggle must exist").not.toBeNull();
  fireEvent.click(cap);
  await waitFor(() => expect(container.querySelectorAll(".mc-ov-corner").length).toBe(4));
}

/** Focusable controls in the room's NARRATIVE column — the first viewport's left column. The
 *  evidence aside and the below-the-fold deck are deliberately out: this contract is about what
 *  competes with the primary action, and neither of those shares its column. */
function narrativeControls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>('button, a[href], [role="tab"], input, select, textarea'),
  ].filter((el) => !el.closest(".mc-evidence") && !el.closest(".mc-below"));
}

/** A stable, legible descriptor: what the control IS, not what it currently says. */
const describeControl = (el: HTMLElement) =>
  `${el.getAttribute("role") ?? el.tagName.toLowerCase()}.${(el.className || "-").split(" ")[0]}` +
  `[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 34)}]`;

describe("Live room - first-viewport hierarchy (issue #236)", () => {
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
    const lone = document.createElement("span");
    lone.className = "active";
    expect(lone.matches(".mc-ov/**/ .active")).toBe(false);
  });

  it("a comma inside a selector comment does not split the selector list — Codex review, PR #268", () => {
    expect(split(".a/* one, two */.b, .c")).toEqual([".a/* one, two */.b", ".c"]);
  });

  it("a literal brace inside a stylesheet comment does not corrupt rule splitting (App.css:2159)", () => {
    const [file] = sheets().filter((f) => f.endsWith("App.css"));
    expect(file, "App.css must ship, or this proof is vacuous").toBeDefined();
    const rules = allRules().filter((r) => r.file === file);
    expect(rules.length).toBeGreaterThan(10);
  });

  it("A: no shipped rule strands the overlay cluster at the column's far edge", async () => {
    const { container } = mount();
    await openOverlay(container);
    const ov = container.querySelector(".mc-ov") as HTMLElement;

    // Shared, tested margin semantics - see `src/test/css-margin.ts` and its focused examples.
    const offenders: string[] = [];
    for (const rule of allRules()) {
      const push = leftMarginIsAuto(rule.body);
      if (!push.auto) continue;
      for (const sel of split(rule.selector))
        if (hits(ov, sel)) offenders.push(`${rule.file}: ${sel} { ${push.source} }`);
    }
    expect(
      offenders,
      "the overlay controls belong WITH the capture status they qualify, not pinned to the right " +
        `edge of a narrow column. These rules strand them:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------
  // B is a RAW-RULE TRIPWIRE, and the name matters. It reads the stylesheet text and asks which
  // rules DECLARE an accent paint on a control the room renders. It does NOT compute anything: it
  // cannot see specificity, cascade order across sheets, `color-mix` results, or what a pixel ends
  // up being. It cannot tell you the room looks right. What it can do is fail the moment someone
  // hands a second control the primary action's paint, which is the regression this contract is
  // about, and it does that in 200ms on every run instead of once per installed review.
  //
  // The COMPUTED evidence is a separate artifact and always will be: the installed review of
  // f7a151b0 measured `getComputedStyle` on every control here at 1280/1500/1920 in both overlay
  // states. That is what proves the room reads correctly; this proves nobody has since reintroduced
  // the shape that broke it. Do not let a green B stand in for looking at the app.
  //
  // Two assertions, because the app has two different accent vocabularies and only one of them is
  // reserved:
  //
  //   B1  A saturated accent BACKGROUND FILL belongs to the primary action and nothing else — in
  //       EVERY state. No exemption for `-on`, and that is the point: the first version of this
  //       guard exempted every `-on` selector and so declared "exactly one accent-painted control"
  //       while `.mc-cap-on` shipped the identical `--ix-accent` fill as `.mc-start`. The exemption
  //       hid the busiest real state from the invariant it claimed to hold. Independent review
  //       caught it; the fill is now `.mc-start`'s alone and this asserts it without escape.
  //
  //   B2  AT REST, no control is accent-painted by fill OR border except the primary action. Here
  //       the state classes ARE excluded, and honestly so, because "at rest" is what the assertion
  //       says: an accent OUTLINE is the app's state vocabulary (`.mc-ov-corner-on`, `.mc-ov-seg-on`
  //       and now `.mc-cap-on` all use it), and forbidding it would forbid honest state. B2 is what
  //       caught the resting `.mc-cap` accent border that shipped before this lane.
  // ---------------------------------------------------------------------------------------------

  /** Rules whose declarations paint with an accent token, keyed by which properties they paint. */
  function accentRules(props: RegExp) {
    const accent = /var\(\s*--(?:v2|ix)-accent[a-z-]*\s*\)/;
    return allRules().filter((rule) =>
      [...rule.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].some(
        ([, prop, value]) => props.test(prop) && accent.test(value),
      ),
    );
  }

  /** Which of `controls` each rule reaches, with the rule cited so a failure is actionable. */
  function paintedBy(
    controls: HTMLElement[],
    rules: { file: string; selector: string }[],
    skipSelector: (sel: string) => boolean,
  ) {
    const why = new Map<HTMLElement, string[]>();
    for (const rule of rules)
      for (const sel of split(rule.selector)) {
        if (skipSelector(sel)) continue;
        for (const el of controls)
          if (hits(el, sel)) why.set(el, [...(why.get(el) ?? []), `${rule.file}: ${sel}`]);
      }
    return why;
  }

  const cite = (why: Map<HTMLElement, string[]>) =>
    [...why.entries()].map(([el, rules]) => `${describeControl(el)}\n    ${rules.join("\n    ")}`).join("\n  ");

  // An interaction pseudo-class is feedback on the element the pointer is already on. It is never a
  // competing invitation, and it is excluded from both assertions.
  const interaction = (sel: string) => /:(hover|focus|focus-visible|active|disabled)/.test(sel);

  it("B1: the accent FILL belongs to the primary action alone - in every state, no exemptions", async () => {
    const { container } = mount();
    await openOverlay(container);
    const controls = narrativeControls(container);
    expect(controls.length, "the room must render its controls").toBeGreaterThan(4);

    // `background` / `background-color` only. Borders and text are the state vocabulary; the FILL is
    // what makes a control read as the thing to press, and it is reserved.
    const why = paintedBy(controls, accentRules(/^background(-color)?$/), interaction);
    expect(
      [...why.keys()].length,
      "a saturated accent fill is the primary action's alone, in EVERY state. These controls also " +
        `declare one:\n  ${cite(why)}`,
    ).toBe(1);
    expect([...why.keys()][0].className, "and it is the room's primary action").toContain("mc-start");
  });

  it("B2: at REST, nothing but the primary action is accent-painted at all", async () => {
    const { container } = mount();
    await openOverlay(container);
    const controls = narrativeControls(container);

    // `-on` is excluded HERE and only here: this assertion is scoped to the resting frame, and an
    // accent outline is how this app says "this is currently on". B1 above is what holds the states.
    const resting = (sel: string) => interaction(sel) || /-on\b/.test(sel);
    const why = paintedBy(
      controls,
      accentRules(/^(background(-color)?|border(-[a-z]+)?(-color)?)$/),
      resting,
    );
    expect(
      [...why.keys()].length,
      "ONE dominant action per room. At rest these narrative-column controls are painted with an " +
        `accent background or border:\n  ${cite(why)}`,
    ).toBe(1);
    expect([...why.keys()][0].className, "and it is the room's primary action").toContain("mc-start");
  });

  it("C: every control that shipped is still here, in the same Tab order", async () => {
    const { container } = mount();
    await openOverlay(container);
    // Pinned from the installed 73b629ed build. Demoting and grouping may change how these LOOK;
    // it may never change which of them exist, or the order Tab walks them.
    expect(narrativeControls(container).map(describeControl)).toEqual([
      "button.mc-start[Start capture]",
      "tab.seg-btn[Live]",
      "tab.seg-btn[Sessions]",
      "button.kl-term[How capture works]",
      "button.mc-cap[Overlay on]",
      "button.mc-ov-corner[Overlay corner top left]",
      "button.mc-ov-corner[Overlay corner top right]",
      "button.mc-ov-corner[Overlay corner bottom left]",
      "button.mc-ov-corner[Overlay corner bottom right]",
      "button.mc-ov-seg[Min]",
      "button.mc-ov-seg[Std]",
      "button.mc-ov-seg[Full]",
      "button.mc-ov-seg[Overlay background]",
      "button.v2-quiet[▸Tuning presetsby-hand checklists ]",
      "button.chip[Max Quality2]",
      "button.chip[More FPS4]",
      "button.chip[Lower Latency2]",
      "button.v2-route-row[View all sessions in History›]",
      "button.kl-term[Watched from outside your game]",
    ]);
  });
});
