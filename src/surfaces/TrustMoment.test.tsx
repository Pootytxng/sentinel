// TrustMoment's rollback half (#631): an undo that ran on Windows but couldn't be saved to history
// must not read as "the change is still active"; a genuine rollback failure still must.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AppliedChange, Recommendation } from "../types";
import { ROLLBACK_UNRECORDED_LEAD } from "../data/rollback-error";

const invokeMock = vi.hoisted(() => ({ rollbackError: null as string | null, applyError: null as string | null }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "apply_recommendation" && invokeMock.applyError) return Promise.reject(invokeMock.applyError);
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
  invokeMock.applyError = null;
});
afterEach(cleanup);

// B11: the backend's own text never reaches the card ("no String(e) in the face"). A refusal backend-error.ts knows
// is said in the user's language; anything else gets the card's generic line. A refused rollback half says first that
// the demo's change is still on, so the mapped "Nothing was changed." reads as being about the undo (c8 review nit).
// Break checks: put `{ error: String(e) }` back (the raw text appears); show the mapped refusal on its own (the
// "still active" lead is missing).
const GM_HOLDS = "Gaming Mode is on and holds this setting for its session, and puts it back when it stops. Stop Gaming Mode first. Nothing was changed.";
describe("TrustMoment — B11: no raw backend text", () => {
  it("a genuine rollback failure shows the generic line, never the backend's text", async () => {
    invokeMock.rollbackError = "access denied (os error 5)";
    const err = await runDemo();
    expect(err.textContent).toBe(
      'The apply worked but the rollback didn\'t finish. The change is still active and undoable in Test under "Applied & history".',
    );
  });

  it("a refused rollback says the change is still on, then why the undo didn't run", async () => {
    invokeMock.rollbackError = `rollback refused: ${GM_HOLDS}`;
    const err = await runDemo();
    expect(err.textContent).toBe(
      `The apply worked, but Compy didn't undo it, so the change is still active and undoable in Test under "Applied & history". Why the undo didn't run: ${GM_HOLDS}`,
    );
    expect(err.textContent).not.toContain("rollback refused:");
  });

  it("a failed apply shows the generic line, never the backend's text", async () => {
    invokeMock.applyError = "registry write failed: 0x80070005";
    render(<TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /watch it work/i }));
    const err = await screen.findByText((_, el) => el?.classList.contains("tm-error") ?? false);
    expect(err.textContent).toBe("Couldn't apply it. Nothing on your PC was changed.");
  });

  it("says the same in Chinese", async () => {
    const i18n = (await import("../i18n")).default;
    await i18n.changeLanguage("zh-CN");
    try {
      invokeMock.rollbackError = `rollback refused: ${GM_HOLDS}`;
      render(<TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />);
      fireEvent.click(screen.getAllByRole("button")[0]);
      const err = await screen.findByText((_, el) => el?.classList.contains("tm-error") ?? false, {}, { timeout: 5000 });
      expect(err.textContent).toBe(
        "应用成功,但 Compy 没有撤销它,所以该更改仍然生效,你可以在「测试」的「已应用与历史记录」中手动撤销。撤销没有执行的原因:游戏模式已开启，并在本次会话中占用此设置，停止时会将其恢复。请先停止游戏模式。没有做任何更改。",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

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
