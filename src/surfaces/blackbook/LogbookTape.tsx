import { useTranslation } from "react-i18next";
import { Term } from "../../design/Term";
import { prettyGameName } from "../game-name";
import {
  chronologyNote,
  groupByMonth,
  type LogbookChange,
  type LogbookSession,
  type LogbookAutopsy,
  type LogbookObserved,
} from "./logbook";
import type { LogbookView } from "./logbook-view";
import type { ChangeChronology } from "../../types";
import "../../i18n";
import "./blackbook-console.css";

// LogbookTape — Blackbook's flight recorder, and the evidence column of the approved History
// composition (03-history-approved.png, issue #49). ONE reverse-chronological tape unifying the
// user's real changes, sessions, guide checks and observed machine drift, grouped by calendar
// month. Extracted from BlackbookConsole in the comp-fidelity pass: the comp puts the tape in the
// room's evidence column and everything else full-width beneath it, which makes them two siblings
// rather than two tiles of one grid. The ROWS are unchanged code, moved.
//
// Honesty contract (the room's spine, unchanged): buildLogbook renders ONLY real records — an
// unparseable timestamp is dropped, never coerced, so the tape can't fabricate a row; no records ⇒
// the honest empty state, never a placeholder line. A KNOWN-incomplete ledger narrows every claim
// that speaks for the whole record; UNKNOWN leaves them exactly as they were.

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
        ) : r.unconfirmed ? (
          /* #625: the live check could not say. Health's words, never "still on". */
          <span className="bc-state">
            {t("blackbook.blackbookConsole.changeBody.unconfirmed")}
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
        {(r.active || r.unconfirmed) && r.restoresLabel && (
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
          avg <b className="bc-mono">{r.avgFps == null ? "—" : Math.round(r.avgFps)}</b> fps
        </span>
        <span className="bc-stat">
          <Term id="one-percent-lows">{t("blackbook.blackbookConsole.sessionBody.oneLow")}</Term>{" "}
          <b className="bc-mono">{r.low1Fps == null ? "—" : Math.round(r.low1Fps)}</b>
        </span>
        {/* The chip prints the rounded delta, so it shows only when that is not 0 (desk review
            2026-11-02: a sub-1 fps difference printed "▲ +0 fps vs last"). */}
        {delta != null && Math.round(delta) !== 0 && (
          <span className={`bc-delta ${delta > 0 ? "bc-delta-up" : "bc-delta-down"}`}>
            {t("blackbook.blackbookConsole.sessionBody.delta", {
              arrow: delta > 0 ? "▲" : "▼",
              sign: delta > 0 ? "+" : "−",
              value: Math.abs(Math.round(delta)),
            })}
          </span>
        )}
        {/* PLAIN COPY, NOT A CHIP (03-history-approved.png). "12 changes on" sits in the same
            grey run as `avg 191 fps` with no outline: it is one more fact about the session, and
            the pill it used to wear made it read as a badge the session had EARNED. */}
        {r.changesActive != null && r.changesActive > 0 && (
          <span className="bc-row-note">
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
              <b className="bc-mono">{r.risky}</b>{" "}
              {t("blackbook.blackbookConsole.autopsyBody.risky")}
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

export function LogbookTape({
  view,
  reduced,
  onReviewSession,
  chronology = null,
}: {
  view: LogbookView;
  /** Reduced motion ⇒ the tape is still (no staggered reveal). */
  reduced: boolean;
  /** Opens the latest session where its full readout already lives — Live. Omitted ⇒ the row
   *  carries no chevron, because an affordance that leads nowhere is a drawn lie. */
  onReviewSession?: () => void;
  /** The Machine Model's chronology (#450), for its own caveat and unknown-reason sentences. Null
   *  while the model has not been read — the tape then prints no note rather than inventing one. */
  chronology?: ChangeChronology | null;
}) {
  const { t, i18n } = useTranslation();
  const { records, filter, tape, older, sinceDate, incomplete, latestSession } = view;
  // `incomplete` is set on exactly the health the notice above renders, so it is also the answer to
  // "has this room already disclosed that the ledger could not be read?". While it is, the
  // chronology's own reason is a SECOND voice for one failure — the thing LedgerHealthNotice was
  // built to make impossible — so the tape defers to it (self-review 2026-09-17, #450).
  const note = chronologyNote(chronology, { unknownStatedElsewhere: Boolean(incomplete) });
  // The model's OWN reason the chronology is short — an unreadable Trust Ledger, or nothing
  // recorded. It replaces the empty state's claim about the machine, verbatim, and only where the
  // room is not already saying it.
  const unknownReason = incomplete ? null : (chronology?.unknown_reason ?? null);

  if (records.length === 0) {
    return (
      <div className="bc-empty">
        {/* "No record yet" is a claim about the MACHINE, and an unreadable ledger is the one
            state where Compy cannot make it. The notice above already says what's missing, so
            this narrows to the kinds Compy can still vouch for rather than repeating it. The
            model's own unknown_reason (#450) is the same rule applied to the chronology: while it
            is set, the empty tape states that reason instead of "nothing changed" — but only when
            the notice is NOT up, because then the narrowed `emptyIncomplete` copy is already the
            room's one answer for that failure. The two branches are mutually exclusive by
            construction (`unknownReason` is nulled while `incomplete`), and neither can fall
            through to "No record yet". */}
        <span className="bc-empty-title">
          {t(
            unknownReason
              ? "blackbook.blackbookConsole.emptyUnknown.title"
              : incomplete
                ? "blackbook.blackbookConsole.emptyIncomplete.title"
                : "blackbook.blackbookConsole.empty.title",
          )}
        </span>
        <span className="bc-empty-sub">
          {unknownReason ??
            t(
              incomplete
                ? "blackbook.blackbookConsole.emptyIncomplete.sub"
                : "blackbook.blackbookConsole.empty.sub",
            )}
        </span>
      </div>
    );
  }

  return (
    <>
      {/* The record's scent line — WHEN IT HAS SOMETHING TO SAY. It was the hero tile's badge
          before the split, and it printed unconditionally: "everything Compy has done on this PC ·
          since <date>". 03-history-approved.png draws nothing above the first month head, and the
          reason that is safe rather than a deletion is that the widest CLAIM went with it — no
          sentence on this screen now says the record is complete, so there is nothing left to
          bound. What survives is the half that narrows: a filter is active (the tape is showing a
          slice and must say so), or the ledger is KNOWN incomplete (the record cannot speak for
          the whole machine). Either of those printing is the honest state; both silent is the
          comp. */}
      {(filter || incomplete) && (
        <div className="bc-sect">
          {filter && (
            <span className="bc-sect-t">
              {t(`blackbook.blackbookConsole.filterNoun.${filter}`)} only
            </span>
          )}
          {incomplete && (
            <span className="bc-sect-s">
              {t("blackbook.blackbookConsole.sectionHead.sinceIncomplete")}
              <span className="bc-mono">{sinceDate}</span>
            </span>
          )}
        </div>
      )}
      {/* The tape, grouped by calendar month (intimidation pass 2026-08-20): the month head is the
          orientation a flat log lacks, and the row is two columns — kind tag, then a body whose
          FIRST line carries title + timestamp side by side. The timestamp used to be its own 116px
          grid track, which "Aug 20 · 4:24 PM" overran into the title (every row's AM/PM sat under
          the bold text on the installed build); a grid line with a max-content time track cannot
          overlap, and the body keeps its full width for the meta below. */}
      {/* data-motion rides the TAPE now, not the console root. The reveal is gated on
          `[data-motion="full"] .bc-row`, and the rows left `.blackbook-console` when the tape
          became the room's evidence column -- so the switch was still being set on an ancestor
          the rows no longer have, and every row's stagger was silently dead. */}
      <div className="bc-tape" data-motion={reduced ? "reduced" : "full"}>
        {groupByMonth(tape, i18n.language).map((m, gi, groups) => {
          const offset = groups.slice(0, gi).reduce((n, g) => n + g.records.length, 0);
          return (
            <section key={m.key} className="bc-month" aria-label={m.label}>
              <h4 className="bc-month-h">{m.label}</h4>
              <ol className="bc-month-rows">
                {m.records.map((r, ri) => {
                  const i = offset + ri;
                  // THE CHEVRON IS THE PRIMARY ACTION'S TWIN (03-history-approved.png draws it on
                  // the first row and nowhere else). It opens the same session "Review latest
                  // session" opens, in the same room, so the tape's newest row and the button
                  // above it can never point at two different things.
                  const reviewable = r === latestSession && !!onReviewSession;
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
                        {reviewable && (
                          <button
                            type="button"
                            className="bc-row-go"
                            onClick={onReviewSession}
                            aria-label={t("blackbook.blackbookV2.reviewLatest")}
                          >
                            <span aria-hidden="true">›</span>
                          </button>
                        )}
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
        <button type="button" className="bc-tape-more" onClick={view.revealAll}>
          <span>{t("blackbook.blackbookConsole.tapeMore", { count: older })}</span>
          <span className="bc-tape-more-chev" aria-hidden="true">
            ⌄
          </span>
        </button>
      )}
      {/* THE MODEL'S OWN NOTE, last and quiet (#450). A chronology is not a causal chain, and the
          shared Machine Model is the one place that sentence is written — so it is rendered
          verbatim under the rows it qualifies, never rephrased into a claim. An unreadable Trust
          Ledger replaces it with the reason (see chronologyNote). */}
      {note && <p className="bc-tape-note">{note}</p>}
    </>
  );
}

export default LogbookTape;
