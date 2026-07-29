// Journey guard — recovery item 5, validation test 9: "Ignore / Not for me remains available."
//
// The check is where a user FIRST meets a finding. Before this train it offered exactly two answers —
// apply it, or leave it nagging forever — so the third honest answer ("this one isn't for me") only
// existed one room away in Fix.tsx. These tests pin the third door open, and pin the three rails it
// rides on:
//   1. NOT a mutation path. Declining is a stored PREFERENCE (surfaces/dismissed.ts, localStorage,
//      zero IPC). If a decline ever starts calling the backend, this suite fails.
//   2. It NEVER hides a finding. A set-aside rec stays exactly where it was, labeled, with Restore on
//      it — dismissal is a preference, and vanishing the row would vanish the truth.
//   3. Same key as Fix/Optimize, so one decline is honored wherever the user meets the tweak next.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const prioritiesMock = vi.hoisted(() => ({ payload: {} as Record<string, unknown> }));
const recsMock = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_leftovers")
      return Promise.resolve({ findings: [], checked: 2, unavailable: [] });
    if (cmd === "get_nic_driver_info") return Promise.resolve([]);
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
    return Promise.resolve(null);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import Check from "./Check";
import { ConfirmProvider } from "../design/ConfirmDialog";

const DISMISSED_KEY = "compy_dismissed_recs";

afterEach(() => {
  cleanup();
  localStorage.removeItem(DISMISSED_KEY);
  recsMock.list = [];
  prioritiesMock.payload = {};
  vi.mocked(invoke).mockClear();
});

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

const aggregate = (rec_ids: string[]) => ({
  limiters: [
    {
      id: "pending-safe-recs",
      title: `${rec_ids.length} safe tweaks not applied`,
      reason: "Compy has safe, reversible tweaks you haven't applied.",
      linked: null,
      rec_ids,
      confidence: "high",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
});

// A row whose headline IS the one tweak — the single-rec shape, which keeps its row-level switch.
const singleRow = (id: string, title: string) => ({
  ...aggregate([id]),
  limiters: [
    {
      id: "pending-safe-recs",
      title,
      reason: "A safe, reversible tweak Compy can apply for you.",
      linked: id,
      rec_ids: [id],
      confidence: "high",
      status: "attention",
    },
  ],
});

const APPLIABLE = new Set(["hags-enable", "game-mode"]);

function mount() {
  render(
    <ConfirmProvider>
      <Check
        isAppliable={(id: string) => APPLIABLE.has(id)}
        onOpenLibrary={vi.fn()}
        onChanged={vi.fn()}
        vendor="any"
      />
    </ConfirmProvider>,
  );
}

describe("Check — the decline door (item 5 / validation 9)", () => {
  it("offers 'Not for me' on every actionable named card — appliable AND hands-on", async () => {
    recsMock.list = [
      rec(),
      rec({ id: "game-mode", title: "Turn on Game Mode" }),
      // Compy can't snapshot + undo this one → hands-on. Declining a chore is just as valid.
      rec({ id: "xmp-expo", title: "Enable EXPO memory profile" }),
    ];
    prioritiesMock.payload = aggregate(["hags-enable", "game-mode", "xmp-expo"]);
    mount();
    await screen.findByText("Turn on Game Mode");
    expect(screen.getAllByRole("button", { name: /^Set aside / })).toHaveLength(3);
  });

  it("declining sets the card aside IN PLACE — labeled, still named, with a working Restore", async () => {
    recsMock.list = [rec(), rec({ id: "game-mode", title: "Turn on Game Mode" })];
    prioritiesMock.payload = aggregate(["hags-enable", "game-mode"]);
    mount();
    await screen.findByText("Turn on Game Mode");

    fireEvent.click(screen.getByRole("button", { name: "Set aside Turn on Game Mode" }));

    // The finding does NOT vanish — it stays where it was, named, and says what happened.
    expect(screen.getByText("Turn on Game Mode")).toBeInTheDocument();
    expect(screen.getByText(/Set aside — out of your active count/)).toBeInTheDocument();
    // Its Apply is gone (declined), but the OTHER card's is untouched — identity, not row position.
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(1);

    // …and the way back rides on the card itself.
    fireEvent.click(screen.getByRole("button", { name: "Restore Turn on Game Mode" }));
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(2);
    expect(screen.queryByText(/Set aside — out of your active count/)).not.toBeInTheDocument();
  });

  it("an already-applied tweak offers NO decline — undoing it is a rollback, not a decline", async () => {
    recsMock.list = [
      rec({ currently_applied: true }),
      rec({
        id: "game-mode",
        title: "Turn on Game Mode",
        eligible: false,
        ineligible_reason: "Windows 11 25H2 manages this itself.",
      }),
    ];
    prioritiesMock.payload = aggregate(["hags-enable", "game-mode"]);
    mount();
    await screen.findByText("Turn on Game Mode");
    // Applied → rollback lives in the Trust Ledger. Ineligible → nothing to decline.
    expect(screen.queryByRole("button", { name: /^Set aside / })).not.toBeInTheDocument();
  });

  it("the single-rec row can be declined too, and drops its row-level switch when set aside", async () => {
    recsMock.list = [rec()];
    prioritiesMock.payload = singleRow("hags-enable", "Enable Hardware GPU Scheduling");
    mount();
    await screen.findByRole("switch", { name: "Apply Enable Hardware GPU Scheduling" });

    fireEvent.click(
      screen.getByRole("button", { name: "Set aside Enable Hardware GPU Scheduling" }),
    );

    // Row still there, still named, now labeled — with no live switch inviting the applied action.
    expect(screen.getByText("Enable Hardware GPU Scheduling")).toBeInTheDocument();
    expect(screen.getByText(/Set aside — out of your active count/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore Enable Hardware GPU Scheduling" }));
    expect(
      screen.getByRole("switch", { name: "Apply Enable Hardware GPU Scheduling" }),
    ).toBeInTheDocument();
  });

  it("a decline made anywhere else already reads as set aside here — one shared preference", async () => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(["hags-enable"]));
    recsMock.list = [rec()];
    prioritiesMock.payload = singleRow("hags-enable", "Enable Hardware GPU Scheduling");
    mount();
    // Fix.tsx and Check read the SAME key, so the user never has to decline the same tweak twice.
    expect(await screen.findByText(/Set aside — out of your active count/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("declining touches NO backend — it is a stored preference, never a mutation", async () => {
    recsMock.list = [rec()];
    prioritiesMock.payload = singleRow("hags-enable", "Enable Hardware GPU Scheduling");
    mount();
    await screen.findByRole("switch", { name: "Apply Enable Hardware GPU Scheduling" });
    vi.mocked(invoke).mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Set aside Enable Hardware GPU Scheduling" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore Enable Hardware GPU Scheduling" }));

    // LOCKED rule 3 / train constraint: no new mutation path. Not one IPC call for either direction.
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    // The choice lands in the shared preference store instead.
    expect(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]")).toEqual([]);
  });
});
