import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Lab + the embedded Benchmark/Latency tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { LabV2 } from "./LabV2";
import Lab from "./Lab";
import { labVerdict, labLatestReadings } from "./lab-v2-data";
import { invalidateProbe, putProbe } from "../data/probe-cache";
import type { BenchmarkState, Efficacy, LatencyReport } from "../types";

// V2-7 guards (bug→guard tier 1): the V2 Lab room composes RoomShell (one verdict, NO door —
// Lab is the journey's last chapter — and deliberately NO primary action: the instruments ARE
// the work), its verdict is a PURE derivation from the same benchmark state the Benchmark card
// grades (honest nothing-graded state; the grade names its measured evidence in the same breath
// — the punch (h) law; branch-proper copy, never "(s)"), the measured line's instrument count is
// computed from the same gates the body uses (never hardcoded), the one-mention law holds (Lab's
// standalone head yields to the room verdict), and the CLASSIC Lab render stays pinned unchanged.

beforeAll(() => {
  // jsdom lacks the observers the vendored DecryptedText uses; inert stubs, animation never starts.
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
  invalidateProbe(); // the probe cache is module-level — isolate the bench seed between tests
});

// This suite pins the CLASSIC room + Lab-face composition — the Instrument HUD and the Lab
// bento are default-ON since the 2026-07-06 owner approval, so the classic trees live behind
// the "0" failsafes; the flag-on contracts are pinned in hud-rooms-flag.test.tsx and
// lab-bento.test.tsx.
beforeEach(() => {
  localStorage.setItem("compy_editorial", "0");
  localStorage.setItem("compy_lab_bento", "0");
});

const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const state = (over: Partial<BenchmarkState> = {}): BenchmarkState => ({
  running: false,
  latest: null,
  latest_at: null,
  baseline: null,
  baseline_at: null,
  efficacy: null,
  error: null,
  ...over,
});

const efficacy = (over: Partial<Efficacy> = {}): Efficacy => ({
  per_component: [],
  overall: "improved",
  noise_floor_pct: 2,
  ...over,
});

describe("labVerdict — pure, measured, evidence named in the same breath", () => {
  it("nothing benchmarked (or still loading) → the honest nothing-graded line", () => {
    for (const bench of [null, state()]) {
      const v = labVerdict(bench);
      expect(v.headline).toBe("Nothing graded in the Lab yet.");
      expect(v.sub).toBe(
        "Start with Benchmark — set a baseline, change one thing, re-run. Compy tells you if it actually moved.",
      );
    }
  });

  it("baseline set, nothing graded yet → the next-run coaching, WITHOUT the date (V2-9 punch j: the Benchmark card below already names when the baseline was saved)", () => {
    const v = labVerdict(
      state({ baseline: { components: [], confidence: "clean", notes: [] }, baseline_at: "2026-07-01T10:00:00Z" }),
    );
    expect(v.headline).toBe("Baseline recorded — your next benchmark run gets graded against it.");
    expect(v.sub).toBe("The grade lands here the moment you re-run.");
    expect(v.sub).not.toContain(new Date("2026-07-01T10:00:00Z").toLocaleDateString());
    // No date recorded → same line either way (nothing invented, nothing repeated).
    const noDate = labVerdict(state({ baseline: { components: [], confidence: "clean", notes: [] } }));
    expect(noDate.sub).toBe("The grade lands here the moment you re-run.");
  });

  it("improved → the grade NAMES its component evidence with deltas (punch-h law)", () => {
    const v = labVerdict(
      state({
        efficacy: efficacy({
          per_component: [
            { component: "cpu", before: 100, after: 104.2, delta_pct: 4.2, verdict: "improved" },
            { component: "ram", before: 100, after: 100.5, delta_pct: 0.5, verdict: "no-measurable-change" },
          ],
          overall: "improved",
        }),
      }),
    );
    expect(v.headline).toBe("Your last benchmarked change improved this PC.");
    expect(v.sub).toBe("Measured: CPU +4.2% — graded against a 2% noise floor.");
  });

  it("regressed → names the components that got worse, and coaches the undo", () => {
    const v = labVerdict(
      state({
        efficacy: efficacy({
          per_component: [
            { component: "disk", before: 100, after: 93.7, delta_pct: -6.3, verdict: "regressed" },
          ],
          overall: "regressed",
          noise_floor_pct: 2.5,
        }),
      }),
    );
    expect(v.headline).toBe("Your last benchmarked change made things worse.");
    expect(v.sub).toBe(
      "Measured: Disk -6.3% — graded against a 2.5% noise floor. Undo it, or re-run to confirm.",
    );
  });

  it("no measurable change → the noise-floor honesty line, no component list", () => {
    const v = labVerdict(state({ efficacy: efficacy({ overall: "no-measurable-change" }) }));
    expect(v.headline).toBe("Your last benchmarked change made no measurable difference.");
    expect(v.sub).toBe(
      "Every component stayed inside the 2% noise floor — we call that noise, not a win.",
    );
  });

  it("never '(s)' across every branch", () => {
    const branches: (BenchmarkState | null)[] = [
      null,
      state(),
      state({ baseline: { components: [], confidence: "clean", notes: [] } }),
      state({ efficacy: efficacy({ overall: "improved" }) }),
      state({ efficacy: efficacy({ overall: "regressed" }) }),
      state({ efficacy: efficacy({ overall: "no-measurable-change" }) }),
    ];
    for (const bench of branches) {
      const v = labVerdict(bench);
      expect(`${v.headline} ${v.sub ?? ""}`).not.toContain("(s)");
    }
  });
});

describe("LabV2 — RoomShell composition", () => {
  it("renders ONE verdict (the pure helper's output) and NO door — the last chapter", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" />);
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe("Nothing graded in the Lab yet.");
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
  });

  it("no primary action — the instruments ARE the room's work", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" />);
    expect(container.querySelector(".v2-verdict-action")).toBeNull();
  });

  it("no measured-line header strip — header space is header-format text only (owner law 2026-07-10)", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" diagnostics={<div>diag</div>} />);
    expect(container.querySelector(".v2-measured")).toBeNull();
  });

  it("one-mention law: Lab's standalone head yields to the room verdict", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" />);
    expect(container.querySelector(".lab-head")).toBeNull();
    expect(container.querySelector(".lab-title")).toBeNull();
    expect(container.querySelector(".lab-head-bench")).toBeNull();
    // …but the working face is intact: the instrument cards render.
    expect(screen.getByRole("button", { name: /Benchmark/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Latency/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Black Box/ })).toBeTruthy();
  });
});

// Latest readings (fill pass, spec 2026-07-05): the foot-of-room strip is measured-or-honestly-
// absent — no reading renders "—", a populated source renders the real value, and no fabricated-
// value path exists. The strip is v2-only (classic Lab byte-identity below).
describe("labLatestReadings — pure, measured or honestly '—'", () => {
  it("nothing read yet → every instrument shows '—', never a placeholder number", () => {
    const readings = labLatestReadings({
      bench: null,
      latency: null,
      tuning: { present: true, headline: null },
      crash: null,
      diagnostics: { present: true, captured: false },
    });
    expect(readings.map((r) => r.label)).toEqual([
      "Baseline",
      "Latency",
      "Tuning",
      "Black Box",
      "System report",
    ]);
    for (const r of readings) expect(r.value).toBe("—");
  });

  it("gated instruments (no tuning guide, no diagnostics slot) get NO chip — absent, not '—'", () => {
    const labels = labLatestReadings({
      bench: null,
      latency: null,
      tuning: { present: false, headline: null },
      crash: null,
      diagnostics: { present: false, captured: false },
    }).map((r) => r.label);
    expect(labels).toEqual(["Baseline", "Latency", "Black Box"]);
  });

  it("populated sources → the real measured values (date · timer · verdict · crash count · captured)", () => {
    const readings = labLatestReadings({
      bench: state({
        baseline: { components: [], confidence: "clean", notes: [] },
        baseline_at: "2026-07-01T10:00:00Z",
      }),
      latency: { timer_current_ms: 0.5, msi: { total: 4, msi_on: 3, msi_off: 1 } } as LatencyReport,
      tuning: { present: true, headline: "Holding up so far" },
      crash: { incidents: [], skipped_sources: [] },
      diagnostics: { present: true, captured: true },
    });
    expect(readings).toEqual([
      { label: "Baseline", value: new Date("2026-07-01T10:00:00Z").toLocaleDateString() },
      { label: "Latency", value: "timer 0.50 ms" },
      { label: "Tuning", value: "Holding up so far" },
      { label: "Black Box", value: "none found" },
      { label: "System report", value: "captured" },
    ]);
    // A scan that found incidents reports the honest count.
    const found = labLatestReadings({
      bench: null,
      latency: null,
      tuning: { present: false, headline: null },
      crash: { incidents: [{} as never, {} as never], skipped_sources: [] },
      diagnostics: { present: false, captured: false },
    });
    expect(found.find((r) => r.label === "Black Box")?.value).toBe("2 recorded");
  });
});

describe("LabV2 — latest-readings strip renders at the foot", () => {
  it("cold room → the strip with honest '—' chips; populated bench seed → the real date", () => {
    useReduced();
    const { container, unmount } = render(<LabV2 vendor="nvidia" />);
    const strip = container.querySelector(".lab-readings");
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain("Latest readings");
    expect(strip!.querySelectorAll(".lab-reading-v").length).toBe(3); // no tuning/diag gates on this rig
    for (const v of strip!.querySelectorAll(".lab-reading-v")) expect(v.textContent).toBe("—");
    unmount();
    // Seed the probe cache (the same seed path Lab reads) with a saved baseline → the real date chip.
    putProbe("benchmark-state", state({
      baseline: { components: [], confidence: "clean", notes: [] },
      baseline_at: "2026-07-01T10:00:00Z",
    }));
    const { container: seeded } = render(<LabV2 vendor="nvidia" />);
    expect(seeded.querySelector(".lab-readings")!.textContent).toContain(
      new Date("2026-07-01T10:00:00Z").toLocaleDateString(),
    );
  });
});

describe("classic Lab — pinned unchanged (flag-off byte-identity at the render level)", () => {
  it("keeps its standalone head (title + read-only promise) and renders no RoomShell chrome", () => {
    const { container } = render(<Lab vendor="amd" />);
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeTruthy();
    expect(screen.getByText(/nothing in Advanced\s+changes your PC/)).toBeTruthy();
    expect(container.querySelector(".v2-verdict")).toBeNull();
    expect(container.querySelector(".v2-door")).toBeNull();
    // The latest-readings strip is v2-only — classic renders without it (fill pass, 2026-07-05).
    expect(container.querySelector(".lab-readings")).toBeNull();
  });
});
