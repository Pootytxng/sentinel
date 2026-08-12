import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ExportResult } from "../types";
import { BentoTile } from "../design/bento/BentoGrid";

// Feedback & Export — the in-app path for beta testers (and later, everyone) to send Kuya a note
// plus a diagnostic snapshot without hand-writing a checklist into an email. ALWAYS visible (not a
// dark gate): this is the trust/help surface, not a flagged feature.
//
// Outbound boundary (deliberate): NOTHING is sent automatically. "Email it to me" reuses the same
// fully-local `export_report` bundle the header always wrote, then opens the user's OWN mail client
// with everything pre-filled — the user still presses send. A copy is always saved to disk too, so
// the report survives even if they never send. The gated auto-POST variant ("send straight to Compy")
// is a separate future surface with its own spec + security review + owner sign-off — not this.

// Owner intake. Personal box today (organic beta seed); flip to feedback@compy.gg at public launch —
// this one constant is the whole change. Reversible, single source of truth.
const INTAKE_EMAIL = "christian.mcniel@gmail.com";
// Mirrors the backend FEEDBACK_MAX_CHARS cap (export.rs) so the counter matches what actually lands.
const NOTES_MAX = 4000;
// Keep the mailto: URL within what real mail clients accept — the FULL note always lives in the saved
// report, so trimming the inline email copy loses nothing.
const MAILTO_BODY_MAX = 1900;

// `t` is threaded in (not read from a hook) because this is a module-level pure helper — the compose
// window it builds is part of the localized UI, so its subject + body scaffolding follow the app language.
function buildMailto(notes: string, r: ExportResult, subjectTag: string, t: TFunction): string {
  const base = t("settings.feedback.mailSubject");
  const subject = subjectTag ? `${base} — ${subjectTag}` : base;
  const note = notes.trim() || t("settings.feedback.mailNoNote");
  const snapshot = r.discord?.trim() ? `\n\n${t("settings.feedback.mailSnapshotHeader")}\n${r.discord.trim()}` : "";
  const pointer = `\n\n${t("settings.feedback.mailPointer", { path: r.path })}`;
  let body = note + snapshot + pointer;
  if (body.length > MAILTO_BODY_MAX) {
    // Drop the inline snapshot first (it's in the saved report), then trim the note if still over.
    const room = MAILTO_BODY_MAX - pointer.length - 48;
    const trimmedNote =
      note.length > room ? note.slice(0, Math.max(0, room)).trimEnd() + "\n" + t("settings.feedback.mailTrimmed") : note;
    body = trimmedNote + pointer;
  }
  return `mailto:${INTAKE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function FeedbackExport({
  appVersion,
  buildStamp,
}: {
  appVersion?: string;
  buildStamp?: string | null;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"email" | "save" | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const subjectTag = [appVersion ? `v${appVersion}` : "", buildStamp || ""].filter(Boolean).join(" · ");

  // Both actions build the same local bundle from the CURRENT notes, so the file always reflects what
  // the tester just typed. Blank notes → null → the backend appends no feedback section (no empty header).
  const generate = async (): Promise<ExportResult> => {
    const feedback = notes.trim() ? notes.trim() : null;
    const r = await invoke<ExportResult>("export_report", { feedback });
    setResult(r);
    return r;
  };

  const onEmail = async () => {
    setBusy("email");
    setError(null);
    try {
      const r = await generate();
      await openUrl(buildMailto(notes, r, subjectTag, t));
    } catch (e) {
      // The bundle may have saved even if the mail client didn't open — say what actually happened.
      setError(
        result
          ? t("settings.feedback.errEmailFailed")
          : t("settings.feedback.errBuildFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    setBusy("save");
    setError(null);
    try {
      await generate();
    } catch {
      setError(t("settings.feedback.errSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const onOpenFolder = () => {
    invoke("open_export_folder").catch(() => setError(t("settings.feedback.errFolderFailed")));
  };

  const copySummary = async () => {
    if (!result?.discord) return;
    try {
      await navigator.clipboard.writeText(result.discord);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the block below is still selectable by hand */
    }
  };

  // Bento conversion (2026-08-12). Full width: the notes textarea is the one control in Settings
  // that genuinely needs the room, and squeezing it into a half tile would make writing a bug
  // report feel like writing into a slot. The testid rides an inner <div> — BentoTile takes a
  // fixed prop set and does not spread, so a testid on the tile itself would be dropped.
  return (
    <BentoTile title={t("settings.feedback.sectionTitle")} span="full">
      <div data-testid="feedback-export">
      <p className="receipts-hint">
        {t("settings.feedback.hintPre")}
        <strong>{t("settings.feedback.hintStrong")}</strong>
        {t("settings.feedback.hintPost")}
      </p>

      <textarea
        className="fb-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
        maxLength={NOTES_MAX}
        rows={4}
        placeholder={t("settings.feedback.notesPlaceholder")}
        aria-label={t("settings.feedback.notesAria")}
        spellCheck
      />
      <div className="fb-count">
        {notes.length}/{NOTES_MAX}
      </div>

      <div className="fb-actions">
        <button className="set-action fb-primary" onClick={onEmail} disabled={busy !== null}>
          {busy === "email" ? t("settings.feedback.preparing") : t("settings.feedback.emailIt")}
        </button>
        <button className="set-action" onClick={onSave} disabled={busy !== null}>
          {busy === "save" ? t("settings.feedback.saving") : t("settings.feedback.saveFile")}
        </button>
      </div>

      {error && <p className="receipts-hint fb-error">{error}</p>}

      {result && (
        <div className="fb-saved">
          <p className="receipts-hint fb-saved-line">
            {t("settings.feedback.savedToPre")}
            <span className="fb-path">{result.path}</span>
          </p>
          <div className="fb-saved-actions">
            <button className="set-action" onClick={onOpenFolder}>
              {t("settings.feedback.openFolder")}
            </button>
            <button className="set-action" onClick={copySummary} disabled={!result.discord}>
              {copied ? t("settings.feedback.copied") : t("settings.feedback.copySummary")}
            </button>
          </div>
          {result.discord && <pre className="receipts-preview fb-summary">{result.discord}</pre>}
        </div>
      )}
      </div>
    </BentoTile>
  );
}

export default FeedbackExport;
