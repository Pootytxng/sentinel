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
  // C6: the fixed refusals an undo meets in front of the audited one (experiment::rollback_change →
  // gaming_orchestrator::plain_change_gate), so a stopped undo walk can say why in the user's language.
  // Consts in gaming_orchestrator.rs. The Trial/benchmark plan-class refusal carries the setting's title,
  // so it is not a fixed sentence and is not mapped: an unmapped reason is never shown.
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
