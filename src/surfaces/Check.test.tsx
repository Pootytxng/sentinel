import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Settable per-test leftovers response (vi.mock factories are hoisted — this must be too).
const leftoversMock = vi.hoisted(() => ({
  report: { findings: [], checked: 2, unavailable: [] } as {
    findings: unknown[];
    checked: number;
    unavailable: { id: string; title: string; reason: string }[];
  },
  nics: [] as { name: string; driver_date: string; driver_age_days: number | null; vendor: string }[],
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

// useScan polls real commands on mount; mock invoke to feed a tiny readiness/priorities scan.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_leftovers") return Promise.resolve(leftoversMock.report);
    if (cmd === "get_nic_driver_info") return Promise.resolve(leftoversMock.nics);
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
    if (cmd === "get_priorities") return Promise.resolve(prioritiesMock.payload);
    // useScan/refresh now rank via priorities_from (pure) instead of re-running get_priorities.
    if (cmd === "priorities_from") return Promise.resolve(prioritiesMock.payload);
    if (cmd === "get_recommendations") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import Check, { LEFTOVER_LEARN_ID } from "./Check";
import { KNOWLEDGE_BY_ID } from "../data/knowledge";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { fireEvent } from "@testing-library/react";
import type { SessionSummary } from "../types";

afterEach(() => {
  cleanup();
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
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
    expect(screen.getByText(/Your GPU's been running warm/i)).toBeInTheDocument();
    expect(screen.getByText(/Peaked at 84°C across your last 3 sessions/i)).toBeInTheDocument();
    // named-place law: the link is deliberate travel to the exact Learn guide.
    fireEvent.click(screen.getByRole("button", { name: /undervolt guide/i }));
    expect(onOpenLibrary).toHaveBeenCalledWith("amd-gpu-undervolt");
  });

  it("stays silent when temps are fine, or on a non-AMD rig (bathroom law / v1 scope)", async () => {
    const { rerender } = render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" sessions={[sess(60), sess(61), sess(59)]} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
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
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
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
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Check for past tweaks" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Check for past tweaks" }));
    expect(
      await screen.findByText(/No past tweaks found — your Windows config matches stock/),
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
    fireEvent.click(screen.getByRole("button", { name: "Check for past tweaks" }));
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
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
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
