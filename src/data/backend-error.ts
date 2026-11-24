// D2b: backend sentences that must be shown in the user's language. Rust returns these exact English
// sentences (consts in src-tauri/src/actions.rs, recommendations.rs and gaming_orchestrator.rs); this file maps each one to an
// i18n key. `backend-error.test.ts` pins every entry byte-equal to its Rust const, so a reworded Rust
// sentence fails the gate instead of silently falling back to English.
//
// Matching is "contains the whole sentence", not "starts with": a caller may wrap the error (a batch
// item, a rollback prefix), and every sentence here is long and specific enough not to occur by chance.
// An error that carries none of them returns null, and the caller keeps its own message (D3 will add a
// marked English fallback for the rest).
import type { TFunction } from "i18next";

/** English sentence (byte-equal to the Rust const named) → i18n key. */
export const BACKEND_SENTENCES: ReadonlyArray<{ rust: string; text: string; key: string }> = [
  {
    rust: "TASK_UNREADABLE_APPLY",
    text: "Compy couldn't check this Windows task right now (the check couldn't run or Windows didn't answer in time), so nothing was changed. Try again in a moment.",
    key: "app.backendErrors.taskUnreadable",
  },
  {
    rust: "TASK_NOT_FOUND_APPLY",
    text: "That telemetry task isn't on this PC, so there is nothing to turn off.",
    key: "app.backendErrors.taskNotFound",
  },
  {
    rust: "TASK_UNREADABLE_UNDO",
    text: "Compy couldn't check this Windows task right now, so it wasn't turned back on yet. The change stays in your Trust Ledger so you can try again.",
    key: "app.backendErrors.taskUnreadableUndo",
  },
  {
    rust: "TASK_NOT_FOUND_UNDO",
    text: "Compy couldn't find that telemetry task on this PC any more, so it couldn't turn it back on. The change stays in your Trust Ledger.",
    key: "app.backendErrors.taskNotFoundUndo",
  },
  {
    rust: "TASK_NAME_REFUSED",
    text: "Compy found that telemetry task, but its name has characters Compy won't put into a Windows command, so nothing was changed.",
    key: "app.backendErrors.taskNameRefused",
  },
  {
    rust: "TASK_NAME_REFUSED_UNDO",
    text: "Compy found that telemetry task, but its name has characters Compy won't put into a Windows command, so it wasn't turned back on. The change stays in your Trust Ledger.",
    key: "app.backendErrors.taskNameRefusedUndo",
  },
  {
    rust: "EEE_UNREADABLE_APPLY",
    text: "Compy couldn't read your network adapters right now (the check couldn't run or Windows didn't answer in time), so nothing was changed. Try again in a moment.",
    key: "app.backendErrors.eeeUnreadable",
  },
  {
    rust: "EEE_NO_ADAPTER_APPLY",
    text: "No connected wired network adapter on this PC offers an Energy-Efficient Ethernet setting, so there is nothing to change.",
    key: "app.backendErrors.eeeNoAdapter",
  },
  {
    rust: "EEE_NO_SWITCH_APPLY",
    text: "Your adapter's driver has an Energy-Efficient Ethernet setting, but no value Compy recognizes as off, so Compy left it as it is rather than guess.",
    key: "app.backendErrors.eeeNoSwitch",
  },
  {
    rust: "EEE_UNREAD_REASON",
    text: "Couldn't check Energy-Efficient Ethernet on your wired adapter right now.",
    key: "app.backendErrors.eeeUnreadReason",
  },
  // D4: the all-HDD gate's reason when the drive list came back empty (never "this rig has an SSD").
  {
    rust: "DRIVES_UNREAD_REASON",
    text: "Only for HDD-only systems — Compy couldn't list this rig's drives.",
    key: "app.backendErrors.drivesUnreadReason",
  },
  // A6: an EEE value Compy won't put into a Windows command (a control character) refuses before any prompt.
  {
    rust: "EEE_VALUE_REFUSED_APPLY",
    text: "Compy found your adapter's Energy-Efficient Ethernet setting, but its details contain characters Compy won't put into a Windows command, so nothing was changed.",
    key: "app.backendErrors.eeeValueRefused",
  },
  {
    rust: "EEE_VALUE_REFUSED_UNDO",
    text: "Compy found this change's saved adapter details, but they contain characters Compy won't put into a Windows command, so it didn't run the undo. The change stays in your Trust Ledger.",
    key: "app.backendErrors.eeeValueRefusedUndo",
  },
  // B11: the same-setting refusals of an apply (or a batch) while a Trial tests, or the benchmark measures, that
  // setting (experiment::held_by_trial_refusal, benchmark_trial::bench_held_refusal). Fixed, title-free consts in
  // experiment.rs and benchmark_trial.rs; each refuses before anything runs.
  {
    rust: "TRIAL_HOLDS_SETTING_REFUSAL",
    text: "A setting this action changes is being measured by a Trial right now, so Compy won't run it during the Trial. Let the Trial finish, or end it with Restore now in Test, first. Nothing was changed.",
    key: "app.backendErrors.trialHoldsSetting",
  },
  {
    rust: "TRIAL_START_INTERRUPTED_REFUSAL",
    text: "An earlier Trial start of a setting this action changes was interrupted and isn't resolved yet, so Compy won't run it now. Check Test → Applied & history, then try again. Nothing was changed.",
    key: "app.backendErrors.trialStartInterrupted",
  },
  {
    rust: "BENCH_HOLDS_SETTING_REFUSAL",
    text: "A setting this action changes is being measured by the benchmark right now, so Compy won't run it on top of the measurement. Wait until the benchmark finishes and puts its change back, or cancel it. Nothing was changed.",
    key: "app.backendErrors.benchHoldsSetting",
  },
  // B11 r2: a Trial start refused because other Compy changes can't be confirmed in place
  // (experiment::unverified_start_refusal; one fixed sentence, the count dropped). Written after
  // "experiment not started — " by start_experiment and the journey's precheck.
  {
    rust: "UNVERIFIED_OTHERS_START_REFUSAL",
    text: "One or more other settings Compy changed earlier can't be confirmed as still in place, so a Trial couldn't show that its result is this setting's alone. Undo them in Test → Applied & history, then start the Trial again.",
    key: "app.backendErrors.unverifiedOthersStart",
  },
  // B11 (r2): the fixed reasons a Trial start/conclude/abort/restore and the benchmark's rollback report, so
  // ExperimentBench/Benchmark show each one in the user's language instead of raw backend text. Consts in
  // experiment.rs and benchmark_trial.rs; any detail after a sentence (an OS error) stays in the console.
  {
    rust: "BASELINE_MISSING",
    text: "The baseline session isn't in your session history any more. Play a monitored session, then try again.",
    key: "app.backendErrors.baselineMissing",
  },
  {
    rust: "BASELINE_AMBIGUOUS",
    text: "Two sessions in your history share that baseline's start time, so Compy can't tell which one to use.",
    key: "app.backendErrors.baselineAmbiguous",
  },
  {
    rust: "BASELINE_BEHIND",
    text: "The baseline session measured nothing: another window was in front the whole time. Play a session with the game in front, then try again.",
    key: "app.backendErrors.baselineBehind",
  },
  {
    rust: "BASELINE_NO_READING",
    text: "The baseline session has no frame-rate reading, so there's nothing to compare the change against.",
    key: "app.backendErrors.baselineNoReading",
  },
  {
    rust: "BASELINE_NO_GAME",
    text: "The baseline session didn't record which game was running, so there's no game to measure the change in.",
    key: "app.backendErrors.baselineNoGame",
  },
  {
    rust: "TREATMENT_NO_BASELINE_REF",
    text: "This Trial was started before Compy kept a reference to its baseline session, so the before and after can't be checked. Restore it and start a new one.",
    key: "app.backendErrors.treatmentNoBaselineRef",
  },
  {
    rust: "TREATMENT_IS_BASELINE",
    text: "The session picked as the after-reading is the baseline itself.",
    key: "app.backendErrors.treatmentIsBaseline",
  },
  {
    rust: "TREATMENT_BASELINE_GONE",
    text: "The baseline session is no longer in your session history, so the before and after can't be checked. Restore the Trial and start a new one.",
    key: "app.backendErrors.treatmentBaselineGone",
  },
  {
    rust: "TREATMENT_MISSING",
    text: "That session isn't in your session history. Play a monitored session of this game, then conclude.",
    key: "app.backendErrors.treatmentMissing",
  },
  {
    rust: "TREATMENT_AMBIGUOUS",
    text: "Two sessions in your history share that start time, so Compy can't tell which one to judge.",
    key: "app.backendErrors.treatmentAmbiguous",
  },
  {
    rust: "TREATMENT_BEHIND",
    text: "That session measured nothing: another window was in front the whole time. Play a session of this game with the game in front, then conclude.",
    key: "app.backendErrors.treatmentBehind",
  },
  {
    rust: "TREATMENT_NO_READING",
    text: "That session has no frame-rate reading to judge.",
    key: "app.backendErrors.treatmentNoReading",
  },
  {
    rust: "TREATMENT_NO_GAME",
    text: "That session didn't record which game was running, so Compy can't confirm it measured this game.",
    key: "app.backendErrors.treatmentNoGame",
  },
  {
    rust: "TREATMENT_NO_APPLY_TIME",
    text: "This Trial didn't record when its change took effect, so no session can be shown to have been played after it. Restore it and start a new one.",
    key: "app.backendErrors.treatmentNoApplyTime",
  },
  {
    rust: "TREATMENT_CANT_TELL_AFTER",
    text: "Compy can't tell whether that session was played after the change was applied, so it can't be the after-reading.",
    key: "app.backendErrors.treatmentCantTellAfter",
  },
  {
    rust: "TREATMENT_PLAYED_BEFORE",
    text: "That session was played before the change was applied, so it can't measure it. Play a new session of this game, then conclude.",
    key: "app.backendErrors.treatmentPlayedBefore",
  },
  {
    rust: "TREATMENT_NOT_COMPARABLE",
    text: "The two sessions aren't comparable: a recorded condition differs between them. Play a session of this game under the same conditions as the baseline, or restore the Trial.",
    key: "app.backendErrors.treatmentNotComparable",
  },
  // B11 r1 F5: the condition that differs, from comparability::derive's NotComparable reasons (comparability.rs),
  // written in ( ) after TREATMENT_NOT_COMPARABLE and shown after it by backendMessages.
  {
    rust: "DIFFERENT_GAMES_REASON",
    text: "These are different games, and Compy compares a game only against itself.",
    key: "app.backendErrors.differentGames",
  },
  {
    rust: "DIFFERENT_GPUS_REASON",
    text: "These sessions ran on different GPUs — that's not an apples-to-apples comparison.",
    key: "app.backendErrors.differentGpus",
  },
  {
    rust: "NO_COMMON_METRIC_REASON",
    text: "These sessions were captured by different methods with no metric in common — there's nothing that can be compared directly.",
    key: "app.backendErrors.noCommonMetric",
  },
  {
    rust: "TREATMENT_COMPARABILITY_UNKNOWN",
    text: "The two sessions don't share any recorded rig or conditions, so Compy can't check they're comparable. Restore the Trial and start a new one.",
    key: "app.backendErrors.treatmentComparabilityUnknown",
  },
  {
    rust: "ABORT_NOT_CHANGED",
    text: "The setting did not read as changed after the apply, so there was nothing to measure.",
    key: "app.backendErrors.abortNotChanged",
  },
  {
    rust: "ABORT_UNREADABLE",
    text: "Compy could not read the setting back after the apply, so it can't show the change took effect.",
    key: "app.backendErrors.abortUnreadable",
  },
  {
    rust: "TRIAL_RECORD_NOT_SAVED",
    text: "Compy could not save this Trial's record.",
    key: "app.backendErrors.trialRecordNotSaved",
  },
  {
    rust: "ABORT_RESTORED",
    text: "Compy stopped this Trial before measuring and put the change back.",
    key: "app.backendErrors.abortRestored",
  },
  {
    rust: "ABORT_ALREADY_REVERTED",
    text: "Compy stopped this Trial before measuring; its change history already showed the change as undone, so there was nothing to put back.",
    key: "app.backendErrors.abortAlreadyReverted",
  },
  {
    rust: "RESTORE_NOT_COMPLETED",
    text: "Compy tried to put the change back, but the restore did not complete, so Compy can't confirm the change was undone. Check it in Test → Applied & history and undo it there.",
    key: "app.backendErrors.restoreNotCompleted",
  },
  {
    rust: "RESTORED_STILL_READS_CHANGED",
    text: "Compy put the change back, but a read afterwards still shows the setting as changed. Check it in Test → Applied & history.",
    key: "app.backendErrors.restoredStillReadsChanged",
  },
  {
    rust: "ALREADY_UNDONE_READS_CHANGED",
    text: "The change history already showed the change as undone, but a read now shows the setting as changed. Check it in Test → Applied & history.",
    key: "app.backendErrors.alreadyUndoneReadsChanged",
  },
  {
    rust: "APPLY_ERR_READS_UNCHANGED",
    text: "The apply reported an error. The setting reads as not changed, but a change that stopped part-way can read that way too, and Compy saved no undo record for it. If it looks changed in Windows, set it back there.",
    key: "app.backendErrors.applyErrReadsUnchanged",
  },
  {
    rust: "APPLY_ERR_READS_CHANGED",
    text: "The apply reported an error, and the setting now reads as changed. Compy saved no undo record for it, so it can't undo it and it won't be listed in Test → Applied & history. Set it back in Windows.",
    key: "app.backendErrors.applyErrReadsChanged",
  },
  {
    rust: "APPLY_ERR_UNREADABLE",
    text: "The apply reported an error, and Compy can't read the setting to tell whether it changed. Compy saved no undo record for it. Check the setting in Windows.",
    key: "app.backendErrors.applyErrUnreadable",
  },
  {
    rust: "BENCH_ROLLED_BACK_UNRECORDED",
    text: "Measurement finished and the change was rolled back, but Compy couldn't save that undo to its history, so Test → Applied & history may still list the change as applied.",
    key: "app.backendErrors.benchRolledBackUnrecorded",
  },
  {
    rust: "BENCH_ROLLBACK_FAILED",
    text: "Measurement finished, but Compy tried to roll the change back and the rollback failed, so Compy can't confirm it was undone. Check it in Test → Applied & history and undo it there.",
    key: "app.backendErrors.benchRollbackFailed",
  },
  {
    rust: "BENCH_STACK_ROLLBACK_FAILED",
    text: "Measurement finished, but Compy tried to roll the changes back and one or more rollbacks failed, so Compy can't confirm they were all undone. Check them in Test → Applied & history and undo them there.",
    key: "app.backendErrors.benchStackRollbackFailed",
  },
  {
    rust: "BENCH_STACK_ROLLED_BACK_UNRECORDED",
    text: "The changes were measured and rolled back, but Compy couldn't save some of those undos to its history, so Test → Applied & history may still list them as applied.",
    key: "app.backendErrors.benchStackRolledBackUnrecorded",
  },
  {
    rust: "BENCH_LEDGER_UNREAD_BEFORE",
    text: "Compy couldn't read its change history before measuring, so it changed nothing. Try again when it can be read.",
    key: "app.backendErrors.benchLedgerUnreadBefore",
  },
  {
    rust: "BENCH_LEDGER_UNREAD_AFTER",
    text: "Compy ran the apply, but couldn't re-read its change history to roll back what it applied automatically. Check Test → Applied & history and undo anything this run applied.",
    key: "app.backendErrors.benchLedgerUnreadAfter",
  },
  // A7: the two power GUID refusals (fixed words, never the saved value).
  {
    rust: "POWER_SETTING_ID_REFUSED",
    text: "This change's saved power plan setting isn't in the form Compy expects, so Compy didn't run the undo. The change stays in your Trust Ledger.",
    key: "app.backendErrors.powerSettingIdRefused",
  },
  {
    rust: "POWER_PLAN_ID_REFUSED_UNDO",
    text: "This change's saved power plan isn't in the form Compy expects, so Compy didn't switch back to it. The change stays in your Trust Ledger.",
    key: "app.backendErrors.powerPlanIdRefusedUndo",
  },
  // A9 (owner decision): the ONE fixed sentence for an undo whose stored record fails the closed elevated set's
  // stricter checks (actions::run_elevated_undo_op). Nothing ran; the row stays listed.
  {
    rust: "STORED_RECORD_REFUSED_UNDO",
    text: "Compy couldn't use this change's saved details for an administrator step, so it didn't run the undo. The change stays in your Trust Ledger.",
    key: "app.backendErrors.storedRecordRefusedUndo",
  },
  // C6: the fixed refusals an undo meets in front of the audited one (experiment::rollback_change →
  // gaming_orchestrator::plain_change_gate), so a stopped undo walk can say why in the user's language.
  // Consts in gaming_orchestrator.rs. C8: the Trial/benchmark plan-class refusal is now three fixed sentences
  // (experiment.rs PLAN_CLASS_*), mapped below; it no longer carries the setting's title.
  {
    rust: "SESSION_OP_BUSY_REFUSAL",
    text: "Compy is still finishing another change or a Gaming Mode start (if a Windows permission prompt is open, answer or cancel it) — give it a second and try again",
    key: "app.backendErrors.gmBusy",
  },
  {
    rust: "GM_HOLDS_SETTING_REFUSAL",
    text: "Gaming Mode is on and holds this setting for its session, and puts it back when it stops. Stop Gaming Mode first. Nothing was changed.",
    key: "app.backendErrors.gmHoldsSetting",
  },
  {
    rust: "GM_HOLDS_PLAN_REFUSAL",
    text: "Gaming Mode is on and has switched your power plan for its session, and this setting belongs to the power plan. Stop Gaming Mode first, then change it. Nothing was changed.",
    key: "app.backendErrors.gmHoldsPlan",
  },
  {
    rust: "GM_LEFTOVER_HOLDS_PLAN_REFUSAL",
    text: "A Gaming Mode session that didn't finish putting its changes back still holds your power plan, and this setting belongs to the power plan. Finish that session first in Gaming Mode (\"Finish the last Gaming Mode session\"). Nothing was changed.",
    key: "app.backendErrors.gmLeftoverHoldsPlan",
  },
  {
    rust: "GM_LEFTOVER_HOLDS_SETTING_REFUSAL",
    text: "A Gaming Mode session that didn't finish putting its changes back holds this setting, and puts it back when it's finished. Finish it first in Gaming Mode (\"Finish the last Gaming Mode session\"). Nothing was changed.",
    key: "app.backendErrors.gmLeftoverHoldsSetting",
  },
  {
    rust: "RESTORE_IN_FLIGHT_REFUSAL",
    text: "Gaming Mode is putting its changes back right now (if a Windows permission prompt is open, answer or cancel it). Try again when it has finished. Nothing was changed.",
    key: "app.backendErrors.gmRestoreInFlight",
  },
  // C8: an apply, undo or restore in the power-plan class while a Trial or the benchmark measures the other
  // half (experiment::plan_class_hold_check / held_by_trial_refusal / benchmark_trial::bench_held_refusal).
  // Consts in experiment.rs. Each refuses before anything runs; an undo walk shows the reason only when no
  // record was undone in the run (C6 F3), so "Nothing was changed." is never said after one was.
  {
    rust: "PLAN_CLASS_TRIAL_REFUSAL",
    text: "The power plan or one of its settings is being measured by a Trial right now, and this action writes to the same power plan, so Compy won't run it during the measurement. Let the Trial finish, or end it with Restore now in Test, first. Nothing was changed.",
    key: "app.backendErrors.planTrialMeasuring",
  },
  {
    rust: "PLAN_CLASS_BENCH_REFUSAL",
    text: "The power plan or one of its settings is being measured by the benchmark right now, and this action writes to the same power plan, so Compy won't run it during the measurement. Let it finish, or cancel it, first. Nothing was changed.",
    key: "app.backendErrors.planBenchMeasuring",
  },
  {
    rust: "PLAN_CLASS_INTERRUPTED_REFUSAL",
    text: "An earlier Trial start on the power plan or one of its settings was interrupted and isn't resolved yet. This action writes to the same power plan, so Compy won't run it now. Check Test → Applied & history, then try again. Nothing was changed.",
    key: "app.backendErrors.planTrialInterrupted",
  },
  // D7: the Benchmark card's remaining fixed errors (benchmark_trial.rs BENCH_*_NO_FRAMES / BENCH_STACK_NOTHING_*,
  // benchmark.rs BENCH_RUN_CANCELLED). They reached a zh-CN screen in English; now each has an en + zh key.
  {
    rust: "BENCH_CALIBRATION_NO_FRAMES",
    text: "Couldn't collect enough game frames. Turn on FPS monitoring with a game running.",
    key: "app.backendErrors.benchCalibrationNoFrames",
  },
  {
    rust: "BENCH_BASELINE_NO_FRAMES",
    text: "Couldn't collect baseline frames. Turn on FPS monitoring with a game running.",
    key: "app.backendErrors.benchBaselineNoFrames",
  },
  {
    rust: "BENCH_CHANGE_ON_NO_FRAMES",
    text: "Couldn't collect frames with the change on.",
    key: "app.backendErrors.benchChangeOnNoFrames",
  },
  {
    rust: "BENCH_STACK_ON_NO_FRAMES",
    text: "Couldn't collect frames with the stack on.",
    key: "app.backendErrors.benchStackOnNoFrames",
  },
  {
    rust: "BENCH_STACK_NOTHING_APPLIABLE",
    text: "No appliable starter tweaks to measure as a stack.",
    key: "app.backendErrors.benchStackNothingAppliable",
  },
  {
    rust: "BENCH_STACK_NOTHING_APPLIED",
    text: "The stack didn't apply — nothing was changed, so there's nothing to measure.",
    key: "app.backendErrors.benchStackNothingApplied",
  },
  {
    rust: "BENCH_RUN_CANCELLED",
    text: "Run cancelled.",
    key: "app.backendErrors.benchRunCancelled",
  },
];

/** The i18n key for a backend error/reason that carries one of the sentences above, else null. */
export function backendSentenceKey(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  const text = String(err);
  return BACKEND_SENTENCES.find((s) => text.includes(s.text))?.key ?? null;
}

/** The sentence in the user's language when `err` carries a known one, else null (caller decides). */
export function backendMessage(err: unknown, t: TFunction): string | null {
  const key = backendSentenceKey(err);
  return key ? t(key) : null;
}

/** For text shown as-is (a skip reason, an ineligible reason): the translated sentence when known,
 *  otherwise the text unchanged. */
export function localizeBackendText(text: string, t: TFunction): string {
  return backendMessage(text, t) ?? text;
}

/** D3a: an error for a surface that shows the backend's words. A known sentence comes back in the
 *  user's language; anything else is MARKED as untranslated detail ("Compy couldn't finish this.
 *  Details: <English>" / zh-CN the same frame), so English never reads as half of a Chinese sentence.
 *  Never empty: an error with no text still says Compy couldn't finish.
 *
 *  NOT for the `fail` error banner: App.tsx's banner mapper keeps the raw error in the console and
 *  never on screen (the owner's "no String(e) in the face" law), and a MARKED "Details: <raw>" still
 *  puts String(e) on screen (raw text may also carry paths with the Windows user name). Only for a
 *  surface that ALREADY shows backend text unmarked. Deliberately unused: its first use on any screen
 *  needs the owner's ruling on "Details:" on screen vs console-only. */
export function backendDetail(err: unknown, t: TFunction): string {
  const known = backendMessage(err, t);
  if (known) return known;
  const raw = (err instanceof Error ? err.message : err === null || err === undefined ? "" : String(err)).trim();
  return raw ? t("app.backendErrors.unmapped", { detail: raw }) : t("app.backendErrors.unmappedNoDetail");
}

/** B11: EVERY known sentence `err` carries, in the order they appear, joined with a space, in the user's
 *  language; null when it carries none (caller shows its generic line). For reasons that compose a cause and
 *  an outcome (a Trial aborted before measuring: why, then whether the change was put back), so the screen
 *  keeps both. Text between and after the sentences (an OS error) is never shown. */
export function backendMessages(err: unknown, t: TFunction): string | null {
  if (err === null || err === undefined) return null;
  const text = String(err);
  const found = BACKEND_SENTENCES.map((s) => ({ at: text.indexOf(s.text), key: s.key }))
    .filter((f) => f.at >= 0)
    .sort((a, b) => a.at - b.at);
  return found.length ? found.map((f) => t(f.key)).join(" ") : null;
}
