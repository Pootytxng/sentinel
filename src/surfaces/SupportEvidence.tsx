import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { EvidencePreview, SupportExport, SupportProjection } from "../types";
import { BentoTile } from "../design/bento/BentoGrid";

// Q5 support evidence — the user-facing half of src-tauri/src/support_evidence.rs (spec
// 2026-07-29-product-quality-stabilization-program §12: "the user can inspect the bundle before
// export"). The Rust side ENFORCES that ordering — export_support_evidence returns Err until
// preview_support_evidence has run this session — so the export control only appears once a
// preview has actually come back. A disabled button the user can't explain is a dead end; a
// control that appears when it becomes true tells the story on its own.
//
// The three projections are all returned by ONE preview call over ONE bundle, so switching between
// them is a local re-render, not a second read of the disk — and no projection can surface
// something another one hides. Retention numbers are rendered from the bundle the backend actually
// enforces rather than restated here, so this copy can never drift from the caps.
//
// NOTHING here uploads: Compy has no transport for this file. The user reads it, saves it, and
// attaches it to a support conversation themselves. Copy mirrors docs/PRIVACY.md deliberately —
// one description of the support record, restated, not a second one that can drift.

const PROJECTIONS: SupportProjection[] = ["consumer", "technical", "support"];

type Busy = "preview" | "export" | "clear" | null;

/** `allowClear` (default true): the Care view's "Beyond Compy" box passes false, so the permanent
 *  delete isn't offered right where the user is about to share the record. */
export function SupportEvidence({ allowClear = true }: { allowClear?: boolean } = {}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [projection, setProjection] = useState<SupportProjection>("consumer");
  const [saved, setSaved] = useState<SupportExport | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const k = (key: string) => `settings.supportEvidence.${key}`;

  async function readIt() {
    setBusy("preview");
    setError(null);
    setNotice(null);
    try {
      setPreview(await invoke<EvidencePreview>("preview_support_evidence"));
    } catch (e) {
      setPreview(null);
      setError(t(k("errPreview"), { detail: String(e) }));
    } finally {
      setBusy(null);
    }
  }

  async function saveIt() {
    setBusy("export");
    setError(null);
    setNotice(null);
    try {
      setSaved(await invoke<SupportExport>("export_support_evidence", { projection }));
    } catch (e) {
      setSaved(null);
      setError(t(k("errExport"), { detail: String(e) }));
    } finally {
      setBusy(null);
    }
  }

  async function clearIt() {
    setBusy("clear");
    setError(null);
    setNotice(null);
    try {
      await invoke("clear_support_evidence");
      setConfirmClear(false);
      setSaved(null);
      setNotice(t(k("cleared")));
      // Re-read so the panel shows the empty record it now is, instead of the stale one the user
      // just deleted. A preview already happened, so this cannot trip the backend's ordering gate.
      if (preview) setPreview(await invoke<EvidencePreview>("preview_support_evidence"));
    } catch (e) {
      setError(t(k("errClear"), { detail: String(e) }));
    } finally {
      setBusy(null);
    }
  }

  function openFolder() {
    invoke("open_export_folder").catch(() => setError(t(k("errFolderFailed"))));
  }

  const bundle = preview?.bundle;
  const count = bundle?.events.length ?? 0;
  const metaKey = count === 0 ? "metaEmpty" : count === 1 ? "metaOne" : "meta";
  const unreadable = bundle?.unreadable_records ?? 0;

  // Bento conversion (2026-08-12). A third-width tile that LEADS the row directly beneath the
  // full-width Feedback tile, so the "same errand" pairing above survives the grid. The testid
  // rides an inner <div> — BentoTile takes a fixed prop set and does not spread.
  return (
    <BentoTile title={t(k("sectionTitle"))} span="third">
      <div data-testid="support-evidence">
      <p className="receipts-hint">
        {t(k("hintPre"))}
        <strong>{t(k("hintStrong"))}</strong>
        {t(k("hintPost"))}
      </p>

      <div className="fb-actions">
        <button className="set-action fb-primary" onClick={readIt} disabled={busy !== null}>
          {busy === "preview" ? t(k("reading")) : t(k(preview ? "showAgain" : "show"))}
        </button>
        {preview && (
          <button className="set-action" onClick={saveIt} disabled={busy !== null}>
            {busy === "export" ? t(k("saving")) : t(k("saveFile"))}
          </button>
        )}
      </div>

      {error && <p className="receipts-hint fb-error">{error}</p>}
      {notice && <p className="receipts-hint sev-notice">{notice}</p>}

      {preview && bundle && (
        <div className="sev-preview">
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t(k("detailTitle"))}</div>
              <div className="set-row-sub">{t(k("detailSub"))}</div>
            </div>
            <div className="set-seg" role="group" aria-label={t(k("detailTitle"))}>
              {PROJECTIONS.map((p) => (
                <button
                  key={p}
                  className={`set-seg-btn ${projection === p ? "set-seg-on" : ""}`}
                  aria-pressed={projection === p}
                  onClick={() => setProjection(p)}
                >
                  {t(k(p))}
                </button>
              ))}
            </div>
          </div>

          <pre
            className="receipts-preview sev-text"
            tabIndex={0}
            role="group"
            aria-label={t(k("previewAria"))}
          >
            {preview[projection]}
          </pre>

          <p className="receipts-hint sev-meta">
            {t(k(metaKey), { n: count, location: bundle.location })}
          </p>
          {unreadable > 0 && (
            <p className="receipts-hint sev-meta">
              {t(k(unreadable === 1 ? "unreadableOne" : "unreadable"), { n: unreadable })}
            </p>
          )}
          <p className="receipts-hint sev-meta">
            {t(k("retention"), {
              events: bundle.retention.max_events,
              kb: Math.round(bundle.retention.max_bytes / 1024),
            })}
          </p>
        </div>
      )}

      {saved && (
        <div className="fb-saved">
          <p className="receipts-hint fb-saved-line">
            {t(k("savedToPre"))}
            <span className="fb-path">{saved.path}</span>
          </p>
          <div className="fb-saved-actions">
            <button className="set-action" onClick={openFolder}>
              {t(k("openFolder"))}
            </button>
          </div>
        </div>
      )}

      {allowClear && (
      <div className="sev-clear">
        {confirmClear ? (
          <>
            <p className="receipts-hint sev-warn">{t(k("clearWarn"))}</p>
            <div className="fb-actions">
              {/* "Keep it" carries the accent: the safe answer is the emphasised one. */}
              <button
                className="set-action fb-primary"
                onClick={() => setConfirmClear(false)}
                disabled={busy !== null}
              >
                {t(k("clearCancel"))}
              </button>
              <button className="set-action" onClick={clearIt} disabled={busy !== null}>
                {busy === "clear" ? t(k("clearing")) : t(k("clearConfirm"))}
              </button>
            </div>
          </>
        ) : (
          <button
            className="set-action"
            onClick={() => {
              setConfirmClear(true);
              setError(null);
              setNotice(null);
            }}
            disabled={busy !== null}
          >
            {t(k("clear"))}
          </button>
        )}
      </div>
      )}
      </div>
    </BentoTile>
  );
}

export default SupportEvidence;
