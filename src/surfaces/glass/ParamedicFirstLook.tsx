// The day-one answer (design M5, slice S1). When the measured Paramedic has no usable history (no game
// recorded, or too few sessions), the card asks ONE question, "When did it start?", then asks the engine
// (`paramedic_first_look`, read-only) what changed on this PC in that window. It shows dated facts newest
// first, says what it could not see, and claims no measurement: nothing here is called a problem or a
// cause, and nothing is ordered by likelihood. Nothing about the answer is stored. The engine returns
// codes and numbers; every sentence is a locale string (`paramedic.firstLook.*`), every key literal.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ParamedicDiagnosis, ParamedicLimit } from "../../types";
import { useDates } from "./GamesRoom";

type T = ReturnType<typeof useTranslation>["t"];
type Dates = ReturnType<typeof useDates>;

export type FirstLookSince = "today" | "this-week" | "this-month" | "always" | "dont-know";

export type FirstLookChange = {
  id: string;
  at: string | null;
  precision: "exact" | "day";
  args: Record<string, string>;
  confidence: string;
  evidence: string;
  how: string;
};

export type ParamedicFirstLook = {
  told: { since: FirstLookSince; from: string | null; to: string; hours: number | null };
  changes_listed: boolean;
  touch_games: FirstLookChange[];
  other_changes: FirstLookChange[];
  /** Kinds read completely with nothing in the window: "gpu-driver", "windows-update", "programs". */
  none: string[];
  limits: ParamedicLimit[];
  read_all: boolean;
  method: string;
};

/** The measured answers that leave the user with nothing to look at: the first look takes over from them. */
export function firstLookApplies(d: ParamedicDiagnosis): boolean {
  const s = d.state;
  return s.kind === "needs-more-play" || (s.kind === "cant-tell" && (s.why.kind === "no-sessions" || s.why.kind === "crash-not-covered"));
}

const CHOICES: { since: FirstLookSince }[] = [
  { since: "today" },
  { since: "this-week" },
  { since: "this-month" },
  { since: "always" },
  { since: "dont-know" },
];

function choiceLabel(s: FirstLookSince, t: T): string {
  switch (s) {
    case "today":
      return t("paramedic.firstLook.when.today");
    case "this-week":
      return t("paramedic.firstLook.when.thisWeek");
    case "this-month":
      return t("paramedic.firstLook.when.thisMonth");
    case "always":
      return t("paramedic.firstLook.when.always");
    default:
      return t("paramedic.firstLook.when.dontKnow");
  }
}

/** What the user told Compy, in words, and the window Compy actually read. */
function toldText(a: ParamedicFirstLook, t: T, dates: Dates): string {
  const from = a.told.from ? dates.day(a.told.from) : "";
  switch (a.told.since) {
    case "today":
      return t("paramedic.firstLook.told.today", { from });
    case "this-week":
      return t("paramedic.firstLook.told.thisWeek", { from });
    case "this-month":
      return t("paramedic.firstLook.told.thisMonth", { from });
    case "always":
      return t("paramedic.firstLook.told.always");
    default:
      return t("paramedic.firstLook.told.dontKnow", { from });
  }
}

/** One dated fact. Installs carry a day, never a time of day; every other row names the day and time Windows recorded. */
function changeText(c: FirstLookChange, t: T, dates: Dates): string {
  const a = c.args;
  const when = c.at ? (c.precision === "day" ? dates.day(c.at) : dates.dayTime(c.at)) : "";
  switch (c.id) {
    case "gpu-driver-changed":
      return t("paramedic.firstLook.change.gpuChanged", { from: a.from, to: a.to, when });
    case "gpu-driver-installed":
      return t("paramedic.firstLook.change.gpuInstalled", { to: a.to, when });
    case "gpu-driver-installed-bare":
      return t("paramedic.firstLook.change.gpuInstalledBare", { when });
    case "windows-update":
      return t("paramedic.firstLook.change.windowsUpdate", { kb: a.kb, when });
    case "windows-update-nokb":
      return t("paramedic.firstLook.change.windowsUpdateNoKb", { when });
    case "other-drivers": {
      const count = Number(a.count);
      const classes = a.classes
        .split(", ")
        .map((k) => {
          if (k === "audio") return t("paramedic.driverClass.audio");
          if (k === "network") return t("paramedic.driverClass.network");
          if (k.startsWith("chipset")) return t("paramedic.driverClass.chipset");
          return k;
        })
        .join(", ");
      return t("paramedic.firstLook.change.otherDrivers", { count, classes, when });
    }
    case "programs-installed": {
      const count = Number(a.count);
      const more = Number(a.more);
      if (more > 0) return t("paramedic.firstLook.change.programsMore", { count, names: a.names, more, day: when });
      return t("paramedic.firstLook.change.programs", { count, names: a.names, day: when });
    }
    case "updates-minor":
      return t("paramedic.firstLook.change.updatesMinor", { n: a.n, m: a.m });
    case "updates-unclassified":
      return t("paramedic.firstLook.change.updatesUnclassified", { count: Number(a.n) });
    default:
      return "";
  }
}

/** The one line on how to check or undo it by hand. Compy runs none of them. */
function howText(code: string, t: T): string | null {
  switch (code) {
    case "gpu-driver":
      return t("paramedic.firstLook.how.gpuDriver");
    case "windows-update":
      return t("paramedic.firstLook.how.windowsUpdate");
    case "programs":
      return t("paramedic.firstLook.how.programs");
    case "other-drivers":
      return t("paramedic.firstLook.how.otherDrivers");
    default:
      return null;
  }
}

function limitWhat(kind: ParamedicLimit["kind"], t: T): string {
  switch (kind) {
    case "driver":
      return t("paramedic.firstLook.limit.what.driver");
    case "windows-update":
      return t("paramedic.firstLook.limit.what.windowsUpdate");
    case "programs":
      return t("paramedic.firstLook.limit.what.programs");
    default:
      return t("paramedic.firstLook.limit.what.gameFiles");
  }
}

function limitWhy(l: ParamedicLimit, t: T, dates: Dates): string {
  const from = l.args.from ? dates.day(l.args.from) : "";
  switch (l.code) {
    case "access-denied":
      return t("paramedic.firstLook.limit.why.accessDenied");
    case "log-empty":
      return t("paramedic.firstLook.limit.why.logEmpty");
    case "log-missing":
      return t("paramedic.firstLook.limit.why.logMissing");
    case "read-failed":
      return t("paramedic.firstLook.limit.why.readFailed");
    case "timed-out":
      return t("paramedic.firstLook.limit.why.timedOut");
    case "records-unreadable":
      return t("paramedic.firstLook.limit.why.recordsUnreadable", { n: l.args.n });
    case "registry":
      return t("paramedic.firstLook.limit.why.registry");
    case "not-read":
      return t("paramedic.firstLook.limit.why.notRead");
    case "took-too-long":
      return t("paramedic.firstLook.limit.why.tookTooLong");
    case "reader-failed":
      return t("paramedic.firstLook.limit.why.readerFailed");
    case "partial-timed-out":
      return t("paramedic.firstLook.limit.why.partialTimedOut");
    case "partial-row-cap":
      return t("paramedic.firstLook.limit.why.partialRowCap");
    case "partial-unparsed":
      return t("paramedic.firstLook.limit.why.partialUnparsed", { n: l.args.n });
    case "partial-output-capped":
      return t("paramedic.firstLook.limit.why.partialOutputCapped");
    case "partial-registry":
      return t("paramedic.firstLook.limit.why.partialRegistry", { n: l.args.n });
    case "partial-coverage":
      return t("paramedic.firstLook.limit.why.partialCoverage", { from });
    default:
      return t("paramedic.firstLook.limit.why.other");
  }
}

/** A limit as one sentence. An unread source is "couldn't see", a partly read one "saw only part"; never "nothing changed". */
function limitLine(l: ParamedicLimit, t: T, dates: Dates): string {
  if (l.code === "classes") return t("paramedic.firstLook.limit.classes");
  if (l.code === "no-install-date") return t("paramedic.firstLook.limit.noInstallDate", { n: l.args.n });
  if (l.code === "not-picked") return t("paramedic.firstLook.limit.gameNotPicked");
  const what = limitWhat(l.kind, t);
  const why = limitWhy(l, t, dates);
  return l.code.startsWith("partial-") ? t("paramedic.firstLook.limit.partial", { what, why }) : t("paramedic.firstLook.limit.cantSee", { what, why });
}

function Chevron() {
  return (
    <span aria-hidden="true" className="gl-para-caret">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/** A disclosure: a button with aria-expanded; nothing inside is rendered until it is opened. */
function Fold({ title, testid, defaultOpen = false, children }: { title: string; testid: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="gl-para-fold" data-testid={testid}>
      <button type="button" className="gl-para-fold-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Chevron />
        {title}
      </button>
      {open && (
        <div id={id} className="gl-para-body">
          {children}
        </div>
      )}
    </div>
  );
}

/** Rows of the group that stay open before the rest wait behind one fold. */
const ROWS_OPEN = 3;

function Rows({ rows, t, dates }: { rows: FirstLookChange[]; t: T; dates: Dates }) {
  // The by-hand line is said once per kind of row in a list, under its newest row, not under every row.
  const said = new Set<string>();
  return (
    <ul className="gl-para-lines" data-testid="first-look-rows">
      {rows.map((c, i) => {
        const first = !said.has(c.how);
        said.add(c.how);
        const how = first ? howText(c.how, t) : null;
        return (
          <li key={`${c.id}-${c.at ?? ""}-${i}`}>
            <p>{changeText(c, t, dates)}</p>
            {c.args.via_update === "true" && <p className="gl-para-note">{t("paramedic.firstLook.change.viaUpdate")}</p>}
            {how && <p className="gl-para-note">{how}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function noneLine(code: string, t: T): string | null {
  switch (code) {
    case "gpu-driver":
      return t("paramedic.firstLook.none.gpuDriver");
    case "windows-update":
      return t("paramedic.firstLook.none.windowsUpdate");
    case "programs":
      return t("paramedic.firstLook.none.programs");
    default:
      return null;
  }
}

/** `BUSY`: what the engine answers while another diagnosis or first look is still running ("still checking", never a failure). */
const BUSY = "paramedic-busy";
const BUSY_RETRY_MS = 1200;
const BUSY_RETRIES = 8;

type Step =
  | { kind: "ask"; chosen: FirstLookSince | null }
  | { kind: "busy"; chosen: FirstLookSince }
  | { kind: "still"; chosen: FirstLookSince }
  | { kind: "failed"; chosen: FirstLookSince }
  | { kind: "done"; chosen: FirstLookSince; a: ParamedicFirstLook };

export function ParamedicFirstLook() {
  const { t } = useTranslation();
  const dates = useDates();
  const [step, setStep] = useState<Step>({ kind: "ask", chosen: null });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const headingId = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);
  // Each step's heading takes keyboard focus, so a screen reader starts at the new step.
  useEffect(() => {
    if (step.kind === "ask" || step.kind === "done") headingRef.current?.focus();
  }, [step.kind]);

  const look = (since: FirstLookSince, attempt: number) => {
    setStep({ kind: "busy", chosen: since });
    invoke<ParamedicFirstLook | null>("paramedic_first_look", { game: { kind: "whole-pc" }, since })
      .then((a) => {
        if (alive.current) setStep(a ? { kind: "done", chosen: since, a } : { kind: "failed", chosen: since });
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        if (String(e) !== BUSY) setStep({ kind: "failed", chosen: since });
        else if (attempt < BUSY_RETRIES) timer.current = window.setTimeout(() => look(since, attempt + 1), BUSY_RETRY_MS);
        else setStep({ kind: "still", chosen: since });
      });
  };

  const footer = <p className="gl-para-note">{t("paramedic.firstLook.footer")}</p>;

  if (step.kind !== "done") {
    const busy = step.kind === "busy";
    return (
      <div className="gl-para-body" data-testid="first-look">
        <p>{t("paramedic.firstLook.lead")}</p>
        <div role="group" aria-labelledby={headingId} className="gl-para-lead">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="gl-card-title">
            {t("paramedic.firstLook.when.title")}
          </h2>
          <div className="gl-para-actions">
            {CHOICES.map(({ since }) => (
              <button
                key={since}
                type="button"
                className="gl-ghost"
                aria-pressed={step.chosen === since}
                // Busy: aria-disabled, not disabled, so keyboard focus is not lost; a tap while busy is ignored.
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) look(since, 0);
                }}
              >
                {choiceLabel(since, t)}
              </button>
            ))}
          </div>
        </div>
        {busy && (
          <p className="gl-card-sub" role="status">
            {t("paramedic.firstLook.looking")}
          </p>
        )}
        {step.kind === "still" && (
          <p className="gl-card-sub" role="status">
            {t("paramedic.door.stillChecking")}
          </p>
        )}
        {step.kind === "failed" && (
          <p className="gl-card-sub" role="alert">
            {t("paramedic.door.failed")}
          </p>
        )}
        {footer}
      </div>
    );
  }

  const { a } = step;
  const empty = a.touch_games.length === 0 && a.other_changes.length === 0;
  const open = a.touch_games.slice(0, ROWS_OPEN);
  const rest = a.touch_games.slice(ROWS_OPEN);
  const noneTouch = a.none.filter((n) => n === "gpu-driver" || n === "windows-update");
  const nonePrograms = a.none.includes("programs");
  return (
    <div className="gl-para-body" data-testid="first-look">
      <h2 ref={headingRef} tabIndex={-1} className="gl-card-title">
        {t("paramedic.firstLook.title")}
      </h2>
      <div role="group" aria-label={t("paramedic.firstLook.told.title")}>
        <p>
          <strong>{t("paramedic.firstLook.told.title")}</strong>
        </p>
        <p data-testid="first-look-told">{toldText(a, t, dates)}</p>
      </div>
      {!a.changes_listed && <p data-testid="first-look-always">{t("paramedic.firstLook.alwaysBody")}</p>}
      {a.changes_listed && (
        <>
          {(open.length > 0 || noneTouch.length > 0) && (
            <div role="group" aria-label={t("paramedic.firstLook.group.touch")} data-testid="first-look-touch">
              <p>
                <strong>{t("paramedic.firstLook.group.touch")}</strong>
              </p>
              {open.length > 0 && <Rows rows={open} t={t} dates={dates} />}
              {rest.length > 0 && (
                <Fold title={t("paramedic.firstLook.group.more", { n: rest.length })} testid="first-look-touch-more">
                  <Rows rows={rest} t={t} dates={dates} />
                </Fold>
              )}
              {noneTouch.map((n) => (
                <p key={n} className="gl-para-note">
                  {noneLine(n, t)}
                </p>
              ))}
            </div>
          )}
          {(a.other_changes.length > 0 || nonePrograms) && (
            <Fold title={t("paramedic.firstLook.group.other")} testid="first-look-other">
              {a.other_changes.length > 0 && <Rows rows={a.other_changes} t={t} dates={dates} />}
              {nonePrograms && <p className="gl-para-note">{noneLine("programs", t)}</p>}
            </Fold>
          )}
          {empty && a.read_all && <p data-testid="first-look-nothing">{t("paramedic.firstLook.nothing")}</p>}
          {empty && !a.read_all && <p data-testid="first-look-unread">{t("paramedic.firstLook.unread")}</p>}
          {a.limits.length > 0 && (
            <Fold title={t("paramedic.firstLook.limit.title")} testid="first-look-limits" defaultOpen={empty && !a.read_all}>
              <ul className="gl-para-lines">
                {a.limits.map((l, i) => (
                  <li key={`${l.kind}-${l.code}-${i}`}>{limitLine(l, t, dates)}</li>
                ))}
              </ul>
            </Fold>
          )}
        </>
      )}
      <div role="group" aria-label={t("paramedic.firstLook.cantTell.title")} data-testid="first-look-cant-tell">
        <p>
          <strong>{t("paramedic.firstLook.cantTell.title")}</strong>
        </p>
        <p>{t("paramedic.firstLook.cantTell.body")}</p>
        <p>{t("paramedic.firstLook.cantTell.measure")}</p>
      </div>
      <div>
        <button type="button" className="gl-ghost" onClick={() => setStep({ kind: "ask", chosen: step.chosen })}>
          {t("paramedic.firstLook.changeWhen")}
        </button>
      </div>
      {footer}
    </div>
  );
}
