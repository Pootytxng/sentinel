import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { BlackbookConsole } from "./BlackbookConsole";
import { BlackbookV2 } from "../BlackbookV2";
import type {
  LogbookRecord,
  LogbookChange,
  LogbookSession,
  LogbookAutopsy,
} from "./logbook";
import type { SessionSummary } from "../../types";

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
  title: "Enable Hardware-accelerated GPU scheduling",
  active: true,
  rolledBack: false,
  restoresLabel: "Off",
  appliedLabel: "On",
  payoffLabel: "Input latency",
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

function mountConsole(records: LogbookRecord[], over: Partial<Parameters<typeof BlackbookConsole>[0]> = {}) {
  return render(
    <BlackbookConsole
      records={records}
      vendor="amd"
      onOpenLab={vi.fn()}
      onOpenGuide={vi.fn()}
      {...over}
    />,
  );
}

describe("BlackbookConsole — honest empty (never a fabricated row)", () => {
  it("no records ⇒ the honest empty state, no tape", () => {
    useReduced();
    const { container } = mountConsole([]);
    expect(container.querySelector(".bc-empty")).not.toBeNull();
    expect(container.querySelector(".bc-tape")).toBeNull();
    expect(screen.getByText("No record yet")).toBeTruthy();
    // No Receipts Strip (and no tape head) when there is nothing to count.
    expect(container.querySelector(".bc-strip")).toBeNull();
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

  it("the tape head speaks the field-guide grammar: 'The record' + the since date", () => {
    useReduced();
    const { container } = mountConsole([session()]);
    const sect = container.querySelector(".bc-sect")!;
    expect(sect.textContent).toContain("The record");
    expect(sect.textContent).toContain("everything Compy has done on this PC");
    expect(sect.textContent).toMatch(/since\s/);
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

describe("BlackbookConsole — undo is NOT triggered in-room; active changes route to the Lab", () => {
  it("no in-room Undo button — the Logbook is a read view (undo lives in the Lab, no second surface)", () => {
    useReduced();
    mountConsole([change({ active: true })]);
    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rolling back/i })).toBeNull();
  });

  it("≥1 active change ⇒ a single 'roll back in the Lab' jump that calls onOpenLab", () => {
    useReduced();
    const onOpenLab = vi.fn();
    mountConsole([change({ id: "c1", active: true }), change({ id: "c2", active: true })], {
      onOpenLab,
    });
    const jump = screen.getByRole("button", { name: /roll back in Test/i });
    expect(jump.textContent).toContain("2 changes still active");
    fireEvent.click(jump);
    expect(onOpenLab).toHaveBeenCalledOnce();
  });

  it("singular copy for one active change", () => {
    useReduced();
    mountConsole([change({ active: true })]);
    expect(
      screen.getByRole("button", { name: /roll back in Test/i }).textContent,
    ).toContain("1 change still active");
  });

  it("no active changes ⇒ no jump (rolled-back / no-longer-active never summon it)", () => {
    useReduced();
    mountConsole([change({ active: false, rolledBack: true }), change({ active: false })]);
    expect(screen.queryByRole("button", { name: /roll back in Test/i })).toBeNull();
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
    const root = container.querySelector(".blackbook-console") as HTMLElement;
    expect(root.dataset.motion).toBe("reduced");
    for (const row of container.querySelectorAll<HTMLElement>(".bc-row")) {
      expect(row.style.animationDelay).toBe("");
    }
  });
});

describe("BlackbookV2 console — title-header law + honest data flow", () => {
  it("h1 is the bare title 'Blackbook'; the record count lives in the body, not the header", () => {
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
    expect((container.querySelector(".hud-headline") as HTMLElement).textContent).toBe("History");
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
    const changeTile = screen.getByRole("button", { name: /Changes to this PC/ });
    expect((changeTile as HTMLButtonElement).disabled).toBe(true);
    expect(changeTile.textContent).toContain("nothing changed yet");
  });

  it("tile subs state real composition: active changes + scam flags, from the records themselves", () => {
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

  it("renders at most 30 rows before the press, states the exact older count, unrolls on press", () => {
    useReduced();
    const { container } = mountConsole(many(35));
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(30);
    const more = container.querySelector<HTMLButtonElement>(".bc-tape-more");
    expect(more).not.toBeNull();
    expect(more!.textContent).toContain("5 older records");
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
    const { container } = mountConsole(many(30));
    expect(container.querySelectorAll(".bc-tape .bc-row").length).toBe(30);
    expect(container.querySelector(".bc-tape-more")).toBeNull();
  });
});
