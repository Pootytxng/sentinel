import { useTranslation } from "react-i18next";
// Side-effect import, as in BlackBox.tsx: the i18next singleton is ready even when this is the first
// thing a test loads.
import "../i18n";
import type { BlackBoxReport, CrashIncident, IntelEvent } from "../types";
import "./SinceLastWorked.css";

// P6-timeline (ROADMAP Phase 6 bullet 2, Constitution §16, §17, §27): ONE "Since it last worked"
// list on the Care view. Incidents, Compy's changes, observed changes (driver, Windows build, power
// plan, hardware), drift and sessions, newest first, from the timeline the station's scan already
// carries (`since_last_worked`, intelligence.rs) plus the scan's own incidents. "Last worked" is the
// last clean session by changed_before's rules, honest about how far back the crash scan reaches;
// with none, the list says so and shows nothing. Read-only: no IPC, no write, no button that changes
// anything. Correlation in time only — the list is tagged "not proven cause".

/** Rows shown before the rest collapse into "and N earlier". */
export const MAX_SINCE_ROWS = 40;

export type SinceRowKind = "incident" | "compy" | "observed" | "drift" | "session";
export type SinceRow = {
  key: string;
  kind: SinceRowKind;
  at: string;
  text: string;
  observedBetween: [string, string] | null;
  rolledBack: boolean;
};

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
};

function kindOf(e: IntelEvent): SinceRowKind {
  if (e.event_type === "session") return "session";
  if (e.event_type === "readiness-drift") return "drift";
  return e.scope === "compy-applied" ? "compy" : "observed";
}

/** Pure: the list's rows, newest first. Incidents count only after the anchor session started. */
export function sinceRows(report: BlackBoxReport): SinceRow[] | null {
  const slw = report.since_last_worked;
  if (!slw?.anchor) return null;
  const from = ms(slw.anchor.started_at);
  const fromEvents: SinceRow[] = slw.events.map((e) => ({
    key: e.id,
    kind: kindOf(e),
    at: e.timestamp,
    text: e.summary,
    observedBetween: e.observed_between,
    rolledBack: e.since_rolled_back,
  }));
  const fromIncidents: SinceRow[] = report.incidents
    .filter((i: CrashIncident) => ms(i.when) > from)
    .map((i, n) => ({
      key: `incident:${i.incident_id || `${i.when}-${n}`}`,
      kind: "incident",
      at: i.when,
      text: i.headline,
      observedBetween: null,
      rolledBack: false,
    }));
  // Stable sort: the backend's order holds for equal times.
  return [...fromIncidents, ...fromEvents].sort((a, b) => ms(b.at) - ms(a.at));
}

function fmtWhen(iso: string, lang: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SinceLastWorked({ report }: { report: BlackBoxReport | null }) {
  const { t, i18n } = useTranslation();
  const slw = report?.since_last_worked;
  if (!report || !slw) return null;
  const when = (iso: string) => fmtWhen(iso, i18n.language);
  const rows = sinceRows(report);
  const shown = rows?.slice(0, MAX_SINCE_ROWS) ?? [];
  const hidden = (rows?.length ?? 0) - shown.length;
  const stamp = (r: Pick<SinceRow, "at" | "observedBetween">) =>
    r.observedBetween
      ? t("gaming.blackBox.sinceWorked.observedBetween", {
          from: when(r.observedBetween[0]),
          to: when(r.observedBetween[1]),
        })
      : when(r.at);

  return (
    <section className="bb-since" aria-label={t("gaming.blackBox.sinceWorked.title")}>
      <div className="bb-since-head">
        <span className="bb-since-title">{t("gaming.blackBox.sinceWorked.title")}</span>
        <span className="bb-since-tag">{t("gaming.blackBox.sinceWorked.notProven")}</span>
      </div>
      {!slw.anchor ? (
        <p className="bb-since-line">
          {t(
            slw.none_reason === "none-clean"
              ? "gaming.blackBox.sinceWorked.noneClean"
              : "gaming.blackBox.sinceWorked.noSession",
          )}
        </p>
      ) : (
        <>
          <p className="bb-since-line">
            {t("gaming.blackBox.sinceWorked.since", {
              game: slw.anchor.game,
              date: when(slw.anchor.started_at),
            })}
          </p>
          {shown.length === 0 ? (
            <p className="bb-since-line">{t("gaming.blackBox.sinceWorked.nothing")}</p>
          ) : (
            <ol className="bb-since-list">
              {shown.map((r) => (
                <li key={r.key} className={`bb-since-row bb-since-${r.kind}`} data-kind={r.kind}>
                  <span className="bb-since-kind">{t(`gaming.blackBox.sinceWorked.kind.${r.kind}`)}</span>
                  <span className="bb-since-text">
                    {r.text}
                    {r.rolledBack ? ` · ${t("gaming.blackBox.sinceWorked.rolledBack")}` : ""}
                  </span>
                  <span className="bb-since-when">{stamp(r)}</span>
                </li>
              ))}
            </ol>
          )}
          {hidden > 0 && (
            <p className="bb-since-more">{t("gaming.blackBox.sinceWorked.more", { count: hidden })}</p>
          )}
          {slw.unplaced.length > 0 && (
            <div className="bb-since-unplaced">
              <p className="bb-since-line">{t("gaming.blackBox.sinceWorked.unplaced")}</p>
              <ul className="bb-since-list">
                {slw.unplaced.map((e) => (
                  <li key={e.id} className="bb-since-row" data-kind={kindOf(e)}>
                    <span className="bb-since-kind">{t(`gaming.blackBox.sinceWorked.kind.${kindOf(e)}`)}</span>
                    <span className="bb-since-text">{e.summary}</span>
                    <span className="bb-since-when">
                      {stamp({ at: e.timestamp, observedBetween: e.observed_between })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
