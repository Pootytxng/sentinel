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
    // No count status line when there is nothing to count.
    expect(container.querySelector(".bc-status")).toBeNull();
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
    // status line states the count in the BODY (title-header law) — plural-proper.
    expect(container.querySelector(".bc-status")!.textContent).toContain("3 records");
    // session prettifies the process name (drops .exe; casing left as-is — game exes carry their own)
    expect(screen.getByText("valorant")).toBeTruthy();
    // autopsy uses the plain "Guide check" tag, never "autopsy"/"Black Box"
    expect(container.textContent).toContain("Guide check");
  });

  it("singular 'record' when there is one", () => {
    useReduced();
    const { container } = mountConsole([session()]);
    expect(container.querySelector(".bc-status")!.textContent).toContain("1 record");
    expect(container.querySelector(".bc-status")!.textContent).not.toContain("1 records");
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
    const jump = screen.getByRole("button", { name: /roll back in the Lab/i });
    expect(jump.textContent).toContain("2 changes still active");
    fireEvent.click(jump);
    expect(onOpenLab).toHaveBeenCalledOnce();
  });

  it("singular copy for one active change", () => {
    useReduced();
    mountConsole([change({ active: true })]);
    expect(
      screen.getByRole("button", { name: /roll back in the Lab/i }).textContent,
    ).toContain("1 change still active");
  });

  it("no active changes ⇒ no jump (rolled-back / no-longer-active never summon it)", () => {
    useReduced();
    mountConsole([change({ active: false, rolledBack: true }), change({ active: false })]);
    expect(screen.queryByRole("button", { name: /roll back in the Lab/i })).toBeNull();
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
    expect((container.querySelector(".hud-headline") as HTMLElement).textContent).toBe("Blackbook");
    // the count is a body element, never a heading
    const status = container.querySelector(".bc-status") as HTMLElement;
    expect(status).not.toBeNull();
    expect(status.textContent).toContain("record");
    expect(status.closest("h1")).toBeNull();
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
