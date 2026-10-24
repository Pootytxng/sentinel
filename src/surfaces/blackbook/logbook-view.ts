import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { knownIncomplete } from "../../design/LedgerHealthNotice";
import { liveChangeGroups } from "../../data/live-changes";
import type { AppliedChange, LedgerHealth } from "../../types";
import type { LogbookRecord } from "./logbook";

// logbook-view — the Logbook's view state, hoisted out of BlackbookConsole (comp fidelity
// 2026-08-23, issue #49).
//
// WHY IT MOVED. 03-history-approved.png splits this room: the record TAPE is the evidence column
// and the receipts strip, the patterns band and the library live full-width beneath both columns.
// Those are now two siblings in two different RoomShell slots, and they share one piece of state —
// the strip's filter drives the tape, and always has. State that two siblings share belongs above
// both of them, so it lives here and BlackbookV2 owns it.
//
// It is a hook rather than a prop bag so the derivations that must never disagree — the strip's
// counts and the tape's rows — are still computed once, from the same `records`, in one file.
// Nothing here reads IPC, and nothing here can invent a row: every number is a fold over the
// records buildLogbook already proved real. The one number that is NOT (#625) — how many changes
// are in effect now — is the Machine Model's, and BlackbookV2 hands it to the strip directly.

export type LogbookKind = LogbookRecord["kind"];

// How many tape rows mount before the "show older" press (the SessionStack MAX_STACK_ROWS pattern).
// 30 → 8 in the intimidation pass (2026-08-20): the record is the room's hero, and a hero that runs
// 30 rows deep stretches the bento's two left tiles into hollow columns three viewports tall while
// the tape itself reads as a dump. Eight is a screenful — the latest happenings, grouped by month —
// and everything older is one honest press away (the count is still stated, nothing hidden).
export const TAPE_CAP = 8;

export type LogbookView = ReturnType<typeof useLogbookView>;

/**
 * The route to undo in Test. With nothing unconfirmed it reads as it always did ("Undo any of the
 * N changes in Test"), N being the active count Health and Optimize print. When some can't be
 * confirmed, the sentence names both groups instead of folding them into one "changes" number
 * (#453: History said 14 while Health said 13 for the same ledger).
 */
export function manageJumpLabel(
  t: TFunction,
  counts: { active: number; cantConfirm: number },
): string {
  return counts.cantConfirm > 0
    ? t("blackbook.blackbookConsole.manageJumpSplit", {
        count: counts.active,
        unknown: counts.cantConfirm,
      })
    : t("blackbook.blackbookConsole.manageJump", { count: counts.active });
}

export function useLogbookView(
  records: LogbookRecord[],
  health: LedgerHealth | null,
  changes: readonly AppliedChange[],
) {
  // The Receipts Strip's tape filter (owner pick 2026-07-13, concept A): null = the full tape.
  // Session-local by design — a filter is a glance tool, not a preference.
  const [filter, setFilter] = useState<LogbookKind | null>(null);
  // The tape renders the RECENT slice, not the machine's whole lifetime: an uncapped map over
  // every change+session+autopsy ever recorded was the dominant Blackbook nav-mount cost (80–152ms,
  // scaling with history — nav-mount follow-up, BACKLOG cycle 2026-07-15d). Counts/strip/sinceDate
  // still derive from the FULL records (the numbers never understate), and one press unrolls the
  // rest — nothing is hidden, only deferred behind an honest count.
  const [tapeAll, setTapeAll] = useState(false);

  // The changes an undo can still act on, split the way Health and Optimize split them (#453):
  // `active` is the changes whose live check reads on (the number Health prints), `cantConfirm`
  // the ones Compy cannot read either way. Counted by `liveChangeGroups` over the raw ledger rows,
  // the one TS definition Optimize also uses, and NOT off the tape: the tape drops a row with no
  // apply time (it cannot be placed), but an undated change that reads on is still on (#453 review).
  const undoableChanges = useMemo(() => {
    const g = liveChangeGroups(changes);
    return { active: g.active.length, cantConfirm: g.cantConfirm.length };
  }, [changes]);
  // Per-kind counts + scam flags — the strip's numbers are DERIVED from the same records the tape
  // renders (they can never disagree with it).
  const counts = useMemo(() => {
    const c = { change: 0, session: 0, autopsy: 0, observed: 0, scamFlags: 0 };
    for (const r of records) {
      c[r.kind]++;
      if (r.kind === "autopsy") c.scamFlags += r.scamFlags;
    }
    return c;
  }, [records]);
  const shown = useMemo(
    () => (filter ? records.filter((r) => r.kind === filter) : records),
    [records, filter],
  );
  const tape = tapeAll ? shown : shown.slice(0, TAPE_CAP);
  const older = shown.length - tape.length;
  const sinceDate = useMemo(
    () =>
      records.length
        ? new Date(records[records.length - 1].at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "",
    [records],
  );
  // THE LATEST SESSION — the subject of History's one primary action ("Review latest session").
  // Records are reverse-chronological, so the first session in the FULL record is the latest one;
  // deliberately not read off `tape`, because a filter or the 8-row cap must not be able to make
  // the room claim there is no session when there is. Null ⇒ no session has ever been recorded,
  // and the action that reviews one must not render (honest-measurement law: a button that
  // promises a reading Compy does not have is a fabricated claim in control form).
  const latestSession = useMemo(
    () => records.find((r) => r.kind === "session") ?? null,
    [records],
  );

  // A tile toggles its kind filter; a zero-count tile is disabled (an honest empty beats an empty
  // filtered tape). aria-pressed carries the state for AT.
  const toggleFilter = (kind: LogbookKind) => setFilter((cur) => (cur === kind ? null : kind));

  // KNOWN incomplete, or null. Every claim that speaks for the WHOLE change record — the changes
  // tile, the empty state, the "since <date>" scent — narrows when this is set, and is untouched
  // when it isn't. `.error` splits the two shapes: an unreadable ledger makes the count itself
  // meaningless (show a dash), while a ledger quarantined on an earlier run still counts what
  // survived accurately — it just can't claim that's everything.
  const incomplete = knownIncomplete(health);

  return {
    records,
    filter,
    toggleFilter,
    tapeAll,
    revealAll: () => setTapeAll(true),
    undoableChanges,
    counts,
    tape,
    older,
    sinceDate,
    latestSession,
    incomplete,
  };
}
