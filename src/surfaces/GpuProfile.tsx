import { useState, useCallback } from "react";
import { GPU_SCOPES, gpuScopeMeta } from "../data/profile-store";
import { useGpuProfileScope } from "../hooks/use-gpu-profile-scope";
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

const headingStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--ix-text)" };

function GpuProfileScopePicker() {
  const { scope, setScope } = useGpuProfileScope();
  const active = gpuScopeMeta(scope);

  return (
    <section aria-label="GPU profile scope" style={panelStyle}>
      <div style={headingStyle}>GPU profile view</div>

      <div
        role="radiogroup"
        aria-label="GPU profile scope"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {GPU_SCOPES.map((s) => {
          const meta = gpuScopeMeta(s);
          const selected = s === scope;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setScope(s)}
              style={{
                cursor: "pointer",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                border: selected ? "1px solid var(--ix-accent)" : "1px solid var(--ix-border)",
                background: selected ? "var(--ix-accent)" : "transparent",
                color: selected ? "var(--ix-accent-ink)" : "var(--ix-text-2)",
              }}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ix-text-2)" }}>
        {active.blurb}
      </p>

      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        This just frames what you look at — it changes nothing on your PC.
      </p>
    </section>
  );
}

const dirGlyph: Record<FieldDelta["direction"], string> = { down: "↓", up: "↑", flat: "→", none: "" };

const btnStyle = (quiet = false): React.CSSProperties => ({
  cursor: "pointer",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12.5,
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
  // Temp down = cooler = the good direction; up = warmer. Text/boolean changes are neutral (a driver
  // bump or a mode switch isn't "good" or "bad" on its own — we don't editorialise).
  const changed = d.status === "changed";
  const color =
    changed && d.key === "peakTempC" && d.direction === "down"
      ? "var(--ix-good, var(--ix-text))"
      : changed && d.key === "peakTempC" && d.direction === "up"
        ? "var(--ix-warn, var(--ix-text))"
        : changed
          ? "var(--ix-text)"
          : "var(--ix-text-2)";
  const cell: React.CSSProperties = { padding: "5px 8px", fontSize: 12.5, color };
  return (
    <tr>
      <th scope="row" style={{ ...cell, textAlign: "left", fontWeight: 500 }}>
        {d.label}
      </th>
      <td style={cell}>{d.beforeText}</td>
      <td style={cell}>
        {d.afterText}
        {d.key === "peakTempC" && d.direction !== "none" && d.numericDelta !== 0 ? (
          <span aria-hidden="true"> {dirGlyph[d.direction]}</span>
        ) : null}
      </td>
      <td style={{ ...cell, fontWeight: changed ? 600 : 400 }}>
        {changed ? "Changed" : d.status === "same" ? "No change" : "—"}
      </td>
    </tr>
  );
}

function GpuProfileDelta({ currentSnapshot }: { currentSnapshot?: GpuProfileSnapshot | null }) {
  const [pair, setPair] = useState(() => readGpuProfiles());

  const capture = useCallback(
    (slot: "before" | "after") => {
      if (!currentSnapshot) return; // nothing readable right now — do nothing (never fabricate)
      writeGpuProfileSlot(slot, currentSnapshot);
      setPair(readGpuProfiles());
    },
    [currentSnapshot],
  );

  const reset = useCallback(() => {
    clearGpuProfiles();
    setPair(readGpuProfiles());
  }, []);

  const deltas = computeGpuProfileDelta(pair.before, pair.after);
  const bothCaptured = pair.before != null && pair.after != null;
  const changed = hasAnyChange(deltas);
  const mismatch = versionMismatch(deltas);
  const muted: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ix-text-2)" };

  return (
    <section aria-labelledby="gpu-profile-delta-title" style={panelStyle}>
      <div id="gpu-profile-delta-title" style={headingStyle}>
        Before &amp; after
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        Capture your GPU&apos;s readable settings before and after a change you make in your driver
        tool, then see exactly what moved. Read-only — Compy changes nothing here.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btnStyle()} onClick={() => capture("before")} disabled={!currentSnapshot}>
          {pair.before ? "Re-capture before" : "Capture before"}
        </button>
        <button type="button" style={btnStyle()} onClick={() => capture("after")} disabled={!currentSnapshot}>
          {pair.after ? "Re-capture after" : "Capture after"}
        </button>
        {(pair.before || pair.after) && (
          <button type="button" style={btnStyle(true)} onClick={reset}>
            Clear
          </button>
        )}
      </div>

      {!currentSnapshot && !pair.before && !pair.after ? (
        <p style={muted}>
          No GPU reading is available yet — once your GPU details load you can capture a snapshot.
        </p>
      ) : !bothCaptured ? (
        <p style={muted}>
          {pair.before
            ? "Before snapshot saved. Make your change, then capture after."
            : "Capture a before snapshot to begin."}
        </p>
      ) : (
        <>
          <p style={{ ...muted, fontWeight: changed ? 600 : 400, color: "var(--ix-text)" }}>
            {deltaSummary(deltas)}
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
              <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ix-amber, #fbbf3c)" }}>
                ⚠
              </span>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--ix-text-1, #f2f3f7)" }}>
                Your driver changed too ({mismatch.before} → {mismatch.after}), so this isn&apos;t a
                clean before/after of just your setting. Re-capture both on the same driver to compare
                fairly.
              </p>
            </div>
          )}
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ color: "var(--ix-text-3, var(--ix-text-2))", fontSize: 11.5 }}>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Setting
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Before
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  After
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Delta
                </th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <DeltaRow key={d.key} d={d} />
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--ix-text-3, var(--ix-text-2))" }}>
            Snapshots are stored only on this PC. A dash means that value wasn&apos;t readable in one
            of the snapshots, so it isn&apos;t counted as a change.
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
  if (!currentSnapshot) return null;
  const insights = vendorProfileInsights(currentSnapshot);
  if (insights.length === 0) return null;

  return (
    <section aria-label="Vendor advisory insights" style={panelStyle}>
      <div style={headingStyle}>For your Radeon GPU</div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        Plain-English notes tailored to your GPU, read from settings Compy already sees. Advisory only
        — Compy changes nothing here.
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
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ix-text)" }}>{i.title}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ix-text-2)" }}>{i.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The GPU profile surface: the scope picker (which slice you look at), the vendor-aware advisory
 * badges (plain-English notes for YOUR GPU), and the read-only before/after delta (what moved when
 * you changed something in your driver tool). All are local, advisory, and change nothing on the PC.
 * `currentSnapshot` is the parent-supplied live GPU read for the badges + delta card.
 */
export function GpuProfile({ currentSnapshot }: { currentSnapshot?: GpuProfileSnapshot | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GpuProfileScopePicker />
      <GpuVendorInsights currentSnapshot={currentSnapshot} />
      <GpuProfileDelta currentSnapshot={currentSnapshot} />
    </div>
  );
}
