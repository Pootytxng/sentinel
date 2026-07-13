import { useMemo } from "react";
import { useReducedMotion } from "../../design/use-motion";
import { Term } from "../../design/Term";
import { prettyGameName } from "../game-name";
import type { GpuVendor } from "../walkthroughs";
import {
  startHereEntries,
  type LogbookRecord,
  type LogbookChange,
  type LogbookSession,
  type LogbookAutopsy,
} from "./logbook";
import "./blackbook-console.css";

// BlackbookConsole — the Logbook face (Console HUD Phase 4, plan
// 2026-07-12-console-hud-phase4-blackbook, direction A "The Logbook"). Blackbook's flight
// recorder: a single reverse-chronological TAPE unifying the user's real changes, sessions and
// guide checks, over data App already holds (buildLogbook — zero new IPC, zero src-tauri). Below
// the tape, a compact library strip that doors into the full field guide. The field guide itself
// (today's Learn library) is reached via the room's mode toggle, owned by BlackbookV2.
//
// Honesty contract (the room's spine): buildLogbook renders ONLY real records — an unparseable
// timestamp is dropped, never coerced, so the tape can't fabricate a row; no records ⇒ the honest
// empty state, never a placeholder line. Title-header law: the room h1 stays the bare title
// "Blackbook" (BlackbookV2's masthead) — the "N records · since <date>" status lives here in the
// body. Theme accent only; reduced motion ⇒ the tape is still (no reveal/scrub).
//
// The Logbook is a READ view — it MIRRORS records, it never MOVES them (the plan's rail). Change
// records show WHAT ran + what it reverts to, but undo itself is NOT triggered here: the Lab's
// Optimize station is the ONE audited undo home (owner decision 2026-07-10) — a second full undo
// surface would duplicate it (self-review 2026-07-12, rubric 3). So an active change routes to the
// Lab via a single jump (the plan's sanctioned "manage in Optimize jump" v1). The Logbook triggers
// ZERO mutations — no rollback_change call, no mutation primitive, no src-tauri (mutation-gate: n/a).

const TYPE_LABEL: Record<string, string> = {
  guide: "Guide",
  tweak: "Tweak",
  term: "Term",
  trick: "Scam pattern",
};

// Human, plain-language type tags (never "autopsy"/"Black Box" — the naming rail): the record's
// kind, as a non-technical gamer reads it.
const KIND_TAG: Record<LogbookRecord["kind"], string> = {
  change: "Change",
  session: "Session",
  autopsy: "Guide check",
};

const fmtWhen = (at: number): string => {
  const d = new Date(at);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};

const fmtDuration = (secs: number): string => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
};

function ChangeBody({ r }: { r: LogbookChange }) {
  return (
    <>
      <span className="bc-row-title">{r.title}</span>
      <span className="bc-row-meta">
        {r.active ? (
          <span className="bc-state bc-state-on">on</span>
        ) : r.rolledBack ? (
          <span className="bc-state">rolled back</span>
        ) : (
          <span className="bc-state">no longer active</span>
        )}
        {r.payoffLabel && <span className="bc-chip">{r.payoffLabel}</span>}
        {r.active && r.restoresLabel && (
          <span className="bc-row-note">undo returns to {r.restoresLabel}</span>
        )}
      </span>
    </>
  );
}

function SessionBody({ r }: { r: LogbookSession }) {
  const delta = r.avgFpsDelta;
  return (
    <>
      <span className="bc-row-title">{prettyGameName(r.game) || "Unknown game"}</span>
      <span className="bc-row-meta">
        <span className="bc-stat">
          avg <b className="bc-mono">{Math.round(r.avgFps)}</b> fps
        </span>
        <span className="bc-stat">
          <Term id="one-percent-lows">1% low</Term> <b className="bc-mono">{Math.round(r.low1Fps)}</b>
        </span>
        <span className="bc-stat bc-mono">{fmtDuration(r.durationSecs)}</span>
        {delta != null && delta !== 0 && (
          <span className={`bc-delta ${delta > 0 ? "bc-delta-up" : "bc-delta-down"}`}>
            {delta > 0 ? "▲" : "▼"} {delta > 0 ? "+" : "−"}
            {Math.abs(Math.round(delta))} fps vs last
          </span>
        )}
        {r.changesActive > 0 && (
          <span className="bc-chip">
            {r.changesActive} {r.changesActive === 1 ? "change" : "changes"} on
          </span>
        )}
      </span>
    </>
  );
}

function AutopsyBody({ r }: { r: LogbookAutopsy }) {
  const graded = r.real + r.placebo + r.risky;
  return (
    <>
      <span className="bc-row-title">Fact-checked a guide</span>
      <span className="bc-row-meta">
        {graded > 0 ? (
          <>
            <span className="bc-stat">
              <b className="bc-mono">{r.real}</b> real
            </span>
            <span className="bc-stat">
              <b className="bc-mono">{r.placebo}</b> placebo
            </span>
            <span className="bc-stat">
              <b className="bc-mono">{r.risky}</b> risky
            </span>
          </>
        ) : (
          <span className="bc-row-note">no claims we recognized — we never guess</span>
        )}
        {r.scamFlags > 0 && (
          <span className="bc-chip bc-chip-warn">
            {r.scamFlags} scam {r.scamFlags === 1 ? "pattern" : "patterns"} flagged
          </span>
        )}
      </span>
    </>
  );
}

export function BlackbookConsole({
  records,
  vendor,
  onOpenLab,
  onOpenGuide,
}: {
  records: LogbookRecord[];
  vendor: GpuVendor;
  /** Route to the Lab's Optimize station — the ONE audited undo home (owner decision 2026-07-10). */
  onOpenLab: () => void;
  /** Door into the field guide; a focusId deep-links to that entry. */
  onOpenGuide: (focusId?: string) => void;
}) {
  const reduced = useReducedMotion();
  const startHere = useMemo(() => startHereEntries(vendor, 4), [vendor]);
  // How many changes are still active — the read view states it and routes undo to the Lab.
  const activeChanges = useMemo(
    () => records.filter((r): r is typeof r & { kind: "change" } => r.kind === "change" && r.active).length,
    [records],
  );
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

  return (
    <div className="blackbook-console" data-motion={reduced ? "reduced" : "full"}>
      {/* Body status line — the "N records · since <date>" the title-header law keeps OUT of the
          h1. Absent when there is no record (the empty state below carries the message instead). */}
      {records.length > 0 && (
        <p className="bc-status">
          <b className="bc-mono">{records.length}</b> {records.length === 1 ? "record" : "records"}
          <span className="bc-status-sep"> · </span>since <span className="bc-mono">{sinceDate}</span>
        </p>
      )}

      {records.length === 0 ? (
        <div className="bc-empty">
          <span className="bc-empty-title">No record yet</span>
          <span className="bc-empty-sub">
            Compy logs changes, gaming sessions and guide checks here as they happen.
          </span>
        </div>
      ) : (
        <ol className="bc-tape">
          {records.map((r, i) => (
            <li
              key={`${r.kind}-${r.at}-${i}`}
              className={`bc-row bc-row-${r.kind}${r.kind === "change" && r.rolledBack ? " bc-row-muted" : ""}`}
              style={reduced ? undefined : { animationDelay: `${Math.min(i, 12) * 26}ms` }}
            >
              <span className="bc-tag" data-kind={r.kind}>
                {KIND_TAG[r.kind]}
              </span>
              <span className="bc-time bc-mono">{fmtWhen(r.at)}</span>
              <div className="bc-row-body">
                {r.kind === "change" ? (
                  <ChangeBody r={r} />
                ) : r.kind === "session" ? (
                  <SessionBody r={r} />
                ) : (
                  <AutopsyBody r={r} />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Undo lives in the Lab (the ONE audited undo home) — the Logbook is a read view, so an
          active change routes there rather than rolling back in-room (no second undo surface). */}
      {activeChanges > 0 && (
        <button type="button" className="bc-manage" onClick={onOpenLab}>
          <span>
            {activeChanges} {activeChanges === 1 ? "change" : "changes"} still active — roll back in
            the Lab
          </span>
          <span className="bc-chevron" aria-hidden="true">
            ▸
          </span>
        </button>
      )}

      {/* The compact library strip — doors into the full field guide. Rig-fit "start here" entries
          (real corpus only, hardware-aware) deep-link into the guide; the door browses all. */}
      <div className="bc-library">
        <div className="bc-library-head">
          <span className="bc-library-eyebrow">The field guide</span>
          <span className="bc-library-scent">
            Heard a tweak online? Look it up before you try it — every claim graded.
          </span>
        </div>
        {startHere.length > 0 && (
          <div className="bc-picks">
            {startHere.map((e) => (
              <button
                key={e.id}
                type="button"
                className="bc-pick"
                onClick={() => onOpenGuide(e.id)}
              >
                <span className="bc-pick-type">{TYPE_LABEL[e.type] ?? e.type}</span>
                <span className="bc-pick-name">{e.name}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="bc-library-all" onClick={() => onOpenGuide()}>
          <span>Open the field guide</span>
          <span className="bc-chevron" aria-hidden="true">
            ▸
          </span>
        </button>
      </div>
    </div>
  );
}

export default BlackbookConsole;
