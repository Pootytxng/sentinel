import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BentoTile } from "../design/bento/BentoGrid";
import { writeLedger } from "../data/ledger-write";
import type { AppliedChange } from "../types";
import {
  clearWebviewTargets,
  failureLine,
  groupDeletes,
  groupKept,
  knownRefusal,
  otherRestartReasons,
  planHasLicence,
  resultKind,
  sizeLabel,
  statusLine,
  undoOrder,
  SCREEN_MEMORY,
  type ClearOutcome,
  type ClearPlan,
  type ClearReport,
  type ClearStatus,
  type FailedDelete,
  type Refusal,
  type Scope,
  type WebviewResult,
} from "./your-data";

// "Your data" (C1 + C2b, design _train/d4-clear-data-design.md 2.1-2.5): clear play history, or everything Compy
// keeps, from Settings. Per choice two backend calls: a plan (a read; deletes nothing) and the clear of exactly
// the files of the plan shown, named by its fingerprint. The screen shows the plan first, asks once more with an
// "I understand" box, and afterwards says exactly what happened, file by file. It never says "deleted" unless the
// backend's report says `complete`.
// "Clear everything" refuses while any change Compy made is still applied (or a Trial runs, or Gaming Mode holds
// changes): the change history is the only way to undo them. The way out it offers is "Undo all first", which
// runs the existing rollback, one change at a time, and never goes on to the clear by itself.
// After "clear everything" the app does not restart itself: it asks the user to close and reopen Compy.

type Phase =
  | { kind: "idle" }
  | { kind: "planning"; scope: Scope }
  | { kind: "plan"; scope: Scope; plan: ClearPlan; changed: boolean }
  | { kind: "refused"; scope: Scope; refusals: Refusal[]; plan: ClearPlan | null }
  | { kind: "clearing"; scope: Scope; plan: ClearPlan }
  | { kind: "done"; scope: Scope; report: ClearReport; webview: WebviewResult | null; ack: "ok" | "failed" | null }
  | { kind: "error"; scope: Scope; detail: string; afterDelete: boolean };

type UndoLine = { title: string; ok: boolean };

const k = (key: string) => `settings.yourData.${key}`;

export function YourData() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [understood, setUnderstood] = useState(false);
  const [removeLicence, setRemoveLicence] = useState(false);
  const [status, setStatus] = useState<ClearStatus | null>(null);
  const [undo, setUndo] = useState<{ running: boolean; lines: UndoLine[] } | null>(null);

  async function readStatus() {
    try {
      setStatus(await invoke<ClearStatus>("get_clear_status"));
    } catch {
      setStatus(null); // the status is extra information; the screen works without it
    }
  }

  useEffect(() => {
    void readStatus();
  }, []);

  async function loadPlan(scope: Scope, changed = false, licence = removeLicence) {
    setPhase({ kind: "planning", scope });
    setUnderstood(false);
    try {
      const plan =
        scope === "everything"
          ? await invoke<ClearPlan>("plan_clear_everything", { removeLicence: licence })
          : await invoke<ClearPlan>("plan_clear_play_history");
      if (plan.refusals.length > 0) setPhase({ kind: "refused", scope, refusals: plan.refusals, plan });
      else setPhase({ kind: "plan", scope, plan, changed });
    } catch (e) {
      setPhase({ kind: "error", scope, detail: String(e), afterDelete: false });
    }
  }

  async function clearIt(scope: Scope, plan: ClearPlan) {
    setPhase({ kind: "clearing", scope, plan });
    let outcome: ClearOutcome;
    try {
      outcome =
        scope === "everything"
          ? await invoke<ClearOutcome>("clear_everything", { fingerprint: plan.fingerprint, removeLicence })
          : await invoke<ClearOutcome>("clear_play_history", { fingerprint: plan.fingerprint });
    } catch (e) {
      // The command may have stopped part way: never claim nothing was deleted.
      setPhase({ kind: "error", scope, detail: String(e), afterDelete: true });
      return;
    }
    if (outcome.status === "refused") {
      setPhase({ kind: "refused", scope, refusals: outcome.detail, plan: null });
    } else if (outcome.status === "plan_changed") {
      await loadPlan(scope, true);
    } else {
      const report = outcome.detail;
      // The window's own copies go only after a complete clear: a stopped or failed run leaves them,
      // and the result says so.
      const webview = report.complete ? clearWebviewTargets(report.webview, window.localStorage, window.sessionStorage) : null;
      let ack: "ok" | "failed" | null = null;
      if (scope === "everything" && webview && webview.stillThere.length === 0) {
        // Everything is gone, the window's notes too: the record of the clear is no longer needed.
        try {
          await invoke("acknowledge_clear");
          ack = "ok";
        } catch {
          ack = "failed";
        }
      }
      setPhase({ kind: "done", scope, report, webview, ack });
      void readStatus();
    }
  }

  async function undoAllFirst() {
    setUndo({ running: true, lines: [] });
    const lines: UndoLine[] = [];
    try {
      const rows = undoOrder(await invoke<AppliedChange[]>("get_applied_changes"));
      for (const row of rows) {
        try {
          await writeLedger("rollback_change", { changeId: row.id });
          lines.push({ title: row.rec_title, ok: true });
          setUndo({ running: true, lines: [...lines] });
        } catch {
          // Stop at the first change that could not be undone: the user decides what happens next.
          lines.push({ title: row.rec_title, ok: false });
          break;
        }
      }
    } catch {
      lines.push({ title: "", ok: false });
    }
    setUndo({ running: false, lines });
  }

  async function dismissStatus() {
    try {
      await invoke("acknowledge_clear");
    } catch {
      // kept: the line stays and says so on the next read
    }
    await readStatus();
  }

  function cancel() {
    setPhase({ kind: "idle" });
    setUnderstood(false);
    setUndo(null);
    // The licence box never carries over to another time the list is opened (C2b review B2).
    setRemoveLicence(false);
  }

  function openEverything() {
    setRemoveLicence(false);
    void loadPlan("everything", false, false);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && phase.kind === "plan") {
      e.preventDefault();
      cancel();
    }
  }

  const line = status ? statusLine(status) : null;
  const busyPlanning = phase.kind === "planning";

  return (
    <BentoTile title={t(k("sectionTitle"))} span="full">
      <div data-testid="your-data" onKeyDown={onKey}>
        <p className="receipts-hint">{t(k("header"))}</p>

        {line && (
          <div data-testid="your-data-status">
            <p className="receipts-hint sev-warn">{t(k(`status.${line.key}`), { code: line.code ?? "" })}</p>
            {line.dismiss && (
              <button className="set-action" onClick={dismissStatus}>
                {t(k("statusDismiss"))}
              </button>
            )}
          </div>
        )}

        {(phase.kind === "idle" || phase.kind === "planning") && (
          <>
            <div className="set-row">
              <div className="set-row-text">
                <div className="set-row-title">{t(k("playHistoryTitle"))}</div>
                <div className="set-row-sub">{t(k("playHistorySub"))}</div>
              </div>
              <button className="set-action" onClick={() => loadPlan("play_history")} disabled={busyPlanning}>
                {busyPlanning && phase.scope === "play_history" ? t(k("reading")) : t(k("playHistoryAction"))}
              </button>
            </div>
            <div className="set-row">
              <div className="set-row-text">
                <div className="set-row-title">{t(k("everythingTitle"))}</div>
                <div className="set-row-sub">{t(k("everythingSub"))}</div>
              </div>
              <button className="set-action" onClick={openEverything} disabled={busyPlanning}>
                {busyPlanning && phase.scope === "everything" ? t(k("reading")) : t(k("everythingAction"))}
              </button>
            </div>
          </>
        )}

        {phase.kind === "refused" && (
          <div data-testid="your-data-refused">
            <p className="receipts-hint sev-warn">{t(k("refusedTitle"))}</p>
            <ul className="receipts-hint">
              {phase.refusals.map((r) => (
                <li key={r.code}>
                  {knownRefusal(r.code) ? t(k(`refusal.${r.code}`)) : t("settings.yourData.refusal.other", { code: r.code })}
                  {r.files.length > 0 && <> {t(k("refusalFiles"), { files: r.files.join(", ") })}</>}
                </li>
              ))}
            </ul>
            {phase.plan && phase.plan.applied_changes.length > 0 && (
              <p className="receipts-hint" data-testid="your-data-applied">
                {t(k("appliedList"), { names: phase.plan.applied_changes.join(", ") })}
              </p>
            )}
            {phase.plan?.offer_undo_all && (
              <div data-testid="your-data-undo">
                <p className="receipts-hint">{t(k("undoAllExplain"))}</p>
                <button className="set-action fb-primary" onClick={undoAllFirst} disabled={undo?.running}>
                  {undo?.running ? t(k("undoing")) : t(k("undoAllAction"))}
                </button>
                {undo && (
                  <ul className="receipts-hint" data-testid="your-data-undo-results">
                    {undo.lines.map((l, i) => (
                      <li key={i}>
                        {l.ok
                          ? t(k("undoDone"), { title: l.title })
                          : l.title
                            ? t(k("undoFailed"), { title: l.title })
                            : t(k("undoReadFailed"))}
                      </li>
                    ))}
                    {!undo.running && <li>{t(k("undoAfter"))}</li>}
                  </ul>
                )}
              </div>
            )}
            <div className="fb-actions">
              <button className="set-action fb-primary" onClick={() => loadPlan(phase.scope)} disabled={undo?.running}>
                {t(k("checkAgain"))}
              </button>
              <button className="set-action" onClick={cancel} disabled={undo?.running}>
                {t(k("close"))}
              </button>
            </div>
          </div>
        )}

        {(phase.kind === "plan" || phase.kind === "clearing") && (
          <ConfirmStep
            scope={phase.scope}
            plan={phase.plan}
            changed={phase.kind === "plan" && phase.changed}
            busy={phase.kind === "clearing"}
            understood={understood}
            setUnderstood={setUnderstood}
            removeLicence={removeLicence}
            onLicence={(v) => {
              setRemoveLicence(v);
              void loadPlan("everything", false, v);
            }}
            onCancel={cancel}
            onConfirm={() => clearIt(phase.scope, phase.plan)}
          />
        )}

        {phase.kind === "done" && (
          <Result scope={phase.scope} report={phase.report} webview={phase.webview} ack={phase.ack} onClose={cancel} />
        )}

        {phase.kind === "error" && (
          <div data-testid="your-data-error">
            <p className="receipts-hint fb-error">
              {t(k(phase.afterDelete ? "errClear" : "errPlan"), { detail: phase.detail })}
            </p>
            <div className="fb-actions">
              <button className="set-action" onClick={() => loadPlan(phase.scope)}>
                {t(k("checkAgain"))}
              </button>
            </div>
          </div>
        )}
      </div>
    </BentoTile>
  );
}

function ConfirmStep(props: {
  scope: Scope;
  plan: ClearPlan;
  changed: boolean;
  busy: boolean;
  understood: boolean;
  setUnderstood: (v: boolean) => void;
  removeLicence: boolean;
  onLicence: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const { scope, plan, changed, busy, understood } = props;
  const everything = scope === "everything";
  const groups = groupDeletes(plan);
  const kept = groupKept(plan.kept);
  const nothing = plan.delete.length === 0;
  const title = t(k(everything ? "everythingConfirmTitle" : "confirmTitle"));
  return (
    <div data-testid="your-data-confirm" role="group" aria-label={title}>
      <p className="set-row-title">{title}</p>
      {changed && <p className="receipts-hint sev-warn">{t(k("planChanged"))}</p>}

      {nothing ? (
        <p className="receipts-hint">{t(k(everything ? "everythingNothing" : "nothingToDelete"))}</p>
      ) : (
        <>
          <p className="receipts-hint">{t(k("willDelete"))}</p>
          <ul className="receipts-hint" data-testid="your-data-delete-list">
            {groups.map((g) => (
              <li key={g.group}>
                {t(k(`store.${g.group}`))}{" "}
                {t(k(g.files.length === 1 ? "filesOne" : "files"), { n: g.files.length, size: sizeLabel(g.bytes) })}
              </li>
            ))}
            {plan.webview.length > 0 && <li>{t(k(everything ? "webviewLineEverything" : "webviewLine"))}</li>}
          </ul>
          {plan.delete.some((d) => d.rel === "drift.json") && <p className="receipts-hint">{t(k("driftNotice"))}</p>}
        </>
      )}

      {everything && planHasLicence(plan) && (
        <label className="receipts-hint" data-testid="your-data-licence">
          <input type="checkbox" checked={props.removeLicence} disabled={busy} onChange={(e) => props.onLicence(e.target.checked)} />{" "}
          {t(k("licenceBox"))}
        </label>
      )}

      <p className="receipts-hint">{t(k("keptTitle"))}</p>
      <ul className="receipts-hint" data-testid="your-data-kept-list">
        {!everything && <li>{t(k("keptChangeHistory"))}</li>}
        {kept
          .filter((g) => g.code !== "change_history")
          .map((g) => (
            <li key={g.code}>
              {g.known ? t(k(`kept.${g.code}`)) : t("settings.yourData.kept.other", { code: g.code })}{" "}
              {t(k("keptFiles"), { files: g.files.join(", ") })}
            </li>
          ))}
        {everything ? <li>{t(k("keptEverything"))}</li> : <li>{t(k("keptReports"))}</li>}
        {plan.unknown.length > 0 && <li>{t(k("unknownFiles"), { files: plan.unknown.join(", ") })}</li>}
        {plan.legacy_folder_present && <li>{t(k("legacyFolder"))}</li>}
      </ul>

      {!nothing && (
        <>
          <p className="receipts-hint">{t(k(everything ? "afterwardsEverything" : "afterwards"))}</p>
          {everything && (
            <ul className="receipts-hint sev-warn" data-testid="your-data-everything-warnings">
              <li>{t(k("warnNoRecord"))}</li>
              <li>{t(k("warnAdminLeftovers"))}</li>
              <li>{t(k("warnFinishAtStart"))}</li>
              {props.removeLicence && <li>{t(k("warnLicence"))}</li>}
            </ul>
          )}
          <p className="receipts-hint sev-warn">{t(k("cantUndo"))}</p>
          <label className="receipts-hint">
            <input
              type="checkbox"
              checked={understood}
              disabled={busy}
              onChange={(e) => props.setUnderstood(e.target.checked)}
            />{" "}
            {t(k("understand"))}
          </label>
        </>
      )}
      <div className="fb-actions">
        <button className="set-action fb-primary" onClick={props.onCancel} disabled={busy} autoFocus>
          {t(k("cancel"))}
        </button>
        {!nothing && (
          <button className="set-action" onClick={props.onConfirm} disabled={busy || !understood}>
            {busy ? t(k("deleting")) : t(k(everything ? "everythingDeleteAction" : "deleteAction"))}
          </button>
        )}
      </div>
    </div>
  );
}

function Result({
  scope,
  report,
  webview,
  ack,
  onClose,
}: {
  scope: Scope;
  report: ClearReport;
  webview: WebviewResult | null;
  ack: "ok" | "failed" | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const everything = scope === "everything";
  const kind = resultKind(report);
  // Only files this run deleted count as deleted (C1 review B1); files already gone are said separately.
  const n = report.deleted.length;
  const m = report.already_gone.length;
  const others = otherRestartReasons(report);
  // Play history: a window reload is enough. Everything: the app asks to be closed and reopened (no relaunch).
  const showReload = !everything && report.complete && report.restart_reasons.includes(SCREEN_MEMORY);
  const showReopen = everything && report.complete;
  return (
    <div data-testid="your-data-result">
      <p className={`receipts-hint ${kind === "deleted" || kind === "nothing" || kind === "all_gone" ? "sev-notice" : "sev-warn"}`}>
        {kind === "nothing" && t(k("resultNothing"))}
        {kind === "all_gone" && t(k("resultAllGone"))}
        {kind === "deleted" && t(k(n === 1 ? "resultDeletedOne" : "resultDeleted"), { n })}
        {kind === "stopped" &&
          t(k("resultStopped"), { n, left: report.not_attempted.length })}
        {kind === "not_finished" &&
          t(k("resultNotFinished"), { n, failed: report.failed.length, left: report.not_attempted.length })}
      </p>
      {m > 0 && kind !== "all_gone" && <p className="receipts-hint">{t(k("alreadyGoneCount"), { m })}</p>}
      {report.stopped.length > 0 && (
        <ul className="receipts-hint">
          {report.stopped.map((r) => (
            <li key={r.code}>
              {knownRefusal(r.code) ? t(k(`refusal.${r.code}`)) : t("settings.yourData.refusal.other", { code: r.code })}
            </li>
          ))}
        </ul>
      )}
      <ul className="receipts-hint" data-testid="your-data-files">
        {report.deleted.map((f) => (
          <li key={`d-${f}`}>{t(k("fileDeleted"), { file: f })}</li>
        ))}
        {report.already_gone.map((f) => (
          <li key={`g-${f}`}>{t(k("fileAlreadyGone"), { file: f })}</li>
        ))}
        {report.failed.map((f) => (
          <li key={`f-${f.rel}`}>
            <FailedLine f={f} />
          </li>
        ))}
        {report.not_attempted.map((f) => (
          <li key={`n-${f}`}>{t(k("fileNotTried"), { file: f })}</li>
        ))}
      </ul>
      {webview && webview.stillThere.length === 0 && webview.removed.length > 0 && (
        <p className="receipts-hint">{t(k("webviewCleared"), { n: webview.removed.length })}</p>
      )}
      {webview && webview.stillThere.length > 0 && (
        <p className="receipts-hint sev-warn">{t(k("webviewLeft"), { keys: webview.stillThere.join(", ") })}</p>
      )}
      {!report.complete && <p className="receipts-hint">{t(k("webviewNotTouched"))}</p>}
      {everything && !report.complete && (
        <p className="receipts-hint sev-warn">{t(k(report.record_not_updated ? "recordNotUpdated" : "everythingNotFinished"))}</p>
      )}
      {everything && report.complete && report.record_not_advanced ? (
        <p className="receipts-hint sev-warn">{t(k("recordNotAdvanced"))}</p>
      ) : (
        ack === "failed" && <p className="receipts-hint sev-warn">{t(k("ackFailed"))}</p>
      )}
      {report.deleted.some((f) => f.startsWith("care/")) && <p className="receipts-hint">{t(k("crashNotesReturn"))}</p>}
      {showReload && (
        <div data-testid="your-data-reload">
          <p className="receipts-hint">{t(k("reloadNotice"))}</p>
          <button className="set-action fb-primary" onClick={() => window.location.reload()}>
            {t(k("reloadAction"))}
          </button>
        </div>
      )}
      {showReopen && (
        <div data-testid="your-data-reopen">
          <p className="receipts-hint sev-notice">{t(k("reopenNotice"))}</p>
          <p className="receipts-hint">{t(k("keptEverything"))}</p>
        </div>
      )}
      {others.length > 0 && <p className="receipts-hint sev-warn">{t(k("restartOther"), { codes: others.join(", ") })}</p>}
      <div className="fb-actions">
        <button className="set-action" onClick={onClose}>
          {t(k("close"))}
        </button>
      </div>
    </div>
  );
}

/** "Could not delete" in the screen's own words (your-data.ts `failureLine`): the backend's English never shows. */
function FailedLine({ f }: { f: FailedDelete }) {
  const { t } = useTranslation();
  const line = failureLine(f);
  return <>{t(k(line.key), line.opts)}</>;
}

export default YourData;
