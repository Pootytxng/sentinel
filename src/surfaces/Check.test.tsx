import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// Settable per-test leftovers response (vi.mock factories are hoisted — this must be too).
const leftoversMock = vi.hoisted(() => ({
  report: { findings: [], checked: 2, unavailable: [] } as {
    findings: unknown[];
    checked: number;
    unavailable: { id: string; title: string; reason: string }[];
  },
  nics: [] as { name: string; driver_date: string; driver_age_days: number | null; vendor: string }[],
}));

// Settable Drift Watch payload — a check that was good and has since regressed. Default: none.
const readinessMock = vi.hoisted(() => ({
  drifts: [] as { id: string; label: string; detail: string; noticed_at: string; unreadable_now?: boolean }[],
  // P6-timeline: the hardware-change advisory's payload (hwchange.rs). Default: no change.
  hw: null as null | { changed: boolean; changes: string[]; baseline_recorded: boolean },
  // Checks Compy could not read (each one an extra "unknown" row). Default: none.
  unread: 0,
  // Checks Compy deliberately doesn't judge (each an extra "advisory" row). Default: none.
  advisories: 0,
}));

// Settable priorities payload (R3 Lane B: upgrade_path arrives on this existing command).
const prioritiesMock = vi.hoisted(() => ({
  payload: {
    limiters: [],
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
  } as Record<string, unknown>,
}));

// Settable startup list for the startup-load limiter. `rereadFails` makes every read after the
// disable reject, and `steps` records the order of the disable, the re-read and App's refresh.
const startupMock = vi.hoisted(() => ({
  entries: [] as { name: string; command: string; enabled: boolean }[],
  disabled: false,
  rereadFails: false,
  steps: [] as string[],
}));

// Settable apply path (#619): the recs the scan offers, the ledger entries it reads back, and
// whether apply_recommendation lands. Nothing here reaches Windows; invoke is mocked.
const applyMock = vi.hoisted(() => ({
  recs: [] as { id: string; title: string; currently_applied: boolean }[],
  changes: [] as { rec_id: string; rec_title: string; status: string; is_still_active: boolean }[],
  fails: false,
  applied: [] as string[],
}));

// useScan polls real commands on mount; mock invoke to feed a tiny readiness/priorities scan.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_startup_entries") {
      if (startupMock.disabled) startupMock.steps.push("reread");
      if (startupMock.disabled && startupMock.rereadFails) return Promise.reject(new Error("probe failed"));
      return Promise.resolve(startupMock.entries);
    }
    if (cmd === "set_startup_entry_enabled") {
      startupMock.steps.push("disable");
      startupMock.disabled = true;
      return Promise.resolve(null);
    }
    if (cmd === "get_leftovers") return Promise.resolve(leftoversMock.report);
    if (cmd === "get_nic_driver_info") return Promise.resolve(leftoversMock.nics);
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [
          { id: "a", label: "SSD check", status: "ready", detail: "", value: null },
          ...Array.from({ length: readinessMock.unread }, (_, n) => ({
            id: `u${n}`,
            label: `Unread ${n}`,
            status: "unknown",
            detail: "",
            value: null,
          })),
          ...Array.from({ length: readinessMock.advisories }, (_, n) => ({
            id: `adv${n}`,
            label: `Advisory ${n}`,
            status: "advisory",
            detail: "",
            value: null,
          })),
        ],
        ready_count: 1,
        attention_count: 0,
        unknown_count: readinessMock.unread,
        advisory_count: readinessMock.advisories,
        advisory: "",
        dismissed_ids: [],
        drifts: readinessMock.drifts,
      });
    if (cmd === "get_hardware_changes") return Promise.resolve(readinessMock.hw);
    if (cmd === "get_priorities") return Promise.resolve(prioritiesMock.payload);
    // useScan/refresh now rank via priorities_from (pure) instead of re-running get_priorities.
    if (cmd === "priorities_from") return Promise.resolve(prioritiesMock.payload);
    if (cmd === "get_recommendations") return Promise.resolve(applyMock.recs);
    if (cmd === "get_applied_changes") return Promise.resolve(applyMock.changes);
    if (cmd === "apply_recommendation") {
      if (applyMock.fails) return Promise.reject(new Error("apply refused"));
      applyMock.applied.push("apply");
      return Promise.resolve({ id: "chg-1" });
    }
    return Promise.resolve(null);
  }),
}));

import Check, { LEFTOVER_LEARN_ID } from "./Check";
import { KNOWLEDGE_BY_ID } from "../data/knowledge";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { fireEvent } from "@testing-library/react";
import { LEDGER_CHANGED_EVENT, type SessionSummary } from "../types";
import { invalidateProbe, putProbe } from "../data/probe-cache";
import { useLayoutEffect, useRef } from "react";
import { act } from "@testing-library/react";
import { setExpertView } from "../design/use-expert-view";

afterEach(() => {
  cleanup();
  startupMock.entries = [];
  startupMock.disabled = false;
  startupMock.rereadFails = false;
  startupMock.steps = [];
  applyMock.recs = [];
  applyMock.changes = [];
  applyMock.fails = false;
  applyMock.applied = [];
  readinessMock.drifts = [];
  readinessMock.hw = null;
  invalidateProbe();
  prioritiesMock.payload = {
    limiters: [],
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
  };
});

function sess(temp: number | null): SessionSummary {
  return {
    // Relative to now: the "running warm" nudge is a claim about RECENT sessions (14-day window in
    // gpuRunningHot), and Check calls it with the real Date.now(). A hardcoded date silently ages out
    // of the window once real time passes it (it did, on 2026-06-22) — so keep these fixtures recent.
    started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    duration_secs: 3600,
    process_name: "game.exe",
    samples: 100,
    avg_fps: 140,
    avg_frametime_ms: 7.1,
    low1_fps_est: 138,
    peak_gpu_temp_c: temp,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
  };
}
const HOT = [sess(84), sess(83), sess(82)];

describe("Check", () => {
  it("renders the Check header + the scanned rows from the shared scan", async () => {
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    expect(screen.getByText("Check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-run check|Scanning/ })).toBeInTheDocument();
    // The real readiness check streams into the shared scan rows.
    expect(await screen.findByText("SSD check")).toBeInTheDocument();
  });

  // Codebase review 2026-11-03: "every check came back right" with unread checks on the same screen.
  it("the living clean line never says every check came back right when some were unread", async () => {
    document.documentElement.dataset.living = "on";
    readinessMock.unread = 2;
    try {
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
        </ConfirmProvider>,
      );
      expect(
        await screen.findByText(
          "Measured clean — every check Compy could read came back right; 2 couldn't be read on this PC.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/every check came back right on this rig/)).not.toBeInTheDocument();
    } finally {
      readinessMock.unread = 0;
      delete document.documentElement.dataset.living;
    }
  });

  it("the living clean line names advisories as noted, not graded, never as came back right", async () => {
    document.documentElement.dataset.living = "on";
    readinessMock.advisories = 1;
    try {
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
        </ConfirmProvider>,
      );
      expect(
        await screen.findByText("Measured clean — every graded check came back right; 1 more is advisory: noted, not graded."),
      ).toBeInTheDocument();
    } finally {
      readinessMock.advisories = 0;
      delete document.documentElement.dataset.living;
    }
  });

  it("settled view collapses the scanned rows behind 'All N checks'; expanding reveals them", async () => {
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    // The collapse toggle only renders once the scan settles (verdict phase).
    const toggle = await screen.findByRole("button", { name: /All 1 checks/ });
    // Default settled state: the full per-check row list is collapsed (the chips carry the summary).
    expect(screen.queryByText("SSD check")).not.toBeInTheDocument();
    // Expanding reveals the full checklist — progressive disclosure, nothing deleted.
    fireEvent.click(toggle);
    expect(screen.getByText("SSD check")).toBeInTheDocument();
  });

  // Desk review 2026-11-03 (third pass): the receipt gave network QoS and VRR the accent ✓ of a check
  // that came back right, beside a verdict that called them noted, not graded.
  // s44 batch 2 (B3): Health says "12 of 14 checks look good"; this toggle said "All 16 checks" with no
  // hint that 2 of them are advisory.
  it("the 'All N checks' line names how many are graded and how many advisory", async () => {
    readinessMock.advisories = 1;
    try {
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
        </ConfirmProvider>,
      );
      expect(await screen.findByRole("button", { name: /All 2 checks · 1 graded, 1 advisory/ })).toBeInTheDocument();
    } finally {
      readinessMock.advisories = 0;
    }
  });

  // Review r1 S2: with unread checks too, the numbers must add up to the total.
  it("the 'All N checks' line names the checks that could not be measured, so the numbers add up", async () => {
    readinessMock.advisories = 1;
    readinessMock.unread = 1;
    try {
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
        </ConfirmProvider>,
      );
      expect(
        await screen.findByRole("button", { name: /All 3 checks · 1 graded, 1 advisory, 1 couldn't be measured/ }),
      ).toBeInTheDocument();
    } finally {
      readinessMock.advisories = 0;
      readinessMock.unread = 0;
    }
  });

  it("the receipt marks an advisory row noted, not graded, never with the ✓", async () => {
    readinessMock.advisories = 1;
    try {
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
        </ConfirmProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: /All 2 checks/ }));
      const advisory = screen.getByText("Advisory 0").closest("li")!;
      expect(advisory.className).toContain("check-all-advisory");
      expect(advisory.querySelector(".check-all-mark")!.textContent).toBe("·");
      expect(advisory.textContent).toContain("noted, not graded");
      const ready = screen.getByText("SSD check").closest("li")!;
      expect(ready.querySelector(".check-all-mark")!.textContent).toBe("✓");
    } finally {
      readinessMock.advisories = 0;
    }
  });

  it("drift banner names WHAT (label + detail) and points to WHEN on the Care view, but never a WHO — no 'outside Compy' (honesty guard, drift.rs:61)", async () => {
    // A power-profile regression can be self-inflicted (rolling back the Ultimate power plan in the
    // Trust Ledger drops this same check to Attention). Drift has no vantage point to tell that from a
    // Windows Update revert — so claiming a WHO ("changed outside Compy") is sometimes a flat lie.
    readinessMock.drifts = [
      {
        id: "power-profile",
        label: "Power profile",
        detail: "Active plan 'Balanced'.",
        noticed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    // WHAT drifted: the name and its detail...
    expect(await screen.findByText("Power profile: Active plan 'Balanced'.")).toBeInTheDocument();
    expect(screen.getByText("1 setting changed since it was last good")).toBeInTheDocument();
    // ...WHEN is no longer restated here: the card points to the Care view's list, which dates it
    // (P6-timeline). The old relative "noticed …" line is gone from Check.
    expect(screen.getByText(/lists each one with when Compy noticed it/)).toBeInTheDocument();
    expect(screen.queryByText(/noticed \d|noticed just now|noticed yesterday/)).not.toBeInTheDocument();
    // ...and the banner NEVER attributes a cause. "outside Compy" is the retired false claim.
    expect(screen.queryByText(/outside Compy/i)).not.toBeInTheDocument();
  });

  // CR-1102-left owner call (delegated 2026-11-10): a drift whose check now reads unknown stays, said
  // as last seen changed, never with the unknown check's detail as if it were the regression.
  it("a drift whose check now reads unknown says last seen changed; Compy can't read it now", async () => {
    readinessMock.drifts = [
      { id: "power-profile", label: "Power profile", detail: "Couldn't read the active plan.", noticed_at: new Date().toISOString(), unreadable_now: true },
    ];
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Power profile: last seen changed; Compy can't read it now.")).toBeInTheDocument();
    expect(screen.getByText("1 setting changed since it was last good")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't read the active plan/)).not.toBeInTheDocument();
  });

  it("the hardware advisory names the parts, keeps its actions, and links to the Care view (P6-timeline)", async () => {
    readinessMock.hw = { changed: true, changes: ["GPU: RX 6800 → RX 7900 XT"], baseline_recorded: true };
    const onOpenCare = vi.fn();
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" onOpenCare={onOpenCare} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Your hardware changed since last setup")).toBeInTheDocument();
    expect(screen.getByText(/GPU: RX 6800 → RX 7900 XT/)).toBeInTheDocument();
    // The card's own actions stay: they exist nowhere else.
    expect(screen.getByRole("button", { name: "Re-check my setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /This is my rig now/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See what else changed" }));
    expect(onOpenCare).toHaveBeenCalledTimes(1);
  });

  it("the drift pointer opens the Care view when the Lab wires it (P6-timeline)", async () => {
    readinessMock.drifts = [
      { id: "power-profile", label: "Power profile", detail: "Active plan 'Balanced'.", noticed_at: new Date().toISOString() },
      { id: "game-mode", label: "Game Mode", detail: "Off.", noticed_at: new Date().toISOString() },
    ];
    const onOpenCare = vi.fn();
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" onOpenCare={onOpenCare} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("2 settings changed since they were last good")).toBeInTheDocument();
    // One pointer for every drift, not one card each.
    expect(document.querySelectorAll(".check-drift").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "See what changed" }));
    expect(onOpenCare).toHaveBeenCalledTimes(1);
  });

  it("shows the tuning nudge ONLY when an AMD rig has run sustained-warm, linking to the guide", async () => {
    const onOpenLibrary = vi.fn();
    render(
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={onOpenLibrary}
          onChanged={vi.fn()}
          vendor="amd"
          sessions={HOT}
        />
      </ConfirmProvider>,
    );
    // Wait for the verdict phase (the result block) to render.
    expect(await screen.findByText("Worth a look")).toBeInTheDocument();
    expect(screen.getByText(/Your GPU's been running warm/i)).toBeInTheDocument();
    expect(screen.getByText(/Peaked at 84°C across your last 3 sessions/i)).toBeInTheDocument();
    // named-place law: the link is deliberate travel to the exact Learn guide.
    fireEvent.click(screen.getByRole("button", { name: /undervolt guide/i }));
    expect(onOpenLibrary).toHaveBeenCalledWith("amd-gpu-undervolt");
  });

  // CR-tuning-gpu-other-card: the nudge reads only sessions not recorded on another card, and says when
  // the sessions it read can't be tied to the card in this PC now.
  it("the warm nudge ignores another card's sessions and names the ones it can't tie to this card", async () => {
    const card = (gpu: string) => ({ hash: "h", gpu, gpu_driver: "1", ram_gb: 32, display: "" });
    const gpus = [
      { name: "AMD Radeon(TM) Graphics", driver_age_days: null, vram_bytes: 536870912 },
      { name: "AMD Radeon RX 9070 XT", driver_age_days: null, vram_bytes: 17163091968 },
    ];
    const elsewhere = HOT.map((s) => ({ ...s, hw_fingerprint: card("NVIDIA GeForce GTX 1060") }));
    const { rerender } = render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" sessions={elsewhere} gpus={gpus} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Worth a look")).toBeInTheDocument();
    expect(screen.queryByText(/running warm/i)).not.toBeInTheDocument();
    // Two of the three recorded this PC's card (the most-VRAM GPU), one recorded none.
    const mixed = [{ ...HOT[0], hw_fingerprint: card("AMD Radeon RX 9070 XT") }, HOT[1], { ...HOT[2], hw_fingerprint: card("AMD Radeon RX 9070 XT") }];
    rerender(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" sessions={mixed} gpus={gpus} />
      </ConfirmProvider>,
    );
    expect(screen.getByText(/Your GPU's been running warm/i)).toBeInTheDocument();
    expect(screen.getByTestId("check-warm-untied").textContent).toBe(
      "1 of those sessions didn't record which graphics card it ran on, so Compy can't tie it to the card in this PC now.",
    );
    // No GPU read: the card can't be identified, and the nudge says so.
    rerender(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" sessions={mixed} gpus={[]} />
      </ConfirmProvider>,
    );
    expect(screen.getByTestId("check-warm-untied").textContent).toBe(
      "Compy can't identify the graphics card in this PC right now, so it can't tie those sessions to it.",
    );
  });

  it("stays silent when temps are fine, or on a non-AMD rig (bathroom law / v1 scope)", async () => {
    const { rerender } = render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" sessions={[sess(60), sess(61), sess(59)]} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Worth a look")).toBeInTheDocument();
    expect(screen.queryByText(/running warm/i)).not.toBeInTheDocument();
    // NVIDIA rig, sustained-hot — still no nudge (no AMD guide; v1 AMD-only).
    rerender(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="nvidia" sessions={HOT} />
      </ConfirmProvider>,
    );
    expect(screen.queryByText(/running warm/i)).not.toBeInTheDocument();
  });

  it("driver freshness: a >90-day driver shows the honest advisory with a copyable vendor URL", async () => {
    render(
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={vi.fn()}
          onChanged={vi.fn()}
          vendor="any"
          gpus={[{ name: "AMD Radeon RX 9070 XT", driver_age_days: 200 }]}
        />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Worth a look")).toBeInTheDocument();
    // Age is a fact; "newer exists" stays a maybe — never "out of date", no version claim.
    // P5.5: the row is fact-only; the card's ONE shared note carries the maybe.
    expect(screen.getByText(/Your AMD graphics driver is 200 days old/)).toBeInTheDocument();
    expect(screen.getAllByText(/Newer ones may be available/)).toHaveLength(1);
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument();
    // The link lives behind the Copy button only — no raw URL text, never a launch link
    // (capabilities untouched).
    expect(screen.queryByText("https://www.amd.com/en/support")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy AMD link/ })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("driver freshness: unreadable date is a neutral skip; a recent driver is a quiet pass", async () => {
    const checkWith = (age: number | null) => (
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={vi.fn()}
          onChanged={vi.fn()}
          vendor="any"
          gpus={[{ name: "AMD Radeon RX 9070 XT", driver_age_days: age }]}
        />
      </ConfirmProvider>
    );
    const { rerender } = render(checkWith(null));
    expect(await screen.findByText("Worth a look")).toBeInTheDocument();
    // Missing data is a skip, not an alarm — no age, no nudge, no URL.
    expect(screen.getByText(/couldn't read your graphics driver's date/i)).toBeInTheDocument();
    expect(screen.queryByText(/days old/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy .*link/ })).not.toBeInTheDocument();
    rerender(checkWith(20));
    expect(screen.getByText(/Driver is recent — 20 days old\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
  });

  it("leftovers: on-demand only — a finding renders as a receipt card (museum tone)", async () => {
    leftoversMock.report = {
      findings: [
        {
          id: "pagefile-fixed",
          title: "Pagefile manually fixed",
          current_value: "Fixed at 30000–30000 MB (C:\\pagefile.sys)",
          stock_default: "Automatic (system-managed size)",
          matched_tweak: '"Set a fixed pagefile size" — optimization guides circa 2015–2023',
          mechanism_cost: "A fixed size either wastes disk or caps Windows below what a game may commit.",
          verdict: "On your 31 GB-RAM machine a fixed 29 GB pagefile spends ~29 GB of disk and changes nothing about game performance.",
          uncertain_source: true,
          restore_note: "Safe to restore to automatic; fully reversible; takes effect after a reboot.",
        },
      ],
      checked: 2,
      unavailable: [],
    };
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    // On-demand: nothing scanned, nothing shown until the user asks (charter: zero perceived scanning).
    expect(screen.queryByText(/Pagefile manually fixed/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check this PC for old tweaks" }));
    // Receipts, not adjectives: found value · stock default · matched tweak · rig verdict · rule #5 line.
    expect(await screen.findByText("Past tweak · Pagefile manually fixed")).toBeInTheDocument();
    expect(screen.getByText(/Found: Fixed at 30000.*Windows default: Automatic/)).toBeInTheDocument();
    expect(screen.getByText(/optimization guides circa 2015–2023/)).toBeInTheDocument();
    expect(screen.getByText(/yours to keep/)).toBeInTheDocument();
  });

  it("leftovers: clean result is first-class; unreadable probes are never counted clean", async () => {
    leftoversMock.report = { findings: [], checked: 2, unavailable: [] };
    const ui = (
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>
    );
    const { unmount } = render(ui);
    fireEvent.click(screen.getByRole("button", { name: "Check this PC for old tweaks" }));
    expect(
      await screen.findByText(/Nothing to clean up — your Windows config matches stock/),
    ).toBeInTheDocument();
    unmount();
    // One probe unreadable → the bold "matches stock" claim must NOT appear (honest scope),
    // and the unchecked setting is NAMED with its reason.
    leftoversMock.report = {
      findings: [],
      checked: 1,
      unavailable: [
        { id: "bcdedit-timer-flags", title: "Boot timer flags (bcdedit)", reason: "needs admin to check" },
      ],
    };
    render(ui);
    fireEvent.click(screen.getByRole("button", { name: "Check this PC for old tweaks" }));
    expect(await screen.findByText(/1 couldn't be read, so nothing is claimed/)).toBeInTheDocument();
    expect(
      screen.getByText(/Couldn't check Boot timer flags \(bcdedit\) — needs admin to check\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/matches stock where it matters/)).not.toBeInTheDocument();
  });

  it("NIC driver win-source: a stale network driver gets the honest maybe + copyable Realtek link", async () => {
    leftoversMock.nics = [
      { name: "Realtek PCIe GbE Family Controller", driver_date: "2022-03-01", driver_age_days: 1200, vendor: "realtek" },
    ];
    render(
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={vi.fn()}
          onChanged={vi.fn()}
          vendor="any"
          gpus={[{ name: "AMD Radeon RX 9070 XT", driver_age_days: 20 }]}
        />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Worth a look")).toBeInTheDocument();
    // P5.5 grouped card: the row states the FACT only (no per-device "newer may be available"
    // paragraph — the card's single shared note carries the honest maybe exactly once).
    expect(
      await screen.findByText(/Your Realtek driver \(Realtek PCIe GbE Family Controller\) is 1200\s+days old\./),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Newer ones may be available/)).toHaveLength(1);
    // The link lives BEHIND the Copy button only — no raw URL text on the surface, still no anchor.
    expect(screen.getByRole("button", { name: /Copy Realtek link/ })).toBeInTheDocument();
    expect(screen.queryByText("https://www.realtek.com/Download")).not.toBeInTheDocument();
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument();
    leftoversMock.nics = [];
  });

  it("NIC driver win-source: recent drivers get one quiet line; unreadable dates claim nothing", async () => {
    leftoversMock.nics = [
      { name: "Intel I226-V", driver_date: "2026-05-01", driver_age_days: 41, vendor: "intel" },
    ];
    const ui = (
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={vi.fn()}
          onChanged={vi.fn()}
          vendor="any"
          gpus={[{ name: "AMD Radeon RX 9070 XT", driver_age_days: 20 }]}
        />
      </ConfirmProvider>
    );
    const { unmount } = render(ui);
    expect(await screen.findByText(/Network driver is recent too/)).toBeInTheDocument();
    unmount();
    // One unreadable date → NO claim either way (silence beats overclaiming).
    leftoversMock.nics = [
      { name: "Intel I226-V", driver_date: "", driver_age_days: null, vendor: "intel" },
    ];
    render(ui);
    expect(await screen.findByText(/Driver is recent — 20 days old/)).toBeInTheDocument();
    expect(screen.queryByText(/Network driver/)).not.toBeInTheDocument();
    leftoversMock.nics = [];
  });

  it("every leftovers detector resolves to a real Learn entry — no dead What's-this links", () => {
    // Mirrors the backend DETECTORS list (leftovers.rs) — extend BOTH when adding a detector.
    const detectorIds = [
      "pagefile-fixed",
      "memory-compression-off",
      "bcdedit-timer-flags",
      "mmcss-tampering",
      "core-parking-forced",
      "defender-policy-off",
      "mpo-disabled",
      "tcp-autotuning-off",
      "win32-priority-separation",
    ];
    for (const id of detectorIds) {
      const learnId = LEFTOVER_LEARN_ID[id] ?? id;
      expect(KNOWLEDGE_BY_ID.has(learnId), `${id} → ${learnId} must resolve in the Library`).toBe(true);
    }
    // The section/empty-state explainer is a real entry too.
    expect(KNOWLEDGE_BY_ID.has("leftovers")).toBe(true);
  });

  // ── Upgrade path (R3 Lane B) ──

  it("renders the upgrade-path advisory with copy-only links AND the disclosure when hardware is named", async () => {
    prioritiesMock.payload = {
      limiters: [],
      already_fine: [],
      not_worth_touching: [],
      session_hint: null,
      upgrade_path: {
        items: [
          {
            kind: "gpu",
            title: "GPU was the measured limiter",
            why: "In your most recent monitored session, GPU usage peaked very high (~98%).",
            links: [{ retailer: "Amazon", url: "https://www.amazon.com/s?k=graphics+card" }],
          },
        ],
        disclosure: "If you buy through Compy links we may earn a commission — it never affects verdicts.",
      },
    };
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Upgrade path (advisory)")).toBeInTheDocument();
    expect(screen.getByText("GPU was the measured limiter")).toBeInTheDocument();
    // The disclosure ALWAYS renders with the links (mandatory — receipts law on money surfaces)…
    expect(screen.getByText(/never affects verdicts/)).toBeInTheDocument();
    // …and P5.5 HONESTY GUARD: while the links are tag-free plain searches (the A6 backend guard
    // pins that), the disclosure must NOT claim a commission we cannot earn. The backend const
    // (the fixture line above) is the Phase-D swap point; the SURFACE renders the truthful line
    // until tags actually arm. If Phase D flips this, update BOTH lines the same commit.
    expect(screen.getByText(/Compy earns nothing from these links/)).toBeInTheDocument();
    expect(screen.queryByText(/may earn a commission/)).not.toBeInTheDocument();
    // Links are copy BUTTONS, not anchors — no in-app navigation surface.
    expect(screen.getByRole("button", { name: /Copy Amazon search link/ })).toBeInTheDocument();
    expect(document.querySelector(".check-upgrade a")).toBeNull();
  });

  // P9-gpu-fit-unknowns: under a GPU limiter, what Compy can't check before any card; never a capacity.
  const fitGpuItem = {
    kind: "gpu",
    title: "GPU was the measured limiter",
    why: "In your most recent monitored session the GPU sat at or above 95% for 80% of the time.",
    links: [{ retailer: "Amazon", url: "https://www.amazon.com/s?k=graphics+card" }],
  };
  const showUpgrade = async (items: (typeof fitGpuItem)[]) => {
    prioritiesMock.payload = {
      limiters: [], already_fine: [], not_worth_touching: [], session_hint: null,
      upgrade_path: { items, disclosure: "x" },
    };
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    await screen.findByText("Upgrade path (advisory)");
  };

  // P9-limit-source: the line names the recorded session it was measured from; none recorded, no line.
  it("P9-limit-source: a GPU limiter names the game, the session's date and the counts behind it", async () => {
    await showUpgrade([
      {
        ...fitGpuItem,
        measured_from: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 720, readings: 900, threshold_pct: 95 },
      } as typeof fitGpuItem,
    ]);
    const line = screen.getByTestId("check-upgrade-source");
    // The day is the local date of a 20:36 UTC stamp (11th or 12th by zone); a year only when it isn't this one.
    expect(line.textContent).toMatch(/^Measured from your ROB RUN session on Nov 1[12](, 2026)?: 720 of 900 GPU readings were at 95% load or more\.$/);
    expect(line.closest(".check-upgrade-item")?.textContent).toContain("GPU was the measured limiter");
  });

  // P9-session-on-this-hardware: a session that can't be tied to the card in this PC now says so.
  it.each([
    ["not-recorded", "That session didn't record which graphics card it ran on, so Compy can't tie it to the card in this PC now."],
    ["card-unread", "Compy can't identify the graphics card in this PC right now, so it can't tie this to the card that session ran on."],
  ])("P9-session-on-this-hardware: a %s session says it can't be tied to this card", async (gpu_tie, words) => {
    await showUpgrade([
      {
        ...fitGpuItem,
        measured_from: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 720, readings: 900, threshold_pct: 95, gpu_tie },
      } as typeof fitGpuItem,
    ]);
    expect(screen.getByTestId("check-upgrade-untied").textContent).toBe(` ${words}`);
    expect(screen.getByTestId("check-upgrade-source")).toContainElement(screen.getByTestId("check-upgrade-untied"));
  });

  it("P9-session-on-this-hardware: a session on this card adds no tie line", async () => {
    await showUpgrade([
      {
        ...fitGpuItem,
        measured_from: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 720, readings: 900, threshold_pct: 95, gpu_tie: "this-card" },
      } as typeof fitGpuItem,
    ]);
    expect(screen.getByTestId("check-upgrade-source")).toBeInTheDocument();
    expect(screen.queryByTestId("check-upgrade-untied")).toBeNull();
  });

  // P9-screen-is-limit: averaged at or above the refresh rate it recorded = the screen is the limit,
  // never a GPU pointer or shopping links; below it, or either side unmeasured, the GPU row as before.
  const sourced = (avg_fps?: number, refresh_hz?: number) =>
    ({
      ...fitGpuItem,
      measured_from: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 720, readings: 900, threshold_pct: 95, avg_fps, refresh_hz },
    }) as typeof fitGpuItem;

  it("P9-screen-is-limit: at or above the screen's refresh rate the screen is named and no upgrade is recommended", async () => {
    await showUpgrade([sourced(251.6, 250)]);
    // P9-session-on-this-hardware: the rate is the mode that session ran at, and only a GPU upgrade
    // at that rate is ruled out (a higher refresh mode could still be the answer).
    expect(screen.getByText("Your screen's refresh rate was the limit in that session")).toBeInTheDocument();
    expect(screen.getByTestId("check-upgrade-screen").textContent).toBe(
      "In your ROB RUN session your screen ran at 250 Hz, so it could show at most 250 frames a second, and the session averaged 252 fps: on average a faster GPU wouldn't have shown you more frames at that refresh rate; the slowest moments can still depend on it. For frame rate at 250 Hz, no GPU upgrade is recommended for this game.",
    );
    expect(screen.queryByText("GPU was the measured limiter")).toBeNull();
    expect(screen.queryByTestId("check-upgrade-fit")).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy Amazon search link/ })).toBeNull();
    // What it was measured from still says so.
    expect(screen.getByTestId("check-upgrade-source")).toBeInTheDocument();
  });

  it("P9-screen-is-limit: exactly at the refresh rate counts (review r1 boundary)", async () => {
    await showUpgrade([sourced(250, 250)]);
    expect(screen.getByTestId("check-upgrade-screen")).toBeInTheDocument();
  });

  it.each([
    ["just below the refresh rate (249.6 never rounds up to it)", sourced(249.6, 250)],
    ["below the refresh rate", sourced(180, 250)],
    ["refresh unmeasured", sourced(251.6, undefined)],
    ["FPS unmeasured", sourced(undefined, 250)],
  ])("P9-screen-is-limit: %s keeps the GPU row and its links", async (_n, item) => {
    await showUpgrade([item]);
    expect(screen.getByText("GPU was the measured limiter")).toBeInTheDocument();
    expect(screen.queryByTestId("check-upgrade-screen")).toBeNull();
    expect(screen.getByRole("button", { name: /Copy Amazon search link/ })).toBeInTheDocument();
  });

  it("P9-limit-source: no recorded session, no source line", async () => {
    await showUpgrade([fitGpuItem]);
    expect(screen.queryByTestId("check-upgrade-source")).toBeNull();
  });

  it("P9-gpu-fit-unknowns: a GPU limiter names the power supply and case as unknown when the user added none", async () => {
    localStorage.removeItem("compy_rig_manual_parts");
    await showUpgrade([fitGpuItem]);
    const line = screen.getByTestId("check-upgrade-fit");
    expect(line.textContent).toBe(
      "Before any card: Compy can't read your power supply's capacity or connectors, or how much room and airflow your case has. Check those first.",
    );
    // Under the GPU item's own words, inside that item.
    expect(line.closest(".check-upgrade-item")?.textContent).toContain("GPU was the measured limiter");
  });

  it("P9-gpu-fit-unknowns: a power supply the user added is named as what they told Compy, never a capacity", async () => {
    localStorage.setItem("compy_rig_manual_parts", JSON.stringify([{ id: "m1", kind: "psu", name: "Corsair RM850x" }]));
    try {
      await showUpgrade([fitGpuItem]);
      expect(screen.getByTestId("check-upgrade-fit").textContent).toBe(
        "Before any card: you told Compy your power supply is “Corsair RM850x”. Compy can't check its capacity or connectors, or how much room and airflow your case has. Check those first.",
      );
    } finally {
      localStorage.removeItem("compy_rig_manual_parts");
    }
  });

  it("P9-ssd-fit-unknowns: the HDD item names the board and case slots Compy can't read, and nothing about a card", async () => {
    await showUpgrade([{ kind: "ssd", title: "Games are on an HDD", why: "HDD storage.", links: [] }]);
    const line = screen.getByTestId("check-upgrade-fit");
    expect(line.textContent).toBe(
      "Before any drive: Compy can't read which free M.2 slots, SATA ports or drive bays your motherboard and case have. Check those first.",
    );
    expect(line.closest(".check-upgrade-item")?.textContent).toContain("Games are on an HDD");
    expect(screen.queryByText(/Before any card/)).toBeNull();
  });

  it("P9-gpu-fit-unknowns: an item of another kind gets no fit line", async () => {
    await showUpgrade([{ kind: "other", title: "Something else", why: "x.", links: [] }]);
    expect(screen.getByText("Something else")).toBeInTheDocument();
    expect(screen.queryByTestId("check-upgrade-fit")).toBeNull();
  });

  // Owner rule 2026-11-20: a fact Compy read (a plan, a setting) is Known with its effect on FPS not
  // measured, under "Worth a look"; "Limiters we measured" and "Likely" need a measured row.
  it("a limiter resting on a fact reads Known + 'Effect on FPS not measured' under 'Worth a look'; a measured one keeps its heading and word", async () => {
    const lim = (basis: "fact" | "measured") => ({
      id: "power-profile",
      title: "Power plan isn't performance-oriented",
      reason: "A reason.",
      linked: null,
      confidence: "medium" as const,
      basis,
      status: "attention" as const,
    });
    const labels = () => Array.from(document.querySelectorAll(".check-section-label")).map((e) => e.textContent);
    prioritiesMock.payload = { limiters: [lim("fact")], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null };
    const { unmount } = render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    let row = (await screen.findByText("Power plan isn't performance-oriented")).closest(".check-row")!;
    expect(labels()).toContain("Worth a look");
    expect(labels()).not.toContain("Limiters we measured");
    expect(row.textContent).toContain("Known");
    expect(row.textContent).toContain("Effect on FPS not measured");
    expect(row.textContent).not.toMatch(/Likely/);
    unmount();

    prioritiesMock.payload = { limiters: [lim("measured")], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null };
    invalidateProbe();
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    row = (await screen.findByText("Power plan isn't performance-oriented")).closest(".check-row")!;
    expect(labels()).toContain("Limiters we measured");
    expect(row.textContent).toContain("Likely");
    expect(row.textContent).not.toContain("not measured");
  });

  // Review M2: an empty list is vacuously "all measured"; it must not be headed "Limiters we measured".
  it("an empty limiter list is headed 'Worth a look', never 'Limiters we measured'", async () => {
    prioritiesMock.payload = { limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null };
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("No limiter stands out on this rig — nothing to change today.")).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll(".check-section-label")).map((e) => e.textContent);
    expect(labels).toContain("Worth a look");
    expect(labels).not.toContain("Limiters we measured");
  });

  // ── Session hint (P9-hint-shown) ──

  it("prints the session GPU hint under the limiter rows, and nothing when it is absent", async () => {
    const hint =
      "Recent session hint: the GPU was busy at times (peak ~97%) but sat at or above 95% for only a fifth of the time Compy measured the game, so this session doesn't look GPU-limited overall.";
    prioritiesMock.payload = {
      limiters: [
        {
          id: "lim-x",
          title: "Some limiter",
          reason: "A reason.",
          linked: null,
          confidence: "medium",
          status: "attention",
        },
      ],
      already_fine: [],
      not_worth_touching: [],
      session_hint: hint,
      upgrade_path: null,
    };
    const { unmount } = render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    const line = await screen.findByText(hint);
    expect(line).toHaveClass("check-session-hint");
    // Under the limiter rows: the limiter list comes before the hint in document order.
    const list = document.querySelector(".check-list")!;
    expect(list.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    prioritiesMock.payload = { ...prioritiesMock.payload, session_hint: null };
    invalidateProbe();
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Some limiter")).toBeInTheDocument();
    expect(document.querySelector(".check-session-hint")).toBeNull();
    expect(screen.queryByText(/Recent session hint/)).toBeNull();
  });

  // ── Exportable setup summary (A5) ──

  it("renders a dedicated setup-summary card once the scan settles, with a copy button", async () => {
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    // The card only appears in the settled verdict phase (needs measured data to summarize).
    expect(await screen.findByText("Setup summary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy summary/ })).toBeInTheDocument();
  });

  it("copy button writes the plain-text summary to the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    const btn = await screen.findByRole("button", { name: /Copy summary/ });
    fireEvent.click(btn);
    await screen.findByRole("button", { name: /Copied/ });
    expect(writeText).toHaveBeenCalledTimes(1);
    // Read-only: what's copied is the measured summary text, not a launch/URL.
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toMatch(/^Compy setup summary/);
    expect(copied).toMatch(/measured on this rig/i);
  });

  // #599 review (PR 612): the disable writes the Trust Ledger, so App's refresh (History, Health) must
  // run once it has landed — even when this list's own re-read fails, which is not a failed disable.
  describe("turning a startup app off from the startup-load row", () => {
    const withStartupLimiter = () => {
      prioritiesMock.payload = {
        ...prioritiesMock.payload,
        limiters: [
          {
            id: "startup-load",
            title: "Startup apps",
            reason: "Several apps start with Windows",
            linked: null,
            confidence: "medium",
            status: "attention",
          },
        ],
      };
      startupMock.entries = [{ name: "Discord", command: "discord.exe", enabled: true }];
    };

    it("still runs and awaits App's refresh when the list re-read fails, and reports no failure", async () => {
      withStartupLimiter();
      startupMock.rereadFails = true;
      let refreshed = false;
      const onChanged = vi.fn(async () => {
        startupMock.steps.push("app-refresh");
        await new Promise((r) => setTimeout(r, 0));
        refreshed = true;
      });
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={onChanged} vendor="any" />
        </ConfirmProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Turn off at startup" }));
      // The button leaves its busy state only after the helper's refresh settles, App's included.
      await screen.findByRole("button", { name: "Turn off at startup" });
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(refreshed).toBe(true);
      expect(startupMock.steps[0]).toBe("disable");
      expect(startupMock.steps).toContain("app-refresh");
      expect(startupMock.steps).toContain("reread");
      expect(screen.queryByText("Couldn't change that startup item")).not.toBeInTheDocument();
    });

    it("re-reads the list after a disable that landed, and the app drops off it", async () => {
      withStartupLimiter();
      const onChanged = vi.fn();
      render(
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={onChanged} vendor="any" />
        </ConfirmProvider>,
      );
      const btn = await screen.findByRole("button", { name: "Turn off at startup" });
      startupMock.entries = [{ name: "Discord", command: "discord.exe", enabled: false }];
      fireEvent.click(btn);
      await waitFor(() => expect(screen.queryByText("Discord")).not.toBeInTheDocument());
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Couldn't change that startup item")).not.toBeInTheDocument();
    });
  });

  // #619: an apply from this room writes the Trust Ledger. The Test room's experiment bench, mounted
  // beside it, re-reads the ledger only on focus or LEDGER_CHANGED_EVENT, so the apply must announce
  // it (then App's refresh runs). A refused apply announces nothing.
  describe("applying a fix from Check announces the ledger change", () => {
    const countEvents = () => {
      const seen: string[] = [];
      const on = () => seen.push("event");
      window.addEventListener(LEDGER_CHANGED_EVENT, on);
      return { seen, off: () => window.removeEventListener(LEDGER_CHANGED_EVENT, on) };
    };
    const withApplyableLimiter = () => {
      prioritiesMock.payload = {
        ...prioritiesMock.payload,
        limiters: [
          {
            id: "power-plan",
            title: "Power plan",
            reason: "Balanced plan parks cores",
            linked: "rec-power",
            confidence: "high",
            status: "attention",
          },
        ],
      };
      applyMock.recs = [{ id: "rec-power", title: "High performance plan", currently_applied: false }];
    };
    const renderCheck = (onChanged: () => void) =>
      render(
        <ConfirmProvider>
          <Check isAppliable={() => true} onOpenLibrary={vi.fn()} onChanged={onChanged} vendor="any" />
        </ConfirmProvider>,
      );

    it("a limiter apply that lands announces it once, then App's refresh runs", async () => {
      withApplyableLimiter();
      const events = countEvents();
      const onChanged = vi.fn(() => events.seen.push("app-refresh"));
      renderCheck(onChanged);
      fireEvent.click(await screen.findByRole("switch", { name: "Apply Power plan" }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      events.off();
      expect(applyMock.applied).toEqual(["apply"]);
      expect(events.seen).toEqual(["event", "app-refresh"]);
    });

    it("a refused limiter apply announces nothing and skips App's refresh", async () => {
      withApplyableLimiter();
      applyMock.fails = true;
      const events = countEvents();
      const onChanged = vi.fn();
      renderCheck(onChanged);
      fireEvent.click(await screen.findByRole("switch", { name: "Apply Power plan" }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
      await screen.findByText("Couldn't apply that fix");
      events.off();
      expect(events.seen).toEqual([]);
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("turning a drifted change back on announces it once, then App's refresh runs", async () => {
      prioritiesMock.payload = {
        ...prioritiesMock.payload,
        limiters: [
          {
            id: "applied-changes",
            title: "Applied changes",
            reason: "One drifted",
            linked: null,
            confidence: "high",
            status: "attention",
          },
        ],
      };
      applyMock.changes = [{ rec_id: "game-bar", rec_title: "Xbox Game Bar off", status: "applied", is_still_active: false }];
      const events = countEvents();
      const onChanged = vi.fn(() => events.seen.push("app-refresh"));
      renderCheck(onChanged);
      fireEvent.click(await screen.findByRole("button", { name: "Turn it back on" }));
      fireEvent.click(await screen.findByRole("button", { name: "Turn it on" }));
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      events.off();
      expect(applyMock.applied).toEqual(["apply"]);
      expect(events.seen).toEqual(["event", "app-refresh"]);
    });
  });

  it("renders NO upgrade-path block when no verdict names hardware", async () => {
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    await screen.findByText("SSD check"); // scan settled
    expect(screen.queryByText("Upgrade path (advisory)")).not.toBeInTheDocument();
    expect(screen.queryByText(/never affects verdicts/)).not.toBeInTheDocument();
  });
});

// CR-check-expert-mount (same class as CR-bench-flake): with a cached verdict, the "measured fine" and
// "not worth touching" piles are on screen in Check's first commit. A tap there that lands before
// React runs the mount's passive effects must stay: the mount effect used to re-assert the Expert
// view default (closed) and undo it. A layout effect is the deterministic stand-in for "on screen,
// effects not run yet": it runs after the DOM is committed and before the passive mount effects.
describe("CR-check-expert-mount: a pile tapped before the mount effects stays as tapped", () => {
  const ITEM = (id: string, title: string) => ({ id, title, reason: "r", linked: null, confidence: "medium", status: "ready" });
  const seedCachedVerdict = () =>
    putProbe("readiness-scan", {
      readiness: {
        checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      },
      priorities: {
        limiters: [],
        already_fine: [ITEM("fine-1", "Fine thing")],
        not_worth_touching: [ITEM("nw-1", "Refused thing")],
        session_hint: null,
        upgrade_path: null,
      },
      recs: [],
      reverted: [],
      elapsed: 1,
    });

  function TapOnCommit({ name }: { name: RegExp }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const door = [...ref.current!.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
      if (!door) throw new Error(`no ${name} button in the first commit`);
      door.click();
    }, [name]);
    return (
      <div ref={ref}>
        <ConfirmProvider>
          <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
        </ConfirmProvider>
      </div>
    );
  }

  it.each([
    ["measured fine", /measured fine/, "Fine thing"],
    ["not worth touching", /not worth touching/, "Refused thing"],
  ])("the %s pile", (_n, name, shown) => {
    seedCachedVerdict();
    render(<TapOnCommit name={name} />);
    const door = screen.getAllByRole("button").find((b) => name.test(b.textContent ?? ""))!;
    expect(door).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(shown)).toBeInTheDocument();
  });

  // Review r1 SHOULD-FIX: the piles still follow a CHANGE of the preference live, both ways.
  it("flipping Expert view on a mounted Check opens both piles, and flipping it back closes them", () => {
    seedCachedVerdict();
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    const pile = (name: RegExp) => screen.getAllByRole("button").filter((b) => name.test(b.textContent ?? ""));
    expect(pile(/measured fine/)).toHaveLength(1);
    expect(pile(/not worth touching/)).toHaveLength(1);
    expect(pile(/measured fine/)[0]).toHaveAttribute("aria-expanded", "false");
    try {
      act(() => setExpertView(true));
      expect(pile(/measured fine/)[0]).toHaveAttribute("aria-expanded", "true");
      expect(pile(/not worth touching/)[0]).toHaveAttribute("aria-expanded", "true");
      act(() => setExpertView(false));
      expect(pile(/measured fine/)[0]).toHaveAttribute("aria-expanded", "false");
      expect(pile(/not worth touching/)[0]).toHaveAttribute("aria-expanded", "false");
    } finally {
      act(() => setExpertView(false));
    }
  });
});
