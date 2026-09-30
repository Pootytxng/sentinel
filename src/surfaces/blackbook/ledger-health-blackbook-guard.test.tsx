// bug → guard, sibling of `surfaces/ledger-health-disclosure-guard.test.tsx`. Same defect, second
// surface: `get_applied_changes` degrades a Trust Ledger it cannot READ to an empty array, and the
// Logbook renders that array's emptiness as an affirmative claim ABOUT THE MACHINE — the changes
// tile ("nothing changed yet"), the empty state ("No record yet") and the tape's widest sentence,
// "everything Compy has done on this PC · since <date>". All three are made false by a ledger that
// would not open, at the exact moment every apply and every rollback is refusing.
//
// The rule: the user must be able to tell "Compy did nothing" apart from "Compy can't tell you what
// it did". Two failure shapes, and they need DIFFERENT numeric treatment:
//   error       — load_history() is failing RIGHT NOW. The count is not a count; it is the output of
//                 a read that failed. Show a dash, never a 0.
//   quarantined — a ledger set aside on an EARLIER run. This load succeeded, so the count IS accurate
//                 for what survived — keep the number, narrow only the words. (After the rename every
//                 later load returns Ok(vec![]), byte-identical to a genuine first run, forever —
//                 which is why `complete` can never be derived from row count.)
//
// And the case that is NOT a defect: UNKNOWN (the probe itself failed, or the console face is off).
// Claiming incompleteness from a failed read is the same sin mirrored, so unknown must leave this
// room byte-identical — pinned literally below, by HTML equality rather than by copy matching.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// One controllable command; everything else answers with the real shape its caller destructures, so
// a sibling fetch can't throw inside its own .then and mask what this file is actually testing.
const ipc: { health: unknown; rejectHealth: boolean; model: unknown } = {
  health: null,
  rejectHealth: false,
  model: null,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_ledger_health") {
      return ipc.rejectHealth ? Promise.reject(new Error("ipc down")) : Promise.resolve(ipc.health);
    }
    // The tape's observed rows and its chronology note come from the shared Machine Model (#450).
    if (cmd === "get_machine_model") return Promise.resolve(ipc.model);
    return Promise.resolve(null);
  }),
}));

import { BlackbookConsole } from "./BlackbookConsole";
import { LogbookTape } from "./LogbookTape";
import { useLogbookView } from "./logbook-view";
import { LedgerHealthNotice } from "../../design/LedgerHealthNotice";
import { BlackbookV2 } from "../BlackbookV2";
import type { LogbookRecord, LogbookChange, LogbookSession, LogbookAutopsy } from "./logbook";
import { invalidateProbe } from "../../data/probe-cache";
import type { InEffectCounts } from "../../data/machine-model";
import type { AppliedChange, ChangeChronology, LedgerHealth, SessionSummary } from "../../types";

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  ipc.health = null;
  ipc.rejectHealth = false;
  ipc.model = null;
  // The Machine Model rides the probe cache, so one mount's read would otherwise answer the next
  // test's mount from memory.
  invalidateProbe();
});

// Reduced motion makes the render deterministic (no per-row animationDelay), which is what lets the
// UNKNOWN case be pinned as exact HTML equality rather than as a list of copy assertions.
const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const HEALTHY: LedgerHealth = { complete: true, error: null, quarantined: false };
const UNREADABLE: LedgerHealth = {
  complete: false,
  error: "failed to read history.json: The process cannot access the file",
  quarantined: false,
};
const QUARANTINED: LedgerHealth = { complete: false, error: null, quarantined: true };

const change = (over: Partial<LogbookChange> = {}): LogbookChange => ({
  kind: "change",
  at: Date.parse("2026-07-10T12:00:00Z"),
  id: "c1",
  recId: "hags",
  title: "Enable Hardware-accelerated GPU scheduling",
  active: true,
  unconfirmed: false,
  rolledBack: false,
  restoresLabel: "Off",
  appliedLabel: "On",
  payoffLabel: "Input latency",
  count: 1,
  firstAt: Date.parse("2026-07-10T12:00:00Z"),
  ...over,
});
const session = (over: Partial<LogbookSession> = {}): LogbookSession => ({
  kind: "session",
  at: Date.parse("2026-07-09T20:00:00Z"),
  game: "valorant.exe",
  avgFps: 240,
  low1Fps: 190,
  durationSecs: 3600,
  changesActive: 1,
  avgFpsDelta: null,
  ...over,
});
const autopsy = (over: Partial<LogbookAutopsy> = {}): LogbookAutopsy => ({
  kind: "autopsy",
  at: Date.parse("2026-07-08T08:00:00Z"),
  real: 2,
  placebo: 1,
  risky: 0,
  unknown: 0,
  scamFlags: 0,
  ...over,
});

// The room is THREE siblings over one shared view state (logbook-view.ts) since the approved
// split put the disclosure, the tape and the receipts strip in three RoomShell slots. The
// ledger-health claims this file guards are spread across all three -- the notice is the shell's
// `notice`, the changes tile is in the strip, the scent line and the empty state are in the tape --
// so mounting any one of them alone would leave the rest unguarded. The ORDER here is the order
// RoomShell renders them, which is what keeps the "caveat before its subject" assertion honest.
// The Machine Model's in-effect count (#625): what the changes tile says is on. Default: one on.
const counted = (activeNow: number, unknown = 0): InEffectCounts => ({
  kind: "counted",
  activeNow,
  unknown,
  totalRecorded: activeNow + unknown,
});

function Logbook({
  records,
  health,
  chronology = null,
  inEffect = counted(1),
}: {
  records: LogbookRecord[];
  health: LedgerHealth | null;
  chronology?: ChangeChronology | null;
  inEffect?: InEffectCounts;
}) {
  const view = useLogbookView(records, health);
  return (
    <>
      <LedgerHealthNotice health={health} />
      <LogbookTape view={view} reduced chronology={chronology} />
      <BlackbookConsole
        view={view}
        vendor="amd"
        onOpenLab={vi.fn()}
        onOpenGuide={vi.fn()}
        inEffect={inEffect}
      />
    </>
  );
}

function mountConsole(
  records: LogbookRecord[],
  health: LedgerHealth | null,
  chronology: ChangeChronology | null = null,
  inEffect: InEffectCounts = counted(1),
) {
  return render(
    <Logbook records={records} health={health} chronology={chronology} inEffect={inEffect} />,
  );
}

// Every claim is asserted through the ELEMENT that carries it, not a substring of the room: a text
// matcher would keep passing if the claim were merely reworded, which is the failure this file exists
// to catch.
const tileN = (c: HTMLElement, kind: string) =>
  c.querySelector(`.bc-tile[data-kind="${kind}"] .bc-tile-n`)?.textContent;
const tileD = (c: HTMLElement, kind: string) =>
  c.querySelector(`.bc-tile[data-kind="${kind}"] .bc-tile-d`)?.textContent;
const scent = (c: HTMLElement) => c.querySelector(".bc-sect-s")?.textContent ?? "";
const notice = (c: HTMLElement) => c.querySelector(".ledger-health");

// THE WIDEST CLAIM IS GONE, AND THAT IS THE POINT NOW (2026-08-23). It used to print above every
// tape: "everything Compy has done on this PC · since <date>". 03-history-approved.png draws no head
// there at all, and following the picture was only safe because the CLAIM went with the chrome --
// so this constant flipped from something the healthy room must SAY into something no room may say
// in any health state. That is strictly stronger: a sentence that never claims completeness cannot
// be falsified by a ledger that would not open.
const WIDEST_CLAIM = "everything Compy has done on this PC";
/** The head only appears to NARROW: a filter is active, or the ledger is known incomplete. */
const head = (c: HTMLElement) => c.querySelector(".bc-sect");

describe("the Logbook may not speak for a ledger it could not read", () => {
  it("a healthy ledger is left alone — no disclosure, and no claim needing one", () => {
    useReduced();
    const { container } = mountConsole([change(), session(), autopsy()], HEALTHY);

    expect(tileN(container, "change")).toBe("1");
    expect(tileD(container, "change")).toBe("1 still on · every one undoable");
    expect(notice(container)).toBeNull();
    // Nothing narrows, because nothing over-claimed in the first place.
    expect(head(container)).toBeNull();
    expect(container.textContent).not.toContain(WIDEST_CLAIM);
  });

  it("UNKNOWN health is not incompleteness — the room renders byte-identically to healthy", () => {
    useReduced();
    const records = [change(), session(), autopsy()];
    const healthy = mountConsole(records, HEALTHY).container.innerHTML;
    cleanup();
    const unknown = mountConsole(records, null).container.innerHTML;

    // Not "looks similar" — exactly the same tree. A failed probe may not manufacture a warning,
    // and it may not quietly reword a single line either.
    expect(unknown).toBe(healthy);
  });

  it("an unreadable ledger withdraws the count, the tile copy AND the widest claim", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], UNREADABLE);

    // A count read off a ledger that would not open is not a count. A 0 would say "nothing ever
    // happened here"; the dash says "no number".
    expect(tileN(container, "change")).toBe("—");
    expect(tileD(container, "change")).toBe("can't be read right now");
    expect(scent(container)).toContain("what Compy can still read");
    expect(container.textContent).not.toContain(WIDEST_CLAIM);
    expect(notice(container)).toBeTruthy();
    expect(screen.getByText("Compy can't read its own record right now")).toBeTruthy();
  });

  it("the dash is scoped to the ledger — session and guide-check counts are not sourced from it", () => {
    useReduced();
    const { container } = mountConsole([session(), session(), autopsy()], UNREADABLE);

    // Over-broad blanking is its own dishonesty: these two counts come from data the ledger failure
    // never touched, and dashing them would understate a record Compy can still vouch for.
    expect(tileN(container, "session")).toBe("2");
    expect(tileN(container, "autopsy")).toBe("1");
  });

  it("a quarantined ledger keeps its real number — that load succeeded, it just isn't everything", () => {
    useReduced();
    const { container } = mountConsole(
      [change(), change({ id: "c2" }), session()],
      QUARANTINED,
      null,
      counted(2),
    );

    expect(tileN(container, "change")).toBe("2");
    expect(tileN(container, "change")).not.toBe("—");
    expect(tileD(container, "change")).toBe("2 still on · part of the record is missing");
    // The head is BACK here, and only here-shaped states: known-incomplete is one of the two
    // things it exists to say.
    expect(head(container)).not.toBeNull();
    expect(scent(container)).toContain("what Compy can still read");
    expect(container.textContent).not.toContain(WIDEST_CLAIM);
    expect(screen.getByText("Compy can't tell you everything it did")).toBeTruthy();
  });

  it("a quarantined ledger with no survivors says 'none we can still show', never 'nothing changed yet'", () => {
    useReduced();
    const { container } = mountConsole([session()], QUARANTINED);

    // The exact defect at its sharpest: zero rows, and the honest reading is "the ones we had are
    // gone", not the machine claim that none were ever made.
    expect(tileN(container, "change")).toBe("0");
    expect(tileD(container, "change")).toBe("none we can still show");
    expect(tileD(container, "change")).not.toBe("nothing changed yet");
    expect(
      (container.querySelector('.bc-tile[data-kind="change"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("an empty room with an incomplete ledger narrows 'No record yet' to what it can still vouch for", () => {
    useReduced();
    const { container } = mountConsole([], QUARANTINED);

    // The strip is unconditional since the bento conversion (a vanishing half tile would hole the
    // grid — strict row-major, no dense flow). It stays honest at zero because the incomplete-ledger
    // wording rides the tiles themselves: "none we can still show", never "nothing changed yet".
    expect(container.querySelector(".bc-strip")).not.toBeNull();
    expect(tileD(container, "change")).toBe("none we can still show");
    expect(container.querySelector(".bc-empty-title")?.textContent).toBe("Nothing else to show");
    expect(container.querySelector(".bc-empty-sub")?.textContent).toContain(
      "separately from the change record",
    );
    expect(notice(container)).toBeTruthy();
  });

  it("the disclosure is read BEFORE the counts it qualifies", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], UNREADABLE);

    const box = notice(container)!;
    const strip = container.querySelector(".bc-strip")!;
    // A caveat printed under its own subject has already failed at its job.
    expect(box.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// The console is a pure component, so the cases above would all still pass if someone dropped
// `health={health}` from the room that mounts it. These two mount the real room and prove the whole
// chain: probe → prop → rendered claim.
describe("BlackbookV2 wires the probe to the tape it qualifies", () => {
  const SESSION: SessionSummary = {
    started_at: "2026-07-09T20:00:00Z",
    duration_secs: 3600,
    process_name: "valorant.exe",
    samples: 3400,
    avg_fps: 240,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 1,
  } as SessionSummary;

  async function mountRoom() {
    useReduced();
    localStorage.setItem("compy_blackbook_console", "1");
    const r = render(
      <BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} sessions={[SESSION]} />,
    );
    // The disclosure is a post-mount read, not a prop.
    await act(async () => {
      await Promise.resolve();
    });
    return r;
  }

  it("a real unreadable-ledger probe reaches the room's claims", async () => {
    ipc.health = UNREADABLE;
    const { container } = await mountRoom();

    expect(notice(container)).toBeTruthy();
    expect(tileN(container, "change")).toBe("—");
    expect(scent(container)).toContain("what Compy can still read");
    expect(container.textContent).not.toContain(WIDEST_CLAIM);
  });

  it("a probe that fails leaves the room exactly as it was", async () => {
    ipc.rejectHealth = true;
    const { container } = await mountRoom();

    expect(notice(container)).toBeNull();
    expect(tileN(container, "change")).toBe("0");
    expect(tileD(container, "change")).toBe("nothing changed yet");
    // Byte-for-byte the healthy room: no head, and nothing claiming completeness.
    expect(head(container)).toBeNull();
    expect(container.textContent).not.toContain(WIDEST_CLAIM);
  });
});

// ─────────────────── the same rule, applied to the CHRONOLOGY (#450) ───────────────────
//
// bug → guard for slice 2 of #385. The tape's observed rows now come from the shared Machine Model,
// and the model states its own limits: `unknown_reason` is set when the Trust Ledger could not be
// read (Compy-applied changes are missing from the chronology) or when nothing is recorded at all.
// Rendering an empty tape as "No record yet" while that reason is set is the identical defect this
// file was opened for — a claim about the MACHINE made out of a read that failed — one data source
// over. The reason is the model's own sentence, so it is rendered verbatim, never rephrased.
const CAUSATION = "Chronology never implies causation by itself. These entries say what was recorded and when, not what caused what.";
const UNREADABLE_REASON =
  "The Trust Ledger could not be read, so Compy-applied changes are missing from this view. (failed to read history.json)";

const chron = (over: Partial<ChangeChronology> = {}): ChangeChronology => ({
  identity_snapshots: 0,
  total_events: 0,
  coverage_note: "This view includes Compy-applied changes, monitored sessions…",
  entries: [],
  dropped_unparseable: 0,
  causation_note: CAUSATION,
  ...over,
});

const tapeNote = (c: HTMLElement) => c.querySelector(".bc-tape-note")?.textContent ?? null;
const emptyTitle = (c: HTMLElement) => c.querySelector(".bc-empty-title")?.textContent ?? null;
const emptySub = (c: HTMLElement) => c.querySelector(".bc-empty-sub")?.textContent ?? null;
/** Everything the TAPE itself says — its empty state, its rows, its footnote. Scoped on purpose:
 *  the room's change tile legitimately reads "nothing changed yet" when the ledger IS readable and
 *  holds nothing, and that honest counter must not be able to satisfy a claim about the chronology.
 */
const tapeText = (c: HTMLElement) =>
  [".bc-empty", ".bc-tape", ".bc-tape-note"]
    .flatMap((sel) => Array.from(c.querySelectorAll(sel)))
    .map((el) => el.textContent ?? "")
    .join(" ")
    .toLowerCase();
/** The tape's own no-change claims (en `empty` / `emptyIncomplete`). While the model states a
 *  reason, NONE of them may appear: each one asserts an absence of change, which is exactly the
 *  claim a failed read cannot support. Falsifiable by construction — drop the unknown_reason branch
 *  from LogbookTape and the first of these comes straight back. */
const NO_CHANGE_CLAIMS = [
  "no record yet",
  "nothing else to show",
  "compy logs changes, gaming sessions and guide checks here as they happen",
];

describe("the tape may not speak for a chronology the model could not fill", () => {
  it("an empty tape states the model's own unknown reason, never 'No record yet'", () => {
    useReduced();
    const { container } = mountConsole([], HEALTHY, chron({ unknown_reason: UNREADABLE_REASON }));

    expect(emptySub(container)).toBe(UNREADABLE_REASON);
    expect(emptyTitle(container)).toBe("What changed is not fully known");
    expect(emptyTitle(container)).not.toBe("No record yet");
    for (const claim of NO_CHANGE_CLAIMS) expect(tapeText(container)).not.toContain(claim);
  });

  it("a POPULATED tape carries the reason as the note under the rows it qualifies", () => {
    useReduced();
    const { container } = mountConsole(
      [change(), session()],
      HEALTHY,
      chron({ total_events: 4, unknown_reason: UNREADABLE_REASON }),
    );

    // Verbatim — the note is the model's sentence, and a reworded one would be Compy's claim.
    expect(tapeNote(container)).toBe(UNREADABLE_REASON);
    for (const claim of NO_CHANGE_CLAIMS) expect(tapeText(container)).not.toContain(claim);
  });

  it("with nothing missing, the note is the causation caveat — a chronology is not a cause", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], HEALTHY, chron({ total_events: 4 }));

    expect(tapeNote(container)).toBe(CAUSATION);
  });

  it("an unread model prints NO note — Compy never writes that sentence itself", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], HEALTHY, null);

    expect(tapeNote(container)).toBeNull();
    // And the tape is otherwise exactly the tape: no invented caveat, no empty state.
    expect(emptyTitle(container)).toBeNull();
  });
});

// ─────────── ONE FAILURE, ONE VOICE — the defect the visual self-review caught (#450) ───────────
//
// bug → guard. The first cut of this slice rendered the chronology's `unknown_reason` whenever it was
// set, including while `LedgerHealthNotice` was already up for the same unreadable history.json. The
// self-review's paired fixture showed both boxes back to back, no scroll between them — the amber
// "Compy can't read its own record right now" followed immediately by the tape's "The Trust Ledger
// could not be read…". 61e092c2 built that notice so this would be structurally impossible; the
// chronology is the same file read a second way, so it inherits the rule rather than escaping it.
//
// What must hold: while the notice speaks, the tape does not repeat it — AND it still never falls
// through to a no-change claim, which is the reason the reason was rendered in the first place.
describe("the room states an unreadable ledger ONCE, whichever read noticed it", () => {
  const reasoned = chron({ total_events: 4, unknown_reason: UNREADABLE_REASON });

  it("with the notice up, the tape does not print the reason a second time", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], UNREADABLE, reasoned);

    // The disclosure is there — exactly once, in the element built for it.
    expect(notice(container)).toBeTruthy();
    expect(container.querySelectorAll(".ledger-health")).toHaveLength(1);
    // ...and the tape's footnote fell back to the general caveat instead of echoing it.
    expect(tapeNote(container)).toBe(CAUSATION);
    expect(tapeText(container)).not.toContain(UNREADABLE_REASON.toLowerCase());
  });

  it("an EMPTY tape under the notice narrows, and still never says 'No record yet'", () => {
    useReduced();
    const { container } = mountConsole([], UNREADABLE, chron({ unknown_reason: UNREADABLE_REASON }));

    expect(notice(container)).toBeTruthy();
    // The narrowed copy the notice's own commit introduced — not the model's sentence again...
    expect(emptyTitle(container)).toBe("Nothing else to show");
    expect(tapeText(container)).not.toContain(UNREADABLE_REASON.toLowerCase());
    // ...and not the claim a failed read cannot support either.
    expect(emptyTitle(container)).not.toBe("No record yet");
    expect(tapeText(container)).not.toContain("no record yet");
  });

  it("with the ledger READABLE, the tape is still the only voice the reason has", () => {
    useReduced();
    // The honest counter-case: health says the record is complete, yet the model states a reason
    // (its own producers came up short). Nothing else in the room is saying it, so the tape must.
    const { container } = mountConsole([change(), session()], HEALTHY, reasoned);

    expect(notice(container)).toBeNull();
    expect(tapeNote(container)).toBe(UNREADABLE_REASON);
  });
});

// Same chain proof as the ledger-health pair above, for the model: probe → prop → rendered claim.
describe("BlackbookV2 wires the Machine Model to the tape it qualifies", () => {
  async function mountRoomWithModel(
    chronology: ChangeChronology,
    { changes, activeNow = 0, unknown = 0 }: { changes?: AppliedChange[]; activeNow?: number; unknown?: number } = {},
  ) {
    useReduced();
    localStorage.setItem("compy_blackbook_console", "1");
    // History reads the model's in-effect counts too (#625), so the stub carries an empty ledger.
    ipc.model = {
      chronology,
      compy_changes: {
        total_recorded: changes?.length ?? 0, active_now: activeNow, in_effect_other_rig: 0,
        in_effect_rig_unknown: 0, in_effect_total: activeNow, applied_but_not_in_effect: 0,
        in_effect_unknown: unknown, rolled_back: 0, on_this_rig: 0, not_on_this_rig: 0,
        rig_unknown: 0, changes: [], ledger_note: "",
      },
    };
    const r = render(
      <BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} changes={changes} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return r;
  }

  it("a chronology the model could not fill reaches the room's empty state", async () => {
    // Health reads COMPLETE here on purpose. Pairing this with an unreadable-ledger probe would test
    // the opposite rule — with the notice up the tape defers to it ("one failure, one voice" above),
    // so the chain from probe to rendered claim is only visible where the tape is the only voice.
    ipc.health = HEALTHY;
    const { container } = await mountRoomWithModel(chron({ unknown_reason: UNREADABLE_REASON }));

    expect(container.querySelector(".bc-empty-sub")?.textContent).toBe(UNREADABLE_REASON);
    for (const claim of NO_CHANGE_CLAIMS) expect(tapeText(container)).not.toContain(claim);
  });

  it("the observed rows come from the model's chronology, summary verbatim", async () => {
    const { container } = await mountRoomWithModel(
      chron({
        total_events: 1,
        entries: [
          {
            id: "obs:gpu-driver-change:2026-07-07T10:00:00Z",
            observed_at: "2026-07-07T10:00:00Z",
            summary: "GPU driver changed: 24.10.1 → 25.1.1",
            event_type: "gpu-driver-change",
            source: "identity-snapshot",
            scope: "observed",
            class: "recorded-historically",
          },
        ],
      }),
    );

    expect(container.textContent).toContain("GPU driver changed: 24.10.1 → 25.1.1");
    expect(container.querySelector(".bc-tape-note")?.textContent).toBe(CAUSATION);
  });

  // #625: the changes tile's in-effect words are the model's numbers — the ones Health prints —
  // wired from the room's one model read. The ledger rows here read "on"; the model disagrees, and
  // the tile must say what the model says.
  it("the changes tile prints the model's in-effect counts, not a fold over the rows", async () => {
    ipc.health = HEALTHY;
    const applied = (id: string): AppliedChange => ({
      id,
      rec_id: `rec_${id}`,
      rec_title: `Change ${id}`,
      applied_at: "2026-07-10T12:00:00Z",
      snapshot: {},
      status: "applied",
      is_still_active: true,
      active_check: "on",
    });
    const { container } = await mountRoomWithModel(chron(), {
      changes: [applied("a"), applied("b"), applied("c")],
      activeNow: 1,
      unknown: 2,
    });
    expect(
      container.querySelector('.bc-tile[data-kind="change"] .bc-tile-d')?.textContent,
    ).toBe("1 still on · 2 can't confirm");
  });
});
