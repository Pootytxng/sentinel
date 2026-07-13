import type { AppliedChange, SessionSummary } from "../../types";
import type { AutopsyLedgerEntry } from "../../data/autopsy-ledger";
import { KNOWLEDGE, type KnowledgeEntry } from "../../data/knowledge";

// The Logbook tape builder (Console HUD Phase 4, plan 2026-07-12-console-hud-phase4-blackbook,
// direction A "The Logbook"). A PURE frontend view over data the app ALREADY holds — zero new
// IPC, zero src-tauri. It MIRRORS three real record sources into one reverse-chronological tape;
// it never MOVES them (applied changes still live in the Lab's Optimize station, sessions in
// Monitor, autopsy in its ledger). This is the honesty spine of the room, so it is written and
// tested first:
//   • Only REAL records — an unparseable/absent timestamp is DROPPED, never coerced to now/0, so
//     the tape can never fabricate a row. Empty in ⇒ empty out ⇒ the room's honest empty state.
//   • The rollback flag rides ONLY change records, and only while the change is genuinely active
//     (the same status the Fix ledger reads). A rolled-back change stays on the tape as history
//     but carries no undo affordance.
//   • vs-previous deltas are SAME-GAME only (nearest older session with the same process) — a
//     cross-game gap is never rendered as a regression (the v4 Monitor-waterfall lesson, carried).

export type LogbookChange = {
  kind: "change";
  /** ms epoch, from AppliedChange.applied_at (ISO). */
  at: number;
  /** AppliedChange.id — the key the audited rollback_change path takes. */
  id: string;
  title: string;
  /** Genuinely on right now (status applied AND still active) — the only state that earns undo. */
  active: boolean;
  /** Recorded, then rolled back — history, no undo. */
  rolledBack: boolean;
  /** What a rollback restores to ("Running" / "On" / …) — computed-at-read, may be null. */
  restoresLabel: string | null;
  /** The state the change set things TO — computed-at-read, may be null (legacy entries). */
  appliedLabel: string | null;
  /** The KIND of gain the change targets ("Input latency" …) — never a fabricated number. */
  payoffLabel: string | null;
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
  /** How many Compy changes were active during the session (0 ⇒ no tag). */
  changesActive: number;
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

export type LogbookRecord = LogbookChange | LogbookSession | LogbookAutopsy;

export type LogbookInput = {
  changes?: AppliedChange[] | null;
  sessions?: SessionSummary[] | null;
  autopsy?: AutopsyLedgerEntry[] | null;
};

// A finite ms-epoch or null (never coerced). ISO strings → Date.parse; anything unparseable → null.
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function buildLogbook({ changes, sessions, autopsy }: LogbookInput): LogbookRecord[] {
  const records: LogbookRecord[] = [];

  for (const c of changes ?? []) {
    const at = ms(c.applied_at);
    if (at === null) continue; // no honest timestamp ⇒ no row
    records.push({
      kind: "change",
      at,
      id: c.id,
      title: c.rec_title,
      active: c.status === "applied" && c.is_still_active,
      rolledBack: c.status === "rolled_back",
      restoresLabel: c.restores_label ?? null,
      appliedLabel: c.applied_label ?? null,
      payoffLabel: c.payoff_label ?? null,
    });
  }

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

  // Reverse-chronological — newest first. Array.prototype.sort is stable (ES2019+), so records
  // that share a timestamp keep insertion order (change → session → autopsy): deterministic.
  records.sort((x, y) => y.at - x.at);
  return records;
}

// A few "start here" doors for the Logbook's library strip — rig-fit first (entries whose
// applicability names this rig, or universal ones), guides before single tweaks/terms because a
// guide is the better entry point. Only REAL corpus entries, deterministic corpus order — never
// invented. Clicking one doors into the field guide focused on that entry.
export function startHereEntries(
  vendor: string,
  limit = 4,
): { id: string; name: string; type: KnowledgeEntry["type"] }[] {
  const fits = (e: KnowledgeEntry): boolean =>
    !e.applies || e.applies.length === 0 || (e.applies as string[]).includes(vendor);
  const current = (e: KnowledgeEntry): boolean => e.status !== "deprecated" && e.status !== "superseded";
  const pool = KNOWLEDGE.filter((e) => fits(e) && current(e));
  const guides = pool.filter((e) => e.type === "guide");
  const rest = pool.filter((e) => e.type !== "guide");
  return [...guides, ...rest]
    .slice(0, Math.max(0, limit))
    .map((e) => ({ id: e.id, name: e.name, type: e.type }));
}
