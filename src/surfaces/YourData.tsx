import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BentoTile } from "../design/bento/BentoGrid";
import {
  clearWebviewTargets,
  failureLine,
  groupDeletes,
  groupKept,
  knownRefusal,
  otherRestartReasons,
  resultKind,
  sizeLabel,
  SCREEN_MEMORY,
  type ClearOutcome,
  type ClearPlan,
  type ClearReport,
  type FailedDelete,
  type Refusal,
  type WebviewResult,
} from "./your-data";

// "Your data" (C1, design _train/d4-clear-data-design.md 2.1-2.5): clear play history from Settings.
// Two backend calls only: `plan_clear_play_history` (a read; deletes nothing) and
// `clear_play_history(fingerprint)` (deletes exactly the files of the plan shown, or nothing). The screen
// shows the plan first, asks once more with an "I understand" box, and afterwards says exactly what
// happened, file by file. It never says "deleted" unless the backend's report says `complete`.
// "Clear everything" is slice C2 and is not offered here yet.

type Phase =
  | { kind: "idle" }
  | { kind: "planning" }
  | { kind: "plan"; plan: ClearPlan; changed: boolean }
  | { kind: "refused"; refusals: Refusal[] }
  | { kind: "clearing"; plan: ClearPlan }
  | { kind: "done"; report: ClearReport; webview: WebviewResult | null }
  | { kind: "error"; detail: string; afterDelete: boolean };

const k = (key: string) => `settings.yourData.${key}`;

export function YourData() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [understood, setUnderstood] = useState(false);

  async function loadPlan(changed = false) {
    setPhase({ kind: "planning" });
    setUnderstood(false);
    try {
      const plan = await invoke<ClearPlan>("plan_clear_play_history");
      if (plan.refusals.length > 0) setPhase({ kind: "refused", refusals: plan.refusals });
      else setPhase({ kind: "plan", plan, changed });
    } catch (e) {
      setPhase({ kind: "error", detail: String(e), afterDelete: false });
    }
  }

  async function clearIt(plan: ClearPlan) {
    setPhase({ kind: "clearing", plan });
    let outcome: ClearOutcome;
    try {
      outcome = await invoke<ClearOutcome>("clear_play_history", { fingerprint: plan.fingerprint });
    } catch (e) {
      // The command may have stopped part way: never claim nothing was deleted.
      setPhase({ kind: "error", detail: String(e), afterDelete: true });
      return;
    }
    if (outcome.status === "refused") {
      setPhase({ kind: "refused", refusals: outcome.detail });
    } else if (outcome.status === "plan_changed") {
      await loadPlan(true);
    } else {
      const report = outcome.detail;
      // The window's own copies go only after a complete clear: a stopped or failed run leaves them,
      // and the result says so.
      const webview = report.complete ? clearWebviewTargets(report.webview, window.localStorage, window.sessionStorage) : null;
      setPhase({ kind: "done", report, webview });
    }
  }

  function cancel() {
    setPhase({ kind: "idle" });
    setUnderstood(false);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && phase.kind === "plan") {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <BentoTile title={t(k("sectionTitle"))} span="full">
      <div data-testid="your-data" onKeyDown={onKey}>
        <p className="receipts-hint">{t(k("header"))}</p>

        {(phase.kind === "idle" || phase.kind === "planning") && (
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t(k("playHistoryTitle"))}</div>
              <div className="set-row-sub">{t(k("playHistorySub"))}</div>
            </div>
            <button className="set-action" onClick={() => loadPlan()} disabled={phase.kind === "planning"}>
              {phase.kind === "planning" ? t(k("reading")) : t(k("playHistoryAction"))}
            </button>
          </div>
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
            <div className="fb-actions">
              <button className="set-action fb-primary" onClick={() => loadPlan()}>
                {t(k("checkAgain"))}
              </button>
              <button className="set-action" onClick={cancel}>
                {t(k("close"))}
              </button>
            </div>
          </div>
        )}

        {(phase.kind === "plan" || phase.kind === "clearing") && (
          <ConfirmStep
            plan={phase.plan}
            changed={phase.kind === "plan" && phase.changed}
            busy={phase.kind === "clearing"}
            understood={understood}
            setUnderstood={setUnderstood}
            onCancel={cancel}
            onConfirm={() => clearIt(phase.plan)}
          />
        )}

        {phase.kind === "done" && <Result report={phase.report} webview={phase.webview} onClose={cancel} />}

        {phase.kind === "error" && (
          <div data-testid="your-data-error">
            <p className="receipts-hint fb-error">
              {t(k(phase.afterDelete ? "errClear" : "errPlan"), { detail: phase.detail })}
            </p>
            <div className="fb-actions">
              <button className="set-action" onClick={() => loadPlan()}>
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
  plan: ClearPlan;
  changed: boolean;
  busy: boolean;
  understood: boolean;
  setUnderstood: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const { plan, changed, busy, understood } = props;
  const groups = groupDeletes(plan);
  const kept = groupKept(plan.kept);
  const nothing = plan.delete.length === 0;
  return (
    <div data-testid="your-data-confirm" role="group" aria-label={t(k("confirmTitle"))}>
      <p className="set-row-title">{t(k("confirmTitle"))}</p>
      {changed && <p className="receipts-hint sev-warn">{t(k("planChanged"))}</p>}

      {nothing ? (
        <p className="receipts-hint">{t(k("nothingToDelete"))}</p>
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
            {plan.webview.length > 0 && <li>{t(k("webviewLine"))}</li>}
          </ul>
          {plan.delete.some((d) => d.rel === "drift.json") && <p className="receipts-hint">{t(k("driftNotice"))}</p>}
        </>
      )}

      <p className="receipts-hint">{t(k("keptTitle"))}</p>
      <ul className="receipts-hint" data-testid="your-data-kept-list">
        <li>{t(k("keptChangeHistory"))}</li>
        {kept
          .filter((g) => g.code !== "change_history")
          .map((g) => (
            <li key={g.code}>
              {g.known ? t(k(`kept.${g.code}`)) : t("settings.yourData.kept.other", { code: g.code })}{" "}
              {t(k("keptFiles"), { files: g.files.join(", ") })}
            </li>
          ))}
        <li>{t(k("keptReports"))}</li>
        {plan.unknown.length > 0 && <li>{t(k("unknownFiles"), { files: plan.unknown.join(", ") })}</li>}
        {plan.legacy_folder_present && <li>{t(k("legacyFolder"))}</li>}
      </ul>

      {!nothing && (
        <>
          <p className="receipts-hint">{t(k("afterwards"))}</p>
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
            {busy ? t(k("deleting")) : t(k("deleteAction"))}
          </button>
        )}
      </div>
    </div>
  );
}

function Result({ report, webview, onClose }: { report: ClearReport; webview: WebviewResult | null; onClose: () => void }) {
  const { t } = useTranslation();
  const kind = resultKind(report);
  // Only files this run deleted count as deleted (C1 review B1); files already gone are said separately.
  const n = report.deleted.length;
  const m = report.already_gone.length;
  const others = otherRestartReasons(report);
  const showReload = report.complete && report.restart_reasons.includes(SCREEN_MEMORY);
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
      {report.deleted.some((f) => f.startsWith("care/")) && <p className="receipts-hint">{t(k("crashNotesReturn"))}</p>}
      {showReload && (
        <div data-testid="your-data-reload">
          <p className="receipts-hint">{t(k("reloadNotice"))}</p>
          <button className="set-action fb-primary" onClick={() => window.location.reload()}>
            {t(k("reloadAction"))}
          </button>
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
