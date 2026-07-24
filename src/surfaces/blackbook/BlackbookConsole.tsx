import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  type LogbookObserved,
} from "./logbook";
import "../../i18n";
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

// Human, plain-language type tags (never "autopsy"/"Black Box" — the naming rail): the record's
// kind, as a non-technical gamer reads it. Values resolved via t("blackbook.blackbookConsole.*")
// at each call site (typeLabel / kindTag / filterNoun keys), keyed by the same record-kind strings.

// How many tape rows mount before the "show older" press (the SessionStack MAX_STACK_ROWS pattern,
// sized for a tape: ~a month of typical use above the fold, everything older one press away).
const TAPE_CAP = 30;

const fmtWhen = (at: number): string => {
  const d = new Date(at);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};

const fmtDuration = (secs: number): string => {
  const s = Math.max(0, Math.round(secs));
  // Round to whole minutes FIRST, then split into h/m — otherwise a 59m50s session
  // (3590s) rounds its minute-part to 60 while h stays 0, rendering the impossible "60m"
  // (bug→guard, blackbook-console duration test). Sub-minute sessions still read in seconds.
  if (s < 60) return `${s}s`;
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

// Sentence grammar (owner pick 2026-07-13, concept B): every row reads as a plain sentence with an
// ACTOR — "Compy applied…", "You played…", "You fact-checked…" — so any single row a first-timer
// happens to read explains the whole page (a diary of what Compy and you did to this PC). Copy
// only; the data underneath is unchanged.
function ChangeBody({ r }: { r: LogbookChange }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="bc-row-title">
        {t("blackbook.blackbookConsole.changeBody.titlePre")}
        <b>{r.title}</b>
      </span>
      <span className="bc-row-meta">
        {r.active ? (
          <span className="bc-state bc-state-on">
            {t("blackbook.blackbookConsole.changeBody.stillOn")}
          </span>
        ) : r.rolledBack ? (
          <span className="bc-state">{t("blackbook.blackbookConsole.changeBody.rolledBack")}</span>
        ) : (
          <span className="bc-state">
            {t("blackbook.blackbookConsole.changeBody.noLongerActive")}
          </span>
        )}
        {r.payoffLabel && <span className="bc-chip">{r.payoffLabel}</span>}
        {r.active && r.restoresLabel && (
          <span className="bc-row-note">
            {t("blackbook.blackbookConsole.changeBody.restoresPre")}
            {r.restoresLabel}
          </span>
        )}
      </span>
    </>
  );
}

function SessionBody({ r }: { r: LogbookSession }) {
  const { t } = useTranslation();
  const delta = r.avgFpsDelta;
  return (
    <>
      <span className="bc-row-title">
        {t("blackbook.blackbookConsole.sessionBody.titlePre")}
        <b>{prettyGameName(r.game) || t("blackbook.blackbookConsole.sessionBody.unknownGame")}</b>
        {t("blackbook.blackbookConsole.sessionBody.titlePost")}
        {fmtDuration(r.durationSecs)}
      </span>
      <span className="bc-row-meta">
        <span className="bc-stat">
          avg <b className="bc-mono">{Math.round(r.avgFps)}</b> fps
        </span>
        <span className="bc-stat">
          <Term id="one-percent-lows">{t("blackbook.blackbookConsole.sessionBody.oneLow")}</Term>{" "}
          <b className="bc-mono">{Math.round(r.low1Fps)}</b>
        </span>
        {delta != null && delta !== 0 && (
          <span className={`bc-delta ${delta > 0 ? "bc-delta-up" : "bc-delta-down"}`}>
            {t("blackbook.blackbookConsole.sessionBody.delta", {
              arrow: delta > 0 ? "▲" : "▼",
              sign: delta > 0 ? "+" : "−",
              value: Math.abs(Math.round(delta)),
            })}
          </span>
        )}
        {r.changesActive > 0 && (
          <span className="bc-chip">
            {t("blackbook.blackbookConsole.sessionBody.changesOn", { count: r.changesActive })}
          </span>
        )}
      </span>
    </>
  );
}

function AutopsyBody({ r }: { r: LogbookAutopsy }) {
  const { t } = useTranslation();
  const graded = r.real + r.placebo + r.risky;
  return (
    <>
      <span className="bc-row-title">{t("blackbook.blackbookConsole.autopsyBody.title")}</span>
      <span className="bc-row-meta">
        {graded > 0 ? (
          <>
            <span className="bc-stat">
              <b className="bc-mono">{r.real}</b> {t("blackbook.blackbookConsole.autopsyBody.real")}
            </span>
            <span className="bc-stat">
              <b className="bc-mono">{r.placebo}</b>{" "}
              {t("blackbook.blackbookConsole.autopsyBody.placebo")}
            </span>
            <span className="bc-stat">
              <b className="bc-mono">{r.risky}</b> {t("blackbook.blackbookConsole.autopsyBody.risky")}
            </span>
          </>
        ) : (
          <span className="bc-row-note">{t("blackbook.blackbookConsole.autopsyBody.noClaims")}</span>
        )}
        {r.scamFlags > 0 && (
          <span className="bc-chip bc-chip-warn">
            {t("blackbook.blackbookConsole.scamFlagged", { count: r.scamFlags })}
          </span>
        )}
      </span>
    </>
  );
}

function ObservedBody({ r }: { r: LogbookObserved }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="bc-row-title">
        <b>{r.summary}</b>
      </span>
      <span className="bc-row-meta">
        {r.observedBetween && (
          <span className="bc-stat">
            {t("blackbook.blackbookConsole.observedBody.betweenPre")}
            <b className="bc-mono">{fmtWhen(r.observedBetween[0])}</b>
            {t("blackbook.blackbookConsole.observedBody.betweenMid")}
            <b className="bc-mono">{fmtWhen(r.observedBetween[1])}</b>
          </span>
        )}
        <span className="bc-row-note">
          {r.detail ?? t("blackbook.blackbookConsole.observedBody.noDetail")}
        </span>
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
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const startHere = useMemo(() => startHereEntries(vendor, 4, i18n.language), [vendor, i18n.language]);
  // The Receipts Strip's tape filter (owner pick 2026-07-13, concept A): null = the full tape.
  // Session-local by design — a filter is a glance tool, not a preference.
  const [filter, setFilter] = useState<LogbookRecord["kind"] | null>(null);
  // How many changes are still active — the read view states it and routes undo to the Lab.
  const activeChanges = useMemo(
    () => records.filter((r): r is typeof r & { kind: "change" } => r.kind === "change" && r.active).length,
    [records],
  );
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
  // The tape renders the RECENT slice, not the machine's whole lifetime: an uncapped map over
  // every change+session+autopsy ever recorded was the dominant Blackbook nav-mount cost (80–152ms,
  // scaling with history — nav-mount follow-up, BACKLOG cycle 2026-07-15d). Counts/strip/sinceDate
  // still derive from the FULL records (the numbers never understate), and one press unrolls the
  // rest — nothing is hidden, only deferred behind an honest count.
  const [tapeAll, setTapeAll] = useState(false);
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

  // A tile toggles its kind filter; a zero-count tile is disabled (an honest empty beats an empty
  // filtered tape). aria-pressed carries the state for AT.
  const toggleFilter = (kind: LogbookRecord["kind"]) =>
    setFilter((cur) => (cur === kind ? null : kind));

  return (
    <div className="blackbook-console" data-motion={reduced ? "reduced" : "full"}>
      {/* The Receipts Strip (owner pick 2026-07-13, concept A) — replaces the bare "N records ·
          since <date>" status line with the same facts made self-explanatory: three tappable tiles
          NAME the three things this room records, carry live counts, and filter the tape. The page
          teaches its own vocabulary through a summary you can touch — no explainer paragraph.
          Title-header law: this is BODY content; the h1 stays the bare room title. Absent when
          there is no record (the empty state below carries the message instead). */}
      {records.length > 0 && (
        <div className="bc-strip" role="group" aria-label={t("blackbook.blackbookConsole.stripAriaLabel")}>
          <button
            type="button"
            className="bc-tile"
            data-kind="change"
            aria-pressed={filter === "change"}
            disabled={counts.change === 0}
            onClick={() => toggleFilter("change")}
          >
            <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.changesTitle")}</span>
            <span className="bc-tile-n bc-mono">{counts.change}</span>
            <span className="bc-tile-d">
              {counts.change === 0
                ? t("blackbook.blackbookConsole.tiles.changesNone")
                : activeChanges > 0
                  ? t("blackbook.blackbookConsole.tiles.changesActive", { count: activeChanges })
                  : t("blackbook.blackbookConsole.tiles.changesInactive")}
            </span>
          </button>
          <button
            type="button"
            className="bc-tile"
            data-kind="session"
            aria-pressed={filter === "session"}
            disabled={counts.session === 0}
            onClick={() => toggleFilter("session")}
          >
            <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.sessionsTitle")}</span>
            <span className="bc-tile-n bc-mono">{counts.session}</span>
            <span className="bc-tile-d">
              {counts.session === 0
                ? t("blackbook.blackbookConsole.tiles.sessionsNone")
                : t("blackbook.blackbookConsole.tiles.sessionsSome")}
            </span>
          </button>
          <button
            type="button"
            className="bc-tile"
            data-kind="autopsy"
            aria-pressed={filter === "autopsy"}
            disabled={counts.autopsy === 0}
            onClick={() => toggleFilter("autopsy")}
          >
            <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.autopsyTitle")}</span>
            <span className="bc-tile-n bc-mono">{counts.autopsy}</span>
            <span className="bc-tile-d">
              {counts.autopsy === 0
                ? t("blackbook.blackbookConsole.tiles.autopsyNone")
                : counts.scamFlags > 0
                  ? t("blackbook.blackbookConsole.scamFlagged", { count: counts.scamFlags })
                  : t("blackbook.blackbookConsole.tiles.autopsySome")}
            </span>
          </button>
          {/* Observed machine changes (Intelligence Phase 1) — the tile only mounts once such a
              record exists: three tiles stay the room's stable face until the fourth kind is real. */}
          {counts.observed > 0 && (
            <button
              type="button"
              className="bc-tile"
              data-kind="observed"
              aria-pressed={filter === "observed"}
              onClick={() => toggleFilter("observed")}
            >
              <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.observedTitle")}</span>
              <span className="bc-tile-n bc-mono">{counts.observed}</span>
              <span className="bc-tile-d">{t("blackbook.blackbookConsole.tiles.observedSub")}</span>
            </button>
          )}
        </div>
      )}

      {records.length === 0 ? (
        <div className="bc-empty">
          <span className="bc-empty-title">{t("blackbook.blackbookConsole.empty.title")}</span>
          <span className="bc-empty-sub">{t("blackbook.blackbookConsole.empty.sub")}</span>
        </div>
      ) : (
        <>
          {/* The tape's section head (concept B) — the same eyebrow-plus-scent grammar the field-guide
              strip below already speaks, so the room's two halves finally introduce themselves the
              same way. One line, not a paragraph. */}
          <div className="bc-sect">
            <span className="bc-sect-t">
              {t("blackbook.blackbookConsole.sectionHead.record")}
              {filter
                ? ` · ${t(`blackbook.blackbookConsole.filterNoun.${filter}`)} only`
                : ""}
            </span>
            <span className="bc-sect-rule" aria-hidden="true" />
            <span className="bc-sect-s">
              {t("blackbook.blackbookConsole.sectionHead.since")}
              <span className="bc-mono">{sinceDate}</span>
            </span>
          </div>
          <ol className="bc-tape">
            {tape.map((r, i) => (
            <li
              key={`${r.kind}-${r.at}-${i}`}
              className={`bc-row bc-row-${r.kind}${r.kind === "change" && r.rolledBack ? " bc-row-muted" : ""}`}
              style={reduced ? undefined : { animationDelay: `${Math.min(i, 12) * 26}ms` }}
            >
              <span className="bc-tag" data-kind={r.kind}>
                {t(`blackbook.blackbookConsole.kindTag.${r.kind}`)}
              </span>
              <span className="bc-time bc-mono">{fmtWhen(r.at)}</span>
              <div className="bc-row-body">
                {r.kind === "change" ? (
                  <ChangeBody r={r} />
                ) : r.kind === "session" ? (
                  <SessionBody r={r} />
                ) : r.kind === "autopsy" ? (
                  <AutopsyBody r={r} />
                ) : (
                  <ObservedBody r={r} />
                )}
              </div>
            </li>
          ))}
          </ol>
          {older > 0 && (
            <button type="button" className="bc-tape-more" onClick={() => setTapeAll(true)}>
              {t("blackbook.blackbookConsole.tapeMore", { count: older })}
            </button>
          )}
        </>
      )}

      {/* Undo lives in the Lab (the ONE audited undo home) — the Logbook is a read view, so an
          active change routes there rather than rolling back in-room (no second undo surface). */}
      {activeChanges > 0 && (
        <button type="button" className="bc-manage" onClick={onOpenLab}>
          <span>{t("blackbook.blackbookConsole.manageJump", { count: activeChanges })}</span>
          <span className="bc-chevron" aria-hidden="true">
            ▸
          </span>
        </button>
      )}

      {/* The compact library strip — doors into the full field guide. Rig-fit "start here" entries
          (real corpus only, hardware-aware) deep-link into the guide; the door browses all. */}
      <div className="bc-library">
        <div className="bc-library-head">
          <span className="bc-library-eyebrow">{t("blackbook.blackbookConsole.library.eyebrow")}</span>
          <span className="bc-library-scent">{t("blackbook.blackbookConsole.library.scent")}</span>
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
                <span className="bc-pick-type">
                  {t(`blackbook.blackbookConsole.typeLabel.${e.type}`, { defaultValue: e.type })}
                </span>
                <span className="bc-pick-name">{e.name}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="bc-library-all" onClick={() => onOpenGuide()}>
          <span>{t("blackbook.blackbookConsole.library.openAll")}</span>
          <span className="bc-chevron" aria-hidden="true">
            ▸
          </span>
        </button>
      </div>
    </div>
  );
}

export default BlackbookConsole;
