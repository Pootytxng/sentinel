import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

// BUG → GUARD (owner verdict, 2026-07-29, LabDeck glance-first train)
//
// THE DEFECT. "Measure & prove" listed five instruments and not one RESULT. Compy's strongest piece
// of evidence — a baseline measured before a change and the same game measured after it — existed
// only on the Monitor surface's session debrief, so a user who opened the Lab to answer "did that
// actually help?" was handed a tool list instead of the receipt Compy already held. Worse, the three
// reads that carry it (`get_session_summaries` / `get_armed_comparison` / `get_latest_comparison`)
// were gated behind "does this rig have a vendor tuning guide", which hid a measured result from
// every non-AMD rig for a reason that has nothing to do with applied fixes.
//
// THE RISK IN FIXING IT. A before/after receipt is the single easiest place in the app to fabricate
// a claim: round a verdict into a win, recompute a percentage the backend deliberately judged
// differently, show numbers from a comparison the backend already ruled unfair, or let an
// expected-impact string sit next to measured fps and read as one. Every rule below is a rule the
// backend already enforces in `src-tauri/src/comparison.rs`; this guard pins the frontend to it.
//
// THE GUARD. Three layers, matching the three ways this can go wrong:
//   1. the state machine is tested as pure data — tuning receipts, unfair verdicts, an armed
//      baseline and the two empty states each resolve to exactly one state, so no render has to
//      remember the honesty rules;
//   2. the GLANCE layer is held to a verdict with no values, and the values are asserted absent
//      until the row is opened — proof on demand, not proof in the face;
//   3. the numbers are asserted to be the BACKEND's own: a fixture whose deltas deliberately
//      disagree with raw fps arithmetic must render the backend's percentages, and the unfair
//      verdicts must render no percentages at all.

const state = vi.hoisted(() => ({
  latest: null as unknown,
  armed: null as unknown,
  sessions: [] as unknown[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_latest_comparison") return Promise.resolve(state.latest);
    if (cmd === "get_armed_comparison") return Promise.resolve(state.armed);
    if (cmd === "get_session_summaries") return Promise.resolve(state.sessions);
    return Promise.resolve(null);
  }),
}));
vi.mock("../rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

const { LabDeck } = await import("../lab/LabDeck");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
const { labComparison } = await import("./lab-deck-data");
const { recDisplayLabel } = await import("../../data/friendly-labels");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_motion", "reduced");
  state.latest = null;
  state.armed = null;
  state.sessions = [];
  delete document.documentElement.dataset.living;
});

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
// A real catalog id, so the display name resolves through the same map every other surface uses.
const REC_ID = "power-ultimate";
const REC_TITLE = "Switch to the Ultimate Performance power plan";

// The deltas here deliberately DISAGREE with the raw fps pair (58.4 → 71.6 is ~22.6%, not 12.5%).
// The backend judges on its own captured samples, so the deck must quote it and never re-derive.
const result = (over: Record<string, unknown> = {}) =>
  ({
    rec_id: REC_ID,
    rec_title: REC_TITLE,
    game: "Helldivers2.exe",
    baseline_avg_fps: 58.4,
    baseline_low1_fps: 41.2,
    after_avg_fps: 71.6,
    after_low1_fps: 49.8,
    delta_avg_pct: 9.3,
    delta_low1_pct: 12.5,
    noise_floor_pct: 3,
    verdict: "improved",
    at: "2026-07-28T20:00:00Z",
    ...over,
  }) as never;

const armedBaseline = (over: Record<string, unknown> = {}) =>
  ({
    rec_id: REC_ID,
    rec_title: REC_TITLE,
    game: "Helldivers2.exe",
    baseline_avg_fps: 58.4,
    baseline_low1_fps: 41.2,
    armed_at: "2026-07-28T20:00:00Z",
    ledger_watermark: 7,
    ...over,
  }) as never;

const session = () => ({ process_name: "Helldivers2.exe", avg_fps: 61 }) as never;

const REAL_IMPACT = "Lower input latency · steadier frame times (when gaming)";
const rec = () =>
  ({
    id: REC_ID,
    title: REC_TITLE,
    category: "Power",
    severity: "moderate",
    description: "Windows ships with a hidden 'Ultimate Performance' power plan.",
    impact: REAL_IMPACT,
    downside: "Permanently mutates your daily power profile until you roll back.",
    applies_to: "Currently on 'Balanced'",
    currently_applied: false,
    provenance: "measured-signal",
    eligible: true,
  }) as never;

const renderDeck = async () => {
  const fast = {
    recs: [rec()],
    startup: [],
    changes: [],
    busyId: null,
    isAppliable: () => true,
    activeChangeFor: () => undefined,
    onToggleRec: () => {},
    onToggleStartup: () => {},
    onRollback: () => {},
    onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    onOpenLibrary: () => {},
    onChanged: () => {},
    sessions: [],
    gpus: [],
    vendor: "amd",
  } as never;
  let container!: HTMLElement;
  // The deck lazy-loads the hologram and resolves three probes on mount; without act() the row
  // renders its pre-probe state and every assertion below would test the empty case.
  await act(async () => {
    container = render(
      <ConfirmProvider>
        <LabDeck
          fast={fast}
          diagnostics={<div data-testid="diag" />}
          diagnosticsCaptured
          priorities={null}
          activeCount={0}
        />
      </ConfirmProvider>,
    ).container;
  });
  return container;
};

const head = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>('[aria-controls="ld-prove-compare-body"]')!;
const reading = (c: HTMLElement) => head(c).querySelector<HTMLElement>(".ld-row-reading")!;
const body = (c: HTMLElement) => c.querySelector<HTMLElement>("#ld-prove-compare-body");
const openIt = (c: HTMLElement) => fireEvent.click(head(c));
const factPairs = (c: HTMLElement) =>
  Array.from(body(c)!.querySelectorAll(".ld-cmp-fact")).map((f) => [
    f.querySelector("dt")!.textContent!,
    f.querySelector("dd")!.textContent!,
  ]);

// ── layer 1: the state machine, as pure data ────────────────────────────────────────────────────
describe("labComparison — one state per honest situation", () => {
  it("a fair verdict is measured, and the three fair verdicts are exactly improved/no-change/regressed", () => {
    for (const v of ["improved", "no-change", "regressed"]) {
      const c = labComparison(result({ verdict: v }), null, []);
      expect(c.state).toBe("measured");
    }
  });

  it("confounded and expired are unfair — carried, so the row can say WHY, never scored", () => {
    for (const v of ["confounded", "expired"]) {
      const c = labComparison(result({ verdict: v }), null, []);
      expect(c.state).toBe("unfair");
      if (c.state === "unfair") expect(c.result.verdict).toBe(v);
    }
  });

  it("a tuning receipt is not this receipt: it falls through to the fix path's own state", () => {
    // Undervolt tuning has no ledger entry to revert and is rendered by the Tuning instrument.
    // Borrowing its numbers here would attribute a vendor tuning result to an applied fix.
    expect(labComparison(result({ kind: "tuning" }), null, []).state).toBe("no-sessions");
    expect(labComparison(result({ kind: "tuning" }), null, [session()]).state).toBe("idle");
    expect(labComparison(null, armedBaseline({ kind: "tuning" }), [session()]).state).toBe("idle");
  });

  it("an undefined kind is a fix comparison, matching the shipped debrief filter", () => {
    expect(labComparison(result(), null, []).state).toBe("measured");
    expect(labComparison(null, armedBaseline(), []).state).toBe("armed");
  });

  it("a resolved result outranks an armed baseline — the finished half wins", () => {
    const c = labComparison(result(), armedBaseline(), [session()]);
    expect(c.state).toBe("measured");
  });

  it("the two empty states split on whether Compy has ever measured a session", () => {
    expect(labComparison(null, null, []).state).toBe("no-sessions");
    expect(labComparison(null, null, [session()]).state).toBe("idle");
  });
});

// ── layer 2: the glance layer holds a verdict, not a value ──────────────────────────────────────
describe("the receipt leads Measure & prove, and leads with the verdict", () => {
  it("is the first row in the section — the result outranks the tools that produce it", async () => {
    state.latest = result();
    const c = await renderDeck();
    const rows = Array.from(c.querySelectorAll('[data-section="prove"] .ld-row'));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toBe(head(c).closest(".ld-row"));
  });

  it("names the change through the shared resolver, in both label modes (one name per rec)", async () => {
    // ONE NAME PER REC is only kept if the row asks `recDisplayLabel` rather than printing a title it
    // picked itself — and that resolver's answer DEPENDS on the Living Instrument preview flag. So the
    // guard checks both modes: whichever name the rest of the scroll shows, this row shows the same one.
    state.latest = result();
    const sub = (c: HTMLElement) => head(c).querySelector(".ld-row-sub")!.textContent!;

    let c = await renderDeck();
    expect(recDisplayLabel(REC_ID, REC_TITLE).headline).toBe(REC_TITLE);
    expect(sub(c)).toContain(REC_TITLE);

    cleanup();
    document.documentElement.dataset.living = "on";
    c = await renderDeck();
    const friendly = recDisplayLabel(REC_ID, REC_TITLE).headline;
    expect(friendly).not.toBe(REC_TITLE); // a real mapped id, so the two modes genuinely differ
    expect(sub(c)).toContain(friendly);
    expect(sub(c)).not.toContain(REC_TITLE);
  });

  it("shows no fps values at a glance — the numbers live behind the row's own door", async () => {
    state.latest = result();
    const c = await renderDeck();
    const glance = head(c).textContent!;
    for (const v of ["58", "71", "41", "49"]) expect(glance).not.toContain(v);
    expect(body(c)).toBeNull();
  });

  it("never lets an expected impact sit in the receipt", async () => {
    // The catalog's `impact` string is a forecast. It is the one sentence that must never appear in
    // a block whose whole claim is "this was measured".
    state.latest = result();
    const c = await renderDeck();
    openIt(c);
    expect(head(c).closest(".ld-row")!.textContent).not.toContain(REAL_IMPACT);
  });

  const glanceCases: Array<[string, Record<string, unknown>, string | undefined, string]> = [
    ["improved", { verdict: "improved" }, "ready", "yes"],
    ["regressed", { verdict: "regressed" }, "attention", "yes"],
    ["no-change", { verdict: "no-change" }, undefined, "yes"],
    ["confounded", { verdict: "confounded" }, undefined, "no"],
    ["expired", { verdict: "expired" }, undefined, "no"],
  ];

  it.each(glanceCases)(
    "%s: status ink only where the state is genuinely measured",
    async (_label, over, tone, measured) => {
      state.latest = result(over);
      const c = await renderDeck();
      const r = reading(c);
      expect(r.getAttribute("data-measured")).toBe(measured);
      expect(r.getAttribute("data-tone")).toBe(tone ?? null);
      // Colour is never the only channel: the reading says it in words or in a sign as well.
      expect(r.textContent!.trim().length).toBeGreaterThan(3);
    },
  );

  it("the improved and regressed readings carry the sign, so hue is reinforcement not meaning", async () => {
    state.latest = result({ verdict: "improved", delta_low1_pct: 12.5 });
    let c = await renderDeck();
    expect(reading(c).textContent).toContain("+12.5%");
    cleanup();
    state.latest = result({ verdict: "regressed", delta_low1_pct: -7.4 });
    c = await renderDeck();
    expect(reading(c).textContent).toContain("-7.4%");
  });

  it("an armed baseline reads as waiting, not as a result", async () => {
    state.armed = armedBaseline();
    state.sessions = [session()];
    const c = await renderDeck();
    expect(reading(c).getAttribute("data-measured")).toBe("no");
    expect(reading(c).getAttribute("data-tone")).toBeNull();
  });

  it("with nothing measured at all, the row still says what to do next", async () => {
    const c = await renderDeck();
    const sub = head(c).querySelector(".ld-row-sub")!.textContent!;
    // An honest next action names the mechanism that actually captures a baseline.
    expect(sub.toLowerCase()).toContain("session");
    expect(reading(c).getAttribute("data-measured")).toBe("no");
  });
});

// ── layer 3: the values are the backend's, and only when the backend called them fair ───────────
describe("the proof layer quotes the backend and never re-derives it", () => {
  it("renders the before → after pair for both metrics, rounded for reading only", async () => {
    state.latest = result();
    const c = await renderDeck();
    openIt(c);
    const pairs = factPairs(c);
    expect(pairs).toHaveLength(2);
    expect(pairs[0][1]).toBe("58 → 72 fps");
    expect(pairs[1][1]).toBe("41 → 50 fps");
  });

  it("quotes the backend's percentages even when raw arithmetic would disagree", async () => {
    state.latest = result();
    const c = await renderDeck();
    openIt(c);
    const method = body(c)!.querySelector(".ld-cmp-method")!.textContent!;
    expect(method).toContain("+12.5%");
    expect(method).toContain("+9.3%");
    // 58.4 → 71.6 is ~22.6%. If the deck ever computes its own delta, that number appears here.
    expect(method).not.toContain("22");
  });

  it("states the mechanism: judged on the 1% lows against a named noise floor", async () => {
    state.latest = result({ verdict: "no-change", delta_low1_pct: 1.1 });
    const c = await renderDeck();
    openIt(c);
    const text = body(c)!.textContent!;
    expect(text).toContain("1% lows");
    expect(text).toContain("3%");
  });

  it("an unfair verdict shows no numbers at all — only why it is being withheld", async () => {
    for (const v of ["confounded", "expired"]) {
      cleanup();
      state.latest = result({ verdict: v });
      const c = await renderDeck();
      openIt(c);
      const b = body(c)!;
      expect(b.querySelector(".ld-cmp-facts")).toBeNull();
      expect(b.querySelector(".ld-cmp-line")!.textContent!.length).toBeGreaterThan(20);
      for (const n of ["58", "71", "41", "49", "12.5", "9.3"]) {
        expect(b.textContent).not.toContain(n);
      }
    }
  });

  it("an armed baseline shows the before half only, with no arrow to an after that doesn't exist", async () => {
    state.armed = armedBaseline();
    state.sessions = [session()];
    const c = await renderDeck();
    openIt(c);
    const pairs = factPairs(c);
    expect(pairs).toHaveLength(2);
    expect(pairs[0][1]).toBe("58");
    expect(pairs[1][1]).toBe("41");
    expect(body(c)!.textContent).not.toContain("→");
    // …and it names the game whose next monitored session finishes the comparison, because that is
    // the backend's actual resolution condition (armed.game === session.process_name).
    expect(body(c)!.querySelector(".ld-cmp-line")!.textContent).toContain("Helldivers2.exe");
  });

  it("a measured regression points at the undo, and the other verdicts do not", async () => {
    state.latest = result({ verdict: "regressed", delta_low1_pct: -7.4 });
    let c = await renderDeck();
    openIt(c);
    expect(body(c)!.querySelectorAll(".ld-cmp-actions button")).toHaveLength(1);
    cleanup();
    state.latest = result({ verdict: "improved" });
    c = await renderDeck();
    openIt(c);
    expect(body(c)!.querySelector(".ld-cmp-actions")).toBeNull();
  });

  it("with no measured session at all, the row offers no door onto an empty room", async () => {
    const c = await renderDeck();
    openIt(c);
    expect(body(c)!.querySelector(".ld-cmp-actions")).toBeNull();
  });

  it("keeps the one-open-region rule: opening the receipt is a labelled, reversible disclosure", async () => {
    state.latest = result();
    const c = await renderDeck();
    expect(head(c).getAttribute("aria-expanded")).toBe("false");
    openIt(c);
    expect(head(c).getAttribute("aria-expanded")).toBe("true");
    expect(body(c)).not.toBeNull();
    openIt(c);
    expect(head(c).getAttribute("aria-expanded")).toBe("false");
    expect(body(c)).toBeNull();
  });
});
