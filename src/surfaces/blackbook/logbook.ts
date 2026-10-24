import type { AppliedChange, ChangeChronology, ChronologyEntry, SessionSummary } from "../../types";
import type { AutopsyLedgerEntry } from "../../data/autopsy-ledger";
import { knowledgeForLanguage, type KnowledgeEntry } from "../../data/knowledge";

// The Logbook tape builder (Console HUD Phase 4, plan 2026-07-12-console-hud-phase4-blackbook,
// direction A "The Logbook"). A PURE builder — it does no IO itself; the surface hands it data.
// It MIRRORS four real record sources into one reverse-chronological tape; it never MOVES them
// (applied changes still live in the Lab's Optimize station, sessions in Monitor, autopsy in its
// ledger, observed events in the shared Machine Model's chronology — which the surface reads
// through `data/machine-model.ts`, #450, replacing this room's own timeline fetch). This is the
// honesty spine of the room, so it is written and tested first:
//   • Only REAL records — an unparseable/absent timestamp is DROPPED, never coerced to now/0, so
//     the tape can never fabricate a row. Empty in ⇒ empty out ⇒ the room's honest empty state.
//   • The rollback flag rides ONLY change records, and only while the change is on or cannot be
//     confirmed off (the live re-check's `active_check`, the field the Machine Model's
//     `still_active` Fact is built from, #625). A rolled-back change stays on the tape as history
//     but carries no undo affordance.
//   • vs-previous deltas are SAME-GAME only (nearest older session with the same process) — a
//     cross-game gap is never rendered as a regression (the v4 Monitor-waterfall lesson, carried).

export type LogbookChange = {
  kind: "change";
  /** ms epoch of the MOST RECENT apply of this tweak — where the row sits on the tape. */
  at: number;
  /** AppliedChange.id — the key the audited rollback_change path takes. On a collapsed row this is
   *  the LIVE apply's id (or the newest, when none is live): the one an undo would actually target. */
  id: string;
  /** AppliedChange.rec_id — the tweak's identity, and the key repeats collapse on (C-11). */
  recId: string;
  title: string;
  /** The live re-check PROVED it is on right now (status applied, `active_check` "on") — the only
   *  state that may say "still on". */
  active: boolean;
  /** Applied, but the live re-check could not say (`active_check` "unreadable"/"unrecognised") — the
   *  Machine Model's `still_active` is unknown for it. Never "still on", and undo stays reachable. */
  unconfirmed: boolean;
  /** Recorded, then rolled back — history, no undo. */
  rolledBack: boolean;
  /** What a rollback restores to ("Running" / "On" / …) — computed-at-read, may be null. */
  restoresLabel: string | null;
  /** The state the change set things TO — computed-at-read, may be null (legacy entries). */
  appliedLabel: string | null;
  /** The KIND of gain the change targets ("Input latency" …) — never a fabricated number. */
  payoffLabel: string | null;
  /** How many times this tweak was applied (C-11). 1 for a change applied once — the row then reads
   *  exactly as it always did. */
  count: number;
  /** ms epoch of the FIRST apply. Equals `at` when `count` is 1; on a collapsed row it is what lets
   *  the row say WHEN the repeating started instead of silently swallowing the older applies. */
  firstAt: number;
};

export type LogbookSession = {
  kind: "session";
  /** ms epoch, from SessionSummary.started_at (ISO). */
  at: number;
  /** Raw process name — the component prettifies it (prettyGameName). */
  game: string;
  avgFps: number;
  low1Fps: number;
  durationSecs: number;
  /** How many Compy changes were active during the session (0, or null = not recorded, ⇒ no tag). */
  changesActive: number | null;
  /** Avg-fps delta vs the nearest OLDER same-game session; null when there is no same-game prior
   *  (so a cross-game gap is never shown as a delta). */
  avgFpsDelta: number | null;
};

export type LogbookAutopsy = {
  kind: "autopsy";
  /** ms epoch, from AutopsyLedgerEntry.at. */
  at: number;
  real: number;
  placebo: number;
  risky: number;
  unknown: number;
  scamFlags: number;
};

export type LogbookObserved = {
  kind: "observed";
  /** ms epoch, from ChronologyEntry.observed_at (the reading that revealed the change). */
  at: number;
  /** Stable event id, copied through the Machine Model from the timeline record. */
  id: string;
  /** "hardware-change" | "gpu-driver-change" | "windows-build-change" | "power-plan-change". */
  eventType: string;
  /** The engine's own plain sentence ("GPU driver changed: A → B") — rendered verbatim. */
  summary: string;
  /** The engine's honest how-we-know note — verbatim, never rephrased into a claim. */
  detail: string | null;
  /** Both probe bounds (ms) — the exact moment wasn't witnessed, only the window. */
  observedBetween: [number, number] | null;
};

export type LogbookRecord = LogbookChange | LogbookSession | LogbookAutopsy | LogbookObserved;

export type LogbookInput = {
  changes?: AppliedChange[] | null;
  sessions?: SessionSummary[] | null;
  autopsy?: AutopsyLedgerEntry[] | null;
  /** The Machine Model's chronology entries (#450; Intelligence Phase 1 before it). Only
   *  scope-"observed" rows are taped — compy-applied and measurement events already have their own
   *  records above (decision 15: the tape gains ONLY the event kinds no surface shows; it never
   *  re-lists). */
  observed?: ChronologyEntry[] | null;
};

// A finite ms-epoch or null (never coerced). ISO strings → Date.parse; anything unparseable → null.
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// C-11 — repeats collapse into ONE row per tweak.
//
// WHY, with the owner's own ledger as the evidence: 64 recorded applies, 37 of them the SAME tweak
// (`game-mode`, toggled between 28 May and 29 Jul). The tape shows 30 rows, so the record of this
// PC was almost entirely one sentence printed over and over — which reads as a malfunction, not as
// history, and buries every other thing Compy did underneath it.
//
// A tweak toggled 37 times is ONE fact about the machine ("Game Mode: on, applied 37 times since
// 28 May"), not 37 facts. So the applies fold into a single row that keeps BOTH ends of the story:
// `at` (and the row's position) is the LATEST apply, `firstAt` is the earliest, and `count` says how
// many. Nothing is silently dropped — the row states the number and the date the repeating started.
//
// Which apply represents the group: the one that is genuinely LIVE, if any — its `id` is what an
// undo has to target and its `restoresLabel` is the state undo would return to; a stale id from a
// superseded apply would be the dangerous kind of wrong. With none live, the newest represents.
function collapseRepeats(applies: LogbookChange[]): LogbookChange[] {
  const groups = new Map<string, LogbookChange[]>();
  for (const a of applies) {
    const g = groups.get(a.recId);
    if (g) g.push(a);
    else groups.set(a.recId, [a]);
  }
  const out: LogbookChange[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const newest = g.reduce((x, y) => (y.at > x.at ? y : x));
    const oldest = g.reduce((x, y) => (y.at < x.at ? y : x));
    // Prefer the live apply; among several, the newest live one. Several IS possible, and the
    // comment here used to claim otherwise: `active_check` is a live-state probe per REC
    // (history.rs), not a per-entry fact, and re-applying does not supersede the earlier
    // `applied` row — so a drift-then-reapply cycle, the exact pattern that produced the
    // owner's 37 toggles, leaves two rows both reading active. Taking the newest is then the
    // only defensible choice: it is the apply whose snapshot an undo would restore from.
    // "Live" includes an apply Compy cannot confirm either way (#625): it may still be in place,
    // so it is still what an undo has to target.
    const live = g
      .filter((r) => r.active || r.unconfirmed)
      .reduce<LogbookChange | null>((x, y) => (x && x.at > y.at ? x : y), null);
    const rep = live ?? newest;
    out.push({ ...rep, at: newest.at, firstAt: oldest.at, count: g.length });
  }
  return out;
}

// #625 — what History may say about a change being in effect. It reads `active_check`, the live
// re-check's own verdict, and NOT the legacy `is_still_active` bool: that bool stays true for a
// check that read nothing (so a rollback is never hidden), and History printed it as "still on" —
// a state nobody measured. The mapping is the Machine Model's `still_active` Fact
// (machine_model.rs), arm for arm, so History and Health cannot disagree about one change.
// `src/history-still-active-source-guard.test.ts` pins both sides.
export function changeLiveState(
  c: Pick<AppliedChange, "status" | "active_check">,
): { active: boolean; unconfirmed: boolean } {
  if (c.status !== "applied") return { active: false, unconfirmed: false };
  return {
    active: c.active_check === "on",
    unconfirmed: c.active_check === "unreadable" || c.active_check === "unrecognised",
  };
}

export function buildLogbook({ changes, sessions, autopsy, observed }: LogbookInput): LogbookRecord[] {
  const records: LogbookRecord[] = [];

  // One record per apply first, then collapse repeats of the same tweak (C-11) — see below.
  const applies: LogbookChange[] = [];
  for (const c of changes ?? []) {
    const at = ms(c.applied_at);
    if (at === null) continue; // no honest timestamp ⇒ no row
    applies.push({
      kind: "change",
      at,
      id: c.id,
      recId: c.rec_id,
      title: c.rec_title,
      ...changeLiveState(c),
      rolledBack: c.status === "rolled_back",
      restoresLabel: c.restores_label ?? null,
      appliedLabel: c.applied_label ?? null,
      payoffLabel: c.payoff_label ?? null,
      count: 1,
      firstAt: at,
    });
  }
  records.push(...collapseRepeats(applies));

  // Sessions need cross-item context (same-game vs-previous), so resolve their ms-epochs and sort
  // oldest-first ONCE, then look back for the nearest same-game prior.
  const timed = (sessions ?? [])
    .map((s) => ({ s, at: ms(s.started_at) }))
    .filter((x): x is { s: SessionSummary; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at);
  for (let i = 0; i < timed.length; i++) {
    const { s, at } = timed[i];
    let prevAvg: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (timed[j].s.process_name === s.process_name) {
        prevAvg = timed[j].s.avg_fps;
        break;
      }
    }
    records.push({
      kind: "session",
      at,
      game: s.process_name,
      avgFps: s.avg_fps,
      low1Fps: s.low1_fps_est,
      durationSecs: s.duration_secs,
      changesActive: s.compy_changes_active,
      avgFpsDelta: prevAvg === null ? null : s.avg_fps - prevAvg,
    });
  }

  for (const a of autopsy ?? []) {
    if (!Number.isFinite(a.at)) continue;
    records.push({
      kind: "autopsy",
      at: a.at,
      real: a.real,
      placebo: a.placebo,
      risky: a.risky,
      unknown: a.unknown,
      scamFlags: a.scamFlags,
    });
  }

  // Observed machine changes (Intelligence Phase 1, decision 15): hardware / GPU-driver /
  // Windows-build / power-plan deltas Compy NOTICED between its own readings — the one record
  // class no other surface shows. Scope-filtered hard: compy-applied and measurement events
  // already ride the change/session rows above, and re-listing them would double the tape.
  for (const ev of observed ?? []) {
    if (ev.scope !== "observed") continue;
    const at = ms(ev.observed_at);
    if (at === null) continue; // no honest timestamp ⇒ no row
    let between: [number, number] | null = null;
    if (ev.observed_between) {
      const a = ms(ev.observed_between[0]);
      const b = ms(ev.observed_between[1]);
      if (a !== null && b !== null) between = [a, b];
    }
    records.push({
      kind: "observed",
      at,
      id: ev.id,
      eventType: ev.event_type,
      summary: ev.summary,
      detail: ev.detail ?? null,
      observedBetween: between,
    });
  }

  // Reverse-chronological — newest first. Array.prototype.sort is stable (ES2019+), so records
  // that share a timestamp keep insertion order (change → session → autopsy → observed): deterministic.
  records.sort((x, y) => y.at - x.at);
  return records;
}

/**
 * The tape's footnote, VERBATIM from the Machine Model's chronology (#450) — Compy never writes
 * this sentence itself, so `null` (an unread model) prints nothing rather than a caveat Compy
 * invented.
 *
 * `unknown_reason` outranks the causation caveat, but only while the chronology actually holds
 * events: it is the sentence that says what is MISSING from the rows on screen (an unreadable Trust
 * Ledger leaves a hole in them), and that qualifier beats a general caveat. With nothing recorded
 * at all the reason belongs to the empty state instead, where it replaces "No record yet" — the
 * room may never render "nothing changed" over a record it could not read.
 *
 * `unknownStatedElsewhere` is the room saying it has already disclosed that failure above the rows
 * (`LedgerHealthNotice`). One failure gets ONE voice: 61e092c2 built that notice precisely so two
 * surfaces could not warn about the same file in two different wordings, and the chronology's reason
 * is the same file read a second way — so when the notice is up, the tape keeps the general caveat
 * and says nothing more. It still never falls back to a no-change claim; that branch is the empty
 * state's, and it narrows on the same signal.
 */
export function chronologyNote(
  chronology: ChangeChronology | null | undefined,
  { unknownStatedElsewhere = false }: { unknownStatedElsewhere?: boolean } = {},
): string | null {
  if (!chronology) return null;
  if (chronology.unknown_reason && chronology.total_events > 0 && !unknownStatedElsewhere) {
    return chronology.unknown_reason;
  }
  return chronology.causation_note || null;
}

/** One month of the tape: consecutive records sharing a calendar month (local time), newest
 *  first, with the label the month header shows ("August 2026"). */
export type LogbookMonth = { key: string; label: string; records: LogbookRecord[] };

/** Group an already-sorted tape by calendar month, preserving order. The grouping is the
 *  orientation the record was missing (intimidation pass 2026-08-20): fifteen near-identical rows
 *  read as a dump; the same rows under "August · July · June" read as a timeline. Consecutive-only
 *  on purpose — the input is newest-first, so a month never splits. Never invents a group: an
 *  empty tape is an empty array. */
export function groupByMonth(records: LogbookRecord[], locale?: string): LogbookMonth[] {
  const out: LogbookMonth[] = [];
  for (const r of records) {
    const d = new Date(r.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.records.push(r);
    else
      out.push({
        key,
        label: d.toLocaleDateString(locale, { month: "long", year: "numeric" }),
        records: [r],
      });
  }
  return out;
}

// A few "start here" doors for the Logbook's library strip — rig-fit first (entries whose
// applicability names this rig, or universal ones), guides before single tweaks/terms because a
// guide is the better entry point. Only REAL corpus entries, deterministic corpus order — never
// invented. Clicking one doors into the field guide focused on that entry.
export function startHereEntries(
  vendor: string,
  limit = 4,
  // i18n (2026-07-23): optional, defaults to English so the pinned logbook.test.ts calls (which pass
  // only vendor/limit) keep resolving the same English corpus unchanged. Pass i18n.language from the
  // calling component (BlackbookConsole.tsx) to get translated names.
  lang: string = "en",
): { id: string; name: string; type: KnowledgeEntry["type"] }[] {
  const fits = (e: KnowledgeEntry): boolean =>
    !e.applies || e.applies.length === 0 || (e.applies as string[]).includes(vendor);
  const current = (e: KnowledgeEntry): boolean => e.status !== "deprecated" && e.status !== "superseded";
  const pool = knowledgeForLanguage(lang).filter((e) => fits(e) && current(e));
  const guides = pool.filter((e) => e.type === "guide");
  const rest = pool.filter((e) => e.type !== "guide");
  return [...guides, ...rest]
    .slice(0, Math.max(0, limit))
    .map((e) => ({ id: e.id, name: e.name, type: e.type }));
}
