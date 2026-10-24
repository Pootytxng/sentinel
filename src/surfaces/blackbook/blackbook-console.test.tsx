import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { BlackbookConsole } from "./BlackbookConsole";
import { LogbookTape } from "./LogbookTape";
import { useLogbookView } from "./logbook-view";
import { useReducedMotion } from "../../design/use-motion";
import { BlackbookV2 } from "../BlackbookV2";
import type {
  LogbookRecord,
  LogbookChange,
  LogbookSession,
  LogbookAutopsy,
} from "./logbook";
import type { SessionSummary, LedgerHealth } from "../../types";
import type { InEffectCounts } from "../../data/machine-model";

// Guards for the Logbook console face (Console HUD Phase 4). Covers the T4 rails: honest empty
// (never a fabricated row), title-header law (h1 = bare "Blackbook", status in the body),
// theme-accent-only / no vendor purple, reduced-motion stillness, the naming rail (no second
// "Black Box"), and the undo affordance's mutation wiring (fires the audited handler ONLY for a
// genuinely-active change, with the right id).

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

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const change = (over: Partial<LogbookChange> = {}): LogbookChange => ({
  kind: "change",
  at: Date.parse("2026-07-10T12:00:00Z"),
  id: "c1",
  recId: "hags",
  title: "Enable Hardware-accelerated GPU scheduling",
  active: true,
  unconfirmed: false,
  rolledBack: false,
  restoresLabel: "Off",
  appliedLabel: "On",
  payoffLabel: "Input latency",
  count: 1,
  firstAt: Date.parse("2026-07-10T12:00:00Z"),
  ...over,
});
const session = (over: Partial<LogbookSession> = {}): LogbookSession => ({
  kind: "session",
  at: Date.parse("2026-07-09T20:00:00Z"),
  game: "valorant.exe",
  avgFps: 240,
  low1Fps: 190,
  durationSecs: 3600,
  changesActive: 1,
  avgFpsDelta: null,
  ...over,
});
const autopsy = (over: Partial<LogbookAutopsy> = {}): LogbookAutopsy => ({
  kind: "autopsy",
  at: Date.parse("2026-07-08T08:00:00Z"),
  real: 2,
  placebo: 1,
  risky: 0,
  unknown: 0,
  scamFlags: 0,
  ...over,
});

// THE ROOM IS TWO SIBLINGS NOW. `useLogbookView` holds the state they share (the strip's filter
// drives the tape), `LogbookTape` is RoomShell's evidence column and `BlackbookConsole` is the
// supporting grid beneath both columns -- see logbook-view.ts. Mounting them together is what
// BlackbookV2 does, so it is what these guards must do: every assertion below is about the pair.
// The Machine Model's in-effect count (#625). Default: one change on, none unconfirmed.
const COUNTED_ONE: InEffectCounts = { kind: "counted", activeNow: 1, unknown: 0, totalRecorded: 1 };

function Logbook({
  records,
  health = null,
  onReviewSession,
  inEffect = COUNTED_ONE,
  ...over
}: {
  records: LogbookRecord[];
  health?: LedgerHealth | null;
  onReviewSession?: () => void;
} & Partial<Omit<Parameters<typeof BlackbookConsole>[0], "view">>) {
  const view = useLogbookView(records, health);
  const reduced = useReducedMotion();
  return (
    <>
      <LogbookTape view={view} reduced={reduced} onReviewSession={onReviewSession} />
      <BlackbookConsole
        view={view}
        vendor="amd"
        onOpenLab={() => {}}
        onOpenGuide={() => {}}
        inEffect={inEffect}
        {...over}
      />
    </>
  );
}

function mountConsole(
  records: LogbookRecord[],
  over: Partial<Omit<Parameters<typeof BlackbookConsole>[0], "view">> = {},
) {
  return render(<Logbook records={records} {...over} />);
}

describe("BlackbookConsole — honest empty (never a fabricated row)", () => {
  it("no records ⇒ the honest empty state, no tape", () => {
    useReduced();
    const { container } = mountConsole([]);
    expect(container.querySelector(".bc-empty")).not.toBeNull();
    expect(container.querySelector(".bc-tape")).toBeNull();
    expect(screen.getByText("No record yet")).toBeTruthy();
    // The Receipts Strip is UNCONDITIONAL since the bento conversion: the room is a strict
    // row-major grid with no dense flow, so a half tile that vanishes leaves the 2-row hero's
    // remainder as a visible hole. Its zero-state is already honest (every count 0, every tile
    // disabled, "nothing changed yet"), so showing it costs no truth. What must stay gone is the
    // tape head — a "since <date>" line with no rows behind it IS a claim about the machine.
    const strip = container.querySelector(".bc-strip")!;
    expect(strip).not.toBeNull();
    for (const tile of strip.querySelectorAll(".bc-tile")) {
      expect(tile.querySelector(".bc-tile-n")!.textContent).toBe("0");
      expect((tile as HTMLButtonElement).disabled).toBe(true);
    }
    expect(container.querySelector(".bc-sect")).toBeNull();
  });
});

describe("BlackbookConsole — the tape renders each real record kind", () => {
  it("change / session / autopsy rows all render with real content", () => {
    useReduced();
    const { container } = mountConsole([change(), session(), autopsy()]);
    const rows = container.querySelectorAll(".bc-tape .bc-row");
    expect(rows.length).toBe(3);
    expect(container.querySelector(".bc-row-change")).not.toBeNull();
    expect(container.querySelector(".bc-row-session")).not.toBeNull();
    expect(container.querySelector(".bc-row-autopsy")).not.toBeNull();
    // the Receipts Strip states the per-kind counts in the BODY (title-header law)
    const tiles = container.querySelectorAll(".bc-strip .bc-tile");
    expect(tiles.length).toBe(3);
    for (const tile of tiles) expect(tile.querySelector(".bc-tile-n")!.textContent).toBe("1");
    // session prettifies the process name (drops .exe; casing left as-is — game exes carry their own)
    expect(screen.getByText("valorant")).toBeTruthy();
    // autopsy uses the plain "Guide check" tag, never "autopsy"/"Black Box"
    expect(container.textContent).toContain("Guide check");
  });

  // Sentence grammar (owner pick 2026-07-13, concept B): every row is a plain sentence with an
  // actor, so any single row explains the page. Pin one per kind.
  it("rows read as actor sentences: 'Compy applied…', 'You played…', 'You fact-checked…'", () => {
    useReduced();
    const { container } = mountConsole([change(), session(), autopsy()]);
    const text = container.querySelector(".bc-tape")!.textContent!;
    expect(text).toContain("Compy applied");
    expect(text).toContain("You played");
    expect(text).toContain("for 1h 0m"); // duration lives IN the session sentence now
    expect(text).toContain("You fact-checked a guide");
  });

  // REWRITTEN 2026-08-23, and the rewrite is a TIGHTENING. This used to pin the tape's head as
  // "The record" + "everything Compy has done on this PC · since <date>". 03-history-approved.png
  // draws nothing above the first month head, and that is only safe to follow because the widest
  // CLAIM went out with the chrome: no line on this screen now says the record is complete, so
  // there is nothing left needing a bound. What is pinned instead is the stronger honesty rule --
  // a healthy, unfiltered tape asserts NOTHING about its own completeness, and the head appears
  // only in the two states that NARROW it (a filter is on, or the ledger is known incomplete).
  it("a healthy unfiltered tape claims nothing about its own completeness", () => {
    useReduced();
    const { container } = mountConsole([session()]);
    expect(container.querySelector(".bc-sect"), "the tape drew a head with nothing to say").toBeNull();
    expect(container.textContent).not.toContain("everything Compy has done on this PC");
  });

  it("...and the head returns the moment the tape is showing a slice", () => {
    useReduced();
    const { container } = mountConsole([session(), change()]);
    fireEvent.click(container.querySelector('.bc-tile[data-kind="change"]')!);
    const sect = container.querySelector(".bc-sect");
    expect(sect, "a filtered tape must say it is filtered").not.toBeNull();
    expect(sect!.textContent).toContain("only");
  });

  // bug→guard (autopsy LOW, 2026-07-14): a 59m50s session (3590s) used to render the impossible
  // "60m" — the minute-part rounded to 60 while the hour-part stayed 0. Rounding to whole minutes
  // FIRST carries the overflow into the hour, so it reads "1h 0m" and no "60m" can ever appear.
  it("a sub-hour session that rounds to 60 minutes reads '1h 0m', never '60m'", () => {
    useReduced();
    const { container } = mountConsole([session({ durationSecs: 3590 })]);
    const text = container.querySelector(".bc-tape")!.textContent!;
    expect(text).toContain("for 1h 0m");
    expect(text).not.toContain("60m");
  });

  it("same-game vs-previous delta renders only when present, never '(s)'", () => {
    useReduced();
    const { container } = mountConsole([session({ avgFpsDelta: 30 }), session({ avgFpsDelta: null })]);
    const deltas = container.querySelectorAll(".bc-delta");
    expect(deltas.length).toBe(1); // only the one with a same-game prior
    expect(deltas[0].textContent).toContain("+30 fps vs last");
    expect(container.textContent).not.toContain("(s)");
  });
});

describe("BlackbookConsole — a collapsed repeat states its count (C-11)", () => {
  // buildLogbook folds repeats; this pins that the row SAYS so. A fold the UI doesn't narrate is
  // just missing history — the count and the start date are what make the collapse honest.
  it("count > 1 renders 'applied N times since <date>'; count 1 renders no such note", () => {
    useReduced();
    const { container } = mountConsole([
      change({
        count: 37,
        firstAt: Date.parse("2026-05-28T10:00:00Z"),
        title: "Enable Windows Game Mode",
      }),
    ]);
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(1);
    const note = container.querySelector(".bc-repeat");
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("37");
    // The date is locale-formatted; assert the month it must name rather than a fixed string.
    expect(note!.textContent).toMatch(/May/);

    cleanup();
    const single = mountConsole([change()]).container;
    expect(single.querySelector(".bc-repeat")).toBeNull();
  });
});

describe("BlackbookConsole — undo is NOT triggered in-room; active changes route to the Lab", () => {
  it("no in-room Undo button — the Logbook is a read view (undo lives in the Lab, no second surface)", () => {
    useReduced();
    mountConsole([change({ active: true })]);
    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rolling back/i })).toBeNull();
  });

  it("≥1 active change ⇒ a single 'undo in Test' jump that calls onOpenLab", () => {
    useReduced();
    const onOpenLab = vi.fn();
    mountConsole([change({ id: "c1", active: true }), change({ id: "c2", active: true })], {
      onOpenLab,
    });
    // Action-first, plain words (intimidation pass 2026-08-20): "N changes still active — roll
    // back" read as a warning above a room that had not yet explained itself.
    const jump = screen.getByRole("button", { name: /undo any of the 2 changes in Test/i });
    fireEvent.click(jump);
    expect(onOpenLab).toHaveBeenCalledOnce();
  });

  it("singular copy for one active change", () => {
    useReduced();
    mountConsole([change({ active: true })]);
    expect(screen.getByRole("button", { name: /undo the 1 change in Test/i })).not.toBeNull();
  });

  it("no active changes ⇒ no jump (rolled-back / no-longer-active never summon it)", () => {
    useReduced();
    mountConsole([change({ active: false, rolledBack: true }), change({ active: false })]);
    expect(screen.queryByRole("button", { name: /in Test/i })).toBeNull();
  });

  // #625: a change Compy cannot confirm is still in place may still be in place, so its undo
  // stays one press away. It is counted beside the ones confirmed on.
  it("a change Compy can't confirm still summons the jump, counted with the confirmed ones", () => {
    useReduced();
    const onOpenLab = vi.fn();
    mountConsole(
      [
        change({ id: "c1", active: true }),
        change({ id: "c2", active: false, unconfirmed: true }),
        change({ id: "c3", active: false }),
      ],
      { onOpenLab },
    );
    fireEvent.click(screen.getByRole("button", { name: /undo any of the 2 changes in Test/i }));
    expect(onOpenLab).toHaveBeenCalledOnce();
  });
});

// #625: Health said "can't confirm" where History said "still on" for the same change. A row whose
// live check could not be read now says so, and never claims it is on.
describe("BlackbookConsole — a change Compy can't confirm never reads 'still on' (#625)", () => {
  it("the row states it can't confirm the change, not 'still on' or 'no longer active'", () => {
    useReduced();
    const { container } = mountConsole([change({ active: false, unconfirmed: true })]);
    const row = container.querySelector(".bc-row")!;
    expect(row.textContent).toContain("can't confirm it's still in place");
    expect(row.textContent).not.toMatch(/still on/i);
    expect(row.textContent).not.toMatch(/no longer active/i);
  });

  it("an unconfirmed row keeps its 'undo restores' note — the undo may still have work to do", () => {
    useReduced();
    const on = mountConsole([change({ active: true })]).container.querySelector(".bc-row")!
      .textContent;
    cleanup();
    const unconfirmed = mountConsole([change({ active: false, unconfirmed: true })]).container
      .querySelector(".bc-row")!.textContent;
    cleanup();
    const off = mountConsole([change({ active: false })]).container.querySelector(".bc-row")!
      .textContent;
    // The note names the value undo restores ("Off"); read it off the confirmed-on row so this
    // test does not pin the copy around it.
    const note = on!.slice(on!.indexOf("still on") + "still on".length).trim();
    expect(note).toContain("Off");
    expect(unconfirmed).toContain(note);
    expect(off).not.toContain(note);
  });
});

describe("BlackbookConsole — the library strip doors into the field guide", () => {
  it("start-here picks deep-link (onOpenGuide with an id); the door opens all (undefined)", () => {
    useReduced();
    const onOpenGuide = vi.fn();
    const { container } = mountConsole([], { onOpenGuide });
    const picks = container.querySelectorAll(".bc-pick");
    expect(picks.length).toBeGreaterThan(0);
    fireEvent.click(picks[0]);
    expect(onOpenGuide).toHaveBeenCalledOnce();
    expect(typeof onOpenGuide.mock.calls[0][0]).toBe("string"); // a real entry id
    onOpenGuide.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Open the field guide/ }));
    expect(onOpenGuide).toHaveBeenCalledOnce();
    expect(onOpenGuide.mock.calls[0]).toEqual([]); // no focus id ⇒ browse the whole guide
  });
});

describe("BlackbookConsole — reduced motion is still", () => {
  it("data-motion='reduced' and no inline animation-delay on the rows", () => {
    useReduced();
    const { container } = mountConsole([change(), session()]);
    // On the TAPE, not the console root: the rows moved to the room's evidence column, and the
    // reveal is gated on `[data-motion="full"] .bc-row`. A switch set on an ancestor the rows no
    // longer have is a switch that silently stopped working — which is what happened.
    const root = container.querySelector(".bc-tape") as HTMLElement;
    expect(root.dataset.motion).toBe("reduced");
    for (const row of container.querySelectorAll<HTMLElement>(".bc-row")) {
      expect(row.style.animationDelay).toBe("");
    }
  });
});

describe("BlackbookV2 console — title-header law + honest data flow", () => {
  it("h1 is the room's own sentence; the record count lives in the body, not the header", () => {
    useReduced();
    localStorage.setItem("compy_blackbook_console", "1"); // editorial default ON
    const s: SessionSummary = {
      started_at: "2026-07-09T20:00:00Z",
      duration_secs: 3600,
      process_name: "valorant.exe",
      samples: 3400,
      avg_fps: 240,
      avg_frametime_ms: 4.2,
      low1_fps_est: 190,
      peak_gpu_temp_c: 72,
      peak_gpu_usage_pct: 98,
      peak_ram_used_bytes: null,
      ram_total_bytes: null,
      compy_changes_active: 1,
    } as SessionSummary;
    const { container } = render(
      <BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} sessions={[s]} />,
    );
    // The HUD masthead is gone (issue #49 slice 5, following Live in slice 4). The h1 is the
    // room's own sentence now, exactly as 03-history-approved.png draws it, above a dotted
    // eyebrow. What this guard has always been about survives untouched below: no COUNT is
    // allowed into a heading.
    expect(container.querySelector(".hud-headline")).toBeNull();
    const h1 = container.querySelector(".v2-verdict h1") as HTMLElement;
    expect(h1.textContent).toContain("What changed, and when");
    expect(container.querySelector(".v2-eyebrow")!.textContent).toContain("Local record");
    expect(h1.textContent).not.toMatch(/\d/);
    // the counts live in the body Receipts Strip, never a heading
    const strip = container.querySelector(".bc-strip") as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip.textContent).toContain("Gaming sessions");
    expect(strip.closest("h1")).toBeNull();
  });
});

// ── the Receipts Strip's filter (owner pick 2026-07-13, concept A) ──
describe("BlackbookConsole — Receipts Strip filters the tape honestly", () => {
  it("clicking a tile filters the tape to that kind; clicking again restores the full tape", () => {
    useReduced();
    const { container } = mountConsole([change(), session(), autopsy()]);
    const sessionTile = screen.getByRole("button", { name: /Gaming sessions/ });
    fireEvent.click(sessionTile);
    expect(sessionTile.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(1);
    expect(container.querySelector(".bc-row-session")).not.toBeNull();
    expect(container.querySelector(".bc-row-change")).toBeNull();
    // the tape head states the narrowed view — never a silently filtered list
    expect(container.querySelector(".bc-sect")!.textContent).toContain("sessions only");
    fireEvent.click(sessionTile);
    expect(sessionTile.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(3);
  });

  it("a zero-count tile is disabled (an honest empty beats an empty filtered tape)", () => {
    useReduced();
    mountConsole([session()]);
    const changeTile = screen.getByRole("button", { name: /Changes Compy made/ });
    expect((changeTile as HTMLButtonElement).disabled).toBe(true);
    expect(changeTile.textContent).toContain("nothing changed yet");
  });

  // #638 (PR #634 follow-on): the tile counts every change in the ledger, including ones a stamp
  // says were made on other hardware. "Changes to this PC" claimed they all happened here; the
  // title names who made them instead, and says nothing about which machine.
  it("the changes tile title does not claim every change was made on this PC", () => {
    useReduced();
    const { container } = mountConsole([change()]);
    const title = container.querySelector(".bc-strip .bc-tile-k")!.textContent ?? "";
    expect(title).toBe("Changes Compy made");
    expect(title).not.toMatch(/this PC/i);
  });

  it("tile subs state real composition: scam flags from the records, in-effect words from the model", () => {
    useReduced();
    const { container } = mountConsole([
      change({ id: "c1", active: true }),
      change({ id: "c2", active: false, rolledBack: true }),
      autopsy({ scamFlags: 2 }),
    ]);
    const strip = container.querySelector(".bc-strip")!;
    expect(strip.textContent).toContain("1 still on · every one undoable");
    expect(strip.textContent).toContain("2 scam patterns flagged");
  });

  // #625: the changes tile prints how many are in effect from the Machine Model — the number Health
  // prints — never a fold over the tape. These records say "2 on"; the model says otherwise, and
  // the model wins.
  const twoOn = () => [change({ id: "c1", active: true }), change({ id: "c2", active: true })];
  const changesSub = (inEffect: InEffectCounts) =>
    mountConsole(twoOn(), { inEffect }).container.querySelector('.bc-tile[data-kind="change"] .bc-tile-d')!
      .textContent;

  it("the changes tile prints the model's counts, unconfirmed ones named apart (#625)", () => {
    useReduced();
    expect(changesSub({ kind: "counted", activeNow: 10, unknown: 6, totalRecorded: 30 })).toBe(
      "10 still on · 6 can't confirm",
    );
  });

  it("with nothing unconfirmed the tile keeps its old words, from the model's number", () => {
    useReduced();
    expect(changesSub({ kind: "counted", activeNow: 7, unknown: 0, totalRecorded: 9 })).toBe(
      "7 still on · every one undoable",
    );
    cleanup();
    expect(changesSub({ kind: "counted", activeNow: 0, unknown: 0, totalRecorded: 9 })).toBe(
      "none active now · every one undoable",
    );
  });

  // An empty ledger's words are the ledger's claim, qualified by ledger health — not the model's.
  // The model is never read with the Intelligence flag off, so it must not be able to blank them,
  // and an unreadable LEDGER still overrides everything (Codex r1 on PR 634, answered by design).
  it("zero changes: the ledger's own words stand whatever the model's state", () => {
    useReduced();
    const zeroSub = (inEffect: InEffectCounts, health: LedgerHealth | null = null) =>
      render(<Logbook records={[]} inEffect={inEffect} health={health} />).container.querySelector(
        '.bc-tile[data-kind="change"] .bc-tile-d',
      )!.textContent;
    for (const inEffect of [
      { kind: "pending" },
      { kind: "unreadable", reason: "model read failed" },
      { kind: "counted", activeNow: 0, unknown: 0, totalRecorded: 0 },
    ] as InEffectCounts[]) {
      expect(zeroSub(inEffect)).toBe("nothing changed yet");
      cleanup();
      expect(zeroSub(inEffect, { complete: false, error: "history.json is locked", quarantined: false })).toBe(
        "can't be read right now",
      );
      cleanup();
    }
  });

  it("a model not read yet prints no in-effect words; an unreadable one says so", () => {
    useReduced();
    expect(changesSub({ kind: "pending" })).toBe("");
    cleanup();
    expect(changesSub({ kind: "unreadable", reason: "history.json is locked" })).toBe(
      "can't be read right now",
    );
  });
});

// ── source-level rails (read the real files, like tokens-v2-guard) ──
const src = (...p: string[]) => readFileSync(join("src", ...p), "utf8");
const consoleCss = src("surfaces", "blackbook", "blackbook-console.css");
const consoleTsx = src("surfaces", "blackbook", "BlackbookConsole.tsx");
const logbookTs = src("surfaces", "blackbook", "logbook.ts");

describe("BlackbookConsole — theme accent only, no vendor purple", () => {
  it("blackbook-console.css uses --ix-accent and never the vendor purple literal", () => {
    expect(consoleCss).toContain("--ix-accent");
    expect(consoleCss).not.toMatch(/132\s*,\s*0\s*,\s*255/); // rgb vendor purple
    expect(consoleCss.toLowerCase()).not.toContain("8400ff"); // hex vendor purple
  });
});

// bug→guard (owner catch 2026-07-13): the reveal animation's fill-mode `both` stayed applied after
// the animation finished, making EVERY tape row a permanent stacking context (a filled transform/
// opacity animation does that) — sibling contexts paint in DOM order, so the rows BELOW an open
// Term tooltip painted their text OVER it ("1% low" gloss buried under later rows). The fill must
// be `backwards`: rows stay hidden through their stagger delay, then the fill drops and the
// tooltip's z-index works. Any filled (`both`/`forwards`) animation on .bc-row re-opens the class.
describe("BlackbookConsole — tape rows must not be permanent stacking contexts (tooltip overpaint)", () => {
  it("the .bc-row reveal uses fill-mode `backwards`, never `both`/`forwards`", () => {
    const live = consoleCss.replace(/\/\*[\s\S]*?\*\//g, ""); // scan live CSS, not the comments
    const rowAnim = live.match(/\.bc-row\s*\{[^}]*animation:[^;}]*/g) ?? [];
    expect(rowAnim.length, "the staggered reveal must still exist").toBeGreaterThan(0);
    for (const decl of rowAnim) {
      expect(decl).toContain("backwards");
      expect(decl).not.toMatch(/\bboth\b/);
      expect(decl).not.toMatch(/\bforwards\b/);
    }
  });
});

// Strip block + line comments so the guard scans CODE/COPY, not the comments that document the
// rail itself (which legitimately name "Black Box" to explain why the copy must avoid it). The
// //-strip requires the preceding char not be ':' so it never eats "https://".
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("BlackbookConsole — naming rail (no second 'Black Box')", () => {
  it("the new Blackbook-console copy never introduces 'Black Box' (BlackBox.tsx collision)", () => {
    for (const s of [consoleCss, consoleTsx, logbookTs]) {
      expect(stripComments(s)).not.toMatch(/black\s+box/i);
    }
  });
});

// The tape mounts the RECENT slice, never the machine's whole lifetime in one synchronous render —
// an uncapped map over every record ever kept was the dominant Blackbook nav-mount cost (80–152ms,
// scaling with history; nav-mount follow-up, BACKLOG cycle 2026-07-15d). The cap is honest: the
// strip counts still speak for the FULL record set, and one press unrolls the rest.
describe("BlackbookConsole — the tape caps its first render (nav-mount guard)", () => {
  const many = (n: number): LogbookRecord[] =>
    Array.from({ length: n }, (_, i) =>
      change({ at: Date.parse("2026-07-10T12:00:00Z") - i * 60_000, id: `c${i}`, title: `Tweak ${i}` }),
    );

  // 30 → 8 (intimidation pass 2026-08-20): the record is the bento's hero, and a 30-row hero
  // stretched the two left tiles into hollow columns three viewports tall. Eight is a screenful.
  it("renders at most 8 rows before the press, states the exact older count, unrolls on press", () => {
    useReduced();
    const { container } = mountConsole(many(35));
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(8);
    const more = container.querySelector<HTMLButtonElement>(".bc-tape-more");
    expect(more).not.toBeNull();
    expect(more!.textContent).toContain("27 older records");
    // the strip's count is derived from the FULL records — the cap never understates the ledger
    expect(
      container.querySelector('.bc-tile[data-kind="change"] .bc-tile-n')!.textContent,
    ).toBe("35");
    fireEvent.click(more!);
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(35);
    expect(container.querySelector(".bc-tape-more")).toBeNull();
  });

  it("a tape at or under the cap shows every row and no disclosure button", () => {
    useReduced();
    const { container } = mountConsole(many(8));
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(8);
    expect(container.querySelector(".bc-tape-more")).toBeNull();
  });
});

// Intimidation pass 2026-08-20 (⭐ standing directive: grouping, boxed templates, fewer words —
// never a switch). The flat log became a month-grouped timeline, and the row lost the fixed
// timestamp track that the installed build showed overrunning into the title on every row.
describe("BlackbookConsole — the tape is grouped by month and the row cannot overlap", () => {
  const at = (iso: string) => Date.parse(iso);

  it("rows sit under month heads, newest month first, every row in its own month, order kept", () => {
    useReduced();
    const { container } = mountConsole([
      change({ id: "a", at: at("2026-08-20T16:24:00"), title: "August one" }),
      session({ at: at("2026-08-14T18:15:00"), game: "Aug game" }),
      change({ id: "b", at: at("2026-06-15T17:51:00"), title: "June one" }),
      change({ id: "c", at: at("2026-06-03T06:08:00"), title: "June two" }),
    ]);
    const months = Array.from(container.querySelectorAll<HTMLElement>(".bc-tape .bc-month"));
    expect(months.map((m) => m.querySelector(".bc-month-h")!.textContent)).toEqual([
      "August 2026",
      "June 2026",
    ]);
    expect(months[0].querySelectorAll(".bc-row").length).toBe(2);
    expect(months[1].querySelectorAll(".bc-row").length).toBe(2);
    // Grouping never reorders: the flat row order is still newest-first across the groups.
    const titles = Array.from(container.querySelectorAll(".bc-tape .bc-row-title")).map(
      (e) => e.textContent,
    );
    expect(titles.indexOf(titles.find((x) => x!.includes("August one"))!)).toBe(0);
    expect(titles.findIndex((x) => x!.includes("June two"))).toBe(3);
    // The month head is a real heading (AT users get the same orientation), below the tile's h3.
    expect(months[0].querySelector("h4.bc-month-h")).not.toBeNull();
  });

  it("the cap applies to rows, not months: 8 rows across however many months they span", () => {
    useReduced();
    const rows = Array.from({ length: 12 }, (_, i) =>
      change({ id: `m${i}`, at: at("2026-08-01T12:00:00") - i * 20 * 86_400_000, title: `T${i}` }),
    );
    const { container } = mountConsole(rows);
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(8);
    expect(container.querySelectorAll(".bc-tape .bc-month").length).toBeGreaterThan(1);
  });

  it("the timestamp lives inside the row body (shares the title line) — never its own row track", () => {
    useReduced();
    const { container } = mountConsole([change({ at: at("2026-08-20T16:24:00") })]);
    const row = container.querySelector<HTMLElement>(".bc-row")!;
    // DOM: tag, then body; the time is the body's child, not the row's.
    expect(row.querySelector(":scope > .bc-time")).toBeNull();
    expect(row.querySelector(":scope > .bc-row-body > .bc-time")).not.toBeNull();
    expect(row.querySelector(":scope > .bc-row-body > .bc-row-title")).not.toBeNull();
  });

  it("CSS: .bc-row declares exactly two grid tracks; the body pins title and time to one line", () => {
    const css = stripComments(consoleCss);
    const row = css.match(/\.bc-row\s*\{[^}]*grid-template-columns:\s*([^;]+);/);
    expect(row, ".bc-row must stay a grid").not.toBeNull();
    // Count top-level tracks (minmax(...) is one track).
    const tracks = row![1].replace(/\([^)]*\)/g, "()").trim().split(/\s+/);
    expect(tracks.length).toBe(2);
    expect(css).toMatch(/\.bc-row-body\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.bc-row-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
    expect(css).toMatch(/\.bc-time\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.bc-time\s*\{[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.bc-row-title\s*\{[^}]*grid-column:\s*1/);
    // The chevron is the body's third track (the newest row's "review this session" twin), so
    // it is excluded from the full-width sweep alongside the title and the time.
    expect(css).toMatch(/\.bc-row-go\s*\{[^}]*grid-column:\s*3/);
    // Everything else the body holds spans the full width.
    expect(css).toMatch(
      /\.bc-row-body\s*>\s*:not\(\.bc-row-title\):not\(\.bc-time\):not\(\.bc-row-go\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/,
    );
  });
});
