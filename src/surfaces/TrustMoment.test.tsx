// TrustMoment's rollback half (#631): an undo that ran on Windows but couldn't be saved to history
// must not read as "the change is still active"; a genuine rollback failure still must.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AppliedChange, Recommendation } from "../types";
import { ROLLBACK_UNRECORDED_LEAD } from "../data/rollback-error";

const invokeMock = vi.hoisted(() => ({ rollbackError: null as string | null }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "apply_recommendation") {
      const change: AppliedChange = {
        id: "c-1",
        rec_id: "game-mode",
        rec_title: "Game Mode",
        applied_at: "2026-10-24T01:00:00Z",
        snapshot: null,
        status: "applied",
        is_still_active: true,
      };
      return Promise.resolve(change);
    }
    if (cmd === "rollback_change") {
      // Tauri rejects with the command's Err string.
      return invokeMock.rollbackError ? Promise.reject(invokeMock.rollbackError) : Promise.resolve(null);
    }
    return Promise.reject(`no stub for "${cmd}"`);
  }),
}));

import { TrustMoment } from "./TrustMoment";

const REC: Recommendation = {
  id: "game-mode",
  title: "Game Mode",
  category: "system",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "",
  currently_applied: false,
  provenance: "verified",
};

async function runDemo() {
  render(<TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /watch it work/i }));
  // The card pauses ~2.6 s on the applied receipt before the rollback half runs.
  return screen.findByText((_, el) => el?.classList.contains("tm-error") ?? false, {}, { timeout: 5000 });
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.rollbackError = null;
});
afterEach(cleanup);

describe("TrustMoment — a rollback error", () => {
  it("says the undo worked when only the history save failed", async () => {
    invokeMock.rollbackError = `${ROLLBACK_UNRECORDED_LEAD} (disk full), so Test → Applied & history may still list this change as applied.`;
    const err = await runDemo();
    expect(err.textContent).toMatch(/undo worked on Windows/i);
    expect(err.textContent).not.toMatch(/still active|didn't finish/i);
  });

  it("still says the change is active when the rollback genuinely failed", async () => {
    invokeMock.rollbackError = "access denied";
    const err = await runDemo();
    expect(err.textContent).toMatch(/still active/i);
    expect(err.textContent).not.toMatch(/undo worked on Windows/i);
  });
});

// Desk-batch review 2026-10-31: the card now sits inside the Health summary, so opening the full
// health check (or leaving Health) remounts it while a demo is mid-flight. A fresh copy must not
// offer or start a second run: its apply would snapshot the first run's "on" as its "before", and
// its undo would leave the setting on while the ledger reads it undone.
describe("TrustMoment — one demo at a time", () => {
  it("a card mounted while a demo runs offers nothing and starts nothing", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const calls = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "apply_recommendation").length;
    const before = calls();
    const first = render(<TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /watch it work/i }));
    // The remount: the first card goes away mid-run and a fresh one mounts.
    first.unmount();
    render(<TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /watch it work/i })).toBeNull();
    expect(calls() - before).toBe(1);
    // Let the first run finish its own undo so no state leaks into the next test.
    await new Promise((r) => setTimeout(r, 2800));
  });
});
