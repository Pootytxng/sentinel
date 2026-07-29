import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import FirstCheck, { FIRST_CHECK_KEY } from "./FirstCheck";
import { ConfirmProvider } from "../design/ConfirmDialog";

// FirstCheck drives the shared useScan (get_game_readiness → get_recommendations → priorities_from).
// Default: one ready check, no limiters (the clean-rig verdict). Reset before every test so a test
// that overrides the mock (the limiter path below) can't bleed into another.
const READINESS = {
  checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
  ready_count: 1,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const cleanRig = (cmd: string) => {
  if (cmd === "get_game_readiness") return Promise.resolve(READINESS);
  if (cmd === "priorities_from")
    return Promise.resolve({
      limiters: [],
      already_fine: [],
      not_worth_touching: [],
      session_hint: null,
      upgrade_path: null,
    });
  if (cmd === "get_recommendations") return Promise.resolve([]);
  return Promise.resolve(null);
};

/** A scan that returns exactly these limiter rows and this catalog. */
const scan =
  (limiters: unknown[], recs: unknown[]) =>
  (cmd: string) => {
    if (cmd === "get_game_readiness") return Promise.resolve(READINESS);
    if (cmd === "priorities_from")
      return Promise.resolve({
        limiters,
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: null,
      });
    if (cmd === "get_recommendations") return Promise.resolve(recs);
    return Promise.resolve(null);
  };

const rec = (over: Record<string, unknown> = {}) => ({
  id: "hags-enable",
  title: "Enable Hardware GPU Scheduling",
  category: "GPU",
  severity: "safe",
  description: "Lets the GPU manage its own memory and command queue directly.",
  impact: "Smoother frame pacing",
  downside: null,
  applies_to: "Currently: Off",
  currently_applied: false,
  provenance: "expected-impact",
  ...over,
});

const lim = (over: Record<string, unknown> = {}) => ({
  id: "pending-safe-recs",
  title: "2 safe tweaks not applied",
  reason: "Compy has safe, reversible tweaks you haven't applied.",
  linked: null,
  rec_ids: [],
  confidence: "high",
  status: "attention",
  ...over,
});

// The frontend mirror of the backend's APPLIABLE_REC_IDS (App.tsx passes the real one). Offering
// "Apply" on anything outside this set hands the user a button apply_recommendation would throw on.
const APPLIABLE = new Set(["hags-enable", "game-mode"]);
const isAppliable = (id: string) => APPLIABLE.has(id);

const mount = (onDone = vi.fn()) =>
  render(
    <ConfirmProvider>
      <FirstCheck onDone={onDone} isAppliable={isAppliable} />
    </ConfirmProvider>,
  );

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(cleanRig as never);
});

describe("FirstCheck (audit M1)", () => {
  it("clean rig verdict celebrates the measured win without inventing work (doctrine voice)", async () => {
    mount();
    expect(
      await screen.findByText("Ready to play — this rig measured clean"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every check came back right — measured on this rig, not assumed\./),
    ).toBeInTheDocument();
    // The anti-snake-oil close: green checks are named, work is never invented.
    expect(screen.getByText(/1 checks measured perfect — confirmed right on this rig/)).toBeInTheDocument();
    expect(screen.getByText(/won't invent work to look busy/)).toBeInTheDocument();
  });

  // bug→guard (owner screenshot 2026-07-06): the verdict state stacked the live run-list AND the
  // green collapsible — every check title rendered twice. Pin: in the verdict state each check
  // title renders exactly once (inside the expanded green detail), never in a persisted run-list.
  it("verdict state renders each check title exactly once (no doubled list)", async () => {
    mount();
    await screen.findByText("Ready to play — this rig measured clean");
    // Collapsed: the run-list has resolved into the verdict — no check titles on screen.
    expect(screen.queryByText("SSD check")).not.toBeInTheDocument();
    // Expanded green detail is the ONE canonical list.
    fireEvent.click(screen.getByRole("button", { name: /measured perfect/ }));
    expect(screen.getAllByText("SSD check")).toHaveLength(1);
  });

  it("finishing marks the first check seen (gate key) and hands off to the app", async () => {
    const onDone = vi.fn();
    mount(onDone);
    fireEvent.click(await screen.findByRole("button", { name: "Open the dashboard" }));
    expect(onDone).toHaveBeenCalled();
    expect(localStorage.getItem(FIRST_CHECK_KEY)).toBe("1");
  });

  // bug→guard (BACKLOG:923, Cowork scope-check 2026-07-16): the core reversibility promise
  // ("Compy snapshots the prior state so you can roll this back anytime") lived ONLY inside the
  // confirm dialog shown AFTER clicking Apply — a user who never clicks Apply never saw it. Pin:
  // when the #1 limiter has an applyable fix, that promise renders STANDING on the verdict card,
  // before any Apply interaction.
  it("surfaces the restore-guarantee as a standing line on the verdict card (not only post-Apply)", async () => {
    vi.mocked(invoke).mockImplementation(
      scan(
        [
          lim({
            id: "hags-lim",
            title: "Hardware GPU Scheduling is off",
            reason: "Turning it on can smooth frame pacing on your GPU.",
            linked: "hags-enable",
            rec_ids: ["hags-enable"],
          }),
        ],
        [rec()],
      ) as never,
    );

    mount();

    // The #1-limiter spotlight resolves with an Apply button (an applyable fix)…
    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument();
    // …and the reversibility promise is already on the card — no Apply click required.
    expect(screen.getByText(/roll this back anytime/i)).toBeInTheDocument();
  });
});

// bug→guard (tester feedback 2026-07-22, recovery items 2/4/5): the verdict said "1 safe tweak not
// applied" and the card behind it offered a chip that promised steps it never rendered. The tweak
// was never NAMED and the user had nothing to act on. These pin the fix: identity comes from
// PriorityItem.rec_ids (never re-derived from the row's prose), every named rec shows its real
// per-rig data, and the action offered is the one Compy can honestly perform.
describe("FirstCheck result identity (recovery items 2/4/5)", () => {
  it("turns a count-only aggregate row into every named recommendation behind it", async () => {
    vi.mocked(invoke).mockImplementation(
      scan(
        [lim({ rec_ids: ["game-mode", "hags-enable"] })],
        [rec({ id: "game-mode", title: "Turn on Windows Game Mode" }), rec()],
      ) as never,
    );

    mount();

    // The count-only headline is still the row's own title, but it is no longer the whole story:
    // each tweak is named, with its own action.
    expect(await screen.findByText("Turn on Windows Game Mode")).toBeInTheDocument();
    expect(screen.getByText("Enable Hardware GPU Scheduling")).toBeInTheDocument();
    expect(screen.getByText("2 of them, and here is each one:")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(2);
  });

  it("shows the per-rig facts behind each recommendation, impact tagged with its provenance", async () => {
    vi.mocked(invoke).mockImplementation(
      scan(
        [lim({ id: "hags-lim", title: "Hardware GPU Scheduling is off", rec_ids: ["hags-enable"] })],
        [rec({ applies_to: "Currently: Off", downside: "Needs a reboot." })],
      ) as never,
    );

    mount();

    // What Compy detected on THIS rig, what the setting does, what changes — and the honesty tag
    // that says the impact is expected, not benchmarked here. No fabricated fps/latency number.
    expect(await screen.findByText("Currently: Off")).toBeInTheDocument();
    expect(
      screen.getByText("Lets the GPU manage its own memory and command queue directly."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Smoother frame pacing/)).toBeInTheDocument();
    expect(screen.getByText("Expected")).toBeInTheDocument();
    expect(screen.getByText("Needs a reboot.")).toBeInTheDocument();
  });

  it("opens the REAL guide for a hands-on rec instead of promising steps it never shows", async () => {
    // storage-c-low is a real catalog rec that Compy deliberately cannot apply (no rollback
    // contract for a disk cleanup) — and it pairs with a shipped walkthrough.
    vi.mocked(invoke).mockImplementation(
      scan(
        [
          lim({
            id: "storage-lim",
            title: "System drive is nearly full",
            reason: "Windows needs headroom on C: to stay responsive.",
            linked: "storage-c-low",
            rec_ids: ["storage-c-low"],
          }),
        ],
        [
          rec({
            id: "storage-c-low",
            title: "Free up space on the system drive",
            applies_to: "Currently: 6% free",
          }),
        ],
      ) as never,
    );

    mount();

    // No Apply — the backend can't dispatch this one, so the button that would throw is absent…
    expect(await screen.findByText("Currently: 6% free")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    // …the reason is stated in the rollback-first terms that are actually true…
    expect(screen.getByText(/only flips settings it can snapshot and undo/)).toBeInTheDocument();
    // …and the promised steps are the real shipped walkthrough, not a dead-end chip.
    expect(screen.getByText(/Show me the steps/)).toBeInTheDocument();
    expect(screen.getByText("Free up the system drive (Storage Sense)")).toBeInTheDocument();
    expect(screen.getByText("Open Settings → System → Storage.")).toBeInTheDocument();
  });

  it("makes no offer at all when nothing in the catalog sits behind the row", async () => {
    // A readiness-check row (RAM speed) — there is no tweak to apply and no guide to open. The old
    // code showed a "Compy shows you the steps" chip here that led nowhere.
    vi.mocked(invoke).mockImplementation(
      scan(
        [
          lim({
            id: "ram-speed-lim",
            title: "RAM is running below its rated speed",
            reason: "Your kit is rated faster than it's currently running.",
            linked: "ram-speed",
            rec_ids: [],
          }),
        ],
        [],
      ) as never,
    );

    mount();

    await screen.findByText("RAM is running below its rated speed");
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Show me the steps/)).not.toBeInTheDocument();
    // Nothing to roll back either — the promise must not stand on a card with no applyable fix.
    expect(screen.queryByText(/roll this back anytime/i)).not.toBeInTheDocument();
    expect(screen.getByText("Expected impact · not yet measured on this rig")).toBeInTheDocument();
  });

  it("names the tweak behind a #2…N row when it is expanded (was a dead-end row)", async () => {
    vi.mocked(invoke).mockImplementation(
      scan(
        [
          lim({ id: "hags-lim", title: "Hardware GPU Scheduling is off", rec_ids: ["hags-enable"] }),
          lim({
            id: "pending-safe-recs",
            title: "1 safe tweak not applied",
            rec_ids: ["game-mode"],
          }),
        ],
        [rec(), rec({ id: "game-mode", title: "Turn on Windows Game Mode", applies_to: "Currently: Off" })],
      ) as never,
    );

    mount();

    const row = await screen.findByRole("button", { name: /1 safe tweak not applied/ });
    expect(screen.queryByText("Turn on Windows Game Mode")).not.toBeInTheDocument();
    fireEvent.click(row);
    // The count-only row opens onto the actual tweak, with its own Apply.
    expect(screen.getByText("Turn on Windows Game Mode")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(2);
  });

  it("reports an already-applied rec as done and never re-offers it", async () => {
    vi.mocked(invoke).mockImplementation(
      scan(
        [lim({ id: "hags-lim", title: "Hardware GPU Scheduling is off", rec_ids: ["hags-enable"] })],
        [rec({ currently_applied: true })],
      ) as never,
    );

    mount();

    expect(await screen.findByText(/Already on — nothing to do here\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("states why an ineligible rec is off the table instead of offering it", async () => {
    vi.mocked(invoke).mockImplementation(
      scan(
        [lim({ id: "nv-lim", title: "NVIDIA telemetry is running", rec_ids: ["nvidia-telemetry"] })],
        [
          rec({
            id: "nvidia-telemetry",
            title: "Stop NVIDIA telemetry tasks",
            eligible: false,
            ineligible_reason: "No NVIDIA GPU detected",
          }),
        ],
      ) as never,
    );

    mount();

    expect(await screen.findByText("No NVIDIA GPU detected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByText(/roll this back anytime/i)).not.toBeInTheDocument();
  });

  // bug→guard (self-review round 5, 2026-07-29): the arc is a fixed full-screen overlay drawn over
  // the still-mounted app, but it declared none of that — no dialog role, no trap. A keyboard user
  // Tabbed off the visible verdict into ~17 background stops (nav rail, theme picker, the Lab) with
  // nothing focused on screen. Pin the two halves of the fix: it SAYS it's modal, and it BEHAVES
  // modally (Tab off the last control comes back to the first instead of leaving).
  it("is a real modal for the keyboard: dialog semantics + focus stays inside the arc", async () => {
    // A background control of exactly the kind focus used to escape to.
    render(<button data-testid="behind">Nav rail behind the arc</button>);
    mount();
    await screen.findByText("Ready to play — this rig measured clean");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("fc-backdrop");

    const inside = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled])"));
    expect(inside.length).toBeGreaterThan(1);
    const first = inside[0];
    const last = inside[inside.length - 1];

    // Forward off the last control wraps to the first — it does not walk out into the app.
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab off the first wraps to the last, same reason.
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // And focus that has already escaped gets pulled back in rather than continuing through
    // background chrome the user cannot see.
    screen.getByTestId("behind").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
