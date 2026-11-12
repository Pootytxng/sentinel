import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import FirstCheck, { FIRST_CHECK_KEY } from "./FirstCheck";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { LAST_CHECK_KEY } from "./last-check";

// FirstCheck drives the shared useScan (get_game_readiness → get_recommendations → priorities_from).
// Default: one ready check, no limiters (the clean-rig verdict). Reset before every test so a test
// that overrides the mock (the limiter path below) can't bleed into another.
const cleanRig = (cmd: string) => {
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

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(cleanRig as never);
});

describe("FirstCheck (audit M1)", () => {
  it("clean rig verdict celebrates the measured win without inventing work (doctrine voice)", async () => {
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    expect(
      await screen.findByText("Ready to play — this rig measured clean"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every check came back right — measured on this rig, not assumed\./),
    ).toBeInTheDocument();
    // The anti-snake-oil close: green checks are named, work is never invented.
    expect(screen.getByText(/1 check measured perfect — confirmed right on this rig/)).toBeInTheDocument();
    expect(screen.getByText(/won't invent work to look busy/)).toBeInTheDocument();
  });

  // Codebase review 2026-11-03: an unread check never "came back right" — the verdict speaks for the
  // checks Compy could read and names the rest, instead of "Every check came back right".
  it("unread checks are named, never counted as right", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_game_readiness"
        ? Promise.resolve({
            checks: [
              { id: "a", label: "SSD check", status: "ready", detail: "", value: null },
              { id: "b", label: "Power plan", status: "unknown", detail: "", value: null },
            ],
            ready_count: 1,
            attention_count: 0,
            unknown_count: 1,
            advisory_count: 0,
            advisory: "",
            dismissed_ids: [],
            drifts: [],
          })
        : cleanRig(cmd)) as never);
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Ready to play — everything Compy could read measured clean")).toBeInTheDocument();
    expect(screen.getByText(/Every check Compy could read came back right — 1 couldn't be read on this PC/)).toBeInTheDocument();
    expect(screen.queryByText(/^Every check came back right/)).not.toBeInTheDocument();
  });

  // Round 1 review (2026-11-03): an advisory (VRR, HDR) is a check Compy deliberately doesn't judge,
  // yet it was listed as "measured perfect — confirmed right" and counted in "Every check came back right".
  it("an advisory is noted, not graded — never measured perfect", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_game_readiness"
        ? Promise.resolve({
            checks: [
              { id: "a", label: "SSD check", status: "ready", detail: "", value: null },
              { id: "vrr", label: "Variable refresh rate", status: "advisory", detail: "", value: null },
            ],
            ready_count: 1,
            attention_count: 0,
            unknown_count: 0,
            advisory_count: 1,
            advisory: "",
            dismissed_ids: [],
            drifts: [],
          })
        : cleanRig(cmd)) as never);
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText(/Every graded check came back right — measured on this rig, not assumed\. 1 more is advisory: noted, not graded\./)).toBeInTheDocument();
    const head = screen.getByRole("button", { name: /measured perfect/ });
    expect(head.textContent).toMatch(/^1 check measured perfect — confirmed right on this rig · 1 noted, not graded/);
    fireEvent.click(head);
    expect(screen.getByText("Variable refresh rate — noted, not graded")).toBeInTheDocument();
    // Desk review 2026-11-03: Home's band read this record as "all 2 looked good". It carries the split.
    expect(JSON.parse(localStorage.getItem(LAST_CHECK_KEY) as string)).toMatchObject({
      total: 2,
      green: 1,
      advisory: 1,
      unread: 0,
      fixCount: 0,
    });
  });

  // Round 2 review: with an unread check AND an advisory, the unread line still counted the advisory.
  it("unread and advisory together: the unread line counts graded checks only and names the advisory", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_game_readiness"
        ? Promise.resolve({
            checks: [
              { id: "a", label: "SSD check", status: "ready", detail: "", value: null },
              { id: "b", label: "Power plan", status: "unknown", detail: "", value: null },
              { id: "vrr", label: "Variable refresh rate", status: "advisory", detail: "", value: null },
            ],
            ready_count: 1,
            attention_count: 0,
            unknown_count: 1,
            advisory_count: 1,
            advisory: "",
            dismissed_ids: [],
            drifts: [],
          })
        : cleanRig(cmd)) as never);
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    expect(
      await screen.findByText(
        /Every graded check Compy could read came back right — 1 couldn't be read on this PC, so it isn't counted either way\. 1 more is advisory: noted, not graded\./,
      ),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(LAST_CHECK_KEY) as string)).toMatchObject({
      total: 3,
      green: 1,
      advisory: 1,
      unread: 1,
    });
  });

  // CR-firstcheck-flake: the record above was written from a passive effect, which React runs in a
  // later task than the commit that draws the verdict (the scan resolves outside act). A loaded run
  // read the verdict in that gap and found no record ("got null"). A DOM observer fires right after
  // the commit, before any later task: the record must already be there.
  it("the last-check record lands in the commit that draws the verdict", async () => {
    let recordWhenDrawn: string | null | undefined;
    const watch = new MutationObserver(() => {
      if (recordWhenDrawn === undefined && document.body.textContent?.includes("Ready to play — this rig measured clean")) {
        recordWhenDrawn = localStorage.getItem(LAST_CHECK_KEY);
      }
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      render(
        <ConfirmProvider>
          <FirstCheck onDone={vi.fn()} />
        </ConfirmProvider>,
      );
      await screen.findByText("Ready to play — this rig measured clean");
      expect(recordWhenDrawn, "the observer never saw the verdict").not.toBeUndefined();
      expect(recordWhenDrawn, "the verdict was drawn before its record was written").not.toBeNull();
      expect(JSON.parse(recordWhenDrawn as string)).toMatchObject({ total: 1, green: 1, advisory: 0, unread: 0 });
    } finally {
      watch.disconnect();
    }
  });

  // bug→guard (owner screenshot 2026-07-06): the verdict state stacked the live run-list AND the
  // green collapsible — every check title rendered twice. Pin: in the verdict state each check
  // title renders exactly once (inside the expanded green detail), never in a persisted run-list.
  it("verdict state renders each check title exactly once (no doubled list)", async () => {
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    await screen.findByText("Ready to play — this rig measured clean");
    // Collapsed: the run-list has resolved into the verdict — no check titles on screen.
    expect(screen.queryByText("SSD check")).not.toBeInTheDocument();
    // Expanded green detail is the ONE canonical list.
    fireEvent.click(screen.getByRole("button", { name: /measured perfect/ }));
    expect(screen.getAllByText("SSD check")).toHaveLength(1);
  });

  it("finishing marks the first check seen (gate key) and hands off to the app", async () => {
    const onDone = vi.fn();
    render(
      <ConfirmProvider>
        <FirstCheck onDone={onDone} />
      </ConfirmProvider>,
    );
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
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
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
      if (cmd === "priorities_from")
        return Promise.resolve({
          limiters: [
            {
              id: "hags-lim",
              title: "Hardware GPU Scheduling is off",
              reason: "Turning it on can smooth frame pacing on your GPU.",
              linked: "hags",
              confidence: "high",
              status: "attention",
            },
          ],
          already_fine: [],
          not_worth_touching: [],
          session_hint: null,
          upgrade_path: null,
        });
      if (cmd === "get_recommendations")
        return Promise.resolve([{ id: "hags", title: "Enable Hardware GPU Scheduling", currently_applied: false }]);
      return Promise.resolve(null);
    }) as never);

    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );

    // The #1-limiter spotlight resolves with an Apply button (an applyable fix)…
    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument();
    // …and the reversibility promise is already on the card — no Apply click required.
    expect(screen.getByText(/roll this back anytime/i)).toBeInTheDocument();
  });
});

// CR-tour-reject (codebase review 2026-11-03): a scan that rejected left the first check "running"
// forever; landed, it must not read as a clean rig, and it writes no last-check record (Home's band
// would otherwise say "0/0 clean").
describe("FirstCheck when the scan rejects", () => {
  it("says it couldn't read the PC, offers a retry, and records nothing", async () => {
    vi.mocked(invoke).mockImplementation((() => Promise.reject(new Error("ipc down"))) as never);
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Compy couldn't read this PC's checks just now")).toBeInTheDocument();
    expect(screen.queryByText(/measured clean/)).toBeNull();
    expect(screen.queryByText(/came back right/)).toBeNull();
    expect(screen.queryByText(/won't invent work/)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBeNull();
  });
});
