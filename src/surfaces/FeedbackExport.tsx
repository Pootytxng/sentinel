import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ExportResult } from "../types";

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

function buildMailto(notes: string, r: ExportResult, subjectTag: string): string {
  const subject = `Compy feedback${subjectTag ? ` — ${subjectTag}` : ""}`;
  const note = notes.trim() || "(no note written — the saved report has the diagnostics)";
  const snapshot = r.discord?.trim() ? `\n\n— system snapshot —\n${r.discord.trim()}` : "";
  const pointer = `\n\nFull diagnostic report saved on this PC:\n${r.path}\n(reply and I'll ask for it if I need more detail)`;
  let body = note + snapshot + pointer;
  if (body.length > MAILTO_BODY_MAX) {
    // Drop the inline snapshot first (it's in the saved report), then trim the note if still over.
    const room = MAILTO_BODY_MAX - pointer.length - 48;
    const trimmedNote =
      note.length > room ? note.slice(0, Math.max(0, room)).trimEnd() + "\n…(trimmed — full text in the saved report)" : note;
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
      await openUrl(buildMailto(notes, r, subjectTag));
    } catch (e) {
      // The bundle may have saved even if the mail client didn't open — say what actually happened.
      setError(
        result
          ? "Couldn't open your email app. Your report is saved below — you can attach it to an email yourself."
          : "Couldn't build the report. Nothing was sent.",
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
      setError("Couldn't save the report.");
    } finally {
      setBusy(null);
    }
  };

  const onOpenFolder = () => {
    invoke("open_export_folder").catch(() => setError("Couldn't open the exports folder."));
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

  return (
    <section className="set-section" data-testid="feedback-export">
      <h2 className="set-section-title">Feedback &amp; help</h2>
      <p className="receipts-hint">
        Hit a bug, have an idea, or just want to send what Compy sees on your PC? Write a note and
        Compy builds a diagnostic report for you. <strong>Nothing is sent automatically</strong> —
        "Email it to me" opens your own email app with everything filled in, and a copy is always
        saved on your PC either way.
      </p>

      <textarea
        className="fb-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
        maxLength={NOTES_MAX}
        rows={4}
        placeholder="What's working, what's broken, or what you'd want next…"
        aria-label="Your feedback"
        spellCheck
      />
      <div className="fb-count">
        {notes.length}/{NOTES_MAX}
      </div>

      <div className="fb-actions">
        <button className="set-action fb-primary" onClick={onEmail} disabled={busy !== null}>
          {busy === "email" ? "Preparing…" : "Email it to me"}
        </button>
        <button className="set-action" onClick={onSave} disabled={busy !== null}>
          {busy === "save" ? "Saving…" : "Save a report file"}
        </button>
      </div>

      {error && <p className="receipts-hint fb-error">{error}</p>}

      {result && (
        <div className="fb-saved">
          <p className="receipts-hint fb-saved-line">
            Saved to <span className="fb-path">{result.path}</span>
          </p>
          <div className="fb-saved-actions">
            <button className="set-action" onClick={onOpenFolder}>
              Open folder
            </button>
            <button className="set-action" onClick={copySummary} disabled={!result.discord}>
              {copied ? "Copied!" : "Copy summary for Discord"}
            </button>
          </div>
          {result.discord && <pre className="receipts-preview fb-summary">{result.discord}</pre>}
        </div>
      )}
    </section>
  );
}

export default FeedbackExport;
