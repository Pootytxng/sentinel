import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { withOverrides } from "./eligibility-override";
import type { Recommendation, SessionSummary } from "../types";

// bug→guard (self-review round 11, 2026-07-29). "My hardware supports this — show it anyway" was a
// button that lied twice.
//
//  (1) IT WENT NOWHERE. `useEligibilityOverrides` was `useState(read)` with exactly one caller
//      (Fix), so the override existed in Fix's head and nowhere else. The safe-stack gauge three
//      lines above it — and Home's one-tap band, the room verdicts, the deck's goal groups and
//      next-best-move — all derive from `eligible !== false` on the RAW catalog, so they never
//      heard about it: the ring kept counting a stack that didn't contain the row now sitting in
//      the list under it. Round 8 fixed exactly this shape for `dismissed`; this is its twin.
//
//  (2) IT PROMISED A LIST THAT DIDN'T EXIST. The row's copy said, unconditionally, that the rec
//      "now appears in your list". For a rec ALREADY switched on that is false in every direction:
//      `worthFixing` drops `currently_applied`, and there is no ledger receipt either because Compy
//      never applied it — it appeared in NO list while the copy swore it did.
//
// The rail: pressing the button must move every counter that claims to describe this rig, and the
// sentence under the row must name the place the rec actually went.

const ipc = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    ipc.calls.push(cmd);
    return Promise.resolve(cmd === "get_build_stamp" ? "ab12cd3 · dev" : []);
  },
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  ipc.calls.length = 0;
});

const rec = (over: Partial<Recommendation>): Recommendation =>
  ({
    id: "game-mode",
    title: "Enable Windows Game Mode",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
    ...over,
  }) as Recommendation;

// A stack of one that is already on — so the gauge has a baseline to move AWAY from ("all applied"
// at /1). Without it the ring starts at 0/0 and the caption change proves nothing.
const alreadyOn = rec({ id: "game-mode", currently_applied: true });

const rejected = (over: Partial<Recommendation> = {}) =>
  rec({
    id: "hags-enable",
    title: "Hardware-accelerated GPU scheduling",
    eligible: false,
    ineligible_reason: "Your GPU driver doesn't expose this.",
    ...over,
  } as Partial<Recommendation>);

const station = (recs: Recommendation[], isAppliable: (id: string) => boolean): LabFastPathProps => ({
  recs: recs as never[],
  startup: [],
  changes: [],
  busyId: null,
  isAppliable,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  vendor: "amd" as const,
  onChanged: () => {},
  sessions: [] as SessionSummary[],
  gpus: [],
});

// The real journey, not a state poke: open the "Not for this rig" drawer (collapsed by default),
// then press the override button on its one row.
const overrideFirstRejected = (container: HTMLElement) => {
  const head = [...container.querySelectorAll<HTMLButtonElement>(".fix-group-head")].find((b) =>
    b.textContent?.includes("Not for this rig"),
  );
  expect(head, "the 'Not for this rig' pile must be on screen to override from").toBeTruthy();
  fireEvent.click(head!);
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("My hardware supports this"),
  ) as HTMLButtonElement;
  expect(btn).toBeTruthy();
  fireEvent.click(btn);
};

const caption = (container: HTMLElement) =>
  container.querySelector(".lab-gauge-caption")!.textContent!;
const den = (container: HTMLElement) => container.querySelector(".lab-gauge-den")!.textContent!;
const rowTitles = (container: HTMLElement) =>
  [...container.querySelectorAll(".slimrow")].map((li) => li.textContent ?? "");

describe("an override moves the whole room, not just the row that owns the button", () => {
  it("the safe-stack gauge counts the rec the user vouched for", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...station([alreadyOn, rejected()], () => true)} />
      </ConfirmProvider>,
    );
    // Before: Compy's read owns the stack — one rec, already on.
    expect(den(container)).toBe("/1");
    expect(caption(container)).toContain("nothing to apply");
    expect(rowTitles(container).some((t) => t.includes("GPU scheduling"))).toBe(false);

    overrideFirstRejected(container);

    // After: the stack, the caption, AND the list agree. Before this fix only the list moved.
    expect(den(container), "the ring must grow by the rec the user vouched for").toBe("/2");
    expect(caption(container)).toContain("1 left to enable below");
    expect(
      rowTitles(container).some((t) => t.includes("GPU scheduling")),
      "and it must be a real, appliable row — not just a number",
    ).toBe(true);
  });

  it("an already-on rec says so, and never claims a ready list it isn't in", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation
          {...station([rejected({ currently_applied: true })], () => true)}
        />
      </ConfirmProvider>,
    );
    overrideFirstRejected(container);

    const landed = container.querySelector(".fix-row-landed")!.textContent!;
    expect(landed).toContain("Already switched on");
    // THE LIE: it is in no ready list, so it may not say it is in one.
    expect(landed).not.toContain("ready list");
    expect(container.textContent).not.toContain("Now in the ready list above");
    expect(rowTitles(container).some((t) => t.includes("GPU scheduling"))).toBe(false);
  });

  it("a rec Compy can't apply points at the walkthrough, not at a ready list", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...station([rejected()], () => false)} />
      </ConfirmProvider>,
    );
    overrideFirstRejected(container);

    const landed = container.querySelector(".fix-row-landed")!.textContent!;
    expect(landed).toContain("Compy points the way");
    expect(landed).not.toContain("ready list");
  });
});

describe("withOverrides is a correction, not a second source of truth", () => {
  const recs = [alreadyOn, rejected()];

  it("returns the input untouched when nothing is overridden (no memo thrash)", () => {
    expect(withOverrides(recs, new Set())).toBe(recs);
  });

  it("flips ONLY the overridden ineligible rec, and never invents ineligibility", () => {
    const out = withOverrides(recs, new Set(["hags-enable"]));
    expect(out).not.toBe(recs);
    expect(out[0]).toBe(recs[0]); // untouched recs keep their identity
    expect(out[1].eligible).toBe(true);
    expect(recs[1].eligible, "the catalog itself is never mutated").toBe(false);
  });

  it("ignores an override for a rec Compy never rejected (negative control)", () => {
    const out = withOverrides(recs, new Set(["game-mode"]));
    expect(out[0]).toBe(recs[0]);
    expect(out[1].eligible).toBe(false);
  });
});
