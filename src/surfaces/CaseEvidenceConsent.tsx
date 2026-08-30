// Q9b Tier 3 — the case preview / consent screen. STAGE 2 (#258): the screen only.
//
// WHAT THIS IS. Contract §3 says "the preview is the payload": before a case is sent, the user sees
// the exact bytes, can strike any optional field out of them, and gives permission for ONE
// submission. This component is that screen, and nothing else.
//
// WHAT IT DELIBERATELY CANNOT DO. It has no serializer. It never builds, formats, sorts or
// re-summarises the payload — it is handed a `preview` function and renders whatever that returns,
// verbatim. Today the fixture rig injects a lookup into `src/case-preview-corpus.json`, every byte
// of which was produced by `case_preview()` in `src-tauri/src/case_evidence_upload.rs` (the corpus
// is generated and drift-checked by that module's own tests). At Stage 4 the same prop takes the
// Tauri command instead, and nothing else here changes. That seam is the whole design: a second
// implementation of the canonical bytes — in TypeScript, free to drift the day a field is added —
// is exactly what §3 exists to prevent, and it is the version of this screen that would have been
// easy to write.
//
// The plain-English rows below are not a parallel summary either: they are derived by PARSING the
// canonical text, so a row cannot claim a field the bytes do not carry. That is pinned by test.
//
// NOT REACHABLE IN A SHIPPED BUILD. Nothing in src/ imports this file — `reachability-guard`
// carries the entry and the reason. It sends nothing, stores nothing, schedules nothing and has no
// network call of any kind; Stage 4 is where a send path is even allowed to exist, behind
// `case_evidence_gate()`, which is a hard-false constant today.
//
// NONE OF THAT IS PROSE. `src/case-evidence-consent-guard.test.ts` fails the build on any of it —
// the imports are an allowlist, the capability bans are source-shape detectors with seeded positive
// controls, and the copy below is pinned phrase by phrase against what the Rust redactor can
// actually deliver. Change a promise here and that file is where the argument happens.
//
// COPY IS HARD-CODED ENGLISH, ON PURPOSE. The locale-parity guard requires every en key to exist in
// zh-CN. Adding keys here would force Chinese translations of a privacy promise no user can reach
// yet — and a machine-translated consent sentence is a wrong promise in another language, which is
// worse than an untranslated one. The copy is still graded: plain-language-guard and voice-guard
// both scan every .tsx in src/. i18n lands when the surface does (Stage 9), not before.

import { useMemo, useState } from "react";
import "./CaseEvidenceConsent.css";

/** The removable units of contract §2, in the order the screen lists them. */
export type CaseRemovableUnit =
  | "user_comment"
  | "app_family"
  | "module_family"
  | "error_code"
  /** §2C makes the four hardware fields removable "as one block", never individually. */
  | "hardware"
  | "windows_build"
  | "gpu_driver_version";

/** Exactly `case_preview()`'s two fields (`CasePreview` in case_evidence_upload.rs). */
export type CasePreviewText = { shape: string; payload_json: string };

export type CaseEvidenceConsentProps = {
  /** Which units this case actually offers. A unit not listed gets no remove control. */
  removable: CaseRemovableUnit[];
  /**
   * The ONE authority on bytes. Returns null when the remaining case has no shape at all —
   * `case_payload_json` refuses that payload too, so the screen must refuse to show one.
   */
  preview: (removed: CaseRemovableUnit[]) => CasePreviewText | null;
  /** Presentational only. There is no send state machine here, and no stage that allows one yet. */
  status?: "idle" | "working";
  /** Rendered as-is when the host reports a failure. Never assembled from a code path here. */
  errorText?: string | null;
  /** Consent for ONE submission. The host decides what that means; this file sends nothing. */
  onSend?: (removed: CaseRemovableUnit[]) => void;
};

/** Which unit removes a given payload key. `null` = required, so no remove control (§2). */
const UNIT_OF_KEY: Record<string, CaseRemovableUnit | null> = {
  schema_version: null,
  compy_version: null,
  user_comment: "user_comment",
  incident_kind: null,
  occurred_at: null,
  app_family: "app_family",
  module_family: "module_family",
  error_code: "error_code",
  gpu_vendor: "hardware",
  gpu_model: "hardware",
  cpu_family: "hardware",
  ram_gb_bucket: "hardware",
  windows_build: "windows_build",
  gpu_driver_version: "gpu_driver_version",
};

/** Plain names for a person whose PC just crashed. No field name reaches the screen bare. */
const LABEL_OF_KEY: Record<string, string> = {
  schema_version: "Report format",
  compy_version: "Your Compy version",
  user_comment: "What you wrote",
  incident_kind: "What went wrong",
  occurred_at: "When it happened",
  app_family: "Which program",
  module_family: "Which file inside it failed",
  error_code: "Windows error code",
  gpu_vendor: "Graphics card maker",
  gpu_model: "Graphics card",
  cpu_family: "Processor",
  ram_gb_bucket: "Memory, in GB",
  windows_build: "Windows build number",
  gpu_driver_version: "Graphics driver",
};

const HARDWARE_KEYS = ["gpu_vendor", "gpu_model", "cpu_family", "ram_gb_bucket"];

/** The §1 shape strings, said again in words the person reading them has not had to learn. */
const SHAPE_GLOSS: Record<string, string> = {
  "comment only": "just your message. No crash details go with it.",
  "incident evidence only": "just the crash details below. Nothing you wrote.",
  "comment + incident evidence": "your message, and the details of one crash.",
};

type Row =
  | { kind: "field"; key: string; label: string; value: string; unit: CaseRemovableUnit | null }
  | { kind: "hardware"; label: string; values: { label: string; value: string }[] };

/**
 * Rows are read out of the canonical TEXT, never out of a payload object the screen holds. If the
 * bytes do not carry a field, no row can invent it; if they carry one this file has no label for,
 * the key itself is shown rather than hidden — an unlabelled row is a visible defect, a dropped
 * row is an invisible one.
 */
function rowsFrom(payloadJson: string): Row[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const rows: Row[] = [];
  let hardwareDone = false;
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    // `String`, never `JSON.stringify`: this file must hold no route that can turn a value back
    // into JSON. Every §2 field is a string or a number, so a scalar cast is the whole job, and a
    // guard can then pin the absence of a serializer here structurally.
    const value = String(raw);
    if (HARDWARE_KEYS.includes(key)) {
      if (hardwareDone) continue;
      hardwareDone = true;
      rows.push({
        kind: "hardware",
        label: "Your PC",
        values: HARDWARE_KEYS.filter((k) => k in (parsed as object)).map((k) => ({
          label: LABEL_OF_KEY[k] ?? k,
          value: String((parsed as Record<string, unknown>)[k]),
        })),
      });
      continue;
    }
    rows.push({ kind: "field", key, label: LABEL_OF_KEY[key] ?? key, value, unit: UNIT_OF_KEY[key] ?? null });
  }
  return rows;
}

export function CaseEvidenceConsent({
  removable,
  preview,
  status = "idle",
  errorText = null,
  onSend,
}: CaseEvidenceConsentProps) {
  const [removed, setRemoved] = useState<CaseRemovableUnit[]>([]);

  // Re-derived on every removal — that IS the "removing re-renders the payload" requirement (§3),
  // and it is why the screen holds a removal set rather than a payload of its own.
  const current = useMemo(() => preview(removed), [preview, removed]);
  const rows = useMemo(() => (current ? rowsFrom(current.payload_json) : null), [current]);

  const remove = (unit: CaseRemovableUnit) =>
    setRemoved((prev) => (prev.includes(unit) ? prev : [...prev, unit]));

  if (!current) {
    return (
      <section className="cec" data-testid="case-consent">
        <h2 className="cec-title">Send this case to Compy support</h2>
        <p className="cec-empty" data-testid="case-consent-empty">
          There is nothing to send. A case needs either something you wrote or one crash to report.
        </p>
      </section>
    );
  }

  if (!rows) {
    return (
      <section className="cec" data-testid="case-consent">
        <h2 className="cec-title">Send this case to Compy support</h2>
        <p className="cec-error" role="alert" data-testid="case-consent-unreadable">
          Compy could not read the text it was about to send, so it will not send it. Nothing has
          left this PC.
        </p>
      </section>
    );
  }

  const removedCount = removed.length;

  return (
    <section className="cec" data-testid="case-consent">
      <h2 className="cec-title">Send this case to Compy support</h2>

      <p className="cec-shape" data-testid="case-consent-shape">
        You are sending <strong>{current.shape}</strong> — {SHAPE_GLOSS[current.shape] ?? ""}
      </p>

      <h3 className="cec-heading">Everything that would be sent</h3>
      <p className="cec-hint">
        Every line is below, in full. Anything with a <em>Remove</em> button is optional — take it
        out and the text underneath changes with it.
      </p>

      <ul className="cec-rows" data-testid="case-consent-rows">
        {rows.map((row) =>
          row.kind === "hardware" ? (
            <li className="cec-row" key="hardware" data-testid="case-row-hardware">
              <div className="cec-row-text">
                <div className="cec-row-label">{row.label}</div>
                <div className="cec-row-value">
                  {row.values.map((v) => (
                    <span className="cec-chip" key={v.label}>
                      <span className="cec-chip-label">{v.label}</span>
                      {v.value}
                    </span>
                  ))}
                </div>
              </div>
              {removable.includes("hardware") && (
                <button
                  type="button"
                  className="cec-remove"
                  aria-label="Remove Your PC"
                  onClick={() => remove("hardware")}
                >
                  Remove
                </button>
              )}
            </li>
          ) : (
            <li className="cec-row" key={row.key} data-testid={`case-row-${row.key}`}>
              <div className="cec-row-text">
                <div className="cec-row-label">{row.label}</div>
                <div className="cec-row-value">{row.value}</div>
              </div>
              {row.unit && removable.includes(row.unit) && (
                <button
                  type="button"
                  className="cec-remove"
                  aria-label={`Remove ${row.label}`}
                  onClick={() => remove(row.unit as CaseRemovableUnit)}
                >
                  Remove
                </button>
              )}
            </li>
          ),
        )}
      </ul>

      {removedCount > 0 && (
        <p className="cec-hint" data-testid="case-consent-removed-note">
          {removedCount === 1 ? "One thing was taken out" : `${removedCount} things were taken out`} —
          it is gone from the text below too.
        </p>
      )}

      {/* OPEN by default, and that is a contract decision rather than a style one. §3 is "the
          preview is the payload": the exact bytes have to be on screen, not one click away behind
          a control a hurried person never opens. Collapsing is offered because a wall of JSON is
          DIR-1's intimidation failure — but the user folds it away, Compy never folds it for them. */}
      <details className="cec-exact" open>
        <summary className="cec-exact-summary">The exact text that gets sent</summary>
        <p className="cec-hint">
          This is the whole thing, character for character. Nothing else is attached to it.
        </p>
        <pre className="cec-payload" data-testid="case-consent-payload">
          {current.payload_json}
        </pre>
      </details>

      <h3 className="cec-heading">What happens to it</h3>
      <ul className="cec-facts">
        <li>It goes to Compy&apos;s own store on compy.gg, and nowhere else.</li>
        <li>It is deleted after 30 days. That deadline is set when it arrives and does not move.</li>
        <li>
          You get back a ticket number, so support can find your case, and a deletion code. The code
          is the only way to delete this case before the 30 days are up — Compy cannot look it up
          for you, so keep it if you want that option.
        </li>
        <li>
          Before your message leaves, Compy screens it for usernames, IP addresses, computer names,
          keys and serials, and replaces what it finds with markers like <code>&lt;path&gt;</code>.
          That screening is best-effort, not a guarantee: read the text above and take out anything
          you would not want a stranger to read.
        </li>
        <li>
          Pressing the button gives permission for this one send. Nothing is remembered, nothing is
          switched on, and a second case asks you again from scratch.
        </li>
      </ul>

      {errorText && (
        <p className="cec-error" role="alert" data-testid="case-consent-error">
          {errorText}
        </p>
      )}

      <div className="cec-consent">
        <button
          type="button"
          className="cec-send"
          disabled={status === "working"}
          onClick={() => onSend?.(removed)}
        >
          {status === "working" ? "Sending…" : "Send this one case"}
        </button>
        <p className="cec-hint cec-consent-note">
          Nothing has been sent yet. This is the last step, and it is yours.
        </p>
      </div>
    </section>
  );
}
