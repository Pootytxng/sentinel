import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "../../design/use-motion";
import { BentoGrid, BentoTile } from "../../design/bento/BentoGrid";
import { Term } from "../../design/Term";
import { LedgerHealthNotice, knownIncomplete } from "../../design/LedgerHealthNotice";
import { prettyGameName } from "../game-name";
import type { LedgerHealth } from "../../types";
import type { GpuVendor } from "../walkthroughs";
import {
  groupByMonth,
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

// How many tape rows mount before the "show older" press (the SessionStack MAX_STACK_ROWS pattern).
// 30 → 8 in the intimidation pass (2026-08-20): the record is the room's hero, and a hero that runs
// 30 rows deep stretches the bento's two left tiles into hollow columns three viewports tall while
// the tape itself reads as a dump. Eight is a screenful — the latest happenings, grouped by month —
// and everything older is one honest press away (the count is still stated, nothing hidden).
const TAPE_CAP = 8;

const fmtWhen = (at: number): string => {
  const d = new Date(at);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};

// Date only — for the "since <date>" half of a collapsed repeat row, where the clock time of the
// FIRST of 37 applies is noise.
const fmtDay = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
        {/* C-11: repeats collapsed by buildLogbook. The row states the count and when the
            repeating started, so folding 37 rows into 1 hides nothing — it just stops the record
            reading as a malfunction. */}
        {r.count > 1 && (
          <span className="bc-row-note bc-repeat">
            {t("blackbook.blackbookConsole.changeBody.repeat", {
              times: r.count,
              since: fmtDay(r.firstAt),
            })}
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
  health = null,
  vendor,
  onOpenLab,
  onOpenGuide,
  patterns = null,
}: {
  records: LogbookRecord[];
  /** Whether the Trust Ledger behind the Change records is the WHOLE story (BlackbookV2 probes it).
   *  UNKNOWN — null, the default — leaves every line of this room exactly as it was; only a KNOWN
   *  incomplete ledger narrows the claims below. See `design/LedgerHealthNotice.tsx`. */
  health?: LedgerHealth | null;
  vendor: GpuVendor;
  /** Route to the Lab's Optimize station — the ONE audited undo home (owner decision 2026-07-10). */
  onOpenLab: () => void;
  /** Door into the field guide; a focusId deep-links to that entry. */
  onOpenGuide: (focusId?: string) => void;
  /** Optional full-width band ABOVE the record (BlackbookV2 passes PatternsTile). It is handed in
   *  rather than imported so this file stays zero-IPC, and it must be a `<BentoTile span="full">`
   *  so its absence closes the row instead of leaving a hole (bento row-major law, no dense flow). */
  patterns?: ReactNode;
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

  // KNOWN incomplete, or null. Every claim below that speaks for the WHOLE change record — the
  // changes tile, the empty state, the "since <date>" scent — narrows when this is set, and is
  // untouched when it isn't. `.error` splits the two shapes: an unreadable ledger makes the count
  // itself meaningless (show a dash), while a ledger quarantined on an earlier run still counts
  // what survived accurately — it just can't claim that's everything.
  const incomplete = knownIncomplete(health);

  return (
    <div className="blackbook-console" data-motion={reduced ? "reduced" : "full"}>
      {/* FIRST, above the strip: the strip itself carries a claim, and a caveat printed under its
          subject has already failed at its job. Renders nothing unless the ledger is KNOWN
          incomplete — the same one box the Optimize ledger shows, so the two surfaces cannot drift
          into two different warnings about the same file. */}
      <LedgerHealthNotice health={health} />
      <BentoGrid>
        {/* Intelligence Phase 2 — cross-session pattern synthesis stays ABOVE the record (§5E),
            handed in by BlackbookV2 rather than imported so this file stays zero-IPC. */}
        {patterns}
        {/* The Receipts Strip (owner pick 2026-07-13, concept A) — replaces the bare "N records ·
            since <date>" status line with the same facts made self-explanatory: three tappable tiles
            NAME the three things this room records, carry live counts, and filter the tape. The page
            teaches its own vocabulary through a summary you can touch — no explainer paragraph.
            Title-header law: this is BODY content; the h1 stays the bare room title.
            UNCONDITIONAL since the bento conversion (it used to hide at zero records): its
            zero-state copy is already honest ("nothing changed yet"), every tile disables itself at
            zero, and a half tile that can vanish would leave the 2-row hero's remainder as a
            visible hole — the grid is strict row-major with no dense flow, on purpose. */}
        <BentoTile span="half" title={t("blackbook.blackbookConsole.stripAriaLabel")}>
          <div className="bc-strip">
            <button
              type="button"
              className="bc-tile"
              data-kind="change"
              aria-pressed={filter === "change"}
              disabled={counts.change === 0}
              onClick={() => toggleFilter("change")}
            >
              <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.changesTitle")}</span>
              {/* A count read off a ledger that would not open is not a count. An em dash says
                  "no number", where a 0 would say "nothing ever happened here". */}
              <span className="bc-tile-n bc-mono">{incomplete?.error ? "—" : counts.change}</span>
              <span className="bc-tile-d">
                {incomplete ? (
                  incomplete.error
                    ? t("blackbook.blackbookConsole.tiles.changesUnknown")
                    : counts.change === 0
                      ? t("blackbook.blackbookConsole.tiles.changesNonePartial")
                      : activeChanges > 0
                        ? t("blackbook.blackbookConsole.tiles.changesActivePartial", {
                            count: activeChanges,
                          })
                        : t("blackbook.blackbookConsole.tiles.changesInactivePartial")
                ) : counts.change === 0 ? (
                  t("blackbook.blackbookConsole.tiles.changesNone")
                ) : activeChanges > 0 ? (
                  t("blackbook.blackbookConsole.tiles.changesActive", { count: activeChanges })
                ) : (
                  t("blackbook.blackbookConsole.tiles.changesInactive")
                )}
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
          {/* Undo lives in the Lab (the ONE audited undo home) — the Logbook is a read view, so an
              active change routes there rather than rolling back in-room (no second undo surface).
              It sits in the strip tile because it is a follow-on to the change COUNT above it. */}
          {activeChanges > 0 && (
            <button type="button" className="bc-manage" onClick={onOpenLab}>
              <span>{t("blackbook.blackbookConsole.manageJump", { count: activeChanges })}</span>
              <span className="bc-chevron" aria-hidden="true">
                ▸
              </span>
            </button>
          )}
        </BentoTile>
        {/* THE RECORD — the room's centrepiece, so it takes the one hero. The old ".bc-sect" head
            is now the tile's own title + badge: the title carries "The record", the badge carries
            the active filter and the "since <date>" scent that narrows on a partial ledger. */}
        <BentoTile
          span="hero"
          title={t("blackbook.blackbookConsole.sectionHead.record")}
          badge={
            records.length > 0 ? (
              <span className="bc-sect">
                {filter && (
                  <span className="bc-sect-t">
                    {t(`blackbook.blackbookConsole.filterNoun.${filter}`)} only
                  </span>
                )}
                <span className="bc-sect-s">
                  {/* "everything Compy has done on this PC" is the room's widest claim — it is
                      exactly the sentence a partial ledger makes false. The date stays: it still
                      marks where the readable record begins. */}
                  {t(
                    incomplete
                      ? "blackbook.blackbookConsole.sectionHead.sinceIncomplete"
                      : "blackbook.blackbookConsole.sectionHead.since",
                  )}
                  <span className="bc-mono">{sinceDate}</span>
                </span>
              </span>
            ) : undefined
          }
        >
          {records.length === 0 ? (
            <div className="bc-empty">
              {/* "No record yet" is a claim about the MACHINE, and an unreadable ledger is the one
                  state where Compy cannot make it. The notice above already says what's missing, so
                  this narrows to the kinds Compy can still vouch for rather than repeating it. */}
              <span className="bc-empty-title">
                {t(
                  incomplete
                    ? "blackbook.blackbookConsole.emptyIncomplete.title"
                    : "blackbook.blackbookConsole.empty.title",
                )}
              </span>
              <span className="bc-empty-sub">
                {t(
                  incomplete
                    ? "blackbook.blackbookConsole.emptyIncomplete.sub"
                    : "blackbook.blackbookConsole.empty.sub",
                )}
              </span>
            </div>
          ) : (
            <>
              {/* The tape, grouped by calendar month (intimidation pass 2026-08-20): the month head
                  is the orientation a flat log lacks, and the row is two columns — kind tag, then a
                  body whose FIRST line carries title + timestamp side by side. The timestamp used to
                  be its own 116px grid track, which "Aug 20 · 4:24 PM" overran into the title
                  (every row's AM/PM sat under the bold text on the installed build); a grid line
                  with a max-content time track cannot overlap, and the body keeps its full width
                  for the meta below. */}
              <div className="bc-tape">
                {groupByMonth(tape, i18n.language).map((m, gi, groups) => {
                  const offset = groups.slice(0, gi).reduce((n, g) => n + g.records.length, 0);
                  return (
                    <section key={m.key} className="bc-month" aria-label={m.label}>
                      <h4 className="bc-month-h">{m.label}</h4>
                      <ol className="bc-month-rows">
                        {m.records.map((r, ri) => {
                          const i = offset + ri;
                          return (
                            <li
                              key={`${r.kind}-${r.at}-${i}`}
                              className={`bc-row bc-row-${r.kind}${r.kind === "change" && r.rolledBack ? " bc-row-muted" : ""}`}
                              style={
                                reduced ? undefined : { animationDelay: `${Math.min(i, 12) * 26}ms` }
                              }
                            >
                              <span className="bc-tag" data-kind={r.kind}>
                                {t(`blackbook.blackbookConsole.kindTag.${r.kind}`)}
                              </span>
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
                                <span className="bc-time bc-mono">{fmtWhen(r.at)}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  );
                })}
              </div>
              {older > 0 && (
                <button type="button" className="bc-tape-more" onClick={() => setTapeAll(true)}>
                  {t("blackbook.blackbookConsole.tapeMore", { count: older })}
                </button>
              )}
            </>
          )}
        </BentoTile>
        {/* The compact library strip — doors into the full field guide. Rig-fit "start here" entries
            (real corpus only, hardware-aware) deep-link into the guide; the door browses all. The
            old ".bc-library-eyebrow" is gone: it said the same words the tile title now says, and a
            tile that names itself twice is duplication (self-review rubric 3). */}
        <BentoTile span="half" title={t("blackbook.blackbookConsole.library.eyebrow")}>
          <div className="bc-library">
            <span className="bc-library-scent">{t("blackbook.blackbookConsole.library.scent")}</span>
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
        </BentoTile>
      </BentoGrid>
    </div>
  );
}

export default BlackbookConsole;
