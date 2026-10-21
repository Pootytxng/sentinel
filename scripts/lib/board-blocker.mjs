// The ONE machine-readable BOARD_UNREACHABLE blocker (#445 option 2, owner-accepted 2026-10-21).
//
// Work Control is the board (docs/WORK_CONTROL.md). A session that cannot read it does not know
// which lanes hold which paths, so every gate that needs that answer shares one contract here:
//
//   - unknown board state is NEVER a PASS and NEVER an exemption;
//   - the proof-dependent transitions (ready, merge, close, Done) wait for an authenticated FRESH
//     board read plus every native gate on the exact head — the blocker cannot be substituted;
//   - the hosted lane (claude.ai/code) finishes authoring and pre-proof and hands off blocked
//     evidence, which is work, not a wait.
//
// This is a blocker CONTRACT, not an access repair: it says what an unreachable board costs, in a
// shape (`code` + `consequences`) that a receipt, a gate verdict, a hook line and a handoff can all
// carry verbatim, so no reader has to parse prose to learn that the board was unknown. The second
// read-only transport (#445 option 1) lives next to the readers it backs, never here.

export const BOARD_UNREACHABLE = "BOARD_UNREACHABLE";

/**
 * How old an authenticated board read may be and still count as fresh for a proof-dependent
 * transition. Equal to the session hook's own cache TTL (`BOARD_TTL_MINUTES` in
 * `.claude/hooks/session-root-assert.mjs`), which `scripts/work-control-gate.test.mjs` pins: the
 * receipt's idea of "fresh" and the session's must be the same number.
 */
export const BOARD_FRESH_MINUTES = 10;

/** The transitions an unreachable board holds. Mirrors PROOF_DEPENDENT_TRANSITIONS in the gate. */
export const BOARD_HELD_TRANSITIONS = Object.freeze([
  "mark-pr-ready",
  "close-superseded-pr",
  "merge-pr",
  "close-issue",
  "mark-done",
]);

export const BOARD_UNREACHABLE_CONSEQUENCES = Object.freeze([
  "unknown board state is never a PASS and never an exemption",
  `${BOARD_HELD_TRANSITIONS.join(", ")} wait for an authenticated fresh Work Control read (within ${BOARD_FRESH_MINUTES} minutes, recorded as boardRead on the receipt)`,
  "every native gate on the exact head stays required; this blocker cannot be substituted",
  "the hosted lane finishes authoring and pre-proof and hands off blocked evidence",
]);

/**
 * The blocker as data. `why` says what could not be read (or what the receipt admitted); the
 * `transition` is the one being refused, when there is one.
 */
export function boardUnreachableBlocker({ transition = null, why = "Work Control could not be read" } = {}) {
  return {
    code: BOARD_UNREACHABLE,
    ...(transition ? { transition } : {}),
    why: String(why),
    consequences: [...BOARD_UNREACHABLE_CONSEQUENCES],
  };
}

/** One line a human and a grep can both read: the code first, then why, then the consequences. */
export function renderBoardUnreachable(blocker) {
  const head = `${blocker.code}${blocker.transition ? ` (${blocker.transition})` : ""}: ${blocker.why}`;
  return `${head}. Consequences: ${blocker.consequences.join("; ")}.`;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Whether a receipt's `boardRead` proves an authenticated fresh read. It proves one only when it
 * says so in every field: `status: "fresh"`, `authenticated: true`, and a `readAt` timestamp within
 * BOARD_FRESH_MINUTES of `now` and not after it. Anything else — missing, `unreachable`, a stale
 * cache, an unauthenticated read, a bad or future timestamp — is unknown, and unknown is not fresh.
 *
 * @returns {{fresh: boolean, why: string}}
 */
export function boardReadFreshness(boardRead, { now = new Date(), maxAgeMinutes = BOARD_FRESH_MINUTES } = {}) {
  if (boardRead === undefined || boardRead === null) {
    return { fresh: false, why: "the receipt records no boardRead, so the board's state at proof time is unknown" };
  }
  if (typeof boardRead !== "object" || Array.isArray(boardRead)) {
    return { fresh: false, why: "boardRead must be an object ({ status, authenticated, readAt, via, evidence })" };
  }
  const status = String(boardRead.status ?? "").trim();
  if (status === "unreachable" || status === BOARD_UNREACHABLE) {
    return {
      fresh: false,
      why: `the receipt itself records the board as unreachable${boardRead.why ? ` (${String(boardRead.why).split("\n")[0]})` : ""}`,
    };
  }
  if (status !== "fresh") {
    return { fresh: false, why: `boardRead.status is ${JSON.stringify(boardRead.status ?? null)}, not "fresh"; a cached or unknown read is not a fresh one` };
  }
  if (boardRead.authenticated !== true) {
    return { fresh: false, why: "boardRead.authenticated is not true; an unauthenticated read cannot see the board" };
  }
  const readAt = typeof boardRead.readAt === "string" ? boardRead.readAt.trim() : "";
  if (!ISO_TIMESTAMP.test(readAt) || Number.isNaN(Date.parse(readAt))) {
    return { fresh: false, why: `boardRead.readAt ${JSON.stringify(boardRead.readAt ?? null)} is not an ISO-8601 timestamp` };
  }
  const ageMs = now.getTime() - Date.parse(readAt);
  if (ageMs < 0) return { fresh: false, why: `boardRead.readAt ${readAt} is after now (${now.toISOString()})` };
  if (ageMs >= maxAgeMinutes * 60_000) {
    return {
      fresh: false,
      why: `boardRead.readAt ${readAt} is ${Math.floor(ageMs / 60_000)} minutes old; a fresh read is under ${maxAgeMinutes} minutes at gate time`,
    };
  }
  return { fresh: true, why: `authenticated board read at ${readAt}` };
}
