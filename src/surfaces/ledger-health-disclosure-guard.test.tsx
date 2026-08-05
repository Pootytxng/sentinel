// bug → guard, for the follow-up the backend recorded against itself (src-tauri/src/history.rs, the
// H1 quarantine fix): `get_applied_changes` degrades a ledger it cannot READ to an empty array, and
// the Active layer renders an empty array as "Nothing active on this PC" — an affirmative claim
// ABOUT THE MACHINE, made at the exact moment every apply and every rollback is refusing.
//
// The rule these cases pin, in the wording intelligence.rs uses for the same distinction: the user
// must be able to tell "Compy did nothing" apart from "Compy can't tell you what it did".
//
// Two failure shapes both mean incomplete and both are covered below:
//   transient — load_history() is failing RIGHT NOW (locked file, IO error, parse failure);
//   durable   — a ledger quarantined on an EARLIER run. After that rename the real path is simply
//               gone, so every later load returns Ok(vec![]) — byte-identical to a genuine first
//               run, forever. This is why `complete` can never be derived from row count.
//
// And the case that is NOT a defect: health UNKNOWN (the probe itself failed). Claiming
// incompleteness there would be fabricating a machine claim from a failed read — the same sin,
// mirrored. Unknown must leave the surface exactly as it was.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// Per-test control over ONE command. Everything else resolves null, matching the other Fix mounts'
// mocks, so this file exercises the disclosure and nothing else.
const health: { value: unknown; reject: boolean } = { value: null, reject: false };
const revealCalls: unknown[] = [];
const revealFailure: { message: string | null } = { message: null };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_ledger_health") {
      return health.reject ? Promise.reject(new Error("ipc down")) : Promise.resolve(health.value);
    }
    if (cmd === "reveal_ledger_folder") {
      revealCalls.push(cmd);
      return revealFailure.message
        ? Promise.reject(revealFailure.message)
        : Promise.resolve(null);
    }
    return Promise.resolve(null);
  }),
}));

import Fix from "./Fix";
import type { AppliedChange } from "../types";

beforeEach(() => {
  health.value = null;
  health.reject = false;
  revealCalls.length = 0;
  revealFailure.message = null;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// The claim is asserted through the ELEMENT that carries it, not a text match: a substring matcher
// would keep passing if the claim were reworded, which is exactly the failure this file guards.
const claim = (c: HTMLElement) => c.querySelector(".fix-empty");
const UNREADABLE_TITLE = "Compy can't read its own record right now";
const QUARANTINED_TITLE = "Compy can't tell you everything it did";

const CHANGE: AppliedChange = {
  id: "chg-1",
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  applied_at: new Date().toISOString(),
  snapshot: null,
  status: "applied",
  is_still_active: true,
};

async function mountFix(changes: AppliedChange[] = []) {
  const r = render(
    <Fix
      recs={[]}
      startup={[]}
      changes={changes}
      busyId={null}
      isAppliable={() => true}
      activeChangeFor={() => undefined}
      onToggleRec={vi.fn()}
      onToggleStartup={vi.fn()}
      onRollback={vi.fn()}
      onApplyBatch={vi.fn().mockResolvedValue({ applied: 0, skipped: [] })}
      onOpenLibrary={vi.fn()}
      vendor="amd"
      view="applied"
    />,
  );
  // Flush the get_ledger_health promise — the disclosure is a post-mount read, not a prop.
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

describe("the ledger cannot vouch for itself", () => {
  it("a quarantined ledger withdraws the machine claim and says what is missing", async () => {
    health.value = { complete: false, error: null, quarantined: true };
    const { container } = await mountFix();

    // The defect itself: an empty list that Compy cannot vouch for must not be spoken as fact.
    expect(claim(container)).toBeNull();

    expect(screen.getByText(QUARANTINED_TITLE)).toBeTruthy();
    expect(container.querySelector(".fix-ledger-health")).toBeTruthy();
    // The durable half of the message: the bytes were preserved, but the pre-quarantine changes are
    // gone from this list and unrollbackable from here. Both halves must survive a copy edit.
    const body = container.querySelector(".fix-ledger-health-body")?.textContent ?? "";
    expect(body).toMatch(/set the original aside/i);
    expect(body).toMatch(/can't be undone from here/i);
  });

  it("an unreadable ledger says so, and shows the failure verbatim rather than paraphrasing it", async () => {
    health.value = {
      complete: false,
      error: "failed to read history.json: The process cannot access the file",
      quarantined: false,
    };
    const { container } = await mountFix();

    expect(claim(container)).toBeNull();
    expect(screen.getByText(UNREADABLE_TITLE)).toBeTruthy();
    // Support evidence: the OS message is the diagnostic. Summarising it away loses the only clue.
    expect(container.querySelector(".fix-ledger-health-detail")?.textContent).toBe(
      "failed to read history.json: The process cannot access the file",
    );
    // The transient half must say applies and rollbacks are refusing — not merely that a list is short.
    expect(container.querySelector(".fix-ledger-health-body")?.textContent ?? "").toMatch(
      /won't apply or undo anything/i,
    );
  });

  it("a fresh quarantine — damage found on THIS load — reports both halves, neither twice", async () => {
    health.value = { complete: false, error: "invalid JSON at line 1", quarantined: true };
    const { container } = await mountFix();

    const bodies = container.querySelectorAll(".fix-ledger-health-body");
    expect(bodies.length).toBe(2);
    expect(container.querySelectorAll(".fix-ledger-health").length).toBe(1);
    expect(container.querySelectorAll(".fix-ledger-health-title").length).toBe(1);
    expect(container.querySelector(".fix-ledger-health-detail")?.textContent).toBe(
      "invalid JSON at line 1",
    );
  });

  it("a healthy ledger is left alone — the claim is honest and the disclosure stays away", async () => {
    health.value = { complete: true, error: null, quarantined: false };
    const { container } = await mountFix();

    expect(claim(container)?.textContent).toMatch(/^Nothing active on this PC/);
    expect(container.querySelector(".fix-ledger-health")).toBeNull();
  });

  it("UNKNOWN health is not incompleteness — a failed probe may not manufacture a warning either", async () => {
    health.reject = true;
    const { container } = await mountFix();

    expect(claim(container)?.textContent).toMatch(/^Nothing active on this PC/);
    expect(container.querySelector(".fix-ledger-health")).toBeNull();
  });

  it("the disclosure qualifies rows too, and is read before them", async () => {
    // Not just the empty case: a PARTIAL list is the more dangerous one, because it looks complete.
    health.value = { complete: false, error: null, quarantined: true };
    const { container } = await mountFix([CHANGE]);

    const box = container.querySelector(".fix-ledger-health");
    const rows = screen.getByText("Active on this PC");
    expect(box).toBeTruthy();
    expect(screen.getByText("Hardware-accelerated GPU scheduling")).toBeTruthy();
    // A caveat printed under the thing it qualifies has already failed at its job.
    expect(box!.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the disclosure carries its own fix ([[flags-name-it-and-fix-it-inline]])", () => {
  it("points at the preserved file when there is one, and at the folder when there is not", async () => {
    health.value = { complete: false, error: null, quarantined: true };
    const { container } = await mountFix();
    expect(container.querySelector(".fix-ledger-health-action")?.textContent).toBe(
      "Show me the file Compy set aside",
    );

    cleanup();
    health.value = { complete: false, error: "locked", quarantined: false };
    const second = await mountFix();
    expect(second.container.querySelector(".fix-ledger-health-action")?.textContent).toBe(
      "Open the Compy folder",
    );
  });

  it("a button that fails says so instead of appearing to do nothing", async () => {
    health.value = { complete: false, error: null, quarantined: true };
    revealFailure.message = "Explorer refused to start";
    const { container } = await mountFix();

    await act(async () => {
      fireEvent.click(container.querySelector(".fix-ledger-health-action")!);
      await Promise.resolve();
    });

    expect(revealCalls.length).toBe(1);
    expect(screen.getByText("Explorer refused to start")).toBeTruthy();
  });
});
