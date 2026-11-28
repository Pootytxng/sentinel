// e2 loading states (bug -> guard). Two lines in the Lab's Optimize station stated an EMPTY answer
// while the answer had not been read:
//
//   A. "Nothing waiting — no changes to make on this rig right now." rendered while App's `recs` was
//      still null: OptimizeStation hands Fix `recs ?? []`, and Fix read that [] as "nothing to do".
//   B. "Nothing active on this PC — …" rendered in Applied & history before get_applied_changes had
//      answered (App's `changes` starts as []), and also after that read was REJECTED.
//
// An unread list is not an empty one. Now A says the list is not read yet, B says "Ledger not read
// yet" / "Couldn't read the ledger · trying again" (the rail footer's words for the same two states),
// and the empty-state claims stay for lists that were really read and really empty (pinned below as
// controls, so a fix that just deleted the claims would fail too).
//
// Break checks: remove `recsUnread={props.recs == null}` in OptimizeStation.tsx and the A test fails
// ("Nothing waiting" with recs null). Remove `ledgerRead == null &&` from Fix.tsx's empty-state gate
// and the B tests fail ("Nothing active" while pending / failed). Drop `ledgerRead={props.ledgerRead}`
// in ChangesFace.tsx and its test fails.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const health: { value: unknown } = { value: null };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_ledger_health") return Promise.resolve(health.value);
    return Promise.resolve(null);
  }),
}));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { ChangesFace } = await import("./ChangesFace");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
import type { LabFastPathProps } from "./OptimizeStation";

const HEALTHY = { complete: true, error: null, quarantined: false };
const UNREADABLE = { complete: false, error: "failed to read history.json", quarantined: false };

const NOTHING_WAITING = "Nothing waiting";
const RECS_NOT_READ = "Compy hasn't read which changes fit this rig yet.";
const NOTHING_ACTIVE = "Nothing active on this PC";
const LEDGER_NOT_READ = "Ledger not read yet";
const LEDGER_READ_FAILED = "Couldn't read the ledger · trying again";

const fast: LabFastPathProps = {
  recs: [],
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  onChanged: () => {},
  sessions: [],
  gpus: [],
  vendor: "amd",
};

async function mount(over: Partial<LabFastPathProps> = {}, face: "station" | "changes" = "station") {
  const props = { ...fast, ...over };
  const r = render(
    <ConfirmProvider>{face === "station" ? <OptimizeStation {...props} /> : <ChangesFace {...props} />}</ConfirmProvider>,
  );
  // Flush the ledger-health probes (state set from a promise; React commits it only inside act).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
}

/** The ledger disclosure's body: where Applied & history's own lines live. */
const ledger = (c: HTMLElement) => c.querySelector<HTMLElement>(".lab-optimize-ledger")!;

beforeEach(() => {
  health.value = HEALTHY;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("A: the fixes list before the recommendations are read", () => {
  it("recs not read yet (null) → says so, never 'Nothing waiting'", async () => {
    const { container } = await mount({ recs: null });
    expect(container.textContent).not.toContain(NOTHING_WAITING);
    expect(container.querySelector('[data-testid="fix-recs-unread"]')?.textContent).toBe(RECS_NOT_READ);
  });

  it("control: recs read and empty → 'Nothing waiting' stays, and no not-read line", async () => {
    const { container } = await mount({ recs: [] });
    expect(container.textContent).toContain(NOTHING_WAITING);
    expect(container.textContent).not.toContain(RECS_NOT_READ);
  });
});

describe("B: Applied & history before the ledger is read", () => {
  it("pending → 'Ledger not read yet', never 'Nothing active on this PC'", async () => {
    const { container } = await mount({ ledgerRead: "pending" });
    expect(ledger(container).textContent).toContain(LEDGER_NOT_READ);
    expect(container.textContent).not.toContain(NOTHING_ACTIVE);
  });

  it("read failed → 'Couldn't read the ledger · trying again', never 'Nothing active on this PC'", async () => {
    const { container } = await mount({ ledgerRead: "failed" });
    expect(ledger(container).textContent).toContain(LEDGER_READ_FAILED);
    expect(container.textContent).not.toContain(NOTHING_ACTIVE);
    expect(container.textContent).not.toContain(LEDGER_NOT_READ);
  });

  it("read failed with the amber notice already up → the notice speaks once, no second line, no claim", async () => {
    health.value = UNREADABLE;
    const { container } = await mount({ ledgerRead: "failed" });
    expect(ledger(container).querySelector(".ledger-health")).not.toBeNull();
    expect(container.textContent).not.toContain(LEDGER_READ_FAILED);
    expect(container.textContent).not.toContain(NOTHING_ACTIVE);
  });

  it("control: read and empty → 'Nothing active on this PC' stays, and no not-read line", async () => {
    const { container } = await mount({});
    expect(ledger(container).textContent).toContain(NOTHING_ACTIVE);
    expect(container.textContent).not.toContain(LEDGER_NOT_READ);
    expect(container.textContent).not.toContain(LEDGER_READ_FAILED);
  });

  it("the tuning-tools-off face (ChangesFace) passes the same read state to the same ledger", async () => {
    const { container } = await mount({ ledgerRead: "pending" }, "changes");
    const face = container.querySelector<HTMLElement>('[data-testid="lab-changes-ledger"]')!;
    expect(face.textContent).toContain(LEDGER_NOT_READ);
    expect(face.textContent).not.toContain(NOTHING_ACTIVE);
  });
});
