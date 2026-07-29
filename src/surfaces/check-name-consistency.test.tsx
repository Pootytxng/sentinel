import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// BUG → GUARD (self-review round 3, 2026-07-28, product-recovery train).
//
// The defect: ONE tweak had TWO names. The Lab's surfaces resolved a rec's name through
// data/friendly-labels ("Help Windows focus on your game"); the Check surfaces printed the raw
// catalog title straight from the priority row ("Enable Windows Game Mode"). Worse, when a row stood
// for exactly one rec, the card underneath suppressed its own title as a duplicate — so on that path
// the friendly name never rendered at all. A non-technical gamer met two different names for the
// same setting in a single journey and had no way to know it was one thing. That is precisely the
// orientation failure this train exists to fix, so it gets a permanent guard, not a memory.
//
// What is pinned here: the name a user reads for a rec is the SAME string on the Check faces as the
// one friendly-labels hands the Lab; a row that stands for a COUNT or for no rec at all keeps its own
// words; and the name is never printed twice on one row.

const prioritiesMock = vi.hoisted(() => ({
  payload: {
    limiters: [] as unknown[],
    already_fine: [] as unknown[],
    not_worth_touching: [] as unknown[],
    session_hint: null,
    upgrade_path: null,
  } as Record<string, unknown>,
}));
const recsMock = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "get_priorities" || cmd === "priorities_from")
      return Promise.resolve(prioritiesMock.payload);
    if (cmd === "get_recommendations") return Promise.resolve(recsMock.list);
    if (cmd === "get_leftovers")
      return Promise.resolve({ findings: [], checked: 0, unavailable: [] });
    return Promise.resolve(null);
  }),
}));

import FirstCheck from "./FirstCheck";
import Check from "./Check";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { FRIENDLY_LABELS, rowDisplayLabel, rowNamesItsRec } from "../data/friendly-labels";

// The rec the tester actually met under two names. Its RAW catalog title is what the priority row
// carries; its FRIENDLY headline is what the Lab prints. Both come from real sources, not literals.
const GAME_MODE_RAW = "Enable Windows Game Mode";
const GAME_MODE = FRIENDLY_LABELS["game-mode"];
const HAGS_RAW = "Enable Hardware GPU Scheduling";
const HAGS = FRIENDLY_LABELS["hags-enable"];

const rec = (over: Record<string, unknown> = {}) => ({
  id: "game-mode",
  title: GAME_MODE_RAW,
  category: "System",
  severity: "safe",
  description: "Asks Windows to prioritise the game you're playing.",
  impact: "Fewer background interruptions",
  downside: null,
  applies_to: "Currently: Off",
  currently_applied: false,
  provenance: "expected-impact",
  ...over,
});

const lim = (over: Record<string, unknown> = {}) => ({
  id: "game-mode",
  title: GAME_MODE_RAW,
  reason: "Windows isn't prioritising your game.",
  linked: null,
  rec_ids: ["game-mode"],
  confidence: "high",
  status: "attention",
  ...over,
});

const isAppliable = (id: string) => id === "game-mode" || id === "hags-enable";

const mountFirstCheck = () =>
  render(
    <ConfirmProvider>
      <FirstCheck onDone={vi.fn()} isAppliable={isAppliable} />
    </ConfirmProvider>,
  );

const mountCheck = () =>
  render(
    <ConfirmProvider>
      <Check isAppliable={isAppliable} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
    </ConfirmProvider>,
  );

const setScan = (limiters: unknown[], recs: unknown[], extra: Record<string, unknown> = {}) => {
  prioritiesMock.payload = {
    limiters,
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
    ...extra,
  };
  recsMock.list = recs;
};

beforeEach(() => {
  localStorage.clear();
  // The friendly-label layer is DOM-gated (livingLabelsOn). jsdom leaves it unset, which is exactly
  // why this defect survived the existing suite — every other test reads the raw-title world.
  document.documentElement.dataset.living = "on";
  setScan([], []);
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.living;
  setScan([], []);
});

describe("one rec, one name — the Check faces name a tweak the way the Lab does", () => {
  it("the first-check spotlight prints the friendly name, not the raw catalog title", async () => {
    setScan([lim()], [rec()]);
    mountFirstCheck();

    expect(await screen.findByText(GAME_MODE.headline)).toBeInTheDocument();
    // The real name is still visible — quiet beside the headline, never replaced or hidden.
    expect(screen.getByText(GAME_MODE.tech!)).toBeInTheDocument();
    // And the raw title is gone from the surface: seeing BOTH names is the bug.
    expect(screen.queryByText(GAME_MODE_RAW)).not.toBeInTheDocument();
  });

  it("the Check row prints that SAME name — one journey, one string", async () => {
    setScan([lim()], [rec()]);
    mountCheck();

    expect(await screen.findByText(GAME_MODE.headline)).toBeInTheDocument();
    expect(screen.queryByText(GAME_MODE_RAW)).not.toBeInTheDocument();
  });

  it("names the tweak exactly once per row — the card under a self-named row stays quiet", async () => {
    setScan([lim()], [rec()]);
    mountFirstCheck();

    await screen.findByText(GAME_MODE.headline);
    // The row headline IS the tweak's name, so the card beneath must not repeat it. Two copies of
    // the name reads as two findings.
    expect(screen.getAllByText(GAME_MODE.headline)).toHaveLength(1);
  });

  it("a COUNT row keeps its own words and names every tweak beneath it", async () => {
    const aggregate = lim({
      id: "pending-safe-recs",
      title: "2 safe tweaks not applied",
      rec_ids: ["game-mode", "hags-enable"],
    });
    setScan([aggregate], [rec(), rec({ id: "hags-enable", title: HAGS_RAW })]);
    mountFirstCheck();

    // Renaming this row would put ONE tweak's name on a row that stands for two.
    expect(await screen.findByText("2 safe tweaks not applied")).toBeInTheDocument();
    // …and each tweak underneath is named — in the same voice the Lab uses.
    expect(screen.getByText(GAME_MODE.headline)).toBeInTheDocument();
    expect(screen.getByText(HAGS.headline)).toBeInTheDocument();
  });

  it("a row with no rec behind it is left alone entirely", async () => {
    const observation = lim({
      id: "thermal-headroom",
      title: "GPU ran hot last session",
      rec_ids: [],
      linked: null,
    });
    setScan([observation], []);
    mountFirstCheck();

    expect(await screen.findByText("GPU ran hot last session")).toBeInTheDocument();
  });
});

describe("rowDisplayLabel / rowNamesItsRec — the rule the surfaces share", () => {
  const one = [{ id: "game-mode", title: GAME_MODE_RAW }];

  it("renames only a row that IS a single rec's catalog title", () => {
    expect(rowNamesItsRec(GAME_MODE_RAW, one)).toBe(true);
    expect(rowNamesItsRec("2 safe tweaks not applied", one)).toBe(false);
    expect(rowNamesItsRec(GAME_MODE_RAW, [])).toBe(false);
    expect(
      rowNamesItsRec(GAME_MODE_RAW, [...one, { id: "hags-enable", title: HAGS_RAW }]),
    ).toBe(false);

    expect(rowDisplayLabel(GAME_MODE_RAW, one).headline).toBe(GAME_MODE.headline);
    expect(rowDisplayLabel("2 safe tweaks not applied", one).headline).toBe(
      "2 safe tweaks not applied",
    );
  });

  it("is exactly the condition under which a card hides its own title", () => {
    // The surfaces used to inline `details.length > 1 || d.title !== row.title` as `showTitle`.
    // The shared predicate must stay its complement, or a name goes missing or gets printed twice.
    const cases: { row: string; details: { id: string; title: string }[] }[] = [
      { row: GAME_MODE_RAW, details: one },
      { row: "2 safe tweaks not applied", details: one },
      { row: GAME_MODE_RAW, details: [...one, { id: "hags-enable", title: HAGS_RAW }] },
      { row: HAGS_RAW, details: [{ id: "hags-enable", title: HAGS_RAW }] },
    ];
    for (const c of cases) {
      const legacyShowTitle = c.details.length > 1 || c.details[0].title !== c.row;
      expect(!rowNamesItsRec(c.row, c.details)).toBe(legacyShowTitle);
    }
  });

  it("falls back to the raw title when the friendly layer is off", () => {
    delete document.documentElement.dataset.living;
    expect(rowDisplayLabel(GAME_MODE_RAW, one)).toEqual({
      headline: GAME_MODE_RAW,
      tech: null,
      friendly: false,
    });
  });
});
