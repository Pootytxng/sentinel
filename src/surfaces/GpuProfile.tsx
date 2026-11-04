import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import "../i18n";
import {
  type GpuProfileSnapshot,
  type FieldDelta,
  readGpuProfiles,
  writeGpuProfileSlot,
  clearGpuProfiles,
  computeGpuProfileDelta,
  hasAnyChange,
  deltaSummary,
} from "../data/gpu-profile-store";
import { type InsightTone, vendorProfileInsights } from "../data/gpu-sensor";

// GPU profile surface — two READ-ONLY, advisory, LOCAL-only tools that change NOTHING on the PC:
//   1. Scope picker (measurement, UI-only): frame the GPU view "Global" (whole-PC) or "Per-game".
//      Just chooses which slice of already-measured data you look at. Reversible — pick the other one.
//   2. Before/after delta: capture the readable GPU state (vendor/model/driver/HAGS/power-mode/peak
//      temp) before and after a change YOU make in the vendor tool, then see a plain-English
//      field-by-field diff. No mutation, no apply — this is the read-only half, NOT the gated Phase-B
//      apply/rollback. The live snapshot is supplied by the parent (the component owns no IO).
// Styled with theme tokens only (no new stylesheet); accent fills use --ix-accent-ink for legible
// on-accent text.

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  border: "1px solid var(--ix-border)",
  borderRadius: "var(--ix-radius, 8px)",
  background: "var(--ix-surface-2, rgba(255,255,255,0.03))",
  padding: "14px 16px",
};

const headingStyle: React.CSSProperties = { fontSize: "var(--type-label)", fontWeight: 600, color: "var(--ix-text-1)" };

// The store formats a boolean field as "On" / "Off" (its tests pin that); the room says it in the
// user's language, and leaves every other value as read (CR-zh-gpu).
function valueText(t: TFunction, key: FieldDelta["key"], text: string): string {
  if (key !== "hagsEnabled") return text;
  return text === "On" ? t("lab.gpuProfile.valueOn") : text === "Off" ? t("lab.gpuProfile.valueOff") : text;
}

const dirGlyph: Record<FieldDelta["direction"], string> = { down: "↓", up: "↑", flat: "→", none: "" };

const btnStyle = (quiet = false): React.CSSProperties => ({
  cursor: "pointer",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: "var(--type-label)",
  fontWeight: 600,
  border: "1px solid var(--ix-border)",
  background: "transparent",
  color: quiet ? "var(--ix-text-3, var(--ix-text-2))" : "var(--ix-text-2)",
});

/**
 * Version-pinned mismatch: pure derive from the computed deltas. Returns a warning ONLY when the
 * driver version genuinely changed between the two snapshots (a "changed" driver row — never an
 * "unknown"/unread one) AND a measurement (peak temp) also moved, so the comparison is confounded.
 * A clean (same-driver) comparison, an unread driver, or a driver bump with nothing measured → null.
 * Read-only/advisory, no perf/FPS claim — it protects an honest before/after, never nags.
 */
function versionMismatch(deltas: FieldDelta[]): { before: string; after: string } | null {
  const driver = deltas.find((d) => d.key === "driverVersion" && d.status === "changed");
  if (!driver) return null;
  const tempMoved = deltas.some((d) => d.key === "peakTempC" && d.status === "changed");
  if (!tempMoved) return null;
  return { before: driver.beforeText, after: driver.afterText };
}

function DeltaRow({ d }: { d: FieldDelta }) {
  const { t } = useTranslation();
  // Temp down = cooler = the good direction; up = warmer. Text/boolean changes are neutral (a driver
  // bump or a mode switch isn't "good" or "bad" on its own — we don't editorialise).
  const changed = d.status === "changed";
  const color =
    changed && d.key === "peakTempC" && d.direction === "down"
      ? "var(--ix-good)"
      : changed && d.key === "peakTempC" && d.direction === "up"
        ? "var(--ix-warn)"
        : changed
          ? "var(--ix-text-1)"
          : "var(--ix-text-2)";
  const cell: React.CSSProperties = { padding: "5px 8px", fontSize: "var(--type-label)", color };
  return (
    <tr>
      <th scope="row" style={{ ...cell, textAlign: "left", fontWeight: 500 }}>
        {/* The store's label is the English source and the fallback (CR-zh-gpu). */}
        {t(`lab.gpuProfile.field.${d.key}`, d.label)}
      </th>
      <td style={cell}>{valueText(t, d.key, d.beforeText)}</td>
      <td style={cell}>
        {valueText(t, d.key, d.afterText)}
        {d.key === "peakTempC" && d.direction !== "none" && d.numericDelta !== 0 ? (
          <span aria-hidden="true"> {dirGlyph[d.direction]}</span>
        ) : null}
      </td>
      <td style={{ ...cell, fontWeight: changed ? 600 : 400 }}>
        {changed ? t("lab.gpuProfile.changed") : d.status === "same" ? t("lab.gpuProfile.noChange") : "—"}
      </td>
    </tr>
  );
}

function GpuProfileDelta({
  currentSnapshot,
  readNow,
}: {
  currentSnapshot?: GpuProfileSnapshot | null;
  readNow?: () => Promise<GpuProfileSnapshot | null>;
}) {
  const { t } = useTranslation();
  const [pair, setPair] = useState(() => readGpuProfiles());
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);

  // A capture reads the GPU NOW when the host can (`readNow`): the parent's snapshot is App's last
  // refresh, so a change made in the driver tool or Windows Settings between the two captures was
  // saved as the old values and reported "No changes" (codebase review 2026-11-03). A failed read
  // captures nothing — never the stale snapshot in its place.
  const capture = useCallback(
    async (slot: "before" | "after") => {
      if (!currentSnapshot || reading) return; // nothing readable right now — do nothing (never fabricate)
      let snap: GpuProfileSnapshot | null = currentSnapshot;
      if (readNow) {
        setReading(true);
        setReadFailed(false);
        try {
          snap = await readNow();
        } catch {
          snap = null;
        } finally {
          setReading(false);
        }
      }
      if (!snap) {
        setReadFailed(true);
        return;
      }
      writeGpuProfileSlot(slot, snap);
      setPair(readGpuProfiles());
    },
    [currentSnapshot, readNow, reading],
  );

  const reset = useCallback(() => {
    clearGpuProfiles();
    setPair(readGpuProfiles());
  }, []);

  const deltas = computeGpuProfileDelta(pair.before, pair.after);
  const bothCaptured = pair.before != null && pair.after != null;
  const changed = hasAnyChange(deltas);
  const mismatch = versionMismatch(deltas);
  const muted: React.CSSProperties = { margin: 0, fontSize: "var(--type-label)", lineHeight: 1.5, color: "var(--ix-text-2)" };

  return (
    <section aria-labelledby="gpu-profile-delta-title" style={panelStyle}>
      <div id="gpu-profile-delta-title" style={headingStyle}>
        {t("lab.gpuProfile.beforeAfterTitle")}
      </div>
      <p style={{ margin: 0, fontSize: "var(--type-label)", lineHeight: 1.45, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        {t("lab.gpuProfile.beforeAfterIntro")}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          style={btnStyle()}
          onClick={() => void capture("before")}
          disabled={!currentSnapshot || reading}
        >
          {pair.before ? t("lab.gpuProfile.recaptureBefore") : t("lab.gpuProfile.captureBefore")}
        </button>
        <button
          type="button"
          style={btnStyle()}
          onClick={() => void capture("after")}
          disabled={!currentSnapshot || reading}
        >
          {pair.after ? t("lab.gpuProfile.recaptureAfter") : t("lab.gpuProfile.captureAfter")}
        </button>
        {(pair.before || pair.after) && (
          <button type="button" style={btnStyle(true)} onClick={reset}>
            {t("lab.gpuProfile.clear")}
          </button>
        )}
      </div>
      {(reading || readFailed) && (
        <p role="status" style={{ margin: 0, fontSize: "var(--type-label)", color: "var(--ix-text-2)" }}>
          {reading ? t("lab.gpuProfile.readingNow") : t("lab.gpuProfile.readFailed")}
        </p>
      )}

      {!currentSnapshot && !pair.before && !pair.after ? (
        <p style={muted}>
          {t("lab.gpuProfile.noReadingYet")}
        </p>
      ) : !bothCaptured ? (
        <p style={muted}>
          {pair.before
            ? t("lab.gpuProfile.beforeSaved")
            : t("lab.gpuProfile.captureToBegin")}
        </p>
      ) : (
        <>
          <p style={{ ...muted, fontWeight: changed ? 600 : 400, color: "var(--ix-text-1)" }}>
            {deltaSummary(deltas, (key, fallback, vars) => t(key, { defaultValue: fallback, ...(vars ?? {}) }))}
          </p>
          {mismatch && (
            <div
              role="status"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                border: "1px solid color-mix(in srgb, var(--ix-amber, #fbbf3c) 55%, transparent)",
                borderRadius: "var(--ix-radius, 8px)",
                background: "color-mix(in srgb, var(--ix-amber, #fbbf3c) 10%, transparent)",
                padding: "9px 11px",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "var(--type-label)", lineHeight: 1.5, color: "var(--ix-amber, #fbbf3c)" }}>
                ⚠
              </span>
              <p style={{ margin: 0, fontSize: "var(--type-label)", lineHeight: 1.5, color: "var(--ix-text-1, #f2f3f7)" }}>
                {t("lab.gpuProfile.driverMismatchWarning", {
                  before: mismatch.before,
                  after: mismatch.after,
                })}
              </p>
            </div>
          )}
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ color: "var(--ix-text-3, var(--ix-text-2))", fontSize: "var(--type-label)" }}>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  {t("lab.gpuProfile.colSetting")}
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  {t("lab.gpuProfile.colBefore")}
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  {t("lab.gpuProfile.colAfter")}
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  {t("lab.gpuProfile.colDelta")}
                </th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <DeltaRow key={d.key} d={d} />
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0, fontSize: "var(--type-label)", lineHeight: 1.4, color: "var(--ix-text-3, var(--ix-text-2))" }}>
            {t("lab.gpuProfile.footnote")}
          </p>
        </>
      )}
    </section>
  );
}

// Tone → the border/dot color token for an advisory badge. Text stays --ix-text for legibility on any
// theme (we tint only the accent border + dot, never the body copy — a bug→guard legibility rule).
const toneColor: Record<InsightTone, string> = {
  good: "var(--ready, #46d98a)",
  caution: "var(--attention, #f5b740)",
  info: "var(--ix-accent, #7c8cff)",
};

/**
 * READ-ONLY vendor-aware advisory badges (A4). Renders only when the live snapshot resolves to a
 * vendor Compy has honest advice for (AMD today) — otherwise nothing, so we never mis-advise another
 * vendor. Pure derive from `vendorProfileInsights`; changes nothing, promises no FPS/perf.
 */
function GpuVendorInsights({ currentSnapshot }: { currentSnapshot?: GpuProfileSnapshot | null }) {
  const { t } = useTranslation();
  if (!currentSnapshot) return null;
  const insights = vendorProfileInsights(currentSnapshot, t);
  if (insights.length === 0) return null;

  return (
    <section aria-label={t("lab.gpuProfile.vendorInsightsAriaLabel")} style={panelStyle}>
      <div style={headingStyle}>{t("lab.gpuProfile.vendorInsightsTitle")}</div>
      <p style={{ margin: 0, fontSize: "var(--type-label)", lineHeight: 1.45, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        {t("lab.gpuProfile.vendorInsightsIntro")}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {insights.map((i) => (
          <li
            key={i.key}
            style={{
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
              border: `1px solid color-mix(in srgb, ${toneColor[i.tone]} 45%, var(--ix-border))`,
              borderRadius: "var(--ix-radius, 8px)",
              background: `color-mix(in srgb, ${toneColor[i.tone]} 7%, transparent)`,
              padding: "9px 11px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                marginTop: 5,
                flex: "0 0 auto",
                width: 8,
                height: 8,
                borderRadius: 999,
                background: toneColor[i.tone],
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: "var(--type-label)", fontWeight: 600, color: "var(--ix-text-1)" }}>{i.title}</span>
              <span style={{ fontSize: "var(--type-label)", lineHeight: 1.5, color: "var(--ix-text-2)" }}>{i.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The GPU profile surface: the vendor-aware advisory badges (plain-English notes for YOUR GPU) and the
 * read-only before/after delta (what moved when you changed something in your driver tool). Both are
 * local, advisory, and change nothing on the PC. The Global / Per-game scope picker that used to sit
 * above them was removed (CR-gpu-picker, 2026-11-04): nothing read the chosen scope, so it framed
 * nothing and promised a per-game view that did not exist.
 * `currentSnapshot` is the parent-supplied live GPU read for the badges + delta card.
 */
export function GpuProfile({
  currentSnapshot,
  readNow,
}: {
  currentSnapshot?: GpuProfileSnapshot | null;
  /** Reads the GPU fresh for a before/after capture (LabGround wires it). Absent → the snapshot. */
  readNow?: () => Promise<GpuProfileSnapshot | null>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GpuVendorInsights currentSnapshot={currentSnapshot} />
      <GpuProfileDelta currentSnapshot={currentSnapshot} readNow={readNow} />
    </div>
  );
}
